/**
 * Spidersan AI Core — Event Handler
 *
 * Processes git/colony events → deterministic conflict check → optional LLM escalation.
 * Pure functions — no CLI or server concerns.
 */

import { reason } from './reasoner.js';
import { buildContext } from './context-builder.js';
import { classifyTier } from '../conflict-tier.js';
import type { Advice, EventPayload, SpiderContext } from './types.js';

// ─── Deterministic Conflict Check ───────────────────────────

function checkDeterministicConflicts(
  event: EventPayload,
  context: SpiderContext,
): Advice | null {
  if (!event.files || event.files.length === 0) return null;

  // Find overlapping files with registered branches
  const overlaps: Array<{ branch: string; file: string; tier: 1 | 2 | 3 }> = [];

  // Pre-compute event files as Set for O(1) lookups
  const eventFilesSet = new Set(event.files);

  for (const branch of context.registry.branches) {
    if (branch.name === event.branch) continue;
    if (branch.status !== 'active') continue;

    for (const file of branch.files) {
      if (eventFilesSet.has(file)) {
        overlaps.push({ branch: branch.name, file, tier: classifyTier(file) });
      }
    }
  }

  if (overlaps.length === 0) return null;

  const maxTier = Math.max(...overlaps.map(o => o.tier)) as 1 | 2 | 3;

  const tierActions: Record<number, { action: Advice['action']; label: string }> = {
    3: { action: 'block', label: 'BLOCK' },
    2: { action: 'pause', label: 'PAUSE' },
    1: { action: 'warn', label: 'WARN' },
  };

  const { action, label } = tierActions[maxTier];
  const affectedBranches = [...new Set(overlaps.map(o => o.branch))];
  const affectedFiles = [...new Set(overlaps.map(o => o.file))];

  const commands: string[] = ['spidersan conflicts --json'];
  if (maxTier >= 2) commands.push('spidersan conflicts --wake');
  if (maxTier >= 3) commands.push('spidersan conflicts --strict');

  return {
    tier: maxTier,
    action,
    message: `🕷️ TIER ${maxTier} ${label}: ${event.branch ?? 'unknown'} overlaps with ${affectedBranches.join(', ')} on ${affectedFiles.join(', ')}`,
    commands,
    escalateToLLM: maxTier >= 2,
  };
}

// ─── Main Event Handler ────────────────────────────────────

/**
 * Handle an event (push, PR, colony signal, branch register).
 * First runs deterministic conflict check (fast, no LLM).
 * Only escalates to LLM for TIER 2+ or complex scenarios.
 *
 * @param opts.repoRoot - Local repo path for context building. Defaults to process.cwd().
 * @param opts.localOnly - If true, LLM escalation uses local providers only (never hosted/copilot).
 *                         Use this for daemon/webhook paths to avoid consuming remote API credits.
 */
export async function handleEvent(event: EventPayload, opts: { repoRoot?: string; localOnly?: boolean } = {}): Promise<Advice> {
  const context = await buildContext({ includeActivity: true, repoRoot: opts.repoRoot });

  // Fast path: deterministic conflict check
  const deterministicAdvice = checkDeterministicConflicts(event, context);

  if (deterministicAdvice && !deterministicAdvice.escalateToLLM) {
    return deterministicAdvice;
  }

  // Slow path: LLM reasoning for TIER 2+ or ambiguous situations
  if (deterministicAdvice?.escalateToLLM) {
    try {
      const result = await reason(
        {
          mode: 'ask',
          question: `Event: ${event.type} on branch ${event.branch ?? 'unknown'} touching files [${(event.files ?? []).join(', ')}]. ${deterministicAdvice.message}. What should the agents do?`,
          context,
        },
        { allowRemoteFallback: opts.localOnly ? false : undefined },
      );
      return {
        ...deterministicAdvice,
        message: result.advice,
        commands: result.commands.length > 0 ? result.commands : deterministicAdvice.commands,
      };
    } catch {
      // LLM failed — return deterministic advice as fallback
      return deterministicAdvice;
    }
  }

  // No conflicts detected
  return {
    tier: 0,
    action: 'info',
    message: `✅ ${event.type} on ${event.branch ?? 'unknown'}: no conflicts detected.`,
    commands: [],
    escalateToLLM: false,
  };
}
