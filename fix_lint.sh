sed -i 's/let finalConfig/const finalConfig/g' src/commands/ai.ts
sed -i 's/import { isLocalOrLan } from/import { } from/g' src/commands/ai.ts
sed -i 's/isLocalOrLan,//g' src/commands/ai.ts
sed -i 's/, ProbeResult//g' src/commands/ai.ts
sed -i 's/validateAgentId, validateBranchName/validateBranchName/g' src/commands/conflicts.ts
sed -i 's/const fileList/\/\/ const fileList/g' src/commands/conflicts.ts
sed -i 's/const more/\/\/ const more/g' src/commands/conflicts.ts
sed -i 's/writeFileSync, mkdtempSync, mkdirSync/writeFileSync, mkdtempSync/g' src/commands/queen.ts
sed -i 's/async function getRecentActivity(repoRoot: string): Promise<ContextSource<ActivityEntry\[\]>> {/async function getRecentActivity(_repoRoot: string): Promise<ContextSource<ActivityEntry\[\]>> {/g' src/lib/ai/context-builder.ts
