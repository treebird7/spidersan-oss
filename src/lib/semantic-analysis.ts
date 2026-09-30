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
import { resolveBranchRef, resolveLocalBranchRef } from './git.js';

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

/**
 * File content at ref; null ONLY when the path genuinely doesn't exist there (a legitimate
 * non-conflict). Any other git failure throws, so the caller records it as skipped instead of
 * reading it as "absent".
 */
function show(ref: string, file: string, cwd?: string): string | null {
    try {
        git(['cat-file', '-e', `${ref}:${file}`], cwd);
    } catch {
        return null; // cat-file -e fails => no such path at that ref
    }
    return git(['show', `${ref}:${file}`], cwd);
}

/**
 * A branch's tip for analysis: the LOCAL branch first (unpushed commits are the point), then
 * origin's. resolveBranchRef alone prefers the remote and would read a stale tip.
 */
export function resolveBranchTip(name: string): string | null {
    return resolveLocalBranchRef(name) ?? resolveBranchRef(name);
}

/**
 * A conflict target's ref from its registry label. A registered branch may be a local branch
 * (local-first); a cross-machine label "<machine>/<branch>" is another machine's branch, so it
 * resolves ONLY against origin — a same-named local branch would be the wrong tip.
 */
export function resolveTargetRef(label: string): string | null {
    const local = resolveBranchTip(label);
    if (local) return local;
    const remote = resolveBranchRef(label.slice(label.indexOf('/') + 1));
    return remote?.startsWith('refs/remotes/') ? remote : null;
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

            let current: string | null;
            let other: string | null;
            try {
                current = show(currentRef, file, cwd);
                other = show(target.ref, file, cwd);
            } catch {
                result.skipped.push(`${file}: could not read from ${target.label}`);
                continue;
            }
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
            } catch {
                // A parser failure is unknown, not "no conflicts". No caught message: it can carry
                // internals and this line is printed.
                result.skipped.push(`${file}: parse failed`);
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
