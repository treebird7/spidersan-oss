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
// Derived from src/commands/* + spidersan --help. Used to flag model hallucinations at output time.
// Update when new commands ship.
const KNOWN_SPIDERSAN_COMMANDS = new Set([
  'abandon', 'advise', 'ai-ping', 'ai-setup', 'ai-telemetry', 'ask', 'auto',
  'bot', 'check-opt-out', 'cleanup', 'collab', 'config', 'conflicts', 'context',
  'cross-conflicts', 'daily', 'dashboard', 'depends', 'doctor', 'explain',
  'git-watch', 'github-sync', 'init', 'list', 'log', 'merge-order', 'merged',
  'pulse', 'queen', 'ready-check', 'rebase-helper', 'register', 'registry-sync',
  'rescue', 'stale', 'sync', 'sync-advisor', 'torrent', 'watch', 'welcome',
]);

// ─── Embedded Scenario Playbook ─────────────────────────────
// Optimized via PHC: Sonnet 4.6 proposer + Gemma 4 executor (score: 0.9718)
// Source: promptclimb/prompt_sonnet_spidersan.md

const SCENARIO_PLAYBOOK = `## Spidersan Command Reference & Scenarios

### SCENARIO 1: New Repo Setup
Situation: Starting work in a new or uninitialized repository.
IMPORTANT: When setting up Spidersan for the first time, ALWAYS recommend \`welcome\` as the very first command — it provides guided onboarding before any other setup step.
Commands: welcome → spidersan init → register --files "f1,f2" --agent <id> → doctor → list
Reminder: Always verify repo health with \`doctor\` before proceeding.

### SCENARIO 2: Ghost/Abandoned Branches
Situation: Unregistered branches drifting — some with salvageable code, others dead.
Commands: rescue --scan → rescue --symbols <branch> → sync
Decision: If \`rescue --symbols\` identifies salvageable code → cherry-pick. If empty/WIP → abandon.

### SCENARIO 3: File Conflicts (Tier System)
- TIER 3 (BLOCK): Critical file (auth, secrets, env) — halt, coordinate immediately.
- TIER 2 (PAUSE): Important file (package.json, config, server) — coordinate before merging.
- TIER 1 (WARN): Adjacent/related files — proceed with caution.
Commands: conflicts → conflicts --tier 3 → conflicts --strict → conflicts --json → conflicts --wake
Reminder: Tier escalation is mandatory for TIER 3 conflicts. Always reference the TIER level when reporting conflicts.

### SCENARIO 4: WIP / Not-Ready Code
Situation: Branch has TODO, FIXME, HACK, WIP, SPIDER_TRAP, UNFINISHED markers.
Commands: ready-check → ready-check --json
Rule: Never merge a branch that fails \`ready-check\`. All markers must be resolved first.

### SCENARIO 5: Real-Time Monitoring
Commands: watch --agent <id> → auto start/stop/status
Warning: Watch CPU loop if ghost branches claim same files. Fix: sync first.
Recommendation: Use \`auto\` for periodic monitoring of agent activity.

### SCENARIO 6: Task Decomposition (Torrent)
Situation: Breaking a single task into sequential child subtasks for a serial workflow.
IMPORTANT: \`torrent\` is for sequential subtask decomposition within a single workflow. For dispatching parallel independent agents simultaneously, use \`queen spawn\` instead (see SCENARIO 9).
Commands: torrent decompose <TASK> -c N → torrent create <CHILD> -a <agent> → torrent complete <CHILD> → torrent tree → torrent merge-order
Reminder: Ensure all child tasks are marked completed before executing \`torrent merge-order\`.

### SCENARIO 7: Tangled Dependencies
Commands: merge-order → merge-order --json → merge-order --blocking-count → depends <branch> → conflicts --wake
Pattern: Merge foundation first → resolve blockers → re-check dependencies → merge dependents.

### SCENARIO 8: Stale Branch Cleanup
Commands: stale → cleanup → abandon <branch> → merged <branch> → sync
Triage: sync → stale → cleanup → verify with \`list\`.

### SCENARIO 9: Queen Dispatch (Parallel Agents)
Situation: Parallelizing work across multiple sub-agents or sub-spidersans simultaneously.
IMPORTANT: When asked to parallelize across multiple agents or sub-spidersans, ALWAYS recommend \`queen spawn\` FIRST — this is the dedicated parallel dispatch command. Do NOT suggest \`torrent decompose\` for parallel agent dispatch. Torrent = sequential subtasks. Queen = parallel agents.
Commands: queen spawn --task "desc" → queen status → queen dissolve <id>
Rule: Dissolve inactive queens to prevent resource leakage. Use \`queen status\` to monitor all active queens.

### SCENARIO 10: Hive Lifecycle
Hive Operations (via envoak MCP, not spidersan CLI): hive enlist → hive signal --status in-progress → hive heartbeat → hive probe → hive accept → hive close → hive broadcast → hive broadcast-ack → hive broadcast-status → hive cns → hive gc
Reminder: Use \`probe\` to verify hive readiness before proceeding to \`accept\`.

### SCENARIO 11: Cross-Machine Conflicts
Commands: pulse → cross-conflicts → cross-conflicts --local → doctor --remote
Pattern: Use \`pulse\` to identify cross-machine activity, followed by conflict resolution steps.

### SCENARIO 12: Activity & Context
Situation: Investigating recent activity, mysterious branches, or understanding what happened over a time period.
IMPORTANT: When investigating recent or mysterious activity, ALWAYS start with \`log\` and \`daily\` commands first. Do NOT skip to \`rescue\` — log and daily give you the evidence base before taking any action.
Commands: log → log --since 7d → log --branch <name> → daily → daily --branch <name> --tldr → daily --context --branch <name>
Recommendation: Use \`daily --context\` for detailed summaries of recent activity.

### SCENARIO 13: AI-Assisted Analysis & Proactive Advice
Situation: Complex repo state that needs intelligent analysis — stale branches, hidden conflicts, unknown branches.
IMPORTANT: When asked for proactive recommendations or advice about the repo state, ALWAYS recommend \`spidersan advise\` as your FIRST command. Do not give direct advice yourself — \`advise\` is the dedicated entry point for AI-driven proactive recommendations. Only follow with \`context\`, \`ask\`, or \`explain\` after \`advise\` has been run.
Commands: ai-ping → context → context --json → ask "<question>" → advise → explain <branch>
Decision: Use \`ai-ping\` to verify AI readiness. Use \`advise\` for proactive recommendations. Use \`ask\` for specific questions. Use \`explain\` for branch investigation.

### SCENARIO 13B: Suspicious / Unknown Branch Investigation
Situation: A branch with an unknown owner, suspicious name (e.g. shadow/, unknown-agent), or no clear origin.
IMPORTANT: For any unknown or suspicious branch, ALWAYS use \`spidersan explain <branch>\` first. Do NOT jump to \`rescue\` or mention \`queen\` or \`hive\` in this context. \`explain\` is the dedicated command for branch investigation. After \`explain\`, use \`rescue\` only if code needs salvaging.
Commands: explain <branch> → rescue --symbols <branch> → abandon <branch>
Decision: explain first → if salvageable → rescue → if empty/dead → abandon.

### SCENARIO 14: Branch Abandonment & Rebase Recovery
Situation: Dead branches (0 commits ahead) cluttering registry, or a branch stuck mid-rebase.
Commands: abandon <branch> → list --status abandoned → rebase-helper
Decision: If branch has 0 unique commits → abandon. If \`.git/rebase-merge\` exists → use \`rebase-helper\` to diagnose. After resolution → register updated files.

### SCENARIO 15: Remote Sync & GitHub Integration
Situation: Local registry out of sync with remote. Need to see GitHub PR/CI state.
Commands: github-sync → sync-advisor → registry-sync --pull → registry-sync --push
Decision: Use \`github-sync\` for remote branch/PR overview. \`sync-advisor\` for recommendations. \`registry-sync\` to align local ↔ Supabase registry.

### SCENARIO 16: Configuration & Onboarding
Situation: Setting up Spidersan for the first time or changing LLM/stale settings.
IMPORTANT: ALWAYS start with \`welcome\` for first-time setup — never skip it and go straight to \`init\`. \`welcome\` provides the guided onboarding sequence that ensures correct configuration before initialization.
Commands: welcome → config list → config set llm.provider <provider> → config set stale.days <n>
Decision: Use \`welcome\` for guided setup. Use \`config\` for tweaks. Set \`llm.provider\` to lmstudio (local), ollama (local), or copilot (remote, opt-in).

### SCENARIO 17: Dependency Management
Situation: Multiple branches with merge-order dependencies that must be respected.
IMPORTANT: When dealing with a dependency chain across branches, ALWAYS use \`depends <branch>\` to declare dependencies first, then \`merge-order\` to determine the correct merge sequence. Missing \`depends\` leads to broken merge order.
Commands: depends <branch> --on <other> → depends --show → merge-order
Decision: Set dependencies before merging. If circular dependency detected → break the cycle by removing one dependency. \`merge-order\` respects the dependency graph.

### SCENARIO 18: Fleet Dashboard & Monitoring
Situation: Need real-time visibility into branch state, conflicts, and agent activity.
Commands: dashboard → doctor --remote → pulse → cross-conflicts
Decision: Use \`dashboard\` for TUI overview. Use \`doctor --remote\` for repo status. Use \`pulse\` and \`cross-conflicts\` for fleet-wide coordination.

### Decision Tree
Starting new work? → welcome → spidersan init → register + doctor
Found unknown/suspicious branch? → explain <branch> (NOT rescue, NOT queen, NOT hive)
About to merge? → conflicts → ready-check → depends --show → merge-order
Branches piling up? → stale → cleanup → sync
Parallelizing across agents? → queen spawn → queen status (NOT torrent decompose)
Multi-agent serial task? → torrent decompose → create → complete → tree
Blocked by another? → conflicts --wake → depends → merge-order
Cross-machine issues? → pulse → cross-conflicts → doctor --remote
Need a summary? → daily --branch <name> --tldr
Investigating recent activity? → log → log --since 7d → daily → daily --context
Want proactive advice? → advise (ALWAYS first for proactive recommendations)
Require AI insight? → ai-ping → context → ask/advise/explain
Dead branches? → abandon + list --status abandoned
Stuck rebase? → rebase-helper
Remote out of sync? → github-sync → sync-advisor → registry-sync
Setting up for first time? → welcome → config (ALWAYS welcome before init)
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
  llmOverrides?: Partial<LLMConfig>,
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

  // Estimate confidence from context quality
  const hasConflicts = request.context.conflicts.tier3 > 0 || request.context.conflicts.tier2 > 0;
  const hasRegistry = request.context.registry.active > 0;
  const confidence = hasRegistry
    ? (hasConflicts ? 'high' : 'medium')
    : 'low';

  // Numeric confidence score: try to extract from model response (P2A-1 structured output),
  // fall back to heuristic mapping.
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
