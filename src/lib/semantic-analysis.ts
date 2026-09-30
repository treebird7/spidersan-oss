/**
 * semantic-analysis.ts — the `conflicts --semantic` engine.
 *
 * Takes targets that carry a REAL git ref (never a display label like
 * "PR #303 (branch)") and returns symbol conflicts plus every file it could not
 * analyze. Callers must not print "safe to merge" while `skipped` is non-empty.
 */
import { execFileSync } from 'child_process';
import { ASTParser, type SymbolConflict } from './ast.js';
import { findOutlineConflicts } from './outline.js';

export interface SemanticTarget {
    label: string;
    files: string[];
    /** Resolvable git ref for this target's head, or null when it isn't available locally. */
    ref: string | null;
}

export interface SemanticResult {
    conflicts: SymbolConflict[];
    /** One human-readable line per file/target that could not be analyzed. */
    skipped: string[];
}

const TS_FILE = /\.(ts|js|tsx|jsx)$/;
const PY_FILE = /\.py$/;

const git = (args: string[], cwd?: string): string =>
    execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], cwd });

/** file content at ref; null if the file doesn't exist there (a legitimate non-conflict). */
function show(ref: string, file: string, cwd?: string): string | null {
    try {
        return git(['show', `${ref}:${file}`], cwd);
    } catch {
        return null;
    }
}

export function analyzeSemantic(
    currentLabel: string,
    currentRef: string | null,
    targets: SemanticTarget[],
    cwd?: string
): SemanticResult {
    const parser = new ASTParser();
    const result: SemanticResult = { conflicts: [], skipped: [] };

    for (const target of targets) {
        for (const file of target.files) {
            const isPython = PY_FILE.test(file);
            if (!isPython && !TS_FILE.test(file)) continue;

            // An unresolvable ref is UNKNOWN, not "no conflict" — never swallow it.
            if (!currentRef) {
                result.skipped.push(`${file}: no local ref for ${currentLabel}`);
                continue;
            }
            if (!target.ref) {
                result.skipped.push(`${file}: no local ref for ${target.label} (not fetched?)`);
                continue;
            }

            const current = show(currentRef, file, cwd);
            const other = show(target.ref, file, cwd);
            if (current === null || other === null) continue; // absent on one side: nothing to conflict

            // Three-way against the merge-base; two-way fallback if there isn't one.
            let base: string | undefined;
            try {
                const mb = git(['merge-base', currentRef, target.ref], cwd).trim();
                base = show(mb, file, cwd) ?? undefined;
            } catch {
                base = undefined;
            }

            let found: SymbolConflict[] | null;
            try {
                found = isPython
                    ? findOutlineConflicts('.py', current, `${currentLabel}:${file}`, other, `${target.label}:${file}`, base)
                    : parser.findSymbolConflicts(current, `${currentLabel}:${file}`, other, `${target.label}:${file}`, base);
            } catch (err) {
                // A parser failure is unknown, not "no conflicts".
                result.skipped.push(`${file}: parse failed (${err instanceof Error ? err.message : String(err)})`);
                continue;
            }
            if (!found) {
                result.skipped.push(`${file}: semantic analysis unavailable (install ast-grep)`);
                continue;
            }
            result.conflicts.push(...found);
        }
    }
    return result;
}
