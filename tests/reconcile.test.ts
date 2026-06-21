import { describe, it, expect } from 'vitest';
import { reconcileBranches, activeBranches, type ReconcileDeps } from '../src/lib/reconcile.js';
import type { Branch } from '../src/storage/adapter.js';

function branch(name: string, status: Branch['status'] = 'active'): Branch {
    return { name, files: [`${name}.ts`], registeredAt: new Date(0), status };
}

/**
 * Build deps where `merged`/`gone` name-sets decide git truth, so the tests
 * exercise the partition logic without touching a real repo.
 */
function deps(opts: { merged?: string[]; gone?: string[] } = {}): ReconcileDeps {
    const merged = new Set(opts.merged ?? []);
    const gone = new Set(opts.gone ?? []);
    return {
        trunkName: 'main',
        trunkRef: 'origin/main',
        resolveRef: (name) => (gone.has(name) ? null : `refs/remotes/origin/${name}`),
        isMerged: (ref) => merged.has(ref.replace('refs/remotes/origin/', '')),
    };
}

describe('reconcileBranches', () => {
    it('keeps an active branch that is neither merged nor gone', () => {
        const { live, merged, orphaned } = reconcileBranches([branch('feat/x')], deps());
        expect(live.map(b => b.name)).toEqual(['feat/x']);
        expect(merged).toEqual([]);
        expect(orphaned).toEqual([]);
    });

    it('reconciles a stale `active` branch that is actually merged (the phantom-conflict fix)', () => {
        const { live, merged } = reconcileBranches(
            [branch('feat/merged-but-active')],
            deps({ merged: ['feat/merged-but-active'] }),
        );
        expect(live).toEqual([]);
        expect(merged).toEqual(['feat/merged-but-active']);
    });

    it('drops a branch whose ref is gone from local and remote as orphaned', () => {
        const { live, orphaned } = reconcileBranches(
            [branch('feat/deleted')],
            deps({ gone: ['feat/deleted'] }),
        );
        expect(live).toEqual([]);
        expect(orphaned).toEqual(['feat/deleted']);
    });

    it('honours terminal `completed` status without a git probe', () => {
        const calls: string[] = [];
        const d: ReconcileDeps = {
            ...deps(),
            resolveRef: (n) => { calls.push(n); return `refs/remotes/origin/${n}`; },
        };
        const { merged } = reconcileBranches([branch('feat/done', 'completed')], d);
        expect(merged).toEqual(['feat/done']);
        expect(calls).toEqual([]); // never consulted git
    });

    it('honours terminal `abandoned` status as orphaned without a git probe', () => {
        const { orphaned, live } = reconcileBranches([branch('feat/dead', 'abandoned')], deps());
        expect(orphaned).toEqual(['feat/dead']);
        expect(live).toEqual([]);
    });

    it('passes the trunk branch through as live and never reconciles it away', () => {
        const { live } = reconcileBranches(
            [{ name: 'main', files: [], registeredAt: new Date(0), status: 'active' }],
            deps({ merged: ['main'] }),
        );
        expect(live.map(b => b.name)).toEqual(['main']);
    });

    it('partitions a mixed set correctly', () => {
        const result = reconcileBranches(
            [
                branch('feat/live'),
                branch('feat/merged'),
                branch('feat/gone'),
                branch('feat/done', 'completed'),
                { name: 'main', files: [], registeredAt: new Date(0), status: 'active' },
            ],
            deps({ merged: ['feat/merged'], gone: ['feat/gone'] }),
        );
        expect(result.live.map(b => b.name).sort()).toEqual(['feat/live', 'main']);
        expect(result.merged.sort()).toEqual(['feat/done', 'feat/merged']);
        expect(result.orphaned).toEqual(['feat/gone']);
    });
});

describe('activeBranches (read-path helper)', () => {
    it('excludes proven-merged branches', () => {
        const out = activeBranches(
            [branch('feat/live'), branch('feat/merged')],
            deps({ merged: ['feat/merged'] }),
        );
        expect(out.map(b => b.name)).toEqual(['feat/live']);
    });

    it('KEEPS orphaned (no-ref) branches — could be unfetched on another machine', () => {
        const out = activeBranches(
            [branch('feat/unfetched')],
            deps({ gone: ['feat/unfetched'] }),
        );
        expect(out.map(b => b.name)).toEqual(['feat/unfetched']);
    });

    it('excludes non-active (completed/abandoned) entries', () => {
        const out = activeBranches(
            [branch('feat/a'), branch('feat/done', 'completed'), branch('feat/dead', 'abandoned')],
            deps(),
        );
        expect(out.map(b => b.name)).toEqual(['feat/a']);
    });
});
