/**
 * symbol-extractor.ts — Phase C semantic intelligence
 *
 * Extract exported symbols (functions, classes, types, consts) from a TS file
 * using ts-morph. Used by `spidersan conflicts --semantic`.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { existsSync } from 'fs';

/** Env-gated debug breadcrumb (mirrors DEBUG_COLONY). Off by default. */
function debugSymbols(message: string, detail?: unknown): void {
  if (!process.env.DEBUG_SYMBOLS) return;
  const suffix = detail instanceof Error
    ? `: ${detail.message}`
    : detail !== undefined ? `: ${String(detail)}` : '';
  console.error(`[symbols] ${message}${suffix}`);
}

export interface ExtractedSymbol {
  name: string;
  kind: 'function' | 'class' | 'type' | 'interface' | 'const' | 'enum' | 'other';
  line: number;
}

export interface FileSymbols {
  file: string;
  symbols: ExtractedSymbol[];
  /**
   * Set when the file could NOT be parsed (ts-morph threw). An empty `symbols`
   * with `parseError` set is fundamentally different from a genuinely empty
   * file: callers MUST NOT conclude "no symbols here" — the truth is unknown.
   * Conflating the two is a false negative (e.g. a branch wrongly reported as
   * fully superseded by main). Left undefined on the happy path.
   */
  parseError?: string;
}

/**
 * Extract all exported symbols from a TypeScript file.
 *
 * Returns an empty `symbols` array when the file genuinely has no exports OR
 * doesn't exist. When the file exists but FAILS TO PARSE, `symbols` is empty
 * AND `parseError` is set — callers must distinguish these (see FileSymbols).
 */
export function extractSymbols(filePath: string): FileSymbols {
  if (!existsSync(filePath)) {
    return { file: filePath, symbols: [] };
  }

  try {
    const project = new Project({
      compilerOptions: { allowJs: true },
      skipAddingFilesFromTsConfig: true,
    });
    const sourceFile = project.addSourceFileAtPath(filePath);
    const symbols: ExtractedSymbol[] = [];

    for (const decl of sourceFile.getExportedDeclarations()) {
      const [name, nodes] = decl as [string, import('ts-morph').ExportedDeclarations[]];
      for (const node of nodes) {
        const kind = kindOf(node.getKind());
        const line = node.getStartLineNumber();
        symbols.push({ name, kind, line });
      }
    }

    // ts-morph is lenient: it does NOT throw on broken TS — it silently drops
    // the unparseable declarations and returns a partial (often empty) set.
    // So a syntactically broken branch file would otherwise be indistinguishable
    // from a genuinely empty one. Surface SYNTACTIC errors (not type errors —
    // those parse fine and their symbols are real) as parseError so callers
    // treat the symbol set as unreliable rather than authoritative.
    const syntaxErrors = project.getProgram().getSyntacticDiagnostics(sourceFile);
    if (syntaxErrors.length > 0) {
      debugSymbols(`extractSymbols(${filePath}): ${syntaxErrors.length} syntax error(s)`);
      return { file: filePath, symbols, parseError: `${syntaxErrors.length} syntax error(s)` };
    }

    return { file: filePath, symbols };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    debugSymbols(`extractSymbols(${filePath}): parse failed`, error);
    return { file: filePath, symbols: [], parseError: message };
  }
}

function kindOf(syntaxKind: SyntaxKind): ExtractedSymbol['kind'] {
  switch (syntaxKind) {
    case SyntaxKind.FunctionDeclaration:
    case SyntaxKind.ArrowFunction:
    case SyntaxKind.FunctionExpression:
    case SyntaxKind.MethodDeclaration:
      return 'function';
    case SyntaxKind.ClassDeclaration:
      return 'class';
    case SyntaxKind.TypeAliasDeclaration:
      return 'type';
    case SyntaxKind.InterfaceDeclaration:
      return 'interface';
    case SyntaxKind.EnumDeclaration:
      return 'enum';
    case SyntaxKind.VariableDeclaration:
    case SyntaxKind.VariableStatement:
      return 'const';
    default:
      return 'other';
  }
}

/**
 * Find symbol-level overlaps between two sets of file symbols.
 * Returns symbols that share the same name across different branches.
 */
export interface SymbolOverlap {
  name: string;
  kind: ExtractedSymbol['kind'];
  branches: Array<{ branch: string; file: string; line: number }>;
}

export function findSymbolOverlaps(
  left: { branch: string; symbols: FileSymbols },
  right: { branch: string; symbols: FileSymbols },
): SymbolOverlap[] {
  // Group by name (a file can legitimately export several declarations under
  // one name — overload signatures, declaration merges). A plain
  // `new Map(…map(s => [s.name, s]))` keeps only the LAST, silently dropping
  // the other locations from the overlap report.
  const leftByName = new Map<string, ExtractedSymbol[]>();
  for (const s of left.symbols.symbols) {
    const bucket = leftByName.get(s.name);
    if (bucket) bucket.push(s);
    else leftByName.set(s.name, [s]);
  }

  const overlaps: SymbolOverlap[] = [];
  for (const rs of right.symbols.symbols) {
    const matches = leftByName.get(rs.name);
    if (!matches) continue;
    for (const ls of matches) {
      overlaps.push({
        name: rs.name,
        kind: rs.kind,
        branches: [
          { branch: left.branch, file: left.symbols.file, line: ls.line },
          { branch: right.branch, file: right.symbols.file, line: rs.line },
        ],
      });
    }
  }

  return overlaps;
}
