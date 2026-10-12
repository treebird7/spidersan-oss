/**
 * Pushed-branch rows in spider_registries — the reader side.
 *
 * The `spidersan-webhook` edge function (treebird repo) registers every branch pushed
 * to a watched repo, whoever pushed it (Codex, Copilot, a cloud agent, the web editor,
 * a person), under one virtual machine, `github-push`. The write stays server-side:
 * GitHub's HMAC proves the event and the service key never leaves Supabase.
 *
 * Such a row is shadowed — dropped on read — whenever a real machine has the same
 * branch, so a branch registered by the machine that pushed it never shows twice or
 * conflicts with itself (see dropShadowedPushRows).
 */
import type { MachineRegistryView } from '../types/cloud.js';

export const PUSH_MACHINE_ID = 'github-push';

/**
 * Drop pushed-branch rows a real registration already covers. Applied on every read
 * (pull) BEFORE the caller's own machine is excluded, so a branch the caller itself
 * registered doesn't come back as "github/<branch>" and conflict with itself.
 * `ownBranches` covers the race where the webhook beats the pusher's own registry-sync.
 */
export function dropShadowedPushRows(views: MachineRegistryView[], ownBranches: Iterable<string> = []): MachineRegistryView[] {
    const covered = new Set<string>(ownBranches);
    for (const v of views) {
        if (v.machine_id === PUSH_MACHINE_ID) continue;
        for (const b of v.branches) if (b.status === 'active') covered.add(b.name);
    }
    return views
        .map(v => v.machine_id !== PUSH_MACHINE_ID ? v : { ...v, branches: v.branches.filter(b => !covered.has(b.name)) })
        .filter(v => v.machine_id !== PUSH_MACHINE_ID || v.branches.length > 0);
}
