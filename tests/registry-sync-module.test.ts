import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRegistrySync, syncModulePath, syncModuleRequiredMessage } from '../src/storage/registry-sync.js';

const LEGACY = ['SPIDERSAN_SUPABASE_URL', 'SPIDERSAN_SUPABASE_KEY', 'SUPABASE_URL', 'SUPABASE_KEY'] as const;
const saved = {
    HOME: process.env.HOME, MOD: process.env.SPIDERSAN_SYNC_MODULE, cwd: process.cwd(),
    legacy: Object.fromEntries(LEGACY.map((k) => [k, process.env[k]])),
};
let home: string;
let repo: string;

function fakeModule(dir: string, body = "export const createRegistrySyncClient = async () => ({ pull: async () => [{ machine_id: 'fake' }], push: async () => ({}), getStatus: async () => [], detectCrossMachineConflicts: async () => [] });"): string {
    const p = join(dir, 'client.mjs');
    writeFileSync(p, body);
    return p;
}

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'spsn-home-'));
    repo = mkdtempSync(join(tmpdir(), 'spsn-repo-'));
    process.env.HOME = home;
    delete process.env.SPIDERSAN_SYNC_MODULE;
    for (const k of LEGACY) delete process.env[k];
});
afterEach(() => {
    process.env.HOME = saved.HOME;
    if (saved.MOD === undefined) delete process.env.SPIDERSAN_SYNC_MODULE; else process.env.SPIDERSAN_SYNC_MODULE = saved.MOD;
    process.chdir(saved.cwd);
    for (const k of LEGACY) { if (saved.legacy[k] === undefined) delete process.env[k]; else process.env[k] = saved.legacy[k]; }
    vi.restoreAllMocks();
});

describe('storage.syncModule', () => {
    it('a module named in ~/.spidersanrc becomes the sync client', async () => {
        writeFileSync(join(home, '.spidersanrc'), JSON.stringify({ storage: { syncModule: fakeModule(home) } }));
        const s = await resolveRegistrySync();
        expect(await s!.pullRegistries('x')).toEqual([{ machine_id: 'fake' }]);
    });

    it('SPIDERSAN_SYNC_MODULE works too, with ~ expanded', async () => {
        fakeModule(home);
        process.env.SPIDERSAN_SYNC_MODULE = '~/client.mjs';
        expect(await syncModulePath()).toBe(join(home, 'client.mjs'));
    });

    it('a repo-local .spidersanrc can NOT name a module (a cloned repo must not run code)', async () => {
        writeFileSync(join(repo, '.spidersanrc'), JSON.stringify({ storage: { syncModule: fakeModule(repo, 'throw new Error("ran repo code")') } }));
        process.chdir(repo);
        expect(await syncModulePath()).toBeUndefined();
    });

    it('a relative path or a module without the export is refused loudly', async () => {
        process.env.SPIDERSAN_SYNC_MODULE = 'client.mjs';
        await expect(syncModulePath()).rejects.toThrow(/absolute/);
        process.env.SPIDERSAN_SYNC_MODULE = fakeModule(home, 'export const nope = 1;');
        await expect(resolveRegistrySync()).rejects.toThrow(/createRegistrySyncClient/);
    });
});

describe('no storage.syncModule (the built-in hosted client is gone)', () => {
    it('resolves to null even with legacy Supabase credentials set, and never touches the network', async () => {
        process.env.SPIDERSAN_SUPABASE_URL = 'https://example.invalid';
        process.env.SPIDERSAN_SUPABASE_KEY = 'k';
        writeFileSync(join(home, '.spidersanrc'), JSON.stringify({ storage: { supabaseUrl: 'https://example.invalid', supabaseKey: 'k' } }));
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        expect(await resolveRegistrySync()).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('the message says how to configure a module', () => {
        const msg = syncModuleRequiredMessage().join('\n');
        expect(msg).toContain('storage.syncModule');
        expect(msg).toContain('~/.spidersanrc');
        expect(msg).toContain('SPIDERSAN_SYNC_MODULE');
        expect(msg).toContain('createRegistrySyncClient()');
        expect(msg).not.toContain('no longer enable sync');
    });

    it('tells an upgrader that their legacy credentials no longer enable sync', () => {
        process.env.SUPABASE_URL = 'https://example.invalid';
        expect(syncModuleRequiredMessage().join('\n')).toContain('no longer enable sync');
    });
});
