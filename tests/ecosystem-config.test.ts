/**
 * Ecosystem configuration: the repo list for `conflicts --ecosystem` and the
 * env switches for the optional plugin. Hermetic: HOME points at an empty
 * tmpdir and both SPIDERSAN_* vars are cleared per test, so a developer's own
 * ~/.spidersanrc or shell exports cannot leak in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const mocks = vi.hoisted(() => ({
    spawnSync: vi.fn(),
    execFileSync: vi.fn(),
}));

vi.mock('child_process', async () => {
    const actual = await vi.importActual<typeof import('child_process')>('child_process');
    return { ...actual, spawnSync: mocks.spawnSync, execFileSync: mocks.execFileSync };
});

import {
    isPluginDisabledByEnv,
    resolveEcosystemRepos,
    ECOSYSTEM_UNCONFIGURED_HINT,
} from '../src/lib/ecosystem-env.js';
import { loadConfigWithSources } from '../src/lib/config.js';
import { conflictsCommand } from '../src/commands/conflicts.js';

const emptyConfig = { conflicts: { highSeverityPatterns: [], mediumSeverityPatterns: [], ecosystemRepos: [] } };
const withRepos = (repos: string[]) => ({ conflicts: { ...emptyConfig.conflicts, ecosystemRepos: repos } });

let home: string;
let cwd: string;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'spidersan-eco-home-'));
    cwd = mkdtempSync(join(tmpdir(), 'spidersan-eco-cwd-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('SPIDERSAN_ECOSYSTEM', '');
    vi.stubEnv('SPIDERSAN_CORE_ONLY', '');
    mocks.spawnSync.mockReset();
    mocks.spawnSync.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ summary: { tier3: 0, tier2: 0, tier1: 0 } }),
        stderr: '',
    });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
});

describe('isPluginDisabledByEnv', () => {
    it('SPIDERSAN_CORE_ONLY=1/true disables the plugin', () => {
        expect(isPluginDisabledByEnv({ SPIDERSAN_CORE_ONLY: '1' })).toBe(true);
        expect(isPluginDisabledByEnv({ SPIDERSAN_CORE_ONLY: 'true' })).toBe(true);
        expect(isPluginDisabledByEnv({ SPIDERSAN_CORE_ONLY: ' YES ' })).toBe(true);
    });

    it('SPIDERSAN_CORE_ONLY=0/false/unset leaves the plugin allowed (was inverted)', () => {
        expect(isPluginDisabledByEnv({ SPIDERSAN_CORE_ONLY: '0' })).toBe(false);
        expect(isPluginDisabledByEnv({ SPIDERSAN_CORE_ONLY: 'false' })).toBe(false);
        expect(isPluginDisabledByEnv({})).toBe(false);
    });

    it('SPIDERSAN_ECOSYSTEM=0/false still disables the plugin', () => {
        expect(isPluginDisabledByEnv({ SPIDERSAN_ECOSYSTEM: '0' })).toBe(true);
        expect(isPluginDisabledByEnv({ SPIDERSAN_ECOSYSTEM: 'false' })).toBe(true);
    });

    it('a SPIDERSAN_ECOSYSTEM path list does not disable the plugin', () => {
        expect(isPluginDisabledByEnv({ SPIDERSAN_ECOSYSTEM: '/tmp/repo-a:/tmp/repo-b' })).toBe(false);
    });
});

describe('resolveEcosystemRepos', () => {
    it('unset everywhere → no repos', () => {
        expect(resolveEcosystemRepos(emptyConfig, { env: {}, home })).toEqual({ repos: [], source: 'none' });
    });

    it('reads a colon-separated SPIDERSAN_ECOSYSTEM path list (backwards compatible)', () => {
        const r = resolveEcosystemRepos(emptyConfig, {
            env: { SPIDERSAN_ECOSYSTEM: '/tmp/repo-a: /tmp/repo-b ::' },
            home,
        });
        expect(r).toEqual({ repos: ['/tmp/repo-a', '/tmp/repo-b'], source: 'env' });
    });

    it('reads conflicts.ecosystemRepos from config and expands ~/', () => {
        const r = resolveEcosystemRepos(withRepos(['~/code/repo-a', '/tmp/repo-b']), { env: {}, home });
        expect(r).toEqual({ repos: [join(home, 'code/repo-a'), '/tmp/repo-b'], source: 'config' });
    });

    it('env path list wins over config; --repos wins over both', () => {
        const cfg = withRepos(['/tmp/from-config']);
        const env = { SPIDERSAN_ECOSYSTEM: '/tmp/from-env' };
        expect(resolveEcosystemRepos(cfg, { env, home }).repos).toEqual(['/tmp/from-env']);
        expect(resolveEcosystemRepos(cfg, { env, home, reposFlag: '/tmp/x,/tmp/y' })).toEqual({
            repos: ['/tmp/x', '/tmp/y'],
            source: 'flag',
        });
    });

    it('SPIDERSAN_ECOSYSTEM=0 is a switch, not a path: falls through to config', () => {
        expect(resolveEcosystemRepos(emptyConfig, { env: { SPIDERSAN_ECOSYSTEM: '0' }, home }).repos).toEqual([]);
        expect(
            resolveEcosystemRepos(withRepos(['/tmp/repo-a']), { env: { SPIDERSAN_ECOSYSTEM: 'false' }, home }),
        ).toEqual({ repos: ['/tmp/repo-a'], source: 'config' });
    });

    it('dedupes repeated entries', () => {
        expect(resolveEcosystemRepos(withRepos(['/tmp/a', '/tmp/a']), { env: {}, home }).repos).toEqual(['/tmp/a']);
    });
});

describe('config file: conflicts.ecosystemRepos', () => {
    it('defaults to an empty list', async () => {
        const { config } = await loadConfigWithSources(cwd);
        expect(config.conflicts.ecosystemRepos).toEqual([]);
    });

    it('loads from ~/.spidersanrc', async () => {
        writeFileSync(join(home, '.spidersanrc'), JSON.stringify({ conflicts: { ecosystemRepos: ['/tmp/repo-a'] } }));
        const { config, errors } = await loadConfigWithSources(cwd);
        expect(errors).toEqual([]);
        expect(config.conflicts.ecosystemRepos).toEqual(['/tmp/repo-a']);
        // other conflicts defaults survive the merge
        expect(config.conflicts.highSeverityPatterns.length).toBeGreaterThan(0);
    });

    it('rejects a non-array value', async () => {
        writeFileSync(join(cwd, '.spidersanrc.json'), JSON.stringify({ conflicts: { ecosystemRepos: '/tmp/a' } }));
        const { errors } = await loadConfigWithSources(cwd, { includeGlobal: false });
        expect(errors.some((e) => e.path.endsWith('conflicts.ecosystemRepos'))).toBe(true);
    });
});

describe('conflicts --ecosystem action', () => {
    async function runEcosystem(): Promise<{ stdout: string; stderr: string }> {
        const out: string[] = [];
        const err: string[] = [];
        vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.join(' ')); });
        vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { err.push(a.join(' ')); });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        vi.spyOn(process, 'cwd').mockReturnValue(cwd);
        await conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts', '--ecosystem', '--json']);
        return { stdout: out.join('\n'), stderr: err.join('\n') };
    }

    const scannedDirs = (): string[] =>
        mocks.spawnSync.mock.calls.map((c) => (c[2] as { cwd?: string } | undefined)?.cwd ?? '');

    it('unconfigured: scans nothing, prints the hint, emits empty JSON', async () => {
        const { stdout, stderr } = await runEcosystem();
        expect(mocks.spawnSync).not.toHaveBeenCalled();
        expect(stderr).toContain(ECOSYSTEM_UNCONFIGURED_HINT);
        const parsed = JSON.parse(stdout);
        expect(parsed.repos).toEqual([]);
        expect(parsed.summary.repos_scanned).toBe(0);
    });

    it('scans each repo in the SPIDERSAN_ECOSYSTEM path list', async () => {
        vi.stubEnv('SPIDERSAN_ECOSYSTEM', '/tmp/repo-a:/tmp/repo-b');
        await runEcosystem();
        expect(scannedDirs()).toEqual(['/tmp/repo-a', '/tmp/repo-b']);
    });

    it('scans each repo in ~/.spidersanrc conflicts.ecosystemRepos', async () => {
        writeFileSync(join(home, '.spidersanrc'), JSON.stringify({ conflicts: { ecosystemRepos: ['/tmp/repo-c'] } }));
        await runEcosystem();
        expect(scannedDirs()).toEqual(['/tmp/repo-c']);
    });

    it('SPIDERSAN_ECOSYSTEM=0 does not scan a repo named "0"', async () => {
        vi.stubEnv('SPIDERSAN_ECOSYSTEM', '0');
        const { stderr } = await runEcosystem();
        expect(scannedDirs()).not.toContain('0');
        expect(mocks.spawnSync).not.toHaveBeenCalled();
        expect(stderr).toContain(ECOSYSTEM_UNCONFIGURED_HINT);
    });
});
