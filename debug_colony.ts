// The failure is:
// AssertionError: expected 'agent:a1b2c3d4' to be 'treesan' // Object.is equality
// Expected: "treesan"
// Received: "agent:a1b2c3d4"
// ❯ test/colony-integration.spec.ts:393:31
//
// The code in `src/lib/colony-subscriber.ts` around resolving agent names:
// export function resolveAgentName(agentKeyId: string, agentLabel?: string): string {
//     if (agentLabel) return agentLabel;
//     return `agent:${agentKeyId.slice(0, 8)}`;
// }
//
// And the test mock `makeClaimRow`:
// We need to look at how `makeClaimRow` constructs the row and how `syncFromColony` reads it.
// The test uses `agent_label` on the root of the mock row, but `syncFromColony` gets it from `resolveAgentName(row.agent_key_id, payload.agent ?? undefined)`.
// It completely ignores `row.agent_label` because it queries `colony_signals` (which doesn't have `agent_label`, it's on the view).
// Wait, the memory says: "Vulnerability Pattern / Security Enhancement: When processing external signals or claims (e.g., `ColonySignalRow` in `colony-subscriber`), prefer authoritative database fields (like `agent_label`) over self-reported, potentially spoofable payload data (e.g., `payload.agent`) to ensure correct worker attribution and prevent identity spoofing."
