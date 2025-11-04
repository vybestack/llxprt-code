/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Part,
  PartListUnion,
  GenerateContentResponse,
  FunctionCall,
  FunctionDeclaration,
  FinishReason,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import {
  ToolCallConfirmationDetails,
  ToolResult,
  ToolResultDisplay,
} from '../tools/tools.js';
import { ToolErrorType } from '../tools/tool-error.js';
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
import { GeminiChat, InvalidStreamError } from './geminiChat.js';
import { DebugLogger } from '../debug/index.js';
import { getCodeAssistServer } from '../code_assist/codeAssist.js';
import { UserTierId } from '../code_assist/types.js';

export const DEFAULT_AGENT_ID = 'primary';

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
}

export type ServerGeminiRetryEvent = {
  type: GeminiEventType.Retry;
};

export type ServerGeminiInvalidStreamEvent = {
  type: GeminiEventType.InvalidStream;
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
}

export interface ToolCallResponseInfo {
  callId: string;
  responseParts: Part[];
  resultDisplay: ToolResultDisplay | undefined;
  error: Error | undefined;
  errorType: ToolErrorType | undefined;
  agentId?: string;
}

export interface ServerToolCallConfirmationDetails {
  request: ToolCallRequestInfo;
  details: ToolCallConfirmationDetails;
}

export type ThoughtSummary = {
  subject: string;
  description: string;
};

export type ServerGeminiContentEvent = {
  type: GeminiEventType.Content;
  value: string;
};

export type ServerGeminiSystemNoticeEvent = {
  type: GeminiEventType.SystemNotice;
  value: string;
};

export type ServerGeminiThoughtEvent = {
  type: GeminiEventType.Thought;
  value: ThoughtSummary;
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

export type ServerGeminiErrorEvent = {
  type: GeminiEventType.Error;
  value: GeminiErrorEventValue;
};

export enum CompressionStatus {
  /** The compression was successful */
  COMPRESSED = 1,

  /** The compression failed due to the compression inflating the token count */
  COMPRESSION_FAILED_INFLATED_TOKEN_COUNT,

  /** The compression failed due to an error counting tokens */
  COMPRESSION_FAILED_TOKEN_COUNT_ERROR,

  /** The compression was not necessary and no action was taken */
  NOOP,
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

// The original union type, now composed of the individual types
export type ServerGeminiStreamEvent =
  | ServerGeminiContentEvent
  | ServerGeminiSystemNoticeEvent
  | ServerGeminiToolCallRequestEvent
  | ServerGeminiToolCallResponseEvent
  | ServerGeminiToolCallConfirmationEvent
  | ServerGeminiUserCancelledEvent
  | ServerGeminiErrorEvent
  | ServerGeminiChatCompressedEvent
  | ServerGeminiThoughtEvent
  | ServerGeminiUsageMetadataEvent
  | ServerGeminiMaxSessionTurnsEvent
  | ServerGeminiFinishedEvent
  | ServerGeminiLoopDetectedEvent
  | ServerGeminiCitationEvent
  | ServerGeminiRetryEvent
  | ServerGeminiInvalidStreamEvent;

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
      // Access config through the chat instance
      const config = (this.chat as unknown as { config: unknown }).config as {
        getSettingsService(): { get(key: string): unknown } | undefined;
      };

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
    } catch (error) {
      this.logger.debug('Failed to determine citation settings:', error);
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
    this.logger.debug('Turn.run called', {
      req: JSON.stringify(req, null, 2),
      typeofReq: typeof req,
      isArray: Array.isArray(req),
    });

    try {
      // Note: This assumes `sendMessageStream` yields events like
      // { type: StreamEventType.RETRY } or { type: StreamEventType.CHUNK, value: GenerateContentResponse }
      const responseStream = await this.chat.sendMessageStream(
        {
          message: req,
          config: {
            abortSignal: signal,
          },
        },
        this.prompt_id,
      );

      for await (const streamEvent of responseStream) {
        if (signal?.aborted) {
          yield { type: GeminiEventType.UserCancelled };
          return;
        }

        // Handle the new RETRY event
        if (streamEvent.type === 'retry') {
          yield { type: GeminiEventType.Retry };
          continue; // Skip to the next event in the stream
        }

        // Assuming other events are chunks with a `value` property
        const resp = streamEvent.value as GenerateContentResponse;
        if (!resp) continue; // Skip if there's no response body

        this.debugResponses.push(resp);

        const thoughtPart = resp.candidates?.[0]?.content?.parts?.[0];
        if (thoughtPart?.thought) {
          // Thought always has a bold "subject" part enclosed in double asterisks
          // (e.g., **Subject**). The rest of the string is considered the description.
          const rawText = thoughtPart.text ?? '';
          const subjectStringMatches = rawText.match(/\*\*(.*?)\*\*/s);
          const subject = subjectStringMatches
            ? subjectStringMatches[1].trim()
            : '';
          const description = rawText.replace(/\*\*(.*?)\*\*/s, '').trim();
          const thought: ThoughtSummary = {
            subject,
            description,
          };

          yield {
            type: GeminiEventType.Thought,
            value: thought,
          };
          continue;
        }

        const text = getResponseText(resp);
        if (text) {
          yield { type: GeminiEventType.Content, value: text };

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
        if (finishReason) {
          this.finishReason = finishReason;
          yield {
            type: GeminiEventType.Finished,
            value: {
              reason: finishReason,
              usageMetadata: resp.usageMetadata,
            },
          };
        }
      }
    } catch (e) {
      if (signal.aborted) {
        yield { type: GeminiEventType.UserCancelled };
        // Regular cancellation error, fail gracefully.
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
    const name = fnCall.name || 'undefined_tool_name';
    const args = (fnCall.args || {}) as Record<string, unknown>;

    const toolCallRequest: ToolCallRequestInfo = {
      callId,
      name,
      args,
      isClientInitiated: false,
      prompt_id: this.prompt_id,
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
