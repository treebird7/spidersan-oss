import { describe, expect, it } from 'vitest';
import { renderFetchPollDrift, renderFetchPollHeartbeat } from '../src/lib/watch-renderer.js';
import type { DriftResult } from '../src/lib/remote-drift.js';

function createDriftResult(overrides: Partial<DriftResult> = {}): DriftResult {
    return {
        branch: 'feat/watch',
        remote: 'origin/feat/watch',
        localAhead: 0,
        remoteAhead: 2,
        state: 'remote_ahead',
        driftZone: ['src/auth.ts'],
        registeredInDrift: [],
        unstagedInDrift: [],
        safeToPush: false,
        rebaseContinueRisk: false,
        recommendation: 'pull_rebase',
        ...overrides,
    };
}

describe('watch renderer', () => {
    it('renders the heartbeat message', () => {
        const output = renderFetchPollHeartbeat({
            branch: 'feat/watch',
            timestamp: '12:34:56',
        });

        expect(output).toContain('Remote unchanged');
    });

    it('renders the remote advanced warning when no files are registered', () => {
        const output = renderFetchPollDrift({
            branch: 'feat/watch',
            drift: createDriftResult({
                driftZone: ['README.md'],
            }),
        });

        expect(output).toContain('Remote advanced');
    });

    it('renders registered files with their tier in the drift zone', () => {
        const output = renderFetchPollDrift({
            branch: 'feat/watch',
            drift: createDriftResult({
                registeredInDrift: [
                    { file: 'src/auth.ts', registered: true, tier: 2, unstaged: false },
                ],
            }),
        });

        expect(output).toContain('src/auth.ts');
        expect(output).toContain('registered tier 2');
    });

    it('renders unstaged files in the drift zone', () => {
        const output = renderFetchPollDrift({
            branch: 'feat/watch',
            drift: createDriftResult({
                driftZone: ['CONSORTIUM.md'],
                unstagedInDrift: [
                    { file: 'CONSORTIUM.md', registered: false, tier: null, unstaged: true },
                ],
            }),
        });

        expect(output).toContain('unstaged ⚠');
    });
});
