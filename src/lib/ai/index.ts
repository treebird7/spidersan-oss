/**
 * Spidersan AI Core — Public API
 *
 * Shared library for the CLI (ask/advise/explain) and the MCP tools.
 */

export { buildContext } from './context-builder.js';
export type { BuildContextOptions } from './context-builder.js';

export { chat, ping, resolveConfig } from './llm-client.js';

export { reason } from './reasoner.js';

export type {
  AIConfig,
  ActivityEntry,
  BranchSummary,
  ConflictSummary,
  DailyEntry,
  LLMConfig,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  ReasoningMode,
  ReasoningRequest,
  ReasoningResult,
  SpiderContext,
} from './types.js';

export { DEFAULT_LLM_CONFIGS } from './types.js';
