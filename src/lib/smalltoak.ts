/**
 * smalltoak health probe — proactive down-detection of the comms bridge.
 *
 * smalltoak is the treebird-chat message bridge `spidersan bot` polls
 * (`SMALLTOAK_SERVER_URL`). When it's down, message-driven git ops silently
 * stall — so `pulse` probes it to surface the outage early (tb-r9s).
 *
 * Reachability, not endpoint correctness, is what we detect: ANY HTTP response
 * (even 404/401) means the bridge is up; only a network error / timeout means
 * it's down. So a server without a `/health` route never false-alarms.
 */

export interface SmalltoakHealth {
    /** SMALLTOAK_SERVER_URL is set — otherwise the probe is a no-op. */
    configured: boolean;
    /** The configured base URL (trailing slashes stripped), when configured. */
    url?: string;
    /** True if the server answered at all; false on network error / timeout. */
    reachable?: boolean;
    /** HTTP status of the /health response, when reachable. */
    status?: number;
    /** Failure reason when unreachable. */
    error?: string;
}

/**
 * Probe `${SMALLTOAK_SERVER_URL}/health`. Never throws — failure resolves to
 * `{ reachable: false }`. Returns `{ configured: false }` when the env var is
 * unset so callers can skip silently.
 */
export async function probeSmalltoak(timeoutMs = 2000): Promise<SmalltoakHealth> {
    const base = (process.env.SMALLTOAK_SERVER_URL || '').replace(/\/+$/, '');
    if (!base) return { configured: false };

    try {
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
        return { configured: true, url: base, reachable: true, status: res.status };
    } catch (err) {
        return {
            configured: true,
            url: base,
            reachable: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
