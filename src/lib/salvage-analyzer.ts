/**
 * salvage-analyzer.ts — Phase C3 semantic intelligence
 *
 * Diff abandoned branch symbols vs main and report unique symbols
 * not present in main (salvageable code). Wired into `rescue --symbols`.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractSymbols } from './symbol-extractor.js';
import { validateBranchName } from './security.js';

export interface SalvageableSymbol {
  name: string;
  kind: string;
  line: number;
  file: string;
  branch: string;
}

export interface SalvageReport {
  branch: string;
  analysedFiles: number;
  salvageable: SalvageableSymbol[];
  alreadyInMain: number;
  /**
   * Files whose branch- or main-side version could not be parsed. Their symbols
   * are UNKNOWN — they are neither confirmed salvageable nor confirmed
   * superseded. A non-empty list means the "fully superseded" verdict cannot be
   * trusted (deleting the branch could lose un-analysable work).
   */
  unparseableFiles: string[];
}

/**
 * Analyse an abandoned branch for symbols not present in main.
 * Uses ts-morph (via symbol-extractor) for reliable TypeScript parsing.
 */
export async function analyzeSalvage(
  branch: string,
  mainRef = 'main',
): Promise<SalvageReport> {
  // Validate inputs before passing to git to prevent injection
  validateBranchName(branch);
  validateBranchName(mainRef);

  const report: SalvageReport = {
    branch,
    analysedFiles: 0,
    salvageable: [],
    alreadyInMain: 0,
    unparseableFiles: [],
  };

  // List TypeScript/JavaScript files in the abandoned branch
  let branchFiles: string[];
  try {
    const raw = execFileSync('git', ['ls-tree', '-r', '--name-only', branch], {
      encoding: 'utf-8',
    });
    branchFiles = raw
      .trim()
      .split('\n')
      .filter(f => /\.(ts|js|tsx|jsx)$/.test(f) && !f.includes('node_modules'));
  } catch {
    return report;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'ssan-salvage-'));

  try {
    for (const file of branchFiles) {
      // Get file content from the abandoned branch
      let branchContent: string;
      try {
        branchContent = execFileSync('git', ['show', `${branch}:${file}`], {
          encoding: 'utf-8',
        });
      } catch {
        continue;
      }

      // Write to temp file for ts-morph
      const tmpFile = join(tmpDir, file.replace(/\//g, '_'));
      writeFileSync(tmpFile, branchContent, 'utf-8');

      const branchSymbols = extractSymbols(tmpFile);

      if (branchSymbols.parseError) {
        // Could not parse the branch's version — we CANNOT conclude this file
        // has no unique symbols. Recording it as "analysed with 0 salvageable"
        // would make the branch look superseded (safe to delete) when it isn't.
        report.unparseableFiles.push(file);
        continue;
      }

      // Get main version (may not exist)
      let mainContent: string | null = null;
      try {
        mainContent = execFileSync('git', ['show', `${mainRef}:${file}`], {
          encoding: 'utf-8',
        });
      } catch {
        // File not in main — all its symbols are salvageable
      }

      if (!mainContent) {
        // Entire file is unique to the branch
        report.analysedFiles++;
        for (const sym of branchSymbols.symbols) {
          report.salvageable.push({ ...sym, file, branch });
        }
        continue;
      }

      // Compare symbols with main version
      const mainTmpFile = join(tmpDir, `main_${file.replace(/\//g, '_')}`);
      writeFileSync(mainTmpFile, mainContent, 'utf-8');
      const mainSymbols = extractSymbols(mainTmpFile);
      if (mainSymbols.parseError) {
        // Main's version is unparseable → we can't tell which branch symbols
        // already exist in main. Flag rather than over-report everything as
        // salvageable (or worse, mislabel via a stale comparison).
        report.unparseableFiles.push(file);
        continue;
      }
      report.analysedFiles++;
      const mainNames = new Set(mainSymbols.symbols.map(s => s.name));

      for (const sym of branchSymbols.symbols) {
        if (!mainNames.has(sym.name)) {
          report.salvageable.push({ ...sym, file, branch });
        } else {
          report.alreadyInMain++;
        }
      }
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  return report;
}

/**
 * Format a salvage report for CLI display.
 */
export function formatSalvageReport(report: SalvageReport): string {
  const lines: string[] = [
    `🔍 Salvage analysis: ${report.branch}`,
    `   Files analysed: ${report.analysedFiles}`,
    `   Symbols already in main: ${report.alreadyInMain}`,
    `   Salvageable symbols: ${report.salvageable.length}`,
  ];

  if (report.unparseableFiles.length > 0) {
    lines.push(`   ⚠️  Unparseable files (status UNKNOWN): ${report.unparseableFiles.length}`);
    for (const f of report.unparseableFiles) {
      lines.push(`      • ${f}`);
    }
  }

  if (report.salvageable.length === 0) {
    if (report.unparseableFiles.length > 0) {
      // Some files couldn't be analysed — "fully superseded" would be a lie.
      lines.push('\n   ⚠️  No salvageable symbols found, but some files could not be parsed.');
      lines.push('      Do NOT treat this branch as safe to delete without a manual check.');
    } else {
      lines.push('\n   ✅ No unique symbols — branch is fully superseded by main.');
    }
    return lines.join('\n');
  }

  lines.push('\n   Salvageable symbols (unique to this branch):');
  for (const sym of report.salvageable) {
    lines.push(`   • [${sym.kind.padEnd(9)}] ${sym.name}  (${sym.file}:${sym.line})`);
  }

  return lines.join('\n');
}
