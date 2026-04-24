/**
 * Spidersan AI Core — Public API
 *
 * Shared library for CLI (ask/advise/explain), MCP tools, webhook, and agent mode.
 */

export { buildContext } from './context-builder.js';
export type { BuildContextOptions } from './context-builder.js';

export { chat, ping, resolveConfig } from './llm-client.js';

export { reason } from './reasoner.js';

export { handleEvent } from './event-handler.js';

export type {
  Advice,
  AIConfig,
  ActivityEntry,
  BranchSummary,
  ConflictSummary,
  DailyEntry,
  EventPayload,
  EventType,
  LLMConfig,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  ReasoningMode,
  ReasoningRequest,
  ReasoningResult,
  SpiderContext,
  WorkSignal,
} from './types.js';

export { DEFAULT_LLM_CONFIGS } from './types.js';
