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

// ─── Embedded Scenario Playbook ─────────────────────────────
// Extracted from Spider's Maze — covers all spidersan commands and decision patterns.

const SCENARIO_PLAYBOOK = `## Spidersan Command Reference & Scenarios

### SCENARIO 1: New Repo Setup
Situation: Starting work in a new or uninitialized repository.
Commands: spidersan init → register --files "f1,f2" --agent <id> → doctor → list

### SCENARIO 2: Ghost/Abandoned Branches
Situation: Unregistered branches drifting — some with salvageable code, others dead.
Commands: rescue --scan → rescue --symbols <branch> → sync
Decision: If rescue --symbols shows useful code → cherry-pick. If empty/WIP → abandon.

### SCENARIO 3: File Conflicts (Tier System)
- TIER 3 (BLOCK): Critical file (auth, secrets, env) — stop, coordinate immediately
- TIER 2 (PAUSE): Important file (package.json, config, server) — coordinate before merging
- TIER 1 (WARN): Adjacent/related files — be aware
Commands: conflicts → conflicts --tier 3 → conflicts --strict → conflicts --json → conflicts --wake

### SCENARIO 4: WIP / Not-Ready Code
Situation: Branch has TODO, FIXME, HACK, WIP, SPIDER_TRAP, UNFINISHED markers.
Commands: ready-check → ready-check --json
Rule: Never merge a branch that fails ready-check.

### SCENARIO 5: Real-Time Monitoring
Commands: watch --agent <id> → auto start/stop/status
Warning: Watch CPU loop if ghost branches claim same files. Fix: sync first.

### SCENARIO 6: Task Decomposition (Torrent)
Commands: torrent decompose <TASK> -c N → torrent create <CHILD> -a <agent> → torrent complete <CHILD> → torrent tree → torrent merge-order

### SCENARIO 7: Tangled Dependencies
Commands: merge-order → merge-order --json → merge-order --blocking-count → depends <branch> → conflicts --wake
Pattern: Merge foundation first → resolve blocker → re-check → merge dependents.

### SCENARIO 8: Stale Branch Cleanup
Commands: stale → cleanup → abandon <branch> → merged <branch> → sync
Triage: sync → stale → cleanup → verify with list.

### SCENARIO 9: Queen Dispatch
Commands: queen spawn --task "desc" → queen status → queen dissolve <id>

### SCENARIO 10: Colony Lifecycle
Commands: colony enlist → signal --status in-progress → heartbeat → status → probe → accept → close → broadcast → broadcast-ack → broadcast-status → cns → gc

### SCENARIO 11: Cross-Machine Conflicts
Commands: pulse → cross-conflicts → cross-conflicts --local → doctor --remote

### SCENARIO 12: Activity & Context
Commands: log → log --since 7d → log --branch <name> → daily → daily --branch <name> --tldr → daily --context --branch <name>

### Decision Tree
Starting new work? → init + register + doctor
Found unknown branches? → rescue --scan → rescue --symbols → sync
About to merge? → conflicts → ready-check → merge-order
Branches piling up? → stale → cleanup → sync
Multi-agent task? → torrent decompose → create → complete → tree
Blocked by another? → conflicts --wake → depends → merge-order
Cross-machine? → pulse → cross-conflicts → doctor --remote
"What happened?" → daily --branch <name> --tldr`;

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

  // Estimate confidence from context quality
  const hasConflicts = request.context.conflicts.tier3 > 0 || request.context.conflicts.tier2 > 0;
  const hasRegistry = request.context.registry.active > 0;
  const confidence = hasRegistry
    ? (hasConflicts ? 'high' : 'medium')
    : 'low';

  return {
    advice: response.content,
    commands,
    confidence: confidence as 'high' | 'medium' | 'low',
    mode: request.mode,
    provider: response.provider,
    tokensUsed: response.promptTokens + response.completionTokens,
  };
}
