/**
 * @plan:PLAN-20260617-COREAPI.P04
 * @requirement:REQ-003
 */

import type { ThoughtSummary } from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
import type {
  ModelInfo,
  ChatCompressionInfo,
  StructuredError,
} from '@vybestack/llxprt-code-core/core/turn.js';

export type { ThoughtSummary } from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
export type {
  ModelInfo,
  ChatCompressionInfo,
  StructuredError,
} from '@vybestack/llxprt-code-core/core/turn.js';

export type DoneReason =
  | 'stop'
  | 'aborted'
  | 'max-turns'
  | 'context-overflow'
  | 'loop-detected'
  | 'error'
  | 'hook-stopped';

export type UsageMetadataValue = Readonly<{
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}>;

export type FinishedValue = Readonly<{
  reason: string;
  usageMetadata?: UsageMetadataValue;
}>;

export type AgentStopInfo = Readonly<{
  reason: string;
  systemMessage?: string;
  contextCleared?: boolean;
}>;

export type AgentToolCall = Readonly<{
  id: string;
  name: string;
  args: Readonly<Record<string, unknown>>;
}>;

export type AgentToolResult = Readonly<{
  id: string;
  name: string;
  output?: unknown;
  isError?: boolean;
  display?: unknown;
  suppressDisplay?: boolean;
  errorType?: string;
}>;

export type ToolConfirmation = Readonly<{
  confirmationId: string;
  toolCallId: string;
  name: string;
  details: unknown;
}>;

export type ToolUpdateStatus =
  | 'validating'
  | 'scheduled'
  | 'awaiting-approval'
  | 'executing'
  | 'success'
  | 'error'
  | 'cancelled';

export type ToolUpdate = Readonly<{
  id: string;
  name: string;
  status: ToolUpdateStatus;
  output?: unknown;
  agentId?: string;
}>;

export type AgentTextEvent = Readonly<{
  type: 'text';
  text: string;
}>;

export type AgentThinkingEvent = Readonly<{
  type: 'thinking';
  thought: ThoughtSummary;
}>;

export type AgentToolCallEvent = Readonly<{
  type: 'tool-call';
  call: AgentToolCall;
}>;

export type AgentToolResultEvent = Readonly<{
  type: 'tool-result';
  result: AgentToolResult;
}>;

export type AgentToolConfirmationEvent = Readonly<{
  type: 'tool-confirmation';
  confirmation: ToolConfirmation;
}>;

export type AgentToolStatusEvent = Readonly<{
  type: 'tool-status';
  update: ToolUpdate;
}>;

export type AgentUsageEvent = Readonly<{
  type: 'usage';
  usage: UsageMetadataValue;
}>;

export type AgentModelInfoEvent = Readonly<{
  type: 'model-info';
  info: ModelInfo;
}>;

export type AgentNoticeEvent = Readonly<{
  type: 'notice';
  message: string;
}>;

export type AgentCompressionEvent = Readonly<{
  type: 'compression';
  info: ChatCompressionInfo | null;
}>;

export type AgentContextWarningEvent = Readonly<{
  type: 'context-warning';
  estimatedRequestTokenCount: number;
  remainingTokenCount: number;
}>;

export type AgentRetryEvent = Readonly<{
  type: 'retry';
}>;

export type AgentCitationEvent = Readonly<{
  type: 'citation';
  citation: string;
}>;

export type AgentLoopDetectedEvent = Readonly<{
  type: 'loop-detected';
}>;

export type AgentIdleTimeoutEvent = Readonly<{
  type: 'idle-timeout';
  error: StructuredError;
}>;

export type AgentInvalidStreamEvent = Readonly<{
  type: 'invalid-stream';
}>;

export type AgentHookBlockedEvent = Readonly<{
  type: 'hook-blocked';
  info: AgentStopInfo;
}>;

export type AgentErrorEvent = Readonly<{
  type: 'error';
  error: StructuredError;
}>;

export type AgentDoneEvent = Readonly<{
  type: 'done';
  reason: DoneReason;
  finished?: FinishedValue;
  stop?: AgentStopInfo;
}>;

export type AgentEvent =
  | AgentTextEvent
  | AgentThinkingEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentToolConfirmationEvent
  | AgentToolStatusEvent
  | AgentUsageEvent
  | AgentModelInfoEvent
  | AgentNoticeEvent
  | AgentCompressionEvent
  | AgentContextWarningEvent
  | AgentRetryEvent
  | AgentCitationEvent
  | AgentLoopDetectedEvent
  | AgentIdleTimeoutEvent
  | AgentInvalidStreamEvent
  | AgentHookBlockedEvent
  | AgentErrorEvent
  | AgentDoneEvent;
