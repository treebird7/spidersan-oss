/**
 * Spidersan AI Core — Reasoner
 *
 * Sends SpiderContext + user question to LLM with spidersan-aware system prompt.
 * The scenario playbook is embedded as a TS constant (no file I/O at runtime).
 */

import { chat } from './llm-client.js';
import type {
  LLMConfig,
  LLMMessage,
  ReasoningMode,
  ReasoningRequest,
  ReasoningResult,
  SpiderContext,
} from './types.js';

// ─── Known Command Registry ──────────────────────────────────
// Must equal the CLI's registered commands (src/bin/command-registry.ts); tests/reasoner.validator.test.ts
// checks both directions. Used to flag model hallucinations at output time.
const KNOWN_SPIDERSAN_COMMANDS = new Set([
  'abandon', 'cleanup', 'config', 'conflicts', 'context', 'cross-conflicts', 'depends',
  'doctor', 'git-watch', 'github-sync', 'init', 'list', 'log', 'merge-order', 'merged',
  'pr-check', 'ready-check', 'rebase-helper', 'register', 'registry-sync', 'stale',
  'sync', 'verify-trunk', 'watch',
]);

// ─── Embedded Scenario Playbook ─────────────────────────────
// Optimized via PHC: Sonnet 4.6 proposer + Gemma 4 executor (score: 0.9718), measured before the
// 0.20.0 trim removed the scenarios for dropped commands; the trimmed text is unscored.
// Source: promptclimb/prompt_sonnet_spidersan.md

const SCENARIO_PLAYBOOK = `## Spidersan Command Reference & Scenarios

### SCENARIO 1: New Repo Setup
Situation: Starting work in a new or uninitialized repository.
Commands: spidersan init → register --files "f1,f2" --agent <id> → doctor → list
Reminder: Always verify repo health with \`doctor\` before proceeding.

### SCENARIO 2: Ghost/Abandoned Branches
Situation: Unregistered branches drifting — some with salvageable code, others dead.
Commands: sync → stale → log --branch <branch> → abandon <branch>
Decision: If the branch has unique commits worth keeping → cherry-pick them onto a fresh branch. If empty/WIP → abandon.

### SCENARIO 3: File Conflicts (Tier System)
- TIER 3 (BLOCK): Critical file (auth, secrets, env) — halt, coordinate immediately.
- TIER 2 (PAUSE): Important file (package.json, config, server) — coordinate before merging.
- TIER 1 (WARN): Adjacent/related files — proceed with caution.
Commands: conflicts → conflicts --tier 3 → conflicts --strict → conflicts --json → conflicts --notify
Reminder: Tier escalation is mandatory for TIER 3 conflicts. Always reference the TIER level when reporting conflicts.

### SCENARIO 4: WIP / Not-Ready Code
Situation: Branch has TODO, FIXME, HACK, WIP, SPIDER_TRAP, UNFINISHED markers.
Commands: ready-check → ready-check --json
Rule: Never merge a branch that fails \`ready-check\`. All markers must be resolved first.

### SCENARIO 5: Real-Time Monitoring
Commands: watch --agent <id>
Warning: Watch CPU loop if ghost branches claim same files. Fix: sync first.

### SCENARIO 6: Tangled Dependencies
Commands: merge-order → merge-order --json → merge-order --blocking-count → depends <branch> → conflicts --notify
Pattern: Merge foundation first → resolve blockers → re-check dependencies → merge dependents.

### SCENARIO 7: Stale Branch Cleanup
Commands: stale → cleanup → abandon <branch> → merged <branch> → sync
Triage: sync → stale → cleanup → verify with \`list\`.

### SCENARIO 8: Cross-Machine Conflicts
Commands: registry-sync --pull → cross-conflicts → cross-conflicts --local → doctor --remote
Pattern: Pull the shared registry first, then resolve the conflicts it shows.

### SCENARIO 9: Activity & Context
Situation: Investigating recent activity, mysterious branches, or understanding what happened over a time period.
IMPORTANT: When investigating recent or mysterious activity, ALWAYS start with \`log\` first — it gives you the evidence base before taking any action.
Commands: log → log --since 7d → log --branch <name> → context → context --json

### SCENARIO 10: Suspicious / Unknown Branch Investigation
Situation: A branch with an unknown owner, suspicious name (e.g. shadow/, unknown-agent), or no clear origin.
IMPORTANT: For any unknown or suspicious branch, start with \`log --branch <branch>\` and \`context\` before acting on it.
Commands: log --branch <branch> → context → abandon <branch>
Decision: If it holds work someone owns → contact them. If empty/dead → abandon.

### SCENARIO 11: Branch Abandonment & Rebase Recovery
Situation: Dead branches (0 commits ahead) cluttering registry, or a branch stuck mid-rebase.
Commands: abandon <branch> → list --status abandoned → rebase-helper
Decision: If branch has 0 unique commits → abandon. If \`.git/rebase-merge\` exists → use \`rebase-helper\` to diagnose. After resolution → register updated files.

### SCENARIO 12: Remote Sync & GitHub Integration
Situation: Local registry out of sync with remote. Need to see GitHub PR/CI state.
Commands: github-sync → pr-check <n> → registry-sync --pull → registry-sync --push
Decision: Use \`github-sync\` for remote branch/PR overview. \`pr-check\` for one PR's merge readiness. \`registry-sync\` to align local ↔ Supabase registry.

### SCENARIO 13: Configuration
Situation: Changing LLM or stale settings.
Commands: config list → config set llm.provider <provider> → config set stale.days <n>
Decision: Set \`llm.provider\` to lmstudio (local), ollama (local), or copilot (remote, opt-in).

### SCENARIO 14: Dependency Management
Situation: Multiple branches with merge-order dependencies that must be respected.
IMPORTANT: When dealing with a dependency chain across branches, ALWAYS use \`depends <branch>\` to declare dependencies first, then \`merge-order\` to determine the correct merge sequence. Missing \`depends\` leads to broken merge order.
Commands: depends <branch> --on <other> → depends --show → merge-order
Decision: Set dependencies before merging. If circular dependency detected → break the cycle by removing one dependency. \`merge-order\` respects the dependency graph.

### Decision Tree
Starting new work? → spidersan init → register + doctor
Found unknown/suspicious branch? → log --branch <branch> → context
About to merge? → conflicts → ready-check → depends --show → merge-order
Branches piling up? → stale → cleanup → sync
Blocked by another? → conflicts --notify → depends → merge-order
Cross-machine issues? → registry-sync --pull → cross-conflicts → doctor --remote
Investigating recent activity? → log → log --since 7d → context
Dead branches? → abandon + list --status abandoned
Stuck rebase? → rebase-helper
Remote out of sync? → github-sync → registry-sync
Setting up for first time? → spidersan init → config
Dependency chain? → depends <branch> --on <other> → depends --show → merge-order`;

// ─── System Prompt Builder ──────────────────────────────────

function buildSystemPrompt(mode: ReasoningMode): string {
  const persona = `You are Spidersan — the gitops coordinator for a multi-agent AI development fleet called 'the flock'. You speak with authority: direct, structured, actionable. Use real spidersan commands. Reference tier levels. Give git commands where needed. Never speculate — if you don't have enough context, say so.`;

  const modeInstructions: Record<ReasoningMode, string> = {
    ask: 'Answer the user\'s question using the repository context provided. Recommend specific commands. Structure your response with clear action items per agent if applicable.',
    advise: 'Analyze the current repository state and proactively recommend what should be done next. Prioritize: TIER 3 blocks first, then stale cleanup, then merge ordering. Be concise.',
    explain: 'Explain the branch\'s purpose, owner, status, and any conflicts. Use activity log and daily collab entries if available. Be factual.',
  };

  return `${persona}\n\n${modeInstructions[mode]}\n\n${SCENARIO_PLAYBOOK}`;
}

// ─── Context Serializer ─────────────────────────────────────

function serializeContext(context: SpiderContext, verbose?: boolean): string {
  const sections: string[] = [
    `## Repository State (${context.timestamp})`,
    `Repo: ${context.repo} | Branch: ${context.branch}`,
    `Git: ${context.gitStatus.ahead} ahead, ${context.gitStatus.behind} behind${context.gitStatus.dirty.length > 0 ? `, ${context.gitStatus.dirty.length} dirty files` : ''}`,
    '',
    `## Registry: ${context.registry.active} active, ${context.registry.stale} stale`,
  ];

  if (context.registry.branches.length > 0) {
    for (const b of context.registry.branches.slice(0, 15)) {
      sections.push(`  - ${b.name} [${b.status}] agent=${b.agent ?? 'unknown'} files=${b.files.length}`);
    }
  }

  sections.push('', `## Conflicts: ${context.conflicts.tier3} BLOCK, ${context.conflicts.tier2} PAUSE, ${context.conflicts.tier1} WARN`);
  if (context.conflicts.details.length > 0) {
    for (const c of context.conflicts.details) {
      sections.push(`  - TIER ${c.tier}: ${c.branch} ↔ ${c.otherBranch} on [${c.files.join(', ')}]`);
    }
  }

  sections.push('', `## Colony: ${context.colony.online ? 'online' : 'offline'}, ${context.colony.activeAgents.length} agents`);
  if (context.colony.inProgress.length > 0) {
    for (const w of context.colony.inProgress) {
      sections.push(`  - ${w.agent}: ${w.task} (${w.status})`);
    }
  }

  if (verbose && context.activityLog && context.activityLog.length > 0) {
    sections.push('', '## Recent Activity (last 24h)');
    for (const a of context.activityLog.slice(0, 10)) {
      sections.push(`  - [${a.event}] ${a.branch ?? ''} by ${a.agent ?? 'unknown'} at ${a.timestamp}`);
    }
  }

  return sections.join('\n');
}

// ─── Main Reasoning Function ────────────────────────────────

export async function reason(
  request: ReasoningRequest,
  llmOverrides?: Partial<LLMConfig> & { allowRemoteFallback?: boolean },
): Promise<ReasoningResult> {
  const systemPrompt = buildSystemPrompt(request.mode);
  const contextText = serializeContext(request.context, request.verbose);

  let userMessage: string;
  switch (request.mode) {
    case 'ask':
      userMessage = `${contextText}\n\n## Question\n${request.question}`;
      break;
    case 'advise':
      userMessage = `${contextText}\n\nWhat should I do next? Prioritize by urgency.`;
      break;
    case 'explain':
      userMessage = `${contextText}\n\nExplain branch: ${request.branch}`;
      break;
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await chat(messages, llmOverrides);

  // Extract commands from response (lines starting with spidersan/git/envoak/toak)
  const commandPattern = /^\s*(?:spidersan|git|envoak|toak|npx spidersan)\s+.+/gm;
  const commands = (response.content.match(commandPattern) ?? []).map(c => c.trim());

  // Validate spidersan sub-commands against the known registry
  const spidersanSubcommandPattern = /^(?:spidersan|npx spidersan)\s+(\S+)/;
  const unknownCommands = commands.filter(cmd => {
    const m = cmd.match(spidersanSubcommandPattern);
    return m !== null && !m[1]!.startsWith('-') && !KNOWN_SPIDERSAN_COMMANDS.has(m[1]!);
  });

  // Estimate categorical confidence from context quality
  const hasConflicts = request.context.conflicts.tier3 > 0 || request.context.conflicts.tier2 > 0;
  const hasRegistry = request.context.registry.active > 0;
  const confidence = hasRegistry
    ? (hasConflicts ? 'high' : 'medium')
    : 'low';

  // Numeric trust score: multi-signal composite (0.0–1.0).
  // Base from categorical label, then adjusted by context richness and output quality.
  const CONFIDENCE_SCORES: Record<string, number> = { high: 0.9, medium: 0.7, low: 0.3 };
  let confidenceScore = CONFIDENCE_SCORES[confidence]!;

  // Try to parse numeric confidence from structured JSON response (P2A-1 model format)
  const jsonMatch = response.content.match(/^\s*\{[\s\S]*?"confidence"\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/m);
  if (jsonMatch?.[1]) {
    const parsed = parseFloat(jsonMatch[1]);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      confidenceScore = parsed;
    }
  }

  // Context-richness adjustments (additive, capped at 1.0):
  //   +0.05 if colony is online with active agents (live fleet state available)
  //   +0.05 if activity log is present and non-empty (recent history available)
  //   -0.10 per unknown spidersan command in output (model hallucinated a command)
  //   -0.15 if tier-3 conflict exists and mode is 'advise' (high stakes, lower certainty)
  if (request.context.colony.online && request.context.colony.activeAgents.length > 0) {
    confidenceScore = Math.min(1.0, confidenceScore + 0.05);
  }
  if (request.context.activityLog && request.context.activityLog.length > 0) {
    confidenceScore = Math.min(1.0, confidenceScore + 0.05);
  }
  if (unknownCommands.length > 0) {
    confidenceScore = Math.max(0.0, confidenceScore - 0.10 * unknownCommands.length);
  }
  if (request.context.conflicts.tier3 > 0 && request.mode === 'advise') {
    confidenceScore = Math.max(0.0, confidenceScore - 0.15);
  }
  confidenceScore = Math.round(confidenceScore * 100) / 100;

  return {
    advice: response.content,
    commands,
    unknownCommands,
    confidence: confidence as 'high' | 'medium' | 'low',
    confidenceScore,
    mode: request.mode,
    provider: response.provider,
    tokensUsed: response.promptTokens + response.completionTokens,
  };
}
