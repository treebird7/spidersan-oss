import { describe, expect, it } from 'vitest';
import { renderPulseReport } from '../src/lib/pulse-renderer.js';
import type { DriftResult, DriftSkipped } from '../src/lib/remote-drift.js';

function createDriftResult(overrides: Partial<DriftResult> = {}): DriftResult {
    return {
        branch: 'feat/pulse',
        remote: 'origin/feat/pulse',
        localAhead: 0,
        remoteAhead: 0,
        state: 'synced',
        driftZone: [],
        registeredInDrift: [],
        unstagedInDrift: [],
        safeToPush: true,
        rebaseContinueRisk: false,
        recommendation: 'synced',
        ...overrides,
    };
}

function createDriftSkipped(reason: string): DriftSkipped {
    return { skipped: true, reason };
}

describe('renderPulseReport', () => {
    it('renders the unregistered branch message', () => {
        const output = renderPulseReport({
            branch: 'feat/pulse',
            registered: false,
            conflicts: [],
        });

        expect(output).toContain('not registered');
    });

    it('renders the no-conflicts message for a registered branch', () => {
        const output = renderPulseReport({
            branch: 'feat/pulse',
            registered: true,
            colonySynced: 2,
            colonyOffline: false,
            activeBranches: 3,
            conflicts: [],
        });

        expect(output).toContain('No conflicts');
    });

    it('renders a tier 2 conflict with the orange icon and branch name', () => {
        const output = renderPulseReport({
            branch: 'feat/pulse',
            registered: true,
            colonyOffline: true,
            activeBranches: 2,
            conflicts: [
                { tier: 2, branch: 'feat/other', files: ['src/auth.ts'] },
            ],
        });

        expect(output).toContain('🟠');
        expect(output).toContain('feat/other');
    });

    it('renders a tier 3 conflict with the red icon', () => {
        const output = renderPulseReport({
            branch: 'feat/pulse',
            registered: true,
            colonyOffline: true,
            activeBranches: 2,
            conflicts: [
                { tier: 3, branch: 'feat/blocker', files: ['src/secrets.ts'] },
            ],
        });

        expect(output).toContain('🔴');
    });

    it('renders remote drift details when the remote is ahead', () => {
        const output = renderPulseReport({
            branch: 'feat/pulse',
            registered: true,
            colonyOffline: true,
            activeBranches: 1,
            conflicts: [],
            drift: createDriftResult({
                remoteAhead: 3,
                state: 'remote_ahead',
                driftZone: ['src/auth.ts'],
                registeredInDrift: [
                    { file: 'src/auth.ts', registered: true, tier: 2, unstaged: false },
                ],
                safeToPush: false,
                recommendation: 'pull_rebase',
            }),
        });

        expect(output).toContain('REMOTE DRIFT');
        expect(output).toContain('3 commit(s) ahead');
    });

    it('renders the drift skipped reason', () => {
        const output = renderPulseReport({
            branch: 'feat/pulse',
            registered: true,
            colonyOffline: true,
            activeBranches: 1,
            conflicts: [],
            drift: createDriftSkipped('offline'),
        });

        expect(output).toContain('skipped');
        expect(output).toContain('offline');
    });
});
