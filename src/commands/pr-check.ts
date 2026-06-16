/**
 * spidersan pr-check <number>
 *
 * Check a PR's merge readiness: stacked-base detection and red/behind/conflict
 * state, with the failing *required* checks surfaced. Advisory by default
 * (exit 0); `--exit-code` makes it gate (so a Claude-Code pre-merge hook can
 * shell out to this instead of re-implementing the logic in bash).
 *
 * Promotes the 2026-06-15 `spidersan-pre.sh` hook into a first-class command.
 */

import { Command } from 'commander';
import { getPRMergeState, type PRMergeState } from '../lib/github.js';
import { getTrunkBranch } from '../lib/trunk.js';

interface PrCheckOptions {
    json?: boolean;
    exitCode?: boolean;
    repo?: string;
}

/** Merge-state statuses that mean "don't merge yet" (red / behind / conflicts). */
const RED_STATES = new Set(['UNSTABLE', 'DIRTY', 'BEHIND', 'BLOCKED']);

/**
 * Build the advisory list for a PR's merge state against trunk.
 * Pure — no I/O — so it is trivially unit-testable.
 *
 * @returns advisory strings (empty ⇒ looks clean) plus the derived `stacked` flag.
 */
export function buildPrCheckAdvisories(
    state: PRMergeState,
    trunk: string,
): { advisories: string[]; stacked: boolean } {
    const advisories: string[] = [];
    const stacked = state.baseRefName !== trunk;

    if (stacked) {
        advisories.push(
            `STACKED PR: base=${state.baseRefName} (not trunk) — merging lands on ${state.baseRefName}, not ${trunk}.`,
        );
    }

    if (RED_STATES.has(state.mergeStateStatus)) {
        const failing = state.checkRollup.failingRequired;
        const failingNote = failing.length > 0
            ? ` Failing required checks: ${failing.join(', ')}.`
            : '';
        advisories.push(
            `state=${state.mergeStateStatus} — red/behind/conflicts; verify before merging.${failingNote}`,
        );
    }

    return { advisories, stacked };
}

export const prCheckCommand = new Command('pr-check')
    .description('Check a PR\'s merge readiness (stacked base, red/behind state)')
    .argument('<number>', 'PR number to check')
    .option('--json', 'Output as JSON')
    .option('--exit-code', 'Exit 1 if any advisory fired (2 if PR/gh unavailable) — for hook gating')
    .option('--repo <owner/name>', 'Target repository (defaults to the current repo)')
    .action(async (numberArg: string, options: PrCheckOptions) => {
        const prNumber = Number.parseInt(numberArg, 10);
        if (!Number.isInteger(prNumber) || prNumber <= 0) {
            console.error(`❌ Invalid PR number: ${numberArg}`);
            // Advisory by default (exit 0 = return cleanly); --exit-code → 2 (unusable input).
            if (options.exitCode) process.exit(2);
            return;
        }

        const trunk = getTrunkBranch();
        const state = await getPRMergeState(prNumber, options.repo ? { repo: options.repo } : undefined);

        // gh unavailable / PR not found → friendly advisory message.
        if (!state) {
            const msg = `⚠️  Could not fetch PR #${prNumber} (gh unavailable or PR not found). Skipping merge-readiness check.`;
            if (options.json) {
                console.log(JSON.stringify({ error: msg, trunk, stacked: false, advisories: [] }, null, 2));
            } else {
                console.log(msg);
            }
            // Advisory by default (exit 0 = return cleanly); --exit-code → 2.
            if (options.exitCode) process.exit(2);
            return;
        }

        const { advisories, stacked } = buildPrCheckAdvisories(state, trunk);

        if (options.json) {
            console.log(JSON.stringify({ ...state, stacked, trunk, advisories }, null, 2));
        } else if (advisories.length === 0) {
            console.log(`✅ PR #${state.number} base=${state.baseRefName} state=${state.mergeStateStatus} — looks clean.`);
        } else {
            console.log(`🕷️  PR #${state.number} — merge readiness:`);
            for (const advisory of advisories) {
                console.log(`   ⚠️  ${advisory}`);
            }
        }

        if (options.exitCode && advisories.length > 0) {
            process.exit(1);
        }
    });
