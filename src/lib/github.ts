/**
 * GitHub API client wrapper using `gh` CLI
 *
 * Provides access to branch, PR, and CI status from GitHub
 * without requiring Octokit or managing authentication.
 */

import { execFileSync } from 'child_process';

export interface GitHubRepoConfig {
    owner: string;
    repo: string;
}

export interface GitHubBranchInfo {
    name: string;
    sha: string;
    protected: boolean;
    commit: {
        sha: string;
        date: string;
        author: string;
        message: string;
    };
}

export interface GitHubPRInfo {
    number: number;
    title: string;
    state: string;
    headBranch: string;
    draft: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface GitHubCIStatus {
    status: string;
    conclusion: string | null;
    url: string;
    runId: string;
    createdAt: string;
}

export interface GitHubCommitInfo {
    sha: string;
    date: string;
    author: string;
    message: string;
}

export interface AheadBehind {
    ahead: number;
    behind: number;
}

/**
 * Check if GitHub CLI (gh) is available and authenticated.
 */
export function isGhAvailable(): boolean {
    try {
        execFileSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Fetch all branches from a GitHub repository.
 */
export async function listBranches(config: GitHubRepoConfig): Promise<GitHubBranchInfo[]> {
    try {
        const output = execFileSync('gh', [
            'api',
            `repos/${config.owner}/${config.repo}/branches`,
            '--paginate',
            '--jq',
            '.[] | {name: .name, sha: .commit.sha, protected: .protected}',
        ], { encoding: 'utf-8' });

        const branches: GitHubBranchInfo[] = [];
        const lines = output.trim().split('\n').filter(l => l.length > 0);
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                branches.push({
                    name: data.name,
                    sha: data.sha,
                    protected: data.protected,
                    commit: { sha: data.sha, date: '', author: '', message: '' },
                });
            } catch {
                // Skip invalid JSON lines
            }
        }
        return branches;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to list branches: ${msg}`);
    }
}

/**
 * Fetch commit details for a specific branch.
 */
export async function getCommitInfo(config: GitHubRepoConfig, branch: string): Promise<GitHubCommitInfo | null> {
    try {
        const output = execFileSync('gh', [
            'api',
            `repos/${config.owner}/${config.repo}/commits/${branch}`,
            '--jq',
            '{sha: .sha, date: .commit.author.date, author: .commit.author.name, message: .commit.message}',
        ], { encoding: 'utf-8' });
        try {
            return JSON.parse(output);
        } catch {
            return null;
        }
    } catch {
        return null;
    }
}

/**
 * Fetch all pull requests for a repository.
 */
export async function listPullRequests(config: GitHubRepoConfig): Promise<GitHubPRInfo[]> {
    try {
        const output = execFileSync('gh', [
            'pr', 'list',
            '--repo', `${config.owner}/${config.repo}`,
            '--state', 'all',
            '--json', 'number,title,state,headRefName,isDraft,createdAt,updatedAt',
            '--limit', '1000',
        ], { encoding: 'utf-8' });
        try {
            const data = JSON.parse(output);
            return data.map((pr: Record<string, unknown>) => ({
                number: pr.number,
                title: pr.title,
                state: pr.state,
                headBranch: pr.headRefName,
                draft: pr.isDraft,
                createdAt: pr.createdAt,
                updatedAt: pr.updatedAt,
            }));
        } catch {
            return [];
        }
    } catch {
        return [];
    }
}

/**
 * Get CI status for a branch (from latest workflow run).
 */
export async function getCIStatus(config: GitHubRepoConfig, branch: string): Promise<GitHubCIStatus | null> {
    try {
        const output = execFileSync('gh', [
            'run', 'list',
            '--repo', `${config.owner}/${config.repo}`,
            '--branch', branch,
            '--limit', '1',
            '--json', 'status,conclusion,url,databaseId,createdAt',
        ], { encoding: 'utf-8' });
        try {
            const data = JSON.parse(output);
            if (!Array.isArray(data) || data.length === 0) return null;
            const run = data[0];
            return {
                status: run.status,
                conclusion: run.conclusion,
                url: run.url,
                runId: String(run.databaseId),
                createdAt: run.createdAt,
            };
        } catch {
            return null;
        }
    } catch {
        return null;
    }
}

/**
 * Compare a branch to main (or specified base) and get ahead/behind counts.
 */
export async function getAheadBehind(config: GitHubRepoConfig, branch: string, baseBranch = 'main'): Promise<AheadBehind> {
    try {
        const output = execFileSync('gh', [
            'api',
            `repos/${config.owner}/${config.repo}/compare/${baseBranch}...${branch}`,
            '--jq',
            '{ahead: .ahead_by, behind: .behind_by}',
        ], { encoding: 'utf-8' });
        try {
            const data = JSON.parse(output);
            return { ahead: data.ahead || 0, behind: data.behind || 0 };
        } catch {
            return { ahead: 0, behind: 0 };
        }
    } catch {
        return { ahead: 0, behind: 0 };
    }
}
