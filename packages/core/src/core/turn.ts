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
  GenerateContentResponseUsageMetadata,
  FinishReason,
  Part,
  FunctionDeclaration,
} from '@google/genai';
import type {
  ToolCallConfirmationDetails,
  ToolResult,
  ToolResultDisplay,
  ToolErrorType,
} from '@vybestack/llxprt-code-tools';
import type { ThoughtSummary } from '../utils/thoughtUtils.js';
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../utils/streamIdleTimeout.js';

export const DEFAULT_AGENT_ID = 'primary';

/** @deprecated Use DEFAULT_STREAM_IDLE_TIMEOUT_MS from streamIdleTimeout.js instead */
export const TURN_STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

// Define a structure for tools passed to the server
export interface ServerTool {
  name: string;
  schema: FunctionDeclaration;
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

export enum GeminiEventType {
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

export type ServerGeminiRetryEvent = {
  type: GeminiEventType.Retry;
};

export type ServerGeminiInvalidStreamEvent = {
  type: GeminiEventType.InvalidStream;
};

export type ServerGeminiContextWindowWillOverflowEvent = {
  type: GeminiEventType.ContextWindowWillOverflow;
  value: {
    estimatedRequestTokenCount: number;
    remainingTokenCount: number;
  };
};

export interface StructuredError {
  message: string;
  status?: number;
}

export interface GeminiErrorEventValue {
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
  responseParts: Part[];
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

export type ServerGeminiContentEvent = {
  type: GeminiEventType.Content;
  value: string;
  traceId?: string;
};

export type ServerGeminiSystemNoticeEvent = {
  type: GeminiEventType.SystemNotice;
  value: string;
};

export type ServerGeminiThoughtEvent = {
  type: GeminiEventType.Thought;
  value: ThoughtSummary;
  traceId?: string;
};

export type ServerGeminiToolCallRequestEvent = {
  type: GeminiEventType.ToolCallRequest;
  value: ToolCallRequestInfo;
};

export type ServerGeminiToolCallResponseEvent = {
  type: GeminiEventType.ToolCallResponse;
  value: ToolCallResponseInfo;
};

export type ServerGeminiToolCallConfirmationEvent = {
  type: GeminiEventType.ToolCallConfirmation;
  value: ServerToolCallConfirmationDetails;
};

export type ServerGeminiUserCancelledEvent = {
  type: GeminiEventType.UserCancelled;
};

export type ServerGeminiStreamIdleTimeoutEvent = {
  type: GeminiEventType.StreamIdleTimeout;
  value: GeminiErrorEventValue;
};

export type ServerGeminiErrorEvent = {
  type: GeminiEventType.Error;
  value: GeminiErrorEventValue;
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

export type ServerGeminiChatCompressedEvent = {
  type: GeminiEventType.ChatCompressed;
  value: ChatCompressionInfo | null;
};

export type ServerGeminiUsageMetadataEvent = {
  type: GeminiEventType.UsageMetadata;
  value: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
};

export type ServerGeminiMaxSessionTurnsEvent = {
  type: GeminiEventType.MaxSessionTurns;
};

export type ServerGeminiFinishedOutcome = {
  hadVisibleOutput: boolean;
  hadThinking: boolean;
  hadToolCalls: boolean;
};

export type ServerGeminiFinishedEvent = {
  type: GeminiEventType.Finished;
  value: {
    reason: FinishReason;
    usageMetadata?: GenerateContentResponseUsageMetadata;
    outcome?: ServerGeminiFinishedOutcome;
  };
};

export type ServerGeminiLoopDetectedEvent = {
  type: GeminiEventType.LoopDetected;
};

export type ServerGeminiCitationEvent = {
  type: GeminiEventType.Citation;
  value: string;
};

export interface ModelInfo {
  model: string;
}

export type ServerGeminiModelInfoEvent = {
  type: GeminiEventType.ModelInfo;
  value: ModelInfo;
};

export type ServerGeminiAgentExecutionStoppedEvent = {
  type: GeminiEventType.AgentExecutionStopped;
  reason: string;
  systemMessage?: string;
  contextCleared?: boolean;
};

export type ServerGeminiAgentExecutionBlockedEvent = {
  type: GeminiEventType.AgentExecutionBlocked;
  reason: string;
  systemMessage?: string;
  contextCleared?: boolean;
};

// The original union type, now composed of the individual types
export type ServerGeminiStreamEvent =
  | ServerGeminiContentEvent
  | ServerGeminiSystemNoticeEvent
  | ServerGeminiToolCallRequestEvent
  | ServerGeminiToolCallResponseEvent
  | ServerGeminiToolCallConfirmationEvent
  | ServerGeminiUserCancelledEvent
  | ServerGeminiStreamIdleTimeoutEvent
  | ServerGeminiErrorEvent
  | ServerGeminiChatCompressedEvent
  | ServerGeminiThoughtEvent
  | ServerGeminiUsageMetadataEvent
  | ServerGeminiMaxSessionTurnsEvent
  | ServerGeminiFinishedEvent
  | ServerGeminiLoopDetectedEvent
  | ServerGeminiCitationEvent
  | ServerGeminiRetryEvent
  | ServerGeminiInvalidStreamEvent
  | ServerGeminiAgentExecutionStoppedEvent
  | ServerGeminiAgentExecutionBlockedEvent
  | ServerGeminiContextWindowWillOverflowEvent
  | ServerGeminiModelInfoEvent;
