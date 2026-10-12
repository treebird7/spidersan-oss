import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { branchToRegister, dropShadowedPushRows, PUSH_MACHINE, repoNameFor } from '../src/lib/push-registry';
import { registerPushedBranch, type GitEvent } from '../src/lib/git-events-subscriber';
import { SupabaseRegistrySyncClientImpl } from '../src/storage/supabase-registry-sync-client-impl';
import type { MachineRegistryView } from '../src/types/cloud';

const SHA = 'a'.repeat(40);
const NULL = '0'.repeat(40);

function ev(over: Partial<GitEvent> = {}): GitEvent {
    return {
        id: '1', seq: 1, delivery_id: 'd', repo: 'Treebird-Ecosystem/treebird', event_type: 'push',
        action: null, ref: 'refs/heads/codex/fix-x', ref_type: null, branch: 'codex/fix-x',
        before_sha: NULL, after_sha: SHA, sender_login: 'someone', received_at: '', ...over,
    };
}

function view(machine_id: string, branches: string[]): MachineRegistryView {
    return {
        machine_id, machine_name: machine_id, hostname: 'h', repo_name: 'treebird', repo_path: '/x',
        last_synced: '', branches: branches.map(name => ({ name, files: ['a.ts'], status: 'active' as const, registeredAt: new Date() })),
    };
}

describe('branchToRegister', () => {
    it('registers a pushed feature branch', () => expect(branchToRegister(ev(), 'main')).toBe('codex/fix-x'));
    it('skips trunk, deletes, tags and non-push events', () => {
        expect(branchToRegister(ev({ ref: 'refs/heads/main' }), 'main')).toBeNull();
        expect(branchToRegister(ev({ ref: 'refs/heads/trunk' }), 'trunk')).toBeNull();
        expect(branchToRegister(ev({ after_sha: NULL }), 'main')).toBeNull();
        expect(branchToRegister(ev({ after_sha: null }), 'main')).toBeNull();
        expect(branchToRegister(ev({ ref: 'refs/tags/v1' }), 'main')).toBeNull();
        expect(branchToRegister(ev({ event_type: 'pull_request' }), 'main')).toBeNull();
    });
});

describe('dropShadowedPushRows', () => {
    it('a real registration of the same branch shadows the pushed-branch row', () => {
        const out = dropShadowedPushRows([view('m2', ['feat']), view(PUSH_MACHINE.id, ['feat', 'codex/x'])]);
        const pushed = out.find(v => v.machine_id === PUSH_MACHINE.id)!;
        expect(pushed.branches.map(b => b.name)).toEqual(['codex/x']);
        expect(out.find(v => v.machine_id === 'm2')!.branches).toHaveLength(1);
    });
    it("the caller's own branches shadow it too (webhook beat registry-sync)", () => {
        const out = dropShadowedPushRows([view(PUSH_MACHINE.id, ['mine'])], ['mine']);
        expect(out).toHaveLength(0);
    });
});

describe('pull() — no self-conflict', () => {
    it("a pushed-branch row for the caller's own registered branch returns zero times", async () => {
        const rows = [
            { machine_id: 'm5-uuid', machine_name: 'm5', hostname: 'h', repo_name: 'treebird', repo_path: '/x', branch_name: 'feat', status: 'active', files: ['a.ts'], synced_at: '2', created_at: '1' },
            { machine_id: PUSH_MACHINE.id, machine_name: 'github', hostname: 'github.com', repo_name: 'treebird', repo_path: '/x', branch_name: 'feat', status: 'active', files: ['a.ts'], synced_at: '2', created_at: '1' },
        ];
        const fetchFn = (async () => new Response(JSON.stringify(rows))) as unknown as typeof fetch;
        const client = new SupabaseRegistrySyncClientImpl({ url: 'https://x', key: 'k', fetchFn });
        const views = await client.pull('treebird', 'm5-uuid');
        expect(views.flatMap(v => v.branches.map(b => `${v.machine_name}/${b.name}`))).toEqual([]);
    });
});

describe('registerPushedBranch', () => {
    function fakeFetch(calls: Array<{ url: string; init?: RequestInit }>) {
        return (async (url: string, init?: RequestInit) => {
            calls.push({ url, init });
            if (url === 'https://api.github.com/repos/Treebird-Ecosystem/treebird') return new Response(JSON.stringify({ default_branch: 'main' }));
            if (url.includes('/compare/')) return new Response(JSON.stringify({ files: [{ filename: 'hooks/a.sh' }, { filename: 'README.md' }] }));
            return new Response('[]', { status: 201 });
        }) as unknown as typeof fetch;
    }
    const creds = { SPIDERSAN_SUPABASE_URL: 'https://sb', SPIDERSAN_SUPABASE_KEY: 'svc' };

    it('upserts ONE row under the virtual machine, files vs trunk, repo = clone basename', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const r = await registerPushedBranch(ev(), ['/Users/x/Dev/treebird'], () => {}, creds, fakeFetch(calls));
        expect(r).toBe('registered');
        const writes = calls.filter(c => c.url.startsWith('https://sb/'));
        expect(writes).toHaveLength(1);                       // no abandon PATCH of other rows
        expect(writes[0].init?.method).toBe('POST');
        const [row] = JSON.parse(String(writes[0].init?.body));
        expect(row).toMatchObject({ machine_id: 'github-push', repo_name: 'treebird', branch_name: 'codex/fix-x', agent: 'codex', status: 'active' });
        expect(row.files).toEqual(['hooks/a.sh', 'README.md']);
    });

    it('does nothing without SPIDERSAN_ creds, even when SUPABASE_* (anon) is set', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        const r = await registerPushedBranch(ev(), ['/x/treebird'], () => {}, { SUPABASE_URL: 'https://sb', SUPABASE_KEY: 'anon' }, fakeFetch(calls));
        expect(r).toBe('skipped');
        expect(calls).toHaveLength(0);
    });

    it('skips pushes from dependency bots', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        expect(await registerPushedBranch(ev({ sender_login: 'dependabot[bot]' }), ['/x/treebird'], () => {}, creds, fakeFetch(calls))).toBe('skipped');
        expect(calls).toHaveLength(0);
    });

    it('skips a repo with no local clone', async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = [];
        expect(await registerPushedBranch(ev(), [], () => {}, creds, fakeFetch(calls))).toBe('skipped');
        expect(calls).toHaveLength(0);
    });
});

describe('registry-sync push abandon is repo-scoped', () => {
    it('the abandon PATCH filters on repo_name', async () => {
        const calls: string[] = [];
        const fetchFn = (async (url: string) => {
            calls.push(url);
            if (url.includes('select=branch_name')) return new Response(JSON.stringify([{ branch_name: 'old' }]));
            return new Response('[]');
        }) as unknown as typeof fetch;
        const client = new SupabaseRegistrySyncClientImpl({ url: 'https://x', key: 'k', fetchFn });
        await client.push({ id: 'm5', name: 'm5', hostname: 'h' }, 'treebird', '/x', []);
        const patch = calls.find(u => u.includes('branch_name=in.'))!;
        expect(patch).toContain('repo_name=eq.treebird');
    });
});

describe('repoNameFor', () => {
    it('a sibling worktree resolves to the main clone name', () => {
        const root = mkdtempSync(join(tmpdir(), 'ss-reponame-'));
        try {
            const main = join(root, 'spidersan'); mkdirSync(main);
            const g = (...a: string[]) => execFileSync('git', a, { cwd: main, stdio: 'ignore' });
            g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
            writeFileSync(join(main, 'a'), 'a'); g('add', '.'); g('commit', '-qm', 'a');
            g('worktree', 'add', '-q', '-b', 'topic', join(root, 'spidersan-topic'));
            expect(repoNameFor(main)).toBe('spidersan');
            expect(repoNameFor(join(root, 'spidersan-topic'))).toBe('spidersan');
        } finally { rmSync(root, { recursive: true, force: true }); }
    });
});
