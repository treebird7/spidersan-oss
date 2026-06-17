import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the github lib so scanRepository never shells out to `gh`.
vi.mock('../src/lib/github.js', () => ({
    listBranches: vi.fn(),
    listPullRequests: vi.fn(),
    getCommitInfo: vi.fn(),
    getCIStatus: vi.fn(),
    getAheadBehind: vi.fn(),
}));

import { scanRepository } from '../src/commands/github-sync.js';
import {
    listBranches,
    listPullRequests,
    getCommitInfo,
    getCIStatus,
    getAheadBehind,
    type GitHubBranchInfo,
} from '../src/lib/github.js';

const mockListBranches = vi.mocked(listBranches);
const mockListPRs = vi.mocked(listPullRequests);
const mockCommit = vi.mocked(getCommitInfo);
const mockCI = vi.mocked(getCIStatus);
const mockAB = vi.mocked(getAheadBehind);

const config = { owner: 'treebird7', repo: 'spidersan' };
const machine = { id: 'm-test', name: 'test', hostname: 'test' };
const opts = (concurrency?: number) => ({ includeCi: false, staleDays: 7, machine, concurrency });

function branch(name: string): GitHubBranchInfo {
    return { name, sha: 's', protected: false, commit: { sha: 's', date: '', author: '', message: '' } };
}
const commitFor = (name: string) => ({ sha: `sha-${name}`, date: '2026-01-01', author: 'a', message: 'm' });

beforeEach(() => {
    vi.clearAllMocks();
    mockListPRs.mockResolvedValue([]);
    mockCI.mockResolvedValue(null);
    mockAB.mockResolvedValue({ ahead: 1, behind: 0 });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('scanRepository', () => {
    it('skips trunk branches and preserves input order', async () => {
        mockListBranches.mockResolvedValue(
            ['main', 'feat-a', 'develop', 'feat-b', 'feat-c'].map(branch),
        );
        mockCommit.mockImplementation(async (_c, name) => commitFor(name));

        const rows = await scanRepository(config, opts(4));
        expect(rows.map(r => r.branch_name)).toEqual(['feat-a', 'feat-b', 'feat-c']);
    });

    it('skips a branch whose commit could not be fetched (null)', async () => {
        mockListBranches.mockResolvedValue(['feat-a', 'feat-gone', 'feat-b'].map(branch));
        mockCommit.mockImplementation(async (_c, name) =>
            name === 'feat-gone' ? null : commitFor(name));

        const rows = await scanRepository(config, opts(4));
        expect(rows.map(r => r.branch_name)).toEqual(['feat-a', 'feat-b']);
    });

    it('records ahead_behind: null (not {0,0}) when the compare fails', async () => {
        mockListBranches.mockResolvedValue(['feat-a'].map(branch));
        mockCommit.mockImplementation(async (_c, name) => commitFor(name));
        mockAB.mockResolvedValue(null); // compare failed → unknown
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const rows = await scanRepository(config, opts(4));
        expect(rows).toHaveLength(1);
        expect(rows[0].ahead_behind).toBeNull();
        expect(warn).toHaveBeenCalled();
    });

    it('never exceeds the configured concurrency', async () => {
        const names = Array.from({ length: 12 }, (_, i) => `feat-${i}`);
        mockListBranches.mockResolvedValue(names.map(branch));

        let inFlight = 0;
        let maxInFlight = 0;
        mockCommit.mockImplementation(async (_c, name) => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise(r => setTimeout(r, 5));
            inFlight--;
            return commitFor(name);
        });

        const rows = await scanRepository(config, opts(3));
        expect(rows).toHaveLength(12);
        expect(maxInFlight).toBeLessThanOrEqual(3);
        expect(maxInFlight).toBeGreaterThan(1); // proves it actually parallelized
    });
});
