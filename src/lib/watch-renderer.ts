import type { DriftResult, DriftSkipped } from './remote-drift.js';

export interface FetchPollRenderOptions {
    branch: string;
    drift: DriftResult | DriftSkipped;
    timestamp?: string;
}

/** Pure. Returns terminal string for --fetch-poll drift warnings and heartbeats. */
export function renderFetchPollHeartbeat(opts: { branch: string; timestamp?: string }): string {
    if (opts.timestamp) {
        return `📡 [FETCH-POLL] Remote unchanged (checked at ${opts.timestamp})`;
    }

    return '📡 [FETCH-POLL] Remote unchanged';
}

export function renderFetchPollDrift(opts: FetchPollRenderOptions): string {
    if ('skipped' in opts.drift) {
        return `📡 [FETCH-POLL] Skipped: ${opts.drift.reason}`;
    }

    const drift = opts.drift;
    const driftSummary = drift.driftZone.length > 0
        ? drift.driftZone.map((file) => formatDriftZoneEntry(file, drift)).join(', ')
        : '(none reported)';

    return [
        '📡 [FETCH-POLL] Remote advanced while you\'re working!',
        `   Branch: ${drift.branch}  |  Remote is ${drift.remoteAhead} commit(s) ahead`,
        `   Drift zone: ${driftSummary}`,
        `   → Run: git fetch origin && git log --oneline ${drift.remote} -5`,
    ].join('\n').trimEnd();
}

function formatDriftZoneEntry(file: string, result: DriftResult): string {
    const labels: string[] = [];
    const registered = result.registeredInDrift.find((entry) => entry.file === file);
    const unstaged = result.unstagedInDrift.some((entry) => entry.file === file);

    if (registered && registered.tier !== null) {
        labels.push(`registered tier ${registered.tier}`);
    }

    if (unstaged) {
        labels.push('unstaged ⚠');
    }

    return labels.length > 0 ? `${file} [${labels.join(', ')}]` : file;
}
