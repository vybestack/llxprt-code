/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turn class — extracted from core/turn.ts as part of issue #1592.
 * Protocol types (AgentEventType, ServerAgentStreamEvent, etc.) remain in core.
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
import { getProviderStopReason } from './providerStopReason.js';
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
  resolveStreamFirstResponseTimeoutMs,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import {
  DEFAULT_AGENT_ID,
  AgentEventType,
  type ToolCallRequestInfo,
  type ServerAgentStreamEvent,
  type ServerCitationEvent,
  type StructuredError,
} from '@vybestack/llxprt-code-core/core/turn.js';

/** @deprecated Use DEFAULT_STREAM_IDLE_TIMEOUT_MS from streamIdleTimeout.js instead */
export const TURN_STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

const TURN_STREAM_IDLE_TIMEOUT_ERROR_MESSAGE =
  'Stream idle timeout: no response received within the allowed time.';

/**
 * Options object for {@link Turn.emitFinishReason}. Encapsulates the data
 * needed to emit a Finished event, including the raw provider stop reason
 * (@issue:2329) so it can be surfaced to consumers.
 */
interface EmitFinishReasonOptions {
  finishReason: FinishReason;
  allParts: Part[];
  functionCalls: FunctionCall[];
  text: string | undefined;
  usageMetadata: GenerateContentResponseUsageMetadata | undefined;
  traceId: string | undefined;
  cumulativeOutcome: ResponseOutcome;
  stopReason: string | undefined;
}

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
  AgentEventType,
  CompressionStatus,
  PerformCompressionResult,
} from '@vybestack/llxprt-code-core/core/turn.js';
export type {
  ToolCallRequestInfo,
  ToolCallResponseInfo,
  ServerAgentStreamEvent,
  ServerContentEvent,
  ServerThoughtEvent,
  ServerToolCallRequestEvent,
  ServerToolCallResponseEvent,
  ServerToolCallConfirmationEvent,
  ServerUserCancelledEvent,
  ServerStreamIdleTimeoutEvent,
  ServerErrorEvent,
  ServerChatCompressedEvent,
  ServerUsageMetadataEvent,
  ServerMaxSessionTurnsEvent,
  ServerFinishedEvent,
  ServerLoopDetectedEvent,
  ServerCitationEvent,
  ServerRetryEvent,
  ServerInvalidStreamEvent,
  ServerAgentExecutionStoppedEvent,
  ServerAgentExecutionBlockedEvent,
  ServerContextWindowWillOverflowEvent,
  ServerModelInfoEvent,
  ServerToolCallConfirmationDetails,
  ChatCompressionInfo,
  ModelInfo,
  ServerFinishedOutcome,
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
  private emitCitation(text: string): ServerCitationEvent | null {
    if (!this.shouldShowCitations()) {
      return null;
    }

    return {
      type: AgentEventType.Citation,
      value: text,
    };
  }
  private *emitFinishReason(
    opts: EmitFinishReasonOptions,
  ): Generator<ServerAgentStreamEvent> {
    const {
      finishReason,
      allParts,
      functionCalls,
      text,
      usageMetadata,
      traceId,
      cumulativeOutcome: outcome,
      stopReason,
    } = opts;
    this.logger.debug(() => `[stream:turn] emitting Finished event`, {
      finishReason,
      traceId,
      partCount: allParts.length,
      toolCallCount: functionCalls.length,
      textLength: text?.length ?? 0,
      hasUsageMetadata: Boolean(usageMetadata),
      stopReason,
      outcome,
    });
    this.finishReason = finishReason;
    yield {
      type: AgentEventType.Finished,
      value: {
        reason: finishReason,
        usageMetadata,
        outcome: {
          hadVisibleOutput: outcome.hasVisibleText,
          hadThinking: outcome.hasThinking,
          hadToolCalls: outcome.hasToolCalls,
        },
        // @issue:2329 — only include stopReason when it carries a value,
        // matching existing optional-field style so consumers can detect
        // refusals without receiving a vacuous empty field.
        ...(stopReason !== undefined && stopReason !== ''
          ? { stopReason }
          : {}),
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
  ): Generator<ServerAgentStreamEvent> {
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
          type: AgentEventType.Thought,
          value: thought,
          traceId,
        };
      }
    }

    const finishReason = resp.candidates?.[0]?.finishReason;
    // @issue:2329 — thread the raw provider stop reason (repo-owned
    // providerStopReason field, set by MessageConverter) into the Finished
    // event so consumers can surface a refusal-specific notice. Native SDK
    // responses never carry this field, so descriptive finishMessage text
    // can never leak into the stop-reason signal.
    const providerStopReason = getProviderStopReason(resp.candidates?.[0]);
    const text = allowedParts
      .filter((part) => !isThoughtPart(part))
      .map((part) => part.text)
      .filter((partText): partText is string => typeof partText === 'string')
      .join('');
    if (text !== '') {
      yield { type: AgentEventType.Content, value: text, traceId };

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
      yield* this.emitFinishReason({
        finishReason,
        allParts: allowedParts,
        functionCalls,
        text,
        usageMetadata: resp.usageMetadata,
        traceId,
        cumulativeOutcome,
        stopReason: providerStopReason,
      });
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
    firstResult?: IteratorResult<StreamEvent>,
  ): AsyncGenerator<ServerAgentStreamEvent> {
    let cumulativeOutcome = this.createEmptyResponseOutcome();
    let pendingResult: IteratorResult<StreamEvent> | undefined = firstResult;
    for (;;) {
      // Use watchdog if timeout > 0, otherwise call iterator.next() directly
      let result: IteratorResult<StreamEvent>;
      if (pendingResult !== undefined) {
        // First event was already fetched (and bounded by the first-response
        // watchdog in run()); consume it directly, then clear the pending slot.
        result = pendingResult;
        pendingResult = undefined;
      } else if (effectiveTimeoutMs > 0) {
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
        yield { type: AgentEventType.UserCancelled };
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
    ServerAgentStreamEvent,
    {
      action: 'continue' | 'process' | 'return';
      outcome: ResponseOutcome;
      resp: GenerateContentResponse | null;
    }
  > {
    // Handle the RETRY event
    if (streamEvent.type === StreamEventType.RETRY) {
      const outcome = this.createEmptyResponseOutcome();
      yield { type: AgentEventType.Retry };
      return { action: 'continue', outcome, resp: null };
    }

    // Handle AGENT_EXECUTION_STOPPED event
    if (streamEvent.type === StreamEventType.AGENT_EXECUTION_STOPPED) {
      yield {
        type: AgentEventType.AgentExecutionStopped,
        reason: streamEvent.reason,
        systemMessage: streamEvent.systemMessage,
        contextCleared: streamEvent.contextCleared,
      };
      return { action: 'return', outcome: cumulativeOutcome, resp: null };
    }

    // Handle AGENT_EXECUTION_BLOCKED event
    if (streamEvent.type === StreamEventType.AGENT_EXECUTION_BLOCKED) {
      yield {
        type: AgentEventType.AgentExecutionBlocked,
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
  ): AsyncGenerator<ServerAgentStreamEvent> {
    if (signal.aborted) {
      yield { type: AgentEventType.UserCancelled };
      return;
    }

    if (idleFlag.timedOut) {
      yield {
        type: AgentEventType.StreamIdleTimeout,
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
      yield { type: AgentEventType.InvalidStream };
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
    yield { type: AgentEventType.Error, value: { error: structuredError } };
  }

  // The run method yields simpler events suitable for server logic
  async *run(
    req: PartListUnion,
    signal: AbortSignal,
  ): AsyncGenerator<ServerAgentStreamEvent> {
    const idleFlag: { timedOut: boolean } = { timedOut: false };
    this.logger.debug('Turn.run called', {
      req: safeJsonStringify(req, 2),
      typeofReq: typeof req,
      isArray: Array.isArray(req),
    });

    try {
      if (signal.aborted) {
        yield { type: AgentEventType.UserCancelled };
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
      const firstResponseTimeoutMs = resolveStreamFirstResponseTimeoutMs(
        this.chat.getConfig(),
      );

      try {
        // Acquire the stream AND await the FIRST event, bounding the entire
        // window (activation + connect + first token) by the first-response
        // watchdog. After the first event arrives the first-response timer is
        // cancelled and inter-chunk gaps are governed solely by the existing
        // (default-off) effectiveTimeoutMs watchdog in consumeStreamEvents.
        const { iterator, firstResult } = await this.acquireFirstStreamEvent(
          req,
          timeoutSignal,
          timeoutController,
          firstResponseTimeoutMs,
          idleFlag,
        );
        streamIterator = iterator;

        yield* this.consumeStreamEvents(
          streamIterator,
          timeoutController,
          signal,
          effectiveTimeoutMs,
          idleFlag,
          firstResult,
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

  /**
   * Acquire the response stream and await its FIRST event, bounding the whole
   * time-to-first-response window (both the sendMessageStream() acquisition and
   * the first .next(), since the network work happens on that first .next()) by
   * the first-response watchdog. A dedicated AbortController drives the timer
   * and is aborted in `finally` once the first event resolves or throws, so it
   * can never fire mid-stream. On timeout it sets idleFlag.timedOut, aborts the
   * turn's timeoutController, and throws the canonical idle-timeout error so
   * handleRunError yields StreamIdleTimeout; a parent-signal abort during the
   * wait yields UserCancelled instead (guarded by `!timeoutSignal.aborted`).
   * When disabled (<=0) the behavior is the pre-existing direct acquire-then-
   * next with no bound. Mirrors the first-chunk-timeout pattern in
   * loadBalancing/streamTimeout.ts and RetryOrchestrator.ts.
   */
  private async acquireFirstStreamEvent(
    req: PartListUnion,
    timeoutSignal: AbortSignal,
    timeoutController: AbortController,
    firstResponseTimeoutMs: number,
    idleFlag: { timedOut: boolean },
  ): Promise<{
    iterator: AsyncIterator<StreamEvent>;
    firstResult: IteratorResult<StreamEvent>;
  }> {
    if (firstResponseTimeoutMs <= 0) {
      // First-response watchdog explicitly disabled: direct acquire + first next.
      const iterator = await this.openResponseStreamIterator(
        req,
        timeoutSignal,
      );
      try {
        const firstResult = await iterator.next();
        return { iterator, firstResult };
      } catch (error) {
        // On a first-next failure the iterator has not yet been handed to
        // run() (streamIterator is still unassigned there), so close it here to
        // avoid leaking the provider connection before rethrowing.
        await iterator.return?.().catch(() => {});
        throw error;
      }
    }

    // Dedicated timer cancelled in `finally` so it can never fire mid-stream.
    const firstResponseTimer = new AbortController();
    const timeoutPromise = delay(
      firstResponseTimeoutMs,
      firstResponseTimer.signal,
    ).then(() => {
      // If the parent already aborted, do NOT mask that with a timeout error:
      // surface an AbortError so the race settles with the accurate cause.
      // handleRunError yields UserCancelled either way, but the thrown error is
      // then correct for any upstream diagnostics.
      if (timeoutSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      idleFlag.timedOut = true;
      timeoutController.abort();
      throw new Error(TURN_STREAM_IDLE_TIMEOUT_ERROR_MESSAGE);
    });
    // Aborting the timer (in `finally`, once the event wins) rejects the
    // delay() with an AbortError. Suppress it: the timeout losing the race is
    // expected, and an unhandled rejection could otherwise crash under strict
    // Node --unhandled-rejections modes.
    timeoutPromise.catch(() => {});

    // Race the ENTIRE first-response window: acquisition (sendMessageStream)
    // AND the first .next(), because in production the network work happens on
    // the first .next(), not necessarily during acquisition. The
    // firstEventPromise chains acquisition then first-next; whichever of it or
    // the timeout settles first wins.
    let acquiredIterator: AsyncIterator<StreamEvent> | undefined;
    const firstEventPromise = (async () => {
      const iterator = await this.openResponseStreamIterator(
        req,
        timeoutSignal,
      );
      acquiredIterator = iterator;
      const firstResult = await iterator.next();
      return { iterator, firstResult };
    })();
    // Attach a no-op rejection handler immediately (mirroring timeoutPromise
    // above) so that if firstEventPromise rejects in the brief window before
    // the catch block below attaches the real cleanup handler, it cannot
    // surface as an unhandled rejection under strict Node modes. Promise.race
    // still delivers the rejection to the caller.
    firstEventPromise.catch(() => {});

    try {
      const result = await Promise.race([firstEventPromise, timeoutPromise]);
      // firstEventPromise won: the caller owns and later closes this iterator.
      return result;
    } catch (error) {
      // The timeout won (or acquisition/first-next threw). firstEventPromise is
      // the loser, so its result is discarded and must be cleaned up. Attaching
      // the cleanup HERE — only once we know firstEvent lost — makes correctness
      // independent of microtask ordering: on the winning path above we return
      // without ever attaching cleanup, so the returned iterator is never closed
      // underneath the caller. On the losing path, close the iterator whether it
      // resolves LATE (first event arrived just after the abort) or REJECTS (the
      // aborted provider throws), and swallow the rejection to avoid an
      // unhandled rejection under strict Node modes.
      firstEventPromise
        .then((late) => {
          late.iterator.return?.().catch(() => {});
        })
        .catch(() => {
          acquiredIterator?.return?.().catch(() => {});
        });
      throw error;
    } finally {
      firstResponseTimer.abort();
    }
  }

  /**
   * Open the provider response stream and return its async iterator. Shared by
   * both the bounded and unbounded first-response paths so the request shape is
   * defined in exactly one place.
   */
  private async openResponseStreamIterator(
    req: PartListUnion,
    timeoutSignal: AbortSignal,
  ): Promise<AsyncIterator<StreamEvent>> {
    const responseStream = await this.chat.sendMessageStream(
      {
        message: req,
        config: {
          abortSignal: timeoutSignal,
        },
      },
      this.prompt_id,
    );
    return responseStream[Symbol.asyncIterator]();
  }

  private handlePendingFunctionCall(
    fnCall: FunctionCall,
    functionCallIndex: number,
  ): ServerAgentStreamEvent | null {
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
    return { type: AgentEventType.ToolCallRequest, value: toolCallRequest };
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
