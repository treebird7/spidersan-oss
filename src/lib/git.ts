import { execFileSync } from 'child_process';
import type { ExecFileSyncOptionsWithStringEncoding } from 'child_process';
import { validateFilePath, validateBranchName } from './security.js';

export class GitError extends Error {
    constructor(
        message: string,
        public readonly code: 'NOT_A_REPO' | 'INVALID_REF' | 'EXEC_FAILED'
    ) {
        super(message);
        this.name = 'GitError';
    }
}

type GitExecOptions = Pick<ExecFileSyncOptionsWithStringEncoding, 'stdio'>;

type GitExecError = Error & {
    message?: string;
    stderr?: string | Buffer;
    stdout?: string | Buffer;
};

function gitEnv(): NodeJS.ProcessEnv {
    return { ...process.env };
}

export function execGit(args: string[], options?: GitExecOptions): string {
    return execFileSync('git', args, {
        encoding: 'utf-8',
        env: gitEnv(),
        ...options,
    });
}

function getErrorText(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }

    const gitError = error as GitExecError;
    const parts = [gitError.message];

    if (typeof gitError.stderr === 'string') {
        parts.push(gitError.stderr);
    } else if (Buffer.isBuffer(gitError.stderr)) {
        parts.push(gitError.stderr.toString('utf-8'));
    }

    if (typeof gitError.stdout === 'string') {
        parts.push(gitError.stdout);
    } else if (Buffer.isBuffer(gitError.stdout)) {
        parts.push(gitError.stdout.toString('utf-8'));
    }

    return parts.filter(Boolean).join('\n');
}

function isNotRepoError(error: unknown): boolean {
    return /not a git repository/i.test(getErrorText(error));
}

function isInvalidRefError(error: unknown): boolean {
    return /(ambiguous argument|bad revision|invalid object name|Needed a single revision|unknown revision|unknown option `verify'|not a valid object name)/i.test(getErrorText(error));
}

function isMissingPathAtRefError(error: unknown): boolean {
    return /(does not exist in|exists on disk, but not in)/i.test(getErrorText(error));
}

function toGitError(error: unknown, message: string, fallbackCode: 'INVALID_REF' | 'EXEC_FAILED'): GitError {
    if (error instanceof GitError) {
        return error;
    }
    if (isNotRepoError(error)) {
        return new GitError('Not in a git repository', 'NOT_A_REPO');
    }
    if (fallbackCode === 'INVALID_REF' || isInvalidRefError(error)) {
        return new GitError(message, 'INVALID_REF');
    }
    return new GitError(message, 'EXEC_FAILED');
}

export function getCurrentBranch(): string {
    try {
        return execGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    } catch (error) {
        throw toGitError(error, 'Failed to determine current branch', 'EXEC_FAILED');
    }
}

export function getChangedFiles(options?: { base?: string }): string[] {
    const baseRef = options?.base ?? 'main';
    const strategies = [`${baseRef}...HEAD`, 'HEAD~1', 'HEAD'];

    for (const strategy of strategies) {
        try {
            const output = execGit(['diff', '--name-only', strategy], {
                stdio: ['pipe', 'pipe', 'ignore'],
            });
            const files = output.trim().split('\n').filter(Boolean);
            if (files.length > 0) {
                return files;
            }
        } catch (error) {
            if (isNotRepoError(error)) {
                throw new GitError('Not in a git repository', 'NOT_A_REPO');
            }
        }
    }

    return [];
}

export function getFileAtRef(ref: string, filePath: string): string | null {
    let safeFilePath = filePath;
    try {
        safeFilePath = validateFilePath(filePath);
    } catch {
        // Historical registry entries may contain invalid file names. We still use argv-safe
        // git execution here so callers can inspect those refs without shell interpolation.
    }

    try {
        execGit(['rev-parse', '--verify', `${ref}^{commit}`], {
            stdio: ['pipe', 'pipe', 'ignore'],
        });
    } catch (error) {
        throw toGitError(error, `Invalid git ref: ${ref}`, 'INVALID_REF');
    }

    try {
        return execGit(['show', `${ref}:${safeFilePath}`]);
    } catch (error) {
        if (isNotRepoError(error)) {
            throw new GitError('Not in a git repository', 'NOT_A_REPO');
        }
        if (isMissingPathAtRefError(error)) {
            return null;
        }
        throw toGitError(error, `Failed to read ${safeFilePath} at ref ${ref}`, 'EXEC_FAILED');
    }
}

export function getRemoteHead(remote: string, branch: string): string | null {
    const safeBranch = validateBranchName(branch);

    try {
        const output = execGit(['ls-remote', '--heads', remote, safeBranch], {
            stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();

        if (!output) {
            return null;
        }

        const [sha] = output.split(/\s+/, 1);
        return sha || null;
    } catch {
        return null;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Real merge-conflict analysis (git merge-tree backed) — A1 / SPEC_conflicts-real
// ──────────────────────────────────────────────────────────────────────────

export type MergeConflictKind = 'content' | 'add/add' | 'delete/modify' | 'rename';

export interface MergeConflictResult {
    base: string;
    branch: string;
    mergeBase: string | null;
    conflicts: { file: string; kind: MergeConflictKind }[];
    clean: boolean; // conflicts.length === 0 && !error
    method: 'write-tree' | 'legacy';
    rawOutput?: string;
    error?: string; // env failure only (bad ref / not a repo)
}

/** Read stdout off a thrown execFileSync error (utf-8). */
function getThrownStdout(error: unknown): string {
    const gitError = error as GitExecError;
    if (typeof gitError?.stdout === 'string') {
        return gitError.stdout;
    }
    if (Buffer.isBuffer(gitError?.stdout)) {
        return gitError.stdout.toString('utf-8');
    }
    return '';
}

/** "unknown option" / usage failure → modern --write-tree unsupported, fall back to legacy. */
function isUnknownOptionError(error: unknown): boolean {
    return /(unknown option|usage: git merge-tree|is not a git command)/i.test(getErrorText(error));
}

/**
 * Resolve a ref leniently to a commit SHA.
 * Accepts a local branch / SHA, and falls back to `origin/<ref>`.
 * Returns null if the ref cannot be resolved (caller turns this into `error`).
 */
function resolveRefToSha(ref: string): string | null {
    const candidates = ref.startsWith('origin/') ? [ref] : [ref, `origin/${ref}`];
    for (const candidate of candidates) {
        try {
            return execGit(['rev-parse', '--verify', `${candidate}^{commit}`], {
                stdio: ['pipe', 'pipe', 'ignore'],
            }).trim();
        } catch {
            // try next candidate
        }
    }
    return null;
}

/** Probe once whether this git supports `git merge-tree --write-tree`. */
let writeTreeSupportedCache: boolean | null = null;
function supportsWriteTree(): boolean {
    if (writeTreeSupportedCache !== null) {
        return writeTreeSupportedCache;
    }
    try {
        // Empty-tree against itself is a trivial, side-effect-free probe.
        const empty = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
        execGit(['merge-tree', '--write-tree', empty, empty], {
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        writeTreeSupportedCache = true;
    } catch (error) {
        // Exit-1 here would still mean the option IS supported (just "conflict"/no-op);
        // only a usage/unknown-option failure means it's unsupported.
        writeTreeSupportedCache = !isUnknownOptionError(error);
    }
    return writeTreeSupportedCache;
}

const KIND_FROM_LABEL: Record<string, MergeConflictKind> = {
    content: 'content',
    'add/add': 'add/add',
    'modify/delete': 'delete/modify',
    'delete/modify': 'delete/modify',
    distinct: 'rename',
    rename: 'rename',
    'rename/rename': 'rename',
    'rename/add': 'rename',
    'rename/delete': 'rename',
};

function mapKind(label: string): MergeConflictKind {
    const normalized = label.trim().toLowerCase();
    return KIND_FROM_LABEL[normalized] ?? 'content';
}

/**
 * Parse modern `git merge-tree --write-tree <base> <branch>` output.
 * Format: first line = written tree OID; then a blank line; then an info block
 * with `CONFLICT (<kind>): ... in <path>` lines (and `Auto-merging <path>`).
 * The CONFLICT lines carry BOTH the path and the kind, so we parse those.
 */
function parseWriteTreeConflicts(output: string): { file: string; kind: MergeConflictKind }[] {
    const conflicts = new Map<string, MergeConflictKind>();
    const lines = output.split('\n');

    for (const line of lines) {
        // CONFLICT (content): Merge conflict in <path>
        // CONFLICT (add/add): Merge conflict in <path>
        const merge = line.match(/^CONFLICT \(([^)]+)\): Merge conflict in (.+)$/);
        if (merge) {
            const [, label, path] = merge;
            conflicts.set(path, mapKind(label));
            continue;
        }
        // CONFLICT (modify/delete): <path> deleted in X and modified in Y. ...
        // CONFLICT (rename/delete): <path> renamed ... but deleted in ...
        // Terminate on the multi-word PHRASE that follows the path (" deleted in ",
        // " renamed to ", …), NOT a bare keyword — a path like "my added notes.txt"
        // contains the word "added" but not the phrase " added in ", so phrases avoid
        // truncating the captured path.
        const other = line.match(/^CONFLICT \(([^)]+)\): (.+?)(?: deleted in | renamed to | added in | modified in | left in tree)/);
        if (other) {
            const [, label, path] = other;
            conflicts.set(path, mapKind(label));
        }
    }

    return Array.from(conflicts, ([file, kind]) => ({ file, kind }));
}

/**
 * Parse legacy `git merge-tree <mergeBase> <base> <branch>` output.
 * Output is a per-file record stream. Records begin with an unindented header
 * (`changed in both`, `added in both`, `removed in remote`, `merged`, …) followed
 * by indented `  base/our/their <mode> <oid> <path>` lines and a diff hunk.
 *
 * A `changed in both`/`added in both` header signals BOTH sides touched the path,
 * but is only an actual CONFLICT when its hunk contains `<<<<<<<` markers
 * (e.g. same-file/different-region merges cleanly yet still shows `changed in both`).
 * We track the header record for the path (handling spaces) and require a marker.
 *
 * KNOWN LIMITATION (legacy/git<2.38 only — modern --write-tree path is preferred and
 * always taken on git>=2.38): marker-less conflict classes (modify/delete, rename/*)
 * emit no `<<<<<<<` and are under-reported here. Tracked in STATE.json known-issues;
 * not fixed because legacy git is effectively absent in this fleet (CI/dev on 2.50).
 */
function parseLegacyConflicts(output: string): { file: string; kind: MergeConflictKind }[] {
    const conflicts = new Map<string, MergeConflictKind>();
    const lines = output.split('\n');

    let currentHeader: string | null = null;
    let currentPath: string | null = null;
    let currentKind: MergeConflictKind = 'content';
    let sawMarker = false;

    const flush = () => {
        if (currentHeader && currentPath && sawMarker) {
            conflicts.set(currentPath, currentKind);
        }
        currentHeader = null;
        currentPath = null;
        currentKind = 'content';
        sawMarker = false;
    };

    for (const line of lines) {
        // Unindented record header (starts a new record).
        const header = line.match(/^(changed in both|added in both|removed in (?:both|remote|local)|added in (?:remote|local)|merged|renamed)\b/);
        if (header) {
            flush();
            currentHeader = header[1];
            if (currentHeader === 'added in both') {
                currentKind = 'add/add';
            } else if (currentHeader.startsWith('removed in')) {
                currentKind = 'delete/modify';
            } else if (currentHeader === 'renamed') {
                currentKind = 'rename';
            } else {
                currentKind = 'content';
            }
            continue;
        }

        // Indented file record line: `  our   100644 <oid> <path>` — extract the path.
        // Path may contain spaces; take everything after the oid token.
        const fileLine = line.match(/^\s+(?:base|our|their)\s+\d{6}\s+[0-9a-f]{7,64}\s+(.+)$/);
        if (fileLine && currentHeader && !currentPath) {
            currentPath = fileLine[1];
            continue;
        }

        if (line.includes('<<<<<<<')) {
            sawMarker = true;
        }
    }
    flush();

    return Array.from(conflicts, ([file, kind]) => ({ file, kind }));
}

/**
 * Real conflicts merging `branch` into `base`. Prefers `--write-tree` (git ≥2.38),
 * falls back to the legacy 3-arg form. NEVER throws for "they conflict" — only sets
 * `error` for environmental failures (bad ref / not a repo / unsupported tooling).
 */
export function getMergeConflicts(base: string, branch: string): MergeConflictResult {
    const baseResult: MergeConflictResult = {
        base,
        branch,
        mergeBase: null,
        conflicts: [],
        clean: false,
        method: 'write-tree',
        error: undefined,
    };

    // Resolve both refs leniently first; a missing ref is an env error, not a throw.
    let baseSha: string | null;
    let branchSha: string | null;
    try {
        baseSha = resolveRefToSha(base);
    } catch (error) {
        if (isNotRepoError(error)) {
            return { ...baseResult, error: 'Not in a git repository' };
        }
        baseSha = null;
    }
    if (baseSha === null) {
        return { ...baseResult, error: `ref not found: ${base}` };
    }
    try {
        branchSha = resolveRefToSha(branch);
    } catch (error) {
        if (isNotRepoError(error)) {
            return { ...baseResult, error: 'Not in a git repository' };
        }
        branchSha = null;
    }
    if (branchSha === null) {
        return { ...baseResult, error: `ref not found: ${branch}` };
    }

    // Compute merge-base (best-effort; not fatal if unrelated histories).
    let mergeBase: string | null = null;
    try {
        mergeBase = execGit(['merge-base', baseSha, branchSha], {
            stdio: ['pipe', 'pipe', 'ignore'],
        }).trim() || null;
    } catch {
        mergeBase = null;
    }

    // ── Modern path: git merge-tree --write-tree <base> <branch> ──
    if (supportsWriteTree()) {
        try {
            const output = execGit(['merge-tree', '--write-tree', baseSha, branchSha], {
                stdio: ['pipe', 'pipe', 'ignore'],
            });
            // Exit 0 → clean merge (first line is the tree OID, no conflict block).
            return {
                ...baseResult,
                mergeBase,
                conflicts: [],
                clean: true,
                method: 'write-tree',
                rawOutput: output,
            };
        } catch (error) {
            if (isNotRepoError(error)) {
                return { ...baseResult, mergeBase, error: 'Not in a git repository' };
            }
            if (isUnknownOptionError(error)) {
                // Tooling regression mid-run — fall through to legacy.
                writeTreeSupportedCache = false;
            } else {
                // Exit non-zero WITH parseable conflict output = a valid conflict RESULT.
                const stdout = getThrownStdout(error);
                if (stdout) {
                    const conflicts = parseWriteTreeConflicts(stdout);
                    if (conflicts.length > 0) {
                        return {
                            ...baseResult,
                            mergeBase,
                            conflicts,
                            clean: false,
                            method: 'write-tree',
                            rawOutput: stdout,
                        };
                    }
                    // Non-zero but no parseable conflict (e.g. unrelated histories) → env error.
                    return {
                        ...baseResult,
                        mergeBase,
                        method: 'write-tree',
                        rawOutput: stdout,
                        error: getErrorText(error).split('\n')[0] || 'git merge-tree failed',
                    };
                }
                return {
                    ...baseResult,
                    mergeBase,
                    method: 'write-tree',
                    error: getErrorText(error).split('\n')[0] || 'git merge-tree failed',
                };
            }
        }
    }

    // ── Legacy path: git merge-tree <mergeBase> <base> <branch> ──
    if (mergeBase === null) {
        // Legacy form requires a merge-base; without one we cannot analyze.
        return {
            ...baseResult,
            mergeBase,
            method: 'legacy',
            error: `no merge-base between ${base} and ${branch}`,
        };
    }
    try {
        const output = execGit(['merge-tree', mergeBase, baseSha, branchSha], {
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        const conflicts = parseLegacyConflicts(output);
        return {
            ...baseResult,
            mergeBase,
            conflicts,
            clean: conflicts.length === 0,
            method: 'legacy',
            rawOutput: output,
        };
    } catch (error) {
        if (isNotRepoError(error)) {
            return { ...baseResult, mergeBase, method: 'legacy', error: 'Not in a git repository' };
        }
        // Legacy form may still produce output on a thrown error in some gits.
        const stdout = getThrownStdout(error);
        if (stdout) {
            const conflicts = parseLegacyConflicts(stdout);
            return {
                ...baseResult,
                mergeBase,
                conflicts,
                clean: conflicts.length === 0,
                method: 'legacy',
                rawOutput: stdout,
            };
        }
        return {
            ...baseResult,
            mergeBase,
            method: 'legacy',
            error: getErrorText(error).split('\n')[0] || 'git merge-tree failed',
        };
    }
}

export function getAheadBehind(remote?: string, branch?: string): { ahead: number; behind: number } {
    let upstreamRef: string;

    if (remote && branch) {
        upstreamRef = `${remote}/${validateBranchName(branch)}`;
    } else {
        try {
            upstreamRef = execGit(['rev-parse', '--abbrev-ref', '@{u}'], {
                stdio: ['pipe', 'pipe', 'ignore'],
            }).trim();
        } catch (error) {
            if (isNotRepoError(error)) {
                throw new GitError('Not in a git repository', 'NOT_A_REPO');
            }
            return { ahead: 0, behind: 0 };
        }
    }

    try {
        const output = execGit(['rev-list', '--left-right', '--count', `HEAD...${upstreamRef}`], {
            stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        const [aheadRaw, behindRaw] = output.split(/\s+/);
        const ahead = Number.parseInt(aheadRaw ?? '', 10);
        const behind = Number.parseInt(behindRaw ?? '', 10);

        if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
            throw new GitError(`Failed to parse ahead/behind counts for ${upstreamRef}`, 'EXEC_FAILED');
        }

        return { ahead, behind };
    } catch (error) {
        if (error instanceof GitError) {
            throw error;
        }
        if (isNotRepoError(error)) {
            throw new GitError('Not in a git repository', 'NOT_A_REPO');
        }
        if (!remote && !branch) {
            return { ahead: 0, behind: 0 };
        }
        throw toGitError(error, `Failed to determine ahead/behind for ${upstreamRef}`, 'EXEC_FAILED');
    }
}
