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

function execGit(args: string[], options?: GitExecOptions): string {
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
