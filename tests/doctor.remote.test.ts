import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as cp from 'child_process';
import * as fs from 'fs';
import { doctorCommand, _doctorTestable } from '../src/commands/doctor.js';

vi.mock('child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('child_process')>(),
    execSync: vi.fn(),
    execFileSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => ({
    ...await importOriginal<typeof import('fs')>(),
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
}));

vi.mock('os', async (importOriginal) => ({
    ...await importOriginal<typeof import('os')>(),
    homedir: vi.fn(() => '/home/test'),
}));

vi.mock('../src/storage/index.js', () => ({
    getStorage: vi.fn(),
}));

type Scenario = 'ahead' | 'behind' | 'diverged' | 'unrelated' | 'up-to-date' | 'no remote tracking';

function makeDirent(name: string): fs.Dirent {
    return {
        name,
        isDirectory: () => true,
    } as fs.Dirent;
}

function setupRepoTree(repos: string[]): void {
    const registryPaths = new Set(repos.map(repo => `/home/test/Dev/${repo}/.spidersan/registry.json`));

    vi.mocked(fs.readdirSync).mockImplementation((path, options) => {
        const asString = String(path);
        if (asString === '/home/test/Dev' && options && typeof options === 'object' && 'withFileTypes' in options) {
            return repos.map(makeDirent) as unknown as ReturnType<typeof fs.readdirSync>;
        }
        if (options && typeof options === 'object' && 'withFileTypes' in options) {
            return [] as unknown as ReturnType<typeof fs.readdirSync>;
        }
        return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });

    vi.mocked(fs.existsSync).mockImplementation((path) => registryPaths.has(String(path)));
}

function setupGitScenarios(scenarios: Record<string, Scenario>): void {
    vi.mocked(cp.execFileSync).mockImplementation((_file, args, options) => {
        const cmd = args as string[];
        const cwd = String((options as { cwd?: string } | undefined)?.cwd ?? '');
        const repo = cwd.split('/').pop() ?? '';
        const scenario = scenarios[repo];

        if (cmd[0] === 'rev-parse' && cmd[1] === '--is-inside-work-tree') {
            return 'true';
        }

        if (cmd[0] === 'rev-parse' && cmd[1] === '--abbrev-ref' && cmd[2] === '@{u}') {
            if (scenario === 'no remote tracking') {
                throw new Error('no upstream');
            }
            return 'origin/main';
        }

        if (cmd[0] === 'fetch') return '';

        if (cmd[0] === 'merge-base') {
            if (scenario === 'unrelated') return '';
            return 'abc123';
        }

        if (cmd[0] === 'rev-list' && cmd[2] === 'HEAD..@{u}') {
            if (scenario === 'behind') return '4';
            if (scenario === 'diverged') return '2';
            return '0';
        }

        if (cmd[0] === 'rev-list' && cmd[2] === '@{u}..HEAD') {
            if (scenario === 'ahead') return '3';
            if (scenario === 'diverged') return '5';
            return '0';
        }

        throw new Error(`Unexpected git command: ${cmd.join(' ')}`);
    });
}

describe('doctor --remote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('scans only initialized repos and classifies all required remote states', () => {
        setupRepoTree(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']);
        setupGitScenarios({
            alpha: 'ahead',
            beta: 'behind',
            gamma: 'diverged',
            delta: 'unrelated',
            epsilon: 'up-to-date',
            zeta: 'no remote tracking',
        });

        const rows = _doctorTestable.getRemoteHealthRows('/home/test/Dev');
        expect(rows).toHaveLength(6);

        const byRepo = Object.fromEntries(rows.map(row => [row.repo, row]));
        expect(byRepo.alpha).toMatchObject({ status: 'ahead', ahead: 3, behind: 0, recommendation: 'push' });
        expect(byRepo.beta).toMatchObject({ status: 'behind', ahead: 0, behind: 4, recommendation: 'pull' });
        expect(byRepo.gamma).toMatchObject({ status: 'diverged', ahead: 5, behind: 2, recommendation: 'merge needed' });
        expect(byRepo.delta).toMatchObject({
            status: 'unrelated',
            ahead: null,
            behind: null,
            recommendation: 'merge needed',
        });
        expect(byRepo.epsilon).toMatchObject({ status: 'up-to-date', ahead: 0, behind: 0, recommendation: 'ok' });
        expect(byRepo.zeta).toMatchObject({
            status: 'no remote tracking',
            ahead: null,
            behind: null,
            recommendation: 'ok',
        });
    });

    it('findInitializedRepos returns only repos with .spidersan/registry.json', () => {
        const registryPaths = new Set(['/home/test/Dev/initialized/.spidersan/registry.json']);
        vi.mocked(fs.readdirSync).mockImplementation((path, options) => {
            if (String(path) === '/home/test/Dev' && options && typeof options === 'object' && 'withFileTypes' in options) {
                return [makeDirent('initialized'), makeDirent('plain-git')] as unknown as ReturnType<typeof fs.readdirSync>;
            }
            return [] as unknown as ReturnType<typeof fs.readdirSync>;
        });
        vi.mocked(fs.existsSync).mockImplementation((path) => registryPaths.has(String(path)));
        vi.mocked(cp.execFileSync).mockImplementation((_file, args) => {
            const cmd = args as string[];
            if (cmd[0] === 'rev-parse' && cmd[1] === '--is-inside-work-tree') return 'true';
            throw new Error(`Unexpected command: ${cmd.join(' ')}`);
        });

        const repos = _doctorTestable.findInitializedRepos('/home/test/Dev');
        expect(repos).toEqual(['/home/test/Dev/initialized']);
    });

    it('exits non-zero with --strict when any repo is diverged', async () => {
        setupRepoTree(['gamma']);
        setupGitScenarios({ gamma: 'diverged' });

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit:${code ?? 0}`);
        }) as never);

        await expect(
            doctorCommand.parseAsync(['node', 'spidersan', 'doctor', '--remote', '--strict'])
        ).rejects.toThrow('exit:1');

        expect(exitSpy).toHaveBeenCalledWith(1);

        logSpy.mockRestore();
        errorSpy.mockRestore();
        exitSpy.mockRestore();
    });
});
