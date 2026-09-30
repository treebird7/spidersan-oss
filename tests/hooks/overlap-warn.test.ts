import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync, execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const SCRIPT = resolve(__dirname, '../../hooks/claude/spidersan-overlap-warn.sh');
const hasJq = spawnSync('jq', ['--version']).status === 0;

let repo: string, bin: string, state: string;
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf-8' });

/** stub `spidersan conflicts --json` printing the given payload (or failing) */
function stub(body: string) {
    writeFileSync(join(bin, 'spidersan'), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, 'spidersan'), 0o755);
}
const json = (conflicts: unknown[]) => `cat <<'J'\n${JSON.stringify({ conflicts })}\nJ`;
const run = (file: string) => spawnSync('bash', [SCRIPT], {
    input: JSON.stringify({ tool_input: { file_path: join(repo, file) } }),
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPIDERSAN_OVERLAP_STATE_DIR: state },
    encoding: 'utf-8',
});

describe.skipIf(!hasJq)('spidersan-overlap-warn.sh', () => {
    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'ow-repo-')); bin = mkdtempSync(join(tmpdir(), 'ow-bin-')); state = mkdtempSync(join(tmpdir(), 'ow-st-'));
        git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
        mkdirSync(join(repo, '.spidersan')); writeFileSync(join(repo, 'a.ts'), 'x'); git('add', '.'); git('commit', '-qm', 'i');
        git('checkout', '-q', '-b', 'feat-x');
    });

    it('warns when the edited file overlaps another branch, then stays quiet (dedupe)', () => {
        stub(json([{ branch: 'feat-y', files: ['a.ts'], tier: 2 }]));
        const first = run('a.ts');
        expect(first.status).toBe(0);
        const ctx = JSON.parse(first.stdout).hookSpecificOutput;
        expect(ctx.hookEventName).toBe('PostToolUse');
        expect(ctx.additionalContext).toContain("'feat-y'");
        expect(ctx.additionalContext).toContain('TIER 2');
        expect(run('a.ts').stdout).toBe('');
    });

    it('names the other session (tbe id) when the registry has one, and still parses without one', () => {
        stub(json([
            { branch: 'feat-y', files: ['a.ts'], tier: 2, sessionId: '1a2b3c4d-0000-4000-8000-000000000001' },
            { branch: 'feat-z', files: ['a.ts'], tier: 1 },
        ]));
        const msg: string = JSON.parse(run('a.ts').stdout).hookSpecificOutput.additionalContext;
        expect(msg).toContain("'feat-y' (TIER 2) — session 1a2b3c4d-0000-4000-8000-000000000001 (tbe watch 1a2b3c4d-0000-4000-8000-000000000001)");
        // no-session entry: fields must not shift (tier stays 1, no dangling session text)
        expect(msg).toContain("'feat-z' (TIER 1). Coordinate");
    });

    it('says once per checkout that cross-machine was not checked (no creds), and stays silent when it was', () => {
        const withCm = (crossMachine: string) => `cat <<'J'\n${JSON.stringify({ conflicts: [], crossMachine })}\nJ`;
        stub(withCm('no-credentials'));
        const msg: string = JSON.parse(run('a.ts').stdout).hookSpecificOutput.additionalContext;
        expect(msg).toContain('NOT checked');
        expect(msg).toContain('SPIDERSAN_SUPABASE_URL/KEY');
        expect(run('a.ts').stdout).toBe('');          // once per checkout
        stub(withCm('checked'));
        expect(run('a.ts').stdout).toBe('');          // checked + no overlap => silent
    });

    it('is silent when the overlap is a different file', () => {
        stub(json([{ branch: 'feat-y', files: ['other.ts'], tier: 1 }]));
        expect(run('a.ts').stdout).toBe('');
    });

    it('is silent on trunk', () => {
        git('checkout', '-q', 'main');
        stub(json([{ branch: 'feat-y', files: ['a.ts'], tier: 1 }]));
        expect(run('a.ts').stdout).toBe('');
    });

    it('fails open: CLI error or garbage output is silent and exits 0', () => {
        stub('exit 1'); expect(run('a.ts')).toMatchObject({ status: 0, stdout: '' });
        stub('echo not-json'); expect(run('a.ts')).toMatchObject({ status: 0, stdout: '' });
    });
});
