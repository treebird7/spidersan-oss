/**
 * AI Core Bridge — Dynamic import adapter for MCP server
 *
 * Imports the compiled AI core from the parent spidersan package at runtime.
 * This is a REPO-LOCAL integration — it relies on the parent dist/ being built.
 * For npm distribution, extract the AI core to a shared package instead.
 */

// ─── Narrow Interfaces (match the AI core's actual signatures) ────

export interface SpiderContext {
  timestamp: string;
  repo: string;
  branch: string;
  registry: { active: number; stale: number; branches: unknown[] };
  conflicts: { tier1: number; tier2: number; tier3: number; details: unknown[] };
  gitStatus: { ahead: number; behind: number; dirty: string[] };
  colony: { online: boolean; activeAgents: string[]; inProgress: unknown[] };
  activityLog?: unknown[];
  dailyCollab?: unknown[];
}

export interface ReasoningResult {
  advice: string;
  commands: string[];
  confidence: 'high' | 'medium' | 'low';
  mode: 'ask' | 'advise' | 'explain';
  provider: string;
  tokensUsed: number;
}

export interface PingResult {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
}

interface AICore {
  buildContext: (opts?: { repoRoot?: string; includeActivity?: boolean; verbose?: boolean }) => Promise<SpiderContext>;
  reason: (request: {
    mode: 'ask' | 'advise' | 'explain';
    question?: string;
    branch?: string;
    context: SpiderContext;
    verbose?: boolean;
  }, llmOverrides?: Record<string, unknown>) => Promise<ReasoningResult>;
  ping: (overrides?: Record<string, unknown>) => Promise<PingResult>;
}

// ─── Dynamic Import with Runtime Validation ─────────────────────

let _core: AICore | null = null;
let _loadError: string | null = null;

async function getCore(): Promise<AICore> {
  if (_core) return _core;
  if (_loadError) throw new Error(_loadError);

  try {
    const corePath = new URL('../../../dist/lib/ai/index.js', import.meta.url);
    const mod = await import(corePath.href);

    // Runtime shape check
    if (typeof mod.buildContext !== 'function') throw new Error('buildContext not found');
    if (typeof mod.reason !== 'function') throw new Error('reason not found');
    if (typeof mod.ping !== 'function') throw new Error('ping not found');

    _core = mod as AICore;
    return _core;
  } catch (err) {
    _loadError = `AI core unavailable: ${(err as Error).message}. Ensure parent package is built (cd .. && npx tsc).`;
    throw new Error(_loadError);
  }
}

// ─── Public API ─────────────────────────────────────────────────

export async function buildContext(repoRoot?: string): Promise<SpiderContext> {
  const core = await getCore();
  return core.buildContext({ repoRoot, includeActivity: true });
}

export async function ask(
  question: string,
  repoRoot?: string,
  provider?: string,
): Promise<ReasoningResult> {
  const core = await getCore();
  const ctx = await core.buildContext({ repoRoot, includeActivity: true });
  const overrides = provider ? { provider } : undefined;
  return core.reason({ mode: 'ask', question, context: ctx }, overrides);
}

export async function advise(
  repoRoot?: string,
  provider?: string,
): Promise<ReasoningResult> {
  const core = await getCore();
  const ctx = await core.buildContext({ repoRoot, includeActivity: true });
  const overrides = provider ? { provider } : undefined;
  return core.reason({ mode: 'advise', context: ctx }, overrides);
}

export async function explain(
  branch: string,
  repoRoot?: string,
  provider?: string,
): Promise<ReasoningResult> {
  const core = await getCore();
  const ctx = await core.buildContext({ repoRoot, includeActivity: true });
  const overrides = provider ? { provider } : undefined;
  return core.reason({ mode: 'explain', branch, context: ctx }, overrides);
}

export async function pingLLM(
  provider?: string,
): Promise<PingResult> {
  const core = await getCore();
  const overrides = provider ? { provider } : undefined;
  return core.ping(overrides);
}

export function isAvailable(): boolean {
  return _loadError === null;
}
