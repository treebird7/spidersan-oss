import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dropShadowedPushRows, PUSH_MACHINE_ID } from '../src/lib/push-registry';
import { registryRepoNames } from '../src/lib/git';
import { SupabaseStorage } from '../src/storage/supabase';
import type { SupabaseRegistrySyncClient } from '../src/storage/supabase-registry-sync-client';
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

describe('SupabaseStorage.pullRegistries() over a syncModule client', () => {
    // A module client that does NO de-duplication of its own and honours excludeMachine.
    function fakeClient(views: MachineRegistryView[], seen: { names?: string | string[] } = {}): SupabaseRegistrySyncClient {
        return {
            pull: async (names, exclude) => { seen.names = names; return views.filter(v => v.machine_id !== exclude); },
            push: async () => ({ pushed: 0, updated: 0, abandoned: 0, abandonedBranches: [], errors: [] }),
            getStatus: async () => [],
            detectCrossMachineConflicts: async () => [],
        };
    }

    it("a pushed-branch row for the caller's own registered branch returns zero times", async () => {
        const storage = new SupabaseStorage(fakeClient([view('m5-uuid', ['feat']), view(PUSH_MACHINE_ID, ['feat'])]));
        const views = await storage.pullRegistries(['spidersan', 'spidersan-oss'], 'm5-uuid');
        expect(views.flatMap(v => v.branches)).toEqual([]);
    });

    it('keeps other machines and unshadowed pushed branches', async () => {
        const storage = new SupabaseStorage(fakeClient([view('m5-uuid', ['feat']), view('m2', ['other']), view(PUSH_MACHINE_ID, ['feat', 'codex/x'])]));
        const views = await storage.pullRegistries('spidersan', 'm5-uuid');
        expect(views.map(v => [v.machine_id, v.branches.map(b => b.name)])).toEqual([['m2', ['other']], [PUSH_MACHINE_ID, ['codex/x']]]);
    });

    it('passes every repo name through to the module: the clone directory and the GitHub repo name', async () => {
        const seen: { names?: string | string[] } = {};
        await new SupabaseStorage(fakeClient([], seen)).pullRegistries(['spidersan', 'spidersan-oss']);
        expect(seen.names).toEqual(['spidersan', 'spidersan-oss']);
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
