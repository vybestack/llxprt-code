/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GenerateContentResponse,
  FinishReason,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import {
  type Part,
  type PartListUnion,
  type FunctionCall,
  type FunctionDeclaration,
} from '@google/genai';
import {
  type ToolCallConfirmationDetails,
  type ToolResult,
  type ToolResultDisplay,
} from '../tools/tools.js';
import type { ToolErrorType } from '../tools/tool-error.js';
import {
  getResponseText,
  getFunctionCalls,
} from '../utils/generateContentResponseUtilities.js';
import { reportError } from '../utils/errorReporting.js';
import {
  getErrorMessage,
  UnauthorizedError,
  toFriendlyError,
} from '../utils/errors.js';
import { normalizeToolName } from '../tools/toolNameUtils.js';
import type { GeminiChat } from './geminiChat.js';
import {
  InvalidStreamError,
  StreamEventType,
  type StreamEvent,
} from './geminiChat.js';
import { DebugLogger } from '../debug/index.js';
import { getCodeAssistServer } from '../code_assist/codeAssist.js';
import { UserTierId } from '../code_assist/types.js';
import { parseThought, type ThoughtSummary } from '../utils/thoughtUtils.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from '../utils/streamIdleTimeout.js';

export const DEFAULT_AGENT_ID = 'primary';

/** @deprecated Use DEFAULT_STREAM_IDLE_TIMEOUT_MS from streamIdleTimeout.js instead */
export const TURN_STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

const TURN_STREAM_IDLE_TIMEOUT_ERROR_MESSAGE =
  'Stream idle timeout: no response received within the allowed time.';

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

export type ServerGeminiFinishedEvent = {
  type: GeminiEventType.Finished;
  value: {
    reason: FinishReason;
    usageMetadata?: GenerateContentResponseUsageMetadata;
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

// A turn manages the agentic loop turn within the server context.
export class Turn {
  readonly pendingToolCalls: ToolCallRequestInfo[];
  private debugResponses: GenerateContentResponse[];
  finishReason: FinishReason | undefined;
  private logger: DebugLogger;

  constructor(
    private readonly chat: GeminiChat,
    private readonly prompt_id: string,
    private readonly agentId: string = DEFAULT_AGENT_ID,
    private readonly providerName: string = 'backend',
  ) {
    this.pendingToolCalls = [];
    this.debugResponses = [];
    this.finishReason = undefined;
    this.logger = new DebugLogger('llxprt:core:turn');
  }

  /**
   * Check if citations should be shown for the current user/settings.
   * Based on the upstream implementation from commit 997136ae.
   */
  private shouldShowCitations(): boolean {
    try {
      const config = this.chat.getConfig() as
        | {
            getSettingsService(): { get(key: string): unknown } | undefined;
          }
        | undefined;

      const settingsService = config?.getSettingsService();
      if (settingsService) {
        const enabled = settingsService.get('ui.showCitations');
        if (enabled !== undefined) {
          return enabled as boolean;
        }
      }

      // Fallback: check user tier for code assist server
      const server = getCodeAssistServer(config as never);
      return (server && server.userTier !== UserTierId.FREE) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Emits a citation event with the given text.
   * This integrates with llxprt's provider abstraction to work across all providers.
   */
  private emitCitation(text: string): ServerGeminiCitationEvent | null {
    if (!this.shouldShowCitations()) {
      return null;
    }

    return {
      type: GeminiEventType.Citation,
      value: text,
    };
  }
  // The run method yields simpler events suitable for server logic
  async *run(
    req: PartListUnion,
    signal: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    let idleTimedOut = false;

    this.logger.debug('Turn.run called', {
      req: JSON.stringify(req, null, 2),
      typeofReq: typeof req,
      isArray: Array.isArray(req),
    });

    try {
      if (signal.aborted) {
        yield { type: GeminiEventType.UserCancelled };
        return;
      }

      // Note: This assumes `sendMessageStream` yields events like
      // { type: StreamEventType.RETRY } or { type: StreamEventType.CHUNK, value: GenerateContentResponse }
      const timeoutController = new AbortController();
      const timeoutSignal = timeoutController.signal;
      const onParentAbort = () => timeoutController.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });

      let streamIterator: AsyncIterator<StreamEvent> | undefined;

      // Resolve the effective idle timeout, considering config and env var
      const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(
        this.chat.getConfig(),
      );

      try {
        const responseStream = await this.chat.sendMessageStream(
          {
            message: req,
            config: {
              abortSignal: timeoutSignal,
            },
          },
          this.prompt_id,
        );
        streamIterator = responseStream[Symbol.asyncIterator]();

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Turn events cross provider/runtime boundaries despite declared types.
        while (true) {
          // Use watchdog if timeout > 0, otherwise call iterator.next() directly
          let result: IteratorResult<StreamEvent>;
          if (effectiveTimeoutMs > 0) {
            result = await nextStreamEventWithIdleTimeout({
              iterator: streamIterator,
              timeoutMs: effectiveTimeoutMs,
              signal: timeoutSignal,
              onTimeout: () => {
                if (signal.aborted) {
                  return;
                }
                idleTimedOut = true;
                timeoutController.abort();
              },
              createTimeoutError: () =>
                new Error(TURN_STREAM_IDLE_TIMEOUT_ERROR_MESSAGE),
            });
          } else {
            // Watchdog disabled: call iterator.next() directly
            result = await streamIterator.next();
          }
          if (result.done === true) {
            break;
          }

          const streamEvent = result.value;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Turn events cross provider/runtime boundaries despite declared types.
          if (signal?.aborted) {
            yield { type: GeminiEventType.UserCancelled };
            return;
          }

          // Handle the RETRY event
          if (streamEvent.type === StreamEventType.RETRY) {
            yield { type: GeminiEventType.Retry };
            continue;
          }

          // Handle AGENT_EXECUTION_STOPPED event
          if (streamEvent.type === StreamEventType.AGENT_EXECUTION_STOPPED) {
            yield {
              type: GeminiEventType.AgentExecutionStopped,
              reason: streamEvent.reason,
              systemMessage: streamEvent.systemMessage,
              contextCleared: streamEvent.contextCleared,
            };
            return;
          }

          // Handle AGENT_EXECUTION_BLOCKED event
          if (streamEvent.type === StreamEventType.AGENT_EXECUTION_BLOCKED) {
            yield {
              type: GeminiEventType.AgentExecutionBlocked,
              reason: streamEvent.reason,
              systemMessage: streamEvent.systemMessage,
              contextCleared: streamEvent.contextCleared,
            };
            continue;
          }

          // Narrow to CHUNK — the only other variant in the discriminated union
          const resp = streamEvent.value;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Turn events cross provider/runtime boundaries despite declared types.
          if (resp === null || resp === undefined) continue; // Skip if there's no response body

          this.debugResponses.push(resp);

          const traceId = resp.responseId;

          // Check ALL parts for thinking, not just parts[0]
          // Bug fix: Previously only checked parts[0], missing thoughts in other positions
          // @plan PLAN-20251202-THINKING.P16
          const allParts = resp.candidates?.[0]?.content?.parts ?? [];
          for (const part of allParts) {
            if ((part as unknown as { thought?: boolean }).thought === true) {
              const thought = parseThought(
                (part as unknown as { text?: string }).text ?? '',
              );
              yield {
                type: GeminiEventType.Thought,
                value: thought,
                traceId,
              };
            }
          }

          const text = getResponseText(resp);
          if (text) {
            yield { type: GeminiEventType.Content, value: text, traceId };

            // Emit citation event if conditions are met
            // Based on upstream implementation - emit citation after content
            const citationEvent = this.emitCitation(
              'Response may contain information from external sources. Please verify important details independently.',
            );
            if (citationEvent) {
              yield citationEvent;
            }
          }

          // Handle function calls (requesting tool execution)
          const functionCalls = getFunctionCalls(resp) ?? [];
          for (const fnCall of functionCalls) {
            const event = this.handlePendingFunctionCall(fnCall);
            if (event) {
              yield event;
            }
          }

          // Check if response was truncated or stopped for various reasons
          const finishReason = resp.candidates?.[0]?.finishReason;

          // This is the key change: Only yield 'Finished' if there is a finishReason.
          if (finishReason != null) {
            this.logger.debug(() => `[stream:turn] emitting Finished event`, {
              finishReason,
              traceId,
              partCount: allParts.length,
              toolCallCount: functionCalls.length,
              textLength: text?.length ?? 0,
              hasUsageMetadata: Boolean(resp.usageMetadata),
            });
            this.finishReason = finishReason;
            yield {
              type: GeminiEventType.Finished,
              value: {
                reason: finishReason,
                usageMetadata: resp.usageMetadata,
              },
            };
          } else {
            this.logger.debug(() => `[stream:turn] chunk had no finishReason`, {
              traceId,
              partCount: allParts.length,
              toolCallCount: functionCalls.length,
              textLength: text?.length ?? 0,
              hasUsageMetadata: Boolean(resp.usageMetadata),
            });
          }
        }
      } finally {
        // Don't await the return() call to avoid hanging on stuck generators.
        // The generator will eventually be garbage collected.
        streamIterator?.return?.().catch(() => {
          // cleanup errors are non-fatal
        });
        timeoutController.abort();
        signal.removeEventListener('abort', onParentAbort);
      }
    } catch (e) {
      if (signal.aborted) {
        yield { type: GeminiEventType.UserCancelled };
        // Regular cancellation error, fail gracefully.
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Turn events cross provider/runtime boundaries despite declared types.
      if (idleTimedOut) {
        yield {
          type: GeminiEventType.StreamIdleTimeout,
          value: {
            error: {
              message: TURN_STREAM_IDLE_TIMEOUT_ERROR_MESSAGE,
              status: undefined,
            },
          },
        };
        return;
      }

      if (e instanceof InvalidStreamError) {
        yield { type: GeminiEventType.InvalidStream };
        return;
      }

      const error = toFriendlyError(e);
      if (error instanceof UnauthorizedError) {
        throw error;
      }

      const contextForReport = [...this.chat.getHistory(/*curated*/ true), req];
      await reportError(
        error,
        `Error when talking to ${this.providerName} API`,
        contextForReport,
        'Turn.run-sendMessageStream',
      );
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof (error as { status: unknown }).status === 'number'
          ? (error as { status: number }).status
          : undefined;
      const structuredError: StructuredError = {
        message: getErrorMessage(error),
        status,
      };
      yield { type: GeminiEventType.Error, value: { error: structuredError } };
      return;
    }
  }

  private handlePendingFunctionCall(
    fnCall: FunctionCall,
  ): ServerGeminiStreamEvent | null {
    const callId =
      fnCall.id ??
      `${fnCall.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // REAL FIX: Turn.ts also gets fragmented data - handle properly
    let name = fnCall.name;
    if (!name || name.trim() === '') {
      // Turn may get incomplete data from fragmented FunctionCalls
      // Keep undefined_tool_name for proper error detection
      name = 'undefined_tool_name';
    } else {
      // Apply shared normalization for defined names
      const normalized = normalizeToolName(name);
      if (normalized) {
        name = normalized;
      } else {
        name = 'undefined_tool_name';
      }
    }

    const args = fnCall.args ?? {};

    const toolCallRequest: ToolCallRequestInfo = {
      callId,
      name: name || 'undefined_tool_name',
      args,
      isClientInitiated: false,
      prompt_id: this.prompt_id,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Turn events cross provider/runtime boundaries despite declared types.
      agentId: this.agentId ?? DEFAULT_AGENT_ID,
    };

    this.pendingToolCalls.push(toolCallRequest);

    // Yield a request for the tool call, not the pending/confirming status
    return { type: GeminiEventType.ToolCallRequest, value: toolCallRequest };
  }

  getDebugResponses(): GenerateContentResponse[] {
    return this.debugResponses;
  }
}
