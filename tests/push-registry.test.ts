import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dropShadowedPushRows, PUSH_MACHINE_ID } from '../src/lib/push-registry';
import { registryRepoNames } from '../src/lib/git';
import { SupabaseRegistrySyncClientImpl } from '../src/storage/supabase-registry-sync-client-impl';
import type { MachineRegistryView } from '../src/types/cloud';

function view(machine_id: string, branches: string[]): MachineRegistryView {
    return {
        machine_id, machine_name: machine_id, hostname: 'h', repo_name: 'treebird', repo_path: '/x',
        last_synced: '', branches: branches.map(name => ({ name, files: ['a.ts'], status: 'active' as const, registeredAt: new Date() })),
    };
}

describe('dropShadowedPushRows', () => {
    it('a real registration of the same branch shadows the pushed-branch row', () => {
        const out = dropShadowedPushRows([view('m2', ['feat']), view(PUSH_MACHINE_ID, ['feat', 'codex/x'])]);
        expect(out.find(v => v.machine_id === PUSH_MACHINE_ID)!.branches.map(b => b.name)).toEqual(['codex/x']);
        expect(out.find(v => v.machine_id === 'm2')!.branches).toHaveLength(1);
    });
    it("the caller's own branches shadow it too (webhook beat registry-sync)", () => {
        expect(dropShadowedPushRows([view(PUSH_MACHINE_ID, ['mine'])], ['mine'])).toHaveLength(0);
    });
});

describe('pull()', () => {
    const row = (machine_id: string, repo_name: string, branch_name: string) => ({
        machine_id, machine_name: machine_id === PUSH_MACHINE_ID ? 'github' : 'm5', hostname: 'h', repo_name,
        repo_path: '/x', branch_name, status: 'active', files: ['a.ts'], synced_at: '2', created_at: '1',
    });

    it("a pushed-branch row for the caller's own registered branch returns zero times", async () => {
        const rows = [row('m5-uuid', 'spidersan', 'feat'), row(PUSH_MACHINE_ID, 'spidersan-oss', 'feat')];
        const fetchFn = (async () => new Response(JSON.stringify(rows))) as unknown as typeof fetch;
        const client = new SupabaseRegistrySyncClientImpl({ url: 'https://x', key: 'k', fetchFn });
        const views = await client.pull(['spidersan', 'spidersan-oss'], 'm5-uuid');
        expect(views.flatMap(v => v.branches)).toEqual([]);
    });

    it('queries every name: the clone directory and the GitHub repo name', async () => {
        let url = '';
        const fetchFn = (async (u: string) => { url = u; return new Response('[]'); }) as unknown as typeof fetch;
        const client = new SupabaseRegistrySyncClientImpl({ url: 'https://x', key: 'k', fetchFn });
        await client.pull(['spidersan', 'spidersan-oss']);
        expect(decodeURIComponent(url)).toContain('repo_name=in.("spidersan","spidersan-oss")');
    });
});

describe('registryRepoNames', () => {
    const roots: string[] = [];
    const cwd = process.cwd();
    afterEach(() => { process.chdir(cwd); roots.splice(0).forEach(r => rmSync(r, { recursive: true, force: true })); });

    function repoAt(dir: string, remote: string): string {
        const root = mkdtempSync(join(tmpdir(), 'ss-names-')); roots.push(root);
        const p = join(root, dir); mkdirSync(p);
        execFileSync('git', ['init', '-q'], { cwd: p });
        execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: p });
        return p;
    }

    it('adds the lowercased GitHub name when the clone directory differs', () => {
        process.chdir(repoAt('spidersan', 'https://github.com/treebird7/spidersan-oss.git'));
        expect(registryRepoNames()).toEqual(['spidersan', 'spidersan-oss']);
        process.chdir(repoAt('Toak', 'git@github.com:treebird7/toak.git'));
        expect(registryRepoNames()).toEqual(['Toak', 'toak']);
    });

    it('one name when they already match', () => {
        process.chdir(repoAt('treebird', 'https://github.com/Treebird-Ecosystem/treebird.git'));
        expect(registryRepoNames()).toEqual(['treebird']);
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
        expect(calls.find(u => u.includes('branch_name=in.'))!).toContain('repo_name=eq.treebird');
    });
});
