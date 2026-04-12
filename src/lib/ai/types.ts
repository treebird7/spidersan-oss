/**
 * Spidersan AI Core — Type Definitions
 *
 * Shared types for context aggregation, LLM reasoning, and event handling.
 * Used by CLI (ask/advise/explain), MCP tools, webhook, and agent mode.
 */

// ─── Context Types ──────────────────────────────────────────

export interface BranchSummary {
  name: string;
  agent: string | null;
  files: string[];
  status: 'active' | 'merged' | 'abandoned' | 'completed';
  lastUpdated: string;
  commitsBehindMain: number;
}

export interface ConflictSummary {
  branch: string;
  otherBranch: string;
  tier: 1 | 2 | 3;
  files: string[];
  agent: string | null;
  otherAgent: string | null;
}

export interface WorkSignal {
  agent: string;
  task: string;
  status: string;
  lastHeartbeat: string;
}

export interface ActivityEntry {
  event: string;
  branch: string | null;
  agent: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface DailyEntry {
  agent: string;
  content: string;
  timestamp: string;
}

export interface SpiderContext {
  timestamp: string;
  repo: string;
  branch: string;
  registry: {
    active: number;
    stale: number;
    branches: BranchSummary[];
  };
  conflicts: {
    tier1: number;
    tier2: number;
    tier3: number;
    details: ConflictSummary[];
  };
  gitStatus: {
    ahead: number;
    behind: number;
    dirty: string[];
  };
  colony: {
    online: boolean;
    activeAgents: string[];
    inProgress: WorkSignal[];
  };
  activityLog?: ActivityEntry[];
  dailyCollab?: DailyEntry[];
}

// ─── LLM Types ──────────────────────────────────────────────

export type LLMProvider = 'lmstudio' | 'copilot' | 'ollama';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  baseUrl: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: LLMProvider;
  promptTokens: number;
  completionTokens: number;
}

// ─── Reasoning Types ────────────────────────────────────────

export type ReasoningMode = 'ask' | 'advise' | 'explain';

export interface ReasoningRequest {
  mode: ReasoningMode;
  question?: string;
  branch?: string;
  context: SpiderContext;
  verbose?: boolean;
}

export interface ReasoningResult {
  advice: string;
  commands: string[];
  confidence: 'high' | 'medium' | 'low';
  mode: ReasoningMode;
  provider: LLMProvider;
  tokensUsed: number;
}

// ─── Event Types ────────────────────────────────────────────

export type EventType = 'push' | 'pull_request' | 'colony_signal' | 'branch_register';

export interface EventPayload {
  type: EventType;
  repo: string;
  branch?: string;
  agent?: string;
  files?: string[];
  metadata?: Record<string, unknown>;
}

export interface Advice {
  tier: 0 | 1 | 2 | 3;
  action: 'info' | 'warn' | 'pause' | 'block';
  message: string;
  commands: string[];
  escalateToLLM: boolean;
}

// ─── Configuration ──────────────────────────────────────────

export interface AIConfig {
  llm: LLMConfig;
  enableColony: boolean;
  enableMemoak: boolean;
  enableDailyBridge: boolean;
  playbookPath?: string;
}

export const DEFAULT_LLM_CONFIGS: Record<LLMProvider, LLMConfig> = {
  lmstudio: {
    provider: 'lmstudio',
    model: 'gemma-4-26b-a4b-it',
    baseUrl: 'http://127.0.0.1:1234/v1',
    temperature: 0.4,
    maxTokens: 800,
  },
  copilot: {
    provider: 'copilot',
    model: 'gpt-4o',
    baseUrl: 'https://models.inference.ai.azure.com',
    temperature: 0.4,
    maxTokens: 800,
  },
  ollama: {
    provider: 'ollama',
    model: 'gemma3:4b',
    baseUrl: 'http://localhost:11434',
    temperature: 0.4,
    maxTokens: 800,
  },
};
