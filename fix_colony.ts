// `agent_label` is included in the test response, and the issue states we should use it.
// The problem is that in `colony-subscriber.ts`, `ColonySignalRow` doesn't define `agent_label`, so TS ignores it.
// But wait, at runtime, `row.agent_label` exists! Wait no, TypeScript doesn't remove properties, so if it's there, it's there.
// But look at line 160:
// const agentName = resolveAgentName(row.agent_key_id, payload.agent ?? undefined);
// It is explicitly passing `payload.agent` to `agentLabel` parameter!!
// It ignores `row.agent_label` completely!
// Let's fix this.
// `const agentName = resolveAgentName(row.agent_key_id, (row as any).agent_label ?? payload.agent ?? undefined);`
