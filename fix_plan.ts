// The issue is in `src/lib/colony-subscriber.ts` around line 160:
// `const agentName = resolveAgentName(row.agent_key_id, payload.agent ?? undefined);`
// But wait, the test row says:
// ```
// const claimRows = [
//    makeClaimRow({
//        agent_key_id: workerUuid,
//        agent_label: operatorLabel,   // operator label present
//        branch: 'feature/labelled-claim',
//        files: ['src/feature.ts'],
//    }),
// ];
// ```
// The memory specifically says: "Vulnerability Pattern / Security Enhancement: When processing external signals or claims (e.g., `ColonySignalRow` in `colony-subscriber`), prefer authoritative database fields (like `agent_label`) over self-reported, potentially spoofable payload data (e.g., `payload.agent`) to ensure correct worker attribution and prevent identity spoofing."
// Ah, `colony_signals` *doesn't* have `agent_label`. But wait, `makeClaimRow` puts `agent_label` on the row!
// Let's check `ColonySignalRow` interface:
// ```
// interface ColonySignalRow {
//     id: string;
//     type: string;
//     agent_key_id: string;
//     payload: Record<string, unknown> | string | null;
//     created_at: string;
//     updated_at: string;
//     stale_after_ms: number | null;
// }
// ```
// Oh! It's missing `agent_label` in the interface, BUT the test expects it to be there, and `resolveAgentName` takes it.
// Actually, earlier in `src/lib/colony-subscriber.ts`, the comments say:
// `0. Build an agentKeyId → agentLabel map from all current colony_state rows`
// But step 0 is NOT implemented in the current code!!
// Let's look at `syncFromColony`: it goes straight to `1. Fetch active work_claim signals`.
// Wait, the memory says "prefer authoritative database fields (like `agent_label`) over self-reported, potentially spoofable payload data".
// But `colony_signals` doesn't have `agent_label`. The view `colony_state` has it.
// Wait, the test uses `makeClaimRow` and injects `agent_label`.
