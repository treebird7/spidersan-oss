/**
 * The built-in hosted sync client and git-watch are gone. Pins:
 *  - local-only commands work with no sync module and no Supabase config at all;
 *  - sync commands refuse with an actionable message and exit non-zero, never a
 *    network call, even when legacy Supabase credentials are still set;
 *  - git-watch refuses, including old invocations with options it no longer has.
 *
 * Commands run in-process against a throwaway git repo with HOME pointed at an
 * empty directory, so the user's real ~/.spidersanrc can't leak in.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';

const ENV_KEYS = [
    'HOME', 'SPIDERSAN_SYNC_MODULE',
    'SPIDERSAN_SUPABASE_URL', 'SPIDERSAN_SUPABASE_KEY', 'SUPABASE_URL', 'SUPABASE_KEY',
    'SPIDERSAN_ECOSYSTEM', 'SPIDERSAN_CORE_ONLY', 'SPIDERSAN_ROOM_TOKEN',
] as const;
const saved: Record<string, string | undefined> = {};
const cwd = process.cwd();
let home: string;
let repo: string;
let out: string[];
let fetchSpy: MockInstance;

class Exit extends Error {
    constructor(public code: number) { super(`exit ${code}`); }
}

function git(...args: string[]): void {
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

/** Run a command in-process; returns its exit code (0 when it never calls process.exit). */
async function run(cmd: Command, argv: string[]): Promise<number> {
    // commander keeps parsed option values between parses of the same instance
    (cmd as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    try {
        await cmd.parseAsync(['node', 'spidersan', ...argv]);
        return 0;
    } catch (err) {
        if (err instanceof Exit) return err.code;
        throw err;
    }
}

beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.SPIDERSAN_CORE_ONLY = '1';
    home = mkdtempSync(join(tmpdir(), 'spsn-retire-home-'));
    repo = mkdtempSync(join(tmpdir(), 'spsn-retire-repo-'));
    process.env.HOME = home;
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.invalid');
    git('config', 'user.name', 't');
    writeFileSync(join(repo, 'a.ts'), 'a\n');
    git('add', '.');
    git('commit', '-qm', 'init');
    git('checkout', '-qb', 'feat/one');
    process.chdir(repo);

    out = [];
    const capture = (...a: unknown[]) => { out.push(a.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(capture);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Exit(code ?? 0); }) as never);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network must not be used'));
});

afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
});

describe('local-only commands need no sync module and no Supabase config', () => {
    it('init, register, list and conflicts all work', async () => {
        const { initCommand } = await import('../src/commands/init.js');
        const { registerCommand } = await import('../src/commands/register.js');
        const { listCommand } = await import('../src/commands/list.js');
        const { conflictsCommand } = await import('../src/commands/conflicts.js');

        expect(await run(initCommand, ['init'])).toBe(0);
        expect(await run(registerCommand, ['register', '-f', 'a.ts', '-a', 'tester', '-d', 'one'])).toBe(0);

        out = [];
        expect(await run(listCommand, ['list', '--json'])).toBe(0);
        const listed = JSON.parse(out.join('\n')) as Array<{ name: string; files: string[] }>;
        expect(listed.map((b) => [b.name, b.files])).toContainEqual(['feat/one', ['a.ts']]);

        out = [];
        expect(await run(conflictsCommand, ['conflicts', '--json'])).toBe(0);
        const report = JSON.parse(out.join('\n')) as { conflicts: unknown[]; crossMachine: string };
        expect(report.conflicts).toEqual([]);
        expect(report.crossMachine).toBe('no-credentials');

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('an old config naming Supabase storage still loads, and changes nothing', async () => {
        writeFileSync(join(repo, '.spidersanrc'), JSON.stringify({
            storage: { type: 'supabase', supabaseUrl: 'https://example.invalid', supabaseKey: 'k' },
        }));
        writeFileSync(join(home, '.spidersanrc'), JSON.stringify({ storage: { type: 'supabase', supabaseUrl: 'https://example.invalid' } }));
        const { initCommand } = await import('../src/commands/init.js');
        const { registerCommand } = await import('../src/commands/register.js');
        const { conflictsCommand } = await import('../src/commands/conflicts.js');
        expect(await run(initCommand, ['init'])).toBe(0);
        expect(await run(registerCommand, ['register', '-f', 'a.ts', '-a', 'tester'])).toBe(0);
        out = [];
        expect(await run(conflictsCommand, ['conflicts', '--json'])).toBe(0);
        expect(JSON.parse(out.join('\n')).crossMachine).toBe('no-credentials');
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('sync commands without storage.syncModule', () => {
    beforeEach(() => {
        // An upgrader's environment: the old credentials are still set.
        process.env.SPIDERSAN_SUPABASE_URL = 'https://example.invalid';
        process.env.SPIDERSAN_SUPABASE_KEY = 'k';
    });

    it.each([['--push'], ['--pull'], ['--status'], []])('registry-sync %s exits 1 and says how to configure a module', async (...flags) => {
        const { registrySyncCommand } = await import('../src/commands/registry-sync.js');
        expect(await run(registrySyncCommand, ['registry-sync', ...flags])).toBe(1);
        const text = out.join('\n');
        expect(text).toContain('storage.syncModule');
        expect(text).toContain('SPIDERSAN_SYNC_MODULE');
        expect(text).toContain('no longer enable sync');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('cross-conflicts exits 1 (it used to exit 0, which read as "no conflicts")', async () => {
        const { crossConflictsCommand } = await import('../src/commands/cross-conflicts.js');
        expect(await run(crossConflictsCommand, ['cross-conflicts'])).toBe(1);
        expect(out.join('\n')).toContain('storage.syncModule');
        expect(out.join('\n')).toContain('cross-conflicts --local');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('cross-conflicts --local still works', async () => {
        const { initCommand } = await import('../src/commands/init.js');
        const { crossConflictsCommand } = await import('../src/commands/cross-conflicts.js');
        await run(initCommand, ['init']);
        expect(await run(crossConflictsCommand, ['cross-conflicts', '--local'])).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe('git-watch is retired', () => {
    it.each([[[]], [['--once']], [['--interval', '30000', '--no-realtime', '--repos', '/x:/y']]])(
        'git-watch %j refuses with exit 1 and names the replacement',
        async (flags) => {
            const { gitWatchCommand } = await import('../src/commands/git-watch.js');
            expect(await run(gitWatchCommand, ['git-watch', ...flags])).toBe(1);
            const text = out.join('\n');
            expect(text).toContain('git-watch was retired');
            expect(text).toContain('storage.syncModule');
            expect(fetchSpy).not.toHaveBeenCalled();
        },
    );
});
