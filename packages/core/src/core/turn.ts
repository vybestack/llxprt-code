/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turn types and protocol definitions.
 * The concrete Turn class has been moved to the agents package.
 * @plan PLAN-20260610-ISSUE1592.P03
 */

import type {
  ToolCallConfirmationDetails,
  ToolResult,
  ToolResultDisplay,
  ToolErrorType,
} from '@vybestack/llxprt-code-tools';
import type { ThoughtSummary } from '../utils/thoughtUtils.js';
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../utils/streamIdleTimeout.js';
import type { ToolDeclaration } from '../llm-types/index.js';
import type { CanonicalFinishReason } from '../llm-types/index.js';
import type { ContentBlock, UsageStats } from '../services/history/IContent.js';

export const DEFAULT_AGENT_ID = 'primary';

/** @deprecated Use DEFAULT_STREAM_IDLE_TIMEOUT_MS from streamIdleTimeout.js instead */
export const TURN_STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

// Define a structure for tools passed to the server
export interface ServerTool {
  name: string;
  schema: ToolDeclaration;
  // The execute method signature might differ slightly or be wrapped
  execute(
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult>;
  shouldConfirmExecute(
    params: Record<string, unknown>,
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false>;
}

export enum AgentEventType {
  Content = 'content',
  ToolCallRequest = 'tool_call_request',
  ToolCallResponse = 'tool_call_response',
  ToolCallConfirmation = 'tool_call_confirmation',
  UserCancelled = 'user_cancelled',
  StreamIdleTimeout = 'stream_idle_timeout',
  Error = 'error',
  ChatCompressed = 'chat_compressed',
  Thought = 'thought',
  UsageMetadata = 'usage_metadata',
  MaxSessionTurns = 'max_session_turns',
  Finished = 'finished',
  LoopDetected = 'loop_detected',
  Citation = 'citation',
  Retry = 'retry',
  SystemNotice = 'system_notice',
  InvalidStream = 'invalid_stream',
  ContextWindowWillOverflow = 'context_window_will_overflow',
  ModelInfo = 'model_info',
  AgentExecutionStopped = 'agent_execution_stopped',
  AgentExecutionBlocked = 'agent_execution_blocked',
}

export type ServerRetryEvent = {
  type: AgentEventType.Retry;
};

export type ServerInvalidStreamEvent = {
  type: AgentEventType.InvalidStream;
};

export type ServerContextWindowWillOverflowEvent = {
  type: AgentEventType.ContextWindowWillOverflow;
  value: {
    estimatedRequestTokenCount: number;
    remainingTokenCount: number;
  };
};

export const STRUCTURED_ERROR_CATEGORIES = [
  'rate_limit',
  'quota',
  'authentication',
  'server_error',
  'network',
  'client_error',
] as const;

export type StructuredErrorCategory =
  (typeof STRUCTURED_ERROR_CATEGORIES)[number];

export const STRUCTURED_ERROR_REASONS = [
  'retries_exhausted',
  'all_buckets_exhausted',
] as const;

export type StructuredErrorReason = (typeof STRUCTURED_ERROR_REASONS)[number];

export interface StructuredError {
  message: string;
  status?: number;
  category?: StructuredErrorCategory;
  reason?: StructuredErrorReason;
}

export interface AgentErrorEventValue {
  error: StructuredError;
}

export interface ToolCallRequestInfo {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  isClientInitiated: boolean;
  prompt_id: string;
  agentId?: string;
  checkpoint?: string;
  hookRestrictedAllowedTools?: string[];
}

export interface ToolCallResponseInfo {
  callId: string;
  responseParts: ContentBlock[];
  resultDisplay: ToolResultDisplay | undefined;
  error: Error | undefined;
  errorType: ToolErrorType | undefined;
  agentId?: string;
  outputFile?: string;
  /**
   * Optional flag to suppress display of this tool result
   * @requirement:HOOK-132 - AfterTool suppressOutput support
   */
  suppressDisplay?: boolean;
}

export interface ServerToolCallConfirmationDetails {
  request: ToolCallRequestInfo;
  details: ToolCallConfirmationDetails;
}

export type ServerContentEvent = {
  type: AgentEventType.Content;
  value: string;
  traceId?: string;
};

export type ServerSystemNoticeEvent = {
  type: AgentEventType.SystemNotice;
  value: string;
};

export type ServerThoughtEvent = {
  type: AgentEventType.Thought;
  value: ThoughtSummary;
  traceId?: string;
};

export type ServerToolCallRequestEvent = {
  type: AgentEventType.ToolCallRequest;
  value: ToolCallRequestInfo;
};

export type ServerToolCallResponseEvent = {
  type: AgentEventType.ToolCallResponse;
  value: ToolCallResponseInfo;
};

export type ServerToolCallConfirmationEvent = {
  type: AgentEventType.ToolCallConfirmation;
  value: ServerToolCallConfirmationDetails;
};

export type ServerUserCancelledEvent = {
  type: AgentEventType.UserCancelled;
};

export type ServerStreamIdleTimeoutEvent = {
  type: AgentEventType.StreamIdleTimeout;
  value: AgentErrorEventValue;
};

export type ServerErrorEvent = {
  type: AgentEventType.Error;
  value: AgentErrorEventValue;
};

export enum CompressionStatus {
  /** The compression was successful */
  COMPRESSED = 1,

  /** The compression failed due to the compression inflating the token count */
  COMPRESSION_FAILED_INFLATED_TOKEN_COUNT = 2,

  /** The compression failed due to an error counting tokens */
  COMPRESSION_FAILED_TOKEN_COUNT_ERROR = 3,

  /** The compression failed because the model returned an empty summary */
  COMPRESSION_FAILED_EMPTY_SUMMARY,

  /** The compression was not necessary and no action was taken */
  NOOP = 4,

  /** Compression ran recently and did not reduce tokens further */
  ALREADY_COMPRESSED = 5,

  /** Compression was attempted but all strategies failed */
  COMPRESSION_FAILED = 6,
}

/**
 * Explicit result from CompressionHandler.performCompression().
 * Allows callers to distinguish why compression did (or didn't) modify history,
 * without relying on side-channel token count inference.
 */
export enum PerformCompressionResult {
  /** History was successfully compressed */
  COMPRESSED = 'compressed',
  /** Compression skipped because history is empty */
  SKIPPED_EMPTY = 'skipped_empty',
  /** Compression skipped due to cooldown after repeated failures */
  SKIPPED_COOLDOWN = 'skipped_cooldown',
  /** Compression was attempted but all strategies failed */
  FAILED = 'failed',
}

export interface ChatCompressionInfo {
  originalTokenCount: number;
  newTokenCount: number;
  compressionStatus: CompressionStatus;
}

export type ServerChatCompressedEvent = {
  type: AgentEventType.ChatCompressed;
  value: ChatCompressionInfo | null;
};

export type ServerUsageMetadataEvent = {
  type: AgentEventType.UsageMetadata;
  value: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

export type ServerMaxSessionTurnsEvent = {
  type: AgentEventType.MaxSessionTurns;
};

export type ServerFinishedOutcome = {
  hadVisibleOutput: boolean;
  hadThinking: boolean;
  hadToolCalls: boolean;
};

export type ServerFinishedEvent = {
  type: AgentEventType.Finished;
  value: {
    reason: CanonicalFinishReason;
    usageMetadata?: UsageStats;
    outcome?: ServerFinishedOutcome;
    // @issue:2329 — the raw provider stop reason (e.g. 'refusal', 'end_turn')
    // threaded from the repo-owned candidate providerStopReason carrier, so
    // consumers can surface a refusal-specific notice distinct from a normal
    // completion.
    stopReason?: string;
  };
};

export type ServerLoopDetectedEvent = {
  type: AgentEventType.LoopDetected;
};

export type ServerCitationEvent = {
  type: AgentEventType.Citation;
  value: string;
};

export interface ModelInfo {
  model: string;
  providerName?: string;
  profileName?: string | null;
  displayLabel?: string;
}

export type ServerModelInfoEvent = {
  type: AgentEventType.ModelInfo;
  value: ModelInfo;
};

export type ServerAgentExecutionStoppedEvent = {
  type: AgentEventType.AgentExecutionStopped;
  reason: string;
  systemMessage?: string;
  contextCleared?: boolean;
};

export type ServerAgentExecutionBlockedEvent = {
  type: AgentEventType.AgentExecutionBlocked;
  reason: string;
  systemMessage?: string;
  contextCleared?: boolean;
};

// The original union type, now composed of the individual types
export type ServerAgentStreamEvent =
  | ServerContentEvent
  | ServerSystemNoticeEvent
  | ServerToolCallRequestEvent
  | ServerToolCallResponseEvent
  | ServerToolCallConfirmationEvent
  | ServerUserCancelledEvent
  | ServerStreamIdleTimeoutEvent
  | ServerErrorEvent
  | ServerChatCompressedEvent
  | ServerThoughtEvent
  | ServerUsageMetadataEvent
  | ServerMaxSessionTurnsEvent
  | ServerFinishedEvent
  | ServerLoopDetectedEvent
  | ServerCitationEvent
  | ServerRetryEvent
  | ServerInvalidStreamEvent
  | ServerAgentExecutionStoppedEvent
  | ServerAgentExecutionBlockedEvent
  | ServerContextWindowWillOverflowEvent
  | ServerModelInfoEvent;
