import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({ execFileSync: vi.fn() }));

import { analyzeCarries } from '../src/lib/carries';

const mock = vi.mocked(execFileSync);

/**
 * Route git calls: `log` returns the commit list; `branch -r --contains <sha>`
 * returns the recorded branch membership for that sha.
 */
function routeGit(logOut: string, contains: Record<string, string>) {
    mock.mockImplementation(((_cmd: string, args: string[]) => {
        if (args[0] === 'log') return logOut;
        if (args[0] === 'branch') {
            const sha = args[args.length - 1];
            return contains[sha] ?? '';
        }
        return '';
    }) as never);
}

beforeEach(() => vi.clearAllMocks());

describe('analyzeCarries', () => {
    it('splits own vs inherited and flags on intersection (∩≠∅, not superset)', () => {
        // #78-shaped: own d5cad9f; a285fa0/629b5f8/cddfd0a also on sherlock2.
        // sherlock2 ALSO has §3/§5 commits the PR never took → superset would be false,
        // but any shared commit must still flag.
        routeGit(
            'd5cad9f\tbridge\ncddfd0a\tkeystone\n629b5f8\thandoff\na285fa0\tSE gate',
            {
                d5cad9f: '  origin/birdsan/hive-close-session-bridge',           // only self
                cddfd0a: '  origin/birdsan/hive-close-session-bridge\n  origin/sherlock2/broker-se-gate',
                '629b5f8': '  origin/birdsan/hive-close-session-bridge\n  origin/sherlock2/broker-se-gate',
                a285fa0: '  origin/birdsan/hive-close-session-bridge\n  origin/sherlock2/broker-se-gate',
            },
        );

        const r = analyzeCarries('origin/main', 'refs/spidersan/pr-78', [
            'origin/main',
            'origin/birdsan/hive-close-session-bridge',
        ]);

        expect(r.flagged).toBe(true);
        expect(r.own.map((c) => c.sha)).toEqual(['d5cad9f']);
        expect(r.inherited.map((c) => c.sha).sort()).toEqual(['629b5f8', 'a285fa0', 'cddfd0a']);
        expect(r.inherited[0].branches).toEqual(['origin/sherlock2/broker-se-gate']);
    });

    it('all-own → not flagged', () => {
        routeGit('aaa111\tx\nbbb222\ty', {
            aaa111: '  origin/me/feature',
            bbb222: '  origin/me/feature',
        });
        const r = analyzeCarries('origin/main', 'ref', ['origin/main', 'origin/me/feature']);
        expect(r.flagged).toBe(false);
        expect(r.inherited).toHaveLength(0);
        expect(r.own).toHaveLength(2);
    });

    it('drops symbolic refs (origin/HEAD -> origin/main)', () => {
        routeGit('aaa111\tx', { aaa111: '  origin/HEAD -> origin/main\n  origin/main' });
        const r = analyzeCarries('origin/main', 'ref', ['origin/main']);
        // both the symbolic ref and the self base are excluded → own, not inherited
        expect(r.flagged).toBe(false);
        expect(r.own.map((c) => c.sha)).toEqual(['aaa111']);
    });

    it('empty range → empty report', () => {
        routeGit('', {});
        const r = analyzeCarries('origin/main', 'ref');
        expect(r).toEqual({ own: [], inherited: [], flagged: false });
    });
});
