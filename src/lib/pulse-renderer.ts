import type { DriftResult, DriftSkipped } from './remote-drift.js';

export interface PulseRenderOptions {
    branch: string;
    registered: boolean;
    colonySynced?: number;
    colonyOffline?: boolean;
    activeBranches?: number;
    conflicts: Array<{ tier: number; branch: string; files: string[]; agent?: string }>;
    drift?: DriftResult | DriftSkipped | null;
    verbose?: boolean;
}

/** Pure. Returns terminal string for spidersan pulse human output. */
export function renderPulseReport(opts: PulseRenderOptions): string {
    const lines: string[] = [];

    if (!opts.registered) {
        lines.push(`🕷️ Branch "${opts.branch}" is not registered.`);
        lines.push('   Run: spidersan register --files "..."');

        if (opts.colonyOffline === false) {
            lines.push(`   Colony: synced ${opts.colonySynced ?? 0} claim(s)`);
        }

        appendDrift(lines, opts.drift);
        return lines.join('\n').trimEnd();
    }

    const colonyStatus = opts.colonyOffline
        ? '⚠  offline'
        : `✅ synced ${opts.colonySynced ?? 0} claim(s)`;

    lines.push(`🕷️ SPIDERSAN PULSE — "${opts.branch}"`);
    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`Colony:    ${colonyStatus}`);
    lines.push(`Branches:  ${opts.activeBranches ?? 1} active`);
    lines.push('');

    if (opts.conflicts.length === 0) {
        lines.push('✅ No conflicts detected. You\'re good to go!');
    } else {
        const tierIcons: Record<number, string> = { 1: '🟡', 2: '🟠', 3: '🔴' };
        const tierLabels: Record<number, string> = { 1: 'WARN', 2: 'PAUSE', 3: 'BLOCK' };

        for (const conflict of opts.conflicts) {
            const icon = tierIcons[conflict.tier] ?? '🟡';
            const label = tierLabels[conflict.tier] ?? 'WARN';
            const agentTag = conflict.agent ? ` [@${conflict.agent}]` : '';

            lines.push(`${icon} TIER ${conflict.tier} ${label}: ${conflict.branch}${agentTag}`);
            for (const file of conflict.files) {
                lines.push(`   • ${file}`);
            }
            lines.push('');
        }

        // Optimization: Replaced multiple .filter().length passes with a single loop to reduce allocations
        let tier1 = 0, tier2 = 0, tier3 = 0;
        for (const conflict of opts.conflicts) {
            if (conflict.tier === 1) tier1++;
            else if (conflict.tier === 2) tier2++;
            else if (conflict.tier === 3) tier3++;
        }

        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push(`📊 Summary: 🔴 ${tier3} BLOCK | 🟠 ${tier2} PAUSE | 🟡 ${tier1} WARN`);
    }

    appendDrift(lines, opts.drift);
    return lines.join('\n').trimEnd();
}

function appendDrift(lines: string[], drift?: DriftResult | DriftSkipped | null): void {
    if (!drift) {
        return;
    }

    lines.push('');

    if ('skipped' in drift) {
        lines.push(`⚠  Remote drift check skipped: ${drift.reason}`);
        return;
    }

    lines.push(...renderDriftReportLines(drift));
}

function tierIcon(tier: 1 | 2 | 3 | null): string {
    if (tier === 3) return '🔴';
    if (tier === 2) return '🟠';
    if (tier === 1) return '🟡';
    return '⚪';
}

function renderDriftReportLines(drift: DriftResult): string[] {
    if (drift.state === 'synced' || drift.remoteAhead === 0) {
        return ['✅ Remote drift: 0 commits ahead. Safe to push.'];
    }

    const tierLabels: Record<number, string> = { 1: 'TIER 1', 2: 'TIER 2', 3: 'TIER 3' };
    const lines = [
        `🕷️ REMOTE DRIFT — "${drift.branch}"`,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `Remote is ${drift.remoteAhead} commit(s) ahead of local.`,
        '',
        'Drift zone (files touched by remote commits):',
    ];

    for (const entry of drift.driftZone.map((file) => {
        const found = [...drift.registeredInDrift, ...drift.unstagedInDrift].find((item) => item.file === file);
        return found ?? { file, registered: false, tier: null as null, unstaged: false };
    })) {
        const parts: string[] = [];

        if (entry.registered && entry.tier !== null) {
            parts.push(`registered — ${tierIcon(entry.tier)} ${tierLabels[entry.tier]}`);
        }

        if (entry.unstaged) {
            parts.push('unstaged modification ⚠');
        }

        const label = parts.length > 0 ? `  [${parts.join('] [')}]` : '  [not registered, not modified]';
        lines.push(`  ${entry.file}${label}`);
    }

    lines.push('');

    if (drift.registeredInDrift.length > 0) {
        lines.push(`⚠  ${drift.registeredInDrift.length} registered file(s) in drift zone. Rebase will conflict.`);
    }

    if (drift.rebaseContinueRisk) {
        lines.push('⚠  File(s) with unstaged modifications — git rebase --continue may block even');
        lines.push('   after resolving conflict markers. Fix: git checkout HEAD -- <file>');
        for (const entry of drift.unstagedInDrift) {
            lines.push(`     ${entry.file}`);
        }
    }

    lines.push('');
    lines.push('   git fetch origin');
    lines.push(`   git log --oneline ${drift.remote} -3`);
    return lines;
}
