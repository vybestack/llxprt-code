/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turn class — extracted from core/turn.ts as part of issue #1592.
 * Protocol types (GeminiEventType, ServerGeminiStreamEvent, etc.) remain in core.
 */

import { createHash } from 'node:crypto';
import type {
  GenerateContentResponse,
  FinishReason,
  GenerateContentResponseUsageMetadata,
} from '@google/genai';
import {
  type Part,
  type PartListUnion,
  type FunctionCall,
} from '@google/genai';
import {
  getFunctionCallsFromParts,
  analyzeResponseOutcome,
  type ResponseOutcome,
} from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { isThoughtPart } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import {
  filterHookRestrictedParts,
  filterHookRestrictedFunctionCalls,
  getHookRestrictedAllowedTools,
  getHookRestrictedFunctionCallsFromParts,
  getHookRestrictedAllowedToolsForFunctionCall,
  mergeHookRestrictedFunctionCalls,
} from './hookToolRestrictions.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import {
  getErrorMessage,
  UnauthorizedError,
  toFriendlyError,
} from '@vybestack/llxprt-code-core/utils/errors.js';
import { normalizeToolName } from '@vybestack/llxprt-code-tools';
import type { ChatSession } from './chatSession.js';
import {
  InvalidStreamError,
  StreamEventType,
  type StreamEvent,
} from './chatSession.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { getCodeAssistServer } from '@vybestack/llxprt-code-core/code_assist/codeAssist.js';
import { UserTierId } from '@vybestack/llxprt-code-core/code_assist/types.js';
import { parseThought } from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import {
  DEFAULT_AGENT_ID,
  GeminiEventType,
  type ToolCallRequestInfo,
  type ServerGeminiStreamEvent,
  type ServerGeminiCitationEvent,
  type StructuredError,
} from '@vybestack/llxprt-code-core/core/turn.js';

/** @deprecated Use DEFAULT_STREAM_IDLE_TIMEOUT_MS from streamIdleTimeout.js instead */
export const TURN_STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

const TURN_STREAM_IDLE_TIMEOUT_ERROR_MESSAGE =
  'Stream idle timeout: no response received within the allowed time.';
/**
 * Safely checks if an AbortSignal (or runtime-nullish value) has been aborted.
 * Runtime payloads can pass null/undefined despite declared types.
 */
function isAbortSignalActive(signal: unknown): boolean {
  return (
    signal != null &&
    typeof signal === 'object' &&
    (signal as { aborted?: unknown }).aborted === true
  );
}

function createSafeJsonReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value !== 'object' || value === null) {
      return value;
    }

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value;
    }

    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = record[key];
        return sorted;
      }, {});
  };
}

function safeJsonStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, createSafeJsonReplacer(), space);
  } catch (error) {
    return `[Unserializable request: ${getErrorMessage(error)}]`;
  }
}

// Re-export types that consumers need from this module
export {
  DEFAULT_AGENT_ID,
  GeminiEventType,
  CompressionStatus,
  PerformCompressionResult,
} from '@vybestack/llxprt-code-core/core/turn.js';
export type {
  ToolCallRequestInfo,
  ToolCallResponseInfo,
  ServerGeminiStreamEvent,
  ServerGeminiContentEvent,
  ServerGeminiThoughtEvent,
  ServerGeminiToolCallRequestEvent,
  ServerGeminiToolCallResponseEvent,
  ServerGeminiToolCallConfirmationEvent,
  ServerGeminiUserCancelledEvent,
  ServerGeminiStreamIdleTimeoutEvent,
  ServerGeminiErrorEvent,
  ServerGeminiChatCompressedEvent,
  ServerGeminiUsageMetadataEvent,
  ServerGeminiMaxSessionTurnsEvent,
  ServerGeminiFinishedEvent,
  ServerGeminiLoopDetectedEvent,
  ServerGeminiCitationEvent,
  ServerGeminiRetryEvent,
  ServerGeminiInvalidStreamEvent,
  ServerGeminiAgentExecutionStoppedEvent,
  ServerGeminiAgentExecutionBlockedEvent,
  ServerGeminiContextWindowWillOverflowEvent,
  ServerGeminiModelInfoEvent,
  ServerToolCallConfirmationDetails,
  ChatCompressionInfo,
  ModelInfo,
  ServerGeminiFinishedOutcome,
  StructuredError,
  ServerTool,
} from '@vybestack/llxprt-code-core/core/turn.js';

// A turn manages the agentic loop turn within the server context.
export class Turn {
  readonly pendingToolCalls: ToolCallRequestInfo[];
  private debugResponses: GenerateContentResponse[];
  finishReason: FinishReason | undefined;
  private logger: DebugLogger;

  constructor(
    private readonly chat: ChatSession,
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
  private *emitFinishReason(
    finishReason: FinishReason,
    allParts: Part[],
    functionCalls: FunctionCall[],
    text: string | undefined,
    usageMetadata: GenerateContentResponseUsageMetadata | undefined,
    traceId: string | undefined,
    cumulativeOutcome: ResponseOutcome,
  ): Generator<ServerGeminiStreamEvent> {
    const outcome = cumulativeOutcome;
    this.logger.debug(() => `[stream:turn] emitting Finished event`, {
      finishReason,
      traceId,
      partCount: allParts.length,
      toolCallCount: functionCalls.length,
      textLength: text?.length ?? 0,
      hasUsageMetadata: Boolean(usageMetadata),
      outcome,
    });
    this.finishReason = finishReason;
    yield {
      type: GeminiEventType.Finished,
      value: {
        reason: finishReason,
        usageMetadata,
        outcome: {
          hadVisibleOutput: outcome.hasVisibleText,
          hadThinking: outcome.hasThinking,
          hadToolCalls: outcome.hasToolCalls,
        },
      },
    };
  }

  private logNoFinishReason(
    allParts: Part[],
    functionCalls: FunctionCall[],
    text: string | undefined,
    usageMetadata: GenerateContentResponseUsageMetadata | undefined,
    traceId: string | undefined,
  ): void {
    this.logger.debug(() => `[stream:turn] chunk had no finishReason`, {
      traceId,
      partCount: allParts.length,
      toolCallCount: functionCalls.length,
      textLength: text?.length ?? 0,
      hasUsageMetadata: Boolean(usageMetadata),
    });
  }

  private pushFilteredDebugResponse(
    resp: GenerateContentResponse,
    allowedParts: Part[],
  ): void {
    this.debugResponses.push(
      resp.candidates === undefined
        ? resp
        : ({
            ...resp,
            candidates: resp.candidates.map((candidate, index) =>
              index === 0
                ? {
                    ...candidate,
                    content:
                      candidate.content === undefined
                        ? undefined
                        : { ...candidate.content, parts: allowedParts },
                  }
                : candidate,
            ),
          } as GenerateContentResponse),
    );
  }

  private *processStreamChunk(
    resp: GenerateContentResponse,
    traceId: string | undefined,
    cumulativeOutcome: ResponseOutcome,
  ): Generator<ServerGeminiStreamEvent> {
    // Check ALL parts for thinking, not just parts[0]
    // Bug fix: Previously only checked parts[0], missing thoughts in other positions
    // @plan PLAN-20251202-THINKING.P16
    const allParts = resp.candidates?.[0]?.content?.parts ?? [];
    const allowedParts = filterHookRestrictedParts(
      allParts,
      getHookRestrictedAllowedTools(resp),
    );
    this.pushFilteredDebugResponse(resp, allowedParts);

    for (const part of allowedParts) {
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

    const finishReason = resp.candidates?.[0]?.finishReason;
    const text = allowedParts
      .filter((part) => !isThoughtPart(part))
      .map((part) => part.text)
      .filter((partText): partText is string => typeof partText === 'string')
      .join('');
    if (text !== '') {
      yield { type: GeminiEventType.Content, value: text, traceId };

      if (text.trim() !== '') {
        // Emit citation event if conditions are met
        // Based on upstream implementation - emit citation after content
        const citationEvent = this.emitCitation(
          'Response may contain information from external sources. Please verify important details independently.',
        );
        if (citationEvent) {
          yield citationEvent;
        }
      }
    }

    // Handle function calls (requesting tool execution)
    const partFunctionCalls = getFunctionCallsFromParts(allowedParts) ?? [];
    const topLevelFunctionCalls = filterHookRestrictedFunctionCalls(
      resp.functionCalls ?? [],
      getHookRestrictedAllowedTools(resp),
    );
    const functionCalls = mergeHookRestrictedFunctionCalls(
      partFunctionCalls,
      topLevelFunctionCalls,
    );
    for (const [functionCallIndex, fnCall] of functionCalls.entries()) {
      const event = this.handlePendingFunctionCall(fnCall, functionCallIndex);
      if (event) {
        yield event;
      }
    }

    // This is the key change: Only yield 'Finished' if there is a finishReason.
    // Pass only allowed function calls so logging/outcome reflect executable calls.
    if (finishReason != null) {
      yield* this.emitFinishReason(
        finishReason,
        allowedParts,
        functionCalls,
        text,
        resp.usageMetadata,
        traceId,
        cumulativeOutcome,
      );
    } else {
      this.logNoFinishReason(
        allowedParts,
        functionCalls,
        text,
        resp.usageMetadata,
        traceId,
      );
    }
  }

  private createEmptyResponseOutcome(): ResponseOutcome {
    return {
      hasVisibleText: false,
      hasThinking: false,
      hasToolCalls: false,
      isActionable: false,
    };
  }

  private async *consumeStreamEvents(
    streamIterator: AsyncIterator<StreamEvent>,
    timeoutController: AbortController,
    signal: AbortSignal,
    effectiveTimeoutMs: number,
    idleFlag: { timedOut: boolean },
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    let cumulativeOutcome = this.createEmptyResponseOutcome();
    for (;;) {
      // Use watchdog if timeout > 0, otherwise call iterator.next() directly
      let result: IteratorResult<StreamEvent>;
      if (effectiveTimeoutMs > 0) {
        result = await nextStreamEventWithIdleTimeout({
          iterator: streamIterator,
          timeoutMs: effectiveTimeoutMs,
          signal: timeoutController.signal,
          onTimeout: () => {
            if (signal.aborted) {
              return;
            }
            idleFlag.timedOut = true;
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
      if (isAbortSignalActive(signal)) {
        yield { type: GeminiEventType.UserCancelled };
        return;
      }

      const dispatch = yield* this.dispatchStreamEvent(
        streamEvent,
        cumulativeOutcome,
      );
      cumulativeOutcome = dispatch.outcome;
      if (dispatch.action === 'return') {
        return;
      }
      if (dispatch.action === 'process' && dispatch.resp != null) {
        cumulativeOutcome = this.mergeResponseOutcome(
          cumulativeOutcome,
          dispatch.resp,
        );
        const traceId = dispatch.resp.responseId ?? undefined;
        yield* this.processStreamChunk(
          dispatch.resp,
          traceId as string,
          cumulativeOutcome,
        );
      }
    }
  }

  private async *dispatchStreamEvent(
    streamEvent: StreamEvent,
    cumulativeOutcome: ResponseOutcome,
  ): AsyncGenerator<
    ServerGeminiStreamEvent,
    {
      action: 'continue' | 'process' | 'return';
      outcome: ResponseOutcome;
      resp: GenerateContentResponse | null;
    }
  > {
    // Handle the RETRY event
    if (streamEvent.type === StreamEventType.RETRY) {
      const outcome = this.createEmptyResponseOutcome();
      yield { type: GeminiEventType.Retry };
      return { action: 'continue', outcome, resp: null };
    }

    // Handle AGENT_EXECUTION_STOPPED event
    if (streamEvent.type === StreamEventType.AGENT_EXECUTION_STOPPED) {
      yield {
        type: GeminiEventType.AgentExecutionStopped,
        reason: streamEvent.reason,
        systemMessage: streamEvent.systemMessage,
        contextCleared: streamEvent.contextCleared,
      };
      return { action: 'return', outcome: cumulativeOutcome, resp: null };
    }

    // Handle AGENT_EXECUTION_BLOCKED event
    if (streamEvent.type === StreamEventType.AGENT_EXECUTION_BLOCKED) {
      yield {
        type: GeminiEventType.AgentExecutionBlocked,
        reason: streamEvent.reason,
        systemMessage: streamEvent.systemMessage,
        contextCleared: streamEvent.contextCleared,
      };
      return { action: 'continue', outcome: cumulativeOutcome, resp: null };
    }

    // Narrow to CHUNK — the only other variant in the discriminated union
    const resp = streamEvent.value as GenerateContentResponse | null;
    return { action: 'process', outcome: cumulativeOutcome, resp };
  }

  private mergeResponseOutcome(
    cumulativeOutcome: ResponseOutcome,
    resp: GenerateContentResponse,
  ): ResponseOutcome {
    const parts = resp.candidates?.[0]?.content?.parts ?? [];
    const allowedParts = filterHookRestrictedParts(
      parts,
      getHookRestrictedAllowedTools(resp),
    );
    const allowedPartCalls = getHookRestrictedFunctionCallsFromParts(
      allowedParts,
      getHookRestrictedAllowedTools(resp),
    );
    const allowedMergedCalls = mergeHookRestrictedFunctionCalls(
      allowedPartCalls,
      filterHookRestrictedFunctionCalls(
        resp.functionCalls ?? [],
        getHookRestrictedAllowedTools(resp),
      ),
    );
    const allowedTopLevelCallParts = allowedMergedCalls
      .slice(allowedPartCalls.length)
      .map((functionCall) => ({ functionCall }));
    const chunkOutcome = analyzeResponseOutcome([
      ...allowedParts,
      ...allowedTopLevelCallParts,
    ]);
    return {
      hasVisibleText:
        cumulativeOutcome.hasVisibleText || chunkOutcome.hasVisibleText,
      hasThinking: cumulativeOutcome.hasThinking || chunkOutcome.hasThinking,
      hasToolCalls: cumulativeOutcome.hasToolCalls || chunkOutcome.hasToolCalls,
      isActionable: cumulativeOutcome.isActionable || chunkOutcome.isActionable,
    };
  }

  private extractErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('status' in error)) {
      return undefined;
    }
    const status = (error as { status: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }

  private async *handleRunError(
    e: unknown,
    req: PartListUnion,
    signal: AbortSignal,
    idleFlag: { timedOut: boolean },
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    if (signal.aborted) {
      yield { type: GeminiEventType.UserCancelled };
      return;
    }

    if (idleFlag.timedOut) {
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
    const status = this.extractErrorStatus(error);
    const structuredError: StructuredError = {
      message: getErrorMessage(error),
      status,
    };
    yield { type: GeminiEventType.Error, value: { error: structuredError } };
  }

  // The run method yields simpler events suitable for server logic
  async *run(
    req: PartListUnion,
    signal: AbortSignal,
  ): AsyncGenerator<ServerGeminiStreamEvent> {
    const idleFlag: { timedOut: boolean } = { timedOut: false };
    this.logger.debug('Turn.run called', {
      req: safeJsonStringify(req, 2),
      typeofReq: typeof req,
      isArray: Array.isArray(req),
    });

    try {
      if (signal.aborted) {
        yield { type: GeminiEventType.UserCancelled };
        return;
      }

      const timeoutController = new AbortController();
      const timeoutSignal = timeoutController.signal;
      const onParentAbort = () => timeoutController.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });

      let streamIterator: AsyncIterator<StreamEvent> | undefined;

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

        yield* this.consumeStreamEvents(
          streamIterator,
          timeoutController,
          signal,
          effectiveTimeoutMs,
          idleFlag,
        );
      } finally {
        streamIterator?.return?.().catch(() => {});
        timeoutController.abort();
        signal.removeEventListener('abort', onParentAbort);
      }
    } catch (e) {
      yield* this.handleRunError(e, req, signal, idleFlag);
    }
  }

  private handlePendingFunctionCall(
    fnCall: FunctionCall,
    functionCallIndex: number,
  ): ServerGeminiStreamEvent | null {
    const callId =
      fnCall.id ??
      this.createSyntheticFunctionCallId(fnCall, functionCallIndex);

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
    const allowedTools = getHookRestrictedAllowedToolsForFunctionCall(fnCall);

    const toolCallRequest: ToolCallRequestInfo = {
      callId,
      name: name || 'undefined_tool_name',
      args,
      isClientInitiated: false,
      prompt_id: this.prompt_id,
      agentId: (this.agentId as string | undefined) ?? DEFAULT_AGENT_ID,
      ...(allowedTools !== undefined
        ? { hookRestrictedAllowedTools: allowedTools }
        : {}),
    };

    this.pendingToolCalls.push(toolCallRequest);

    // Yield a request for the tool call, not the pending/confirming status
    return { type: GeminiEventType.ToolCallRequest, value: toolCallRequest };
  }

  private createSyntheticFunctionCallId(
    fnCall: FunctionCall,
    functionCallIndex: number,
  ): string {
    const payload = safeJsonStringify({
      promptId: this.prompt_id,
      agentId: this.agentId,
      functionCallIndex,
      name: fnCall.name ?? '',
      args: fnCall.args ?? {},
    });
    const digest = createHash('sha256')
      .update(payload)
      .digest('hex')
      .slice(0, 16);
    const name = normalizeToolName(fnCall.name ?? '') ?? 'undefined_tool_name';
    return `${name}-${functionCallIndex}-${digest}`;
  }

  getDebugResponses(): GenerateContentResponse[] {
    return this.debugResponses;
  }
}
