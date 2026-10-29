/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turn class — extracted from core/turn.ts as part of issue #1592.
 * Protocol types (AgentEventType, ServerAgentStreamEvent, etc.) remain in core.
 */

import {
  emitThoughtContent,
  emitTextContent,
  filterBlocksByAllowedTools,
  toolRequestFromBlock,
} from './turnChunkEvents.js';
import type {
  ModelStreamChunk,
  CanonicalFinishReason,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  ContentBlock,
  UsageStats,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  analyzeResponseOutcome,
  type ResponseOutcome,
} from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
import { reportError } from '@vybestack/llxprt-code-core/utils/errorReporting.js';
import {
  UnauthorizedError,
  getErrorMessage,
  toFriendlyError,
} from '@vybestack/llxprt-code-core/utils/errors.js';
import type { ChatSession } from './chatSession.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  InvalidStreamError,
  StreamEventType,
  type StreamEvent,
} from './chatSession.js';
import { closeIteratorBounded } from './iteratorCleanup.js';
import { openResponseStreamIterator } from './turnResponseStream.js';
import {
  TurnDebugResponses,
  MAX_DEBUG_RESPONSE_CHUNKS,
} from './turnDebugResponses.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { ContextOverflowError } from '../compression/contextOverflowError.js';
import {
  resolveStreamIdleTimeoutMsSource,
  resolveStreamFirstResponseTimeoutMsSource,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  type StreamLivenessListener,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import {
  createStreamWatchdog,
  type StreamWatchdog,
  type StreamWatchdogFire,
} from '@vybestack/llxprt-code-core/utils/streamWatchdog.js';
import {
  buildStructuredError,
  isAbortSignalActive,
  safeJsonStringify,
} from './turnJsonUtils.js';
import { buildErrorReportContext } from './turnErrorReportContext.js';
import { historySourceFailure } from './historySourceError.js';
import {
  beginWatchdogBoundedAcquisition,
  closeLateAcquiredIterator,
  formatStreamIdleTimeoutMessage,
  raceReadWithAbort,
} from './turnStreamGuards.js';
import {
  DEFAULT_AGENT_ID,
  AgentEventType,
  type ToolCallRequestInfo,
  type ServerAgentStreamEvent,
  type StructuredError,
} from '@vybestack/llxprt-code-core/core/turn.js';

// Re-exported so existing importers of this symbol keep working.
export { MAX_DEBUG_RESPONSE_CHUNKS };

type TurnRequest = string | object | readonly unknown[];
/** @deprecated Use DEFAULT_STREAM_IDLE_TIMEOUT_MS from streamIdleTimeout.js instead */
export const TURN_STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

interface IdleFlag {
  timedOut: boolean;
  fire: StreamWatchdogFire | undefined;
  livenessObserved: boolean;
}

/**
 * Options object for {@link Turn.emitFinishReason}. Encapsulates the data
 * needed to emit a Finished event, including the raw provider stop reason
 * (@issue:2329) so it can be surfaced to consumers.
 */
interface EmitFinishReasonOptions {
  finishReason: CanonicalFinishReason;
  allParts: ContentBlock[];
  functionCalls: ToolCallBlock[];
  text: string | undefined;
  usageMetadata: UsageStats | undefined;
  traceId: string | undefined;
  cumulativeOutcome: ResponseOutcome;
  stopReason: string | undefined;
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
  ServerAttemptBoundaryEvent,
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

interface TurnWatchdogBundle {
  readonly watchdog: StreamWatchdog;
  readonly idleMs: number;
}

// A turn manages the agentic loop turn within the server context.
export class Turn {
  readonly pendingToolCalls: ToolCallRequestInfo[];
  private readonly debugResponses = new TurnDebugResponses();
  finishReason: CanonicalFinishReason | undefined;
  private logger: DebugLogger;

  constructor(
    private readonly chat: ChatSession,
    private readonly prompt_id: string,
    private readonly agentId: string = DEFAULT_AGENT_ID,
    private readonly providerName: string = 'backend',
    private readonly recordingExecution?: AgentChatRecordingExecution,
    private readonly hookOwner?: AgentChatRecordingExecution['hookOwner'],
  ) {
    this.pendingToolCalls = [];
    this.finishReason = undefined;
    this.logger = new DebugLogger('llxprt:core:turn');
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
    allParts: ContentBlock[],
    functionCalls: ToolCallBlock[],
    text: string | undefined,
    usageMetadata: UsageStats | undefined,
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

  private *processStreamChunk(
    chunk: ModelStreamChunk,
    traceId: string | undefined,
    cumulativeOutcome: ResponseOutcome,
  ): Generator<ServerAgentStreamEvent> {
    const allowedBlocks = filterBlocksByAllowedTools(
      chunk.content.blocks,
      chunk.hookRestrictions?.allowedToolNames,
    );
    this.debugResponses.push(chunk, allowedBlocks);

    yield* emitThoughtContent(allowedBlocks, traceId);
    const text = yield* emitTextContent(allowedBlocks, traceId, () =>
      this.chat.shouldShowCitations(),
    );
    const functionCalls = allowedBlocks.filter(
      (block): block is ToolCallBlock => block.type === 'tool_call',
    );
    yield* this.emitFunctionCallRequests(functionCalls);
    yield* this.emitChunkCompletion(
      chunk,
      allowedBlocks,
      functionCalls,
      text,
      traceId,
      cumulativeOutcome,
    );
  }

  private *emitFunctionCallRequests(
    functionCalls: ToolCallBlock[],
  ): Generator<ServerAgentStreamEvent> {
    for (const [functionCallIndex, functionCall] of functionCalls.entries()) {
      const request = toolRequestFromBlock(
        functionCall,
        functionCallIndex,
        this.prompt_id,
        this.agentId,
      );
      this.pendingToolCalls.push(request);
      yield { type: AgentEventType.ToolCallRequest, value: request };
    }
  }

  private *emitChunkCompletion(
    chunk: ModelStreamChunk,
    allowedBlocks: ContentBlock[],
    functionCalls: ToolCallBlock[],
    text: string | undefined,
    traceId: string | undefined,
    cumulativeOutcome: ResponseOutcome,
  ): Generator<ServerAgentStreamEvent> {
    if (chunk.finishReason !== undefined) {
      yield* this.emitFinishReason({
        finishReason: chunk.finishReason,
        allParts: allowedBlocks,
        functionCalls,
        text,
        usageMetadata: chunk.usage,
        traceId,
        cumulativeOutcome,
        stopReason: chunk.rawStopReason,
      });
      return;
    }

    this.logNoFinishReason(
      allowedBlocks,
      functionCalls,
      text,
      chunk.usage,
      traceId,
    );
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
    watchdog: StreamWatchdog,
    idleMs: number,
    idleFlag: IdleFlag,
    onStreamProgress: () => void,
    firstResult?: IteratorResult<StreamEvent>,
  ): AsyncGenerator<ServerAgentStreamEvent> {
    let cumulativeOutcome = this.createEmptyResponseOutcome();
    let pendingResult: IteratorResult<StreamEvent> | undefined = firstResult;
    for (;;) {
      let result: IteratorResult<StreamEvent>;
      if (pendingResult !== undefined) {
        // First event was already fetched (and bounded by the first-response
        // watchdog in run()); consume it directly, then clear the pending slot.
        result = pendingResult;
        pendingResult = undefined;
      } else {
        // The watchdog governs the whole stream when active: its inter-chunk
        // guard is rearmed by both provider liveness pings and semantic
        // events, so a healthy stream never false-trips regardless of chunk
        // cadence. Transports that ignore the abort signal (issue #3236)
        // would leave the read pending until the guard fires — or forever
        // when the watchdog is disabled — so every read also races the
        // parent abort signal.
        const read = watchdog.isActive
          ? Promise.race([streamIterator.next(), watchdog.timeoutPromise])
          : streamIterator.next();
        const outcome = await raceReadWithAbort(read, signal);
        if (outcome.aborted) {
          yield { type: AgentEventType.UserCancelled };
          return;
        }
        result = outcome.value;
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
      if (dispatch.action === 'process' && dispatch.chunk != null) {
        // Only a real model chunk advances the semantic-output watchdog.
        watchdog.onSemanticEvent();
        onStreamProgress();
        cumulativeOutcome = this.mergeResponseOutcome(
          cumulativeOutcome,
          dispatch.chunk,
        );
        const traceId = dispatch.chunk.responseId ?? undefined;
        yield* this.processStreamChunk(
          dispatch.chunk,
          traceId,
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
      chunk: ModelStreamChunk | null;
    }
  > {
    // Handle the RETRY event
    if (streamEvent.type === StreamEventType.RETRY) {
      this.pendingToolCalls.length = 0;
      const outcome = this.createEmptyResponseOutcome();
      yield { type: AgentEventType.Retry };
      return { action: 'continue', outcome, chunk: null };
    }

    // Handle AGENT_EXECUTION_STOPPED event
    if (streamEvent.type === StreamEventType.AGENT_EXECUTION_STOPPED) {
      yield {
        type: AgentEventType.AgentExecutionStopped,
        reason: streamEvent.reason,
        systemMessage: streamEvent.systemMessage,
        contextCleared: streamEvent.contextCleared,
      };
      return { action: 'return', outcome: cumulativeOutcome, chunk: null };
    }

    // Handle AGENT_EXECUTION_BLOCKED event
    if (streamEvent.type === StreamEventType.AGENT_EXECUTION_BLOCKED) {
      yield {
        type: AgentEventType.AgentExecutionBlocked,
        reason: streamEvent.reason,
        systemMessage: streamEvent.systemMessage,
        contextCleared: streamEvent.contextCleared,
      };
      return { action: 'continue', outcome: cumulativeOutcome, chunk: null };
    }

    // Narrow to CHUNK — the only other variant in the discriminated union
    const chunk = streamEvent.value as ModelStreamChunk | null;
    return { action: 'process', outcome: cumulativeOutcome, chunk };
  }

  private mergeResponseOutcome(
    cumulativeOutcome: ResponseOutcome,
    chunk: ModelStreamChunk,
  ): ResponseOutcome {
    const allowedToolNames = chunk.hookRestrictions?.allowedToolNames;
    const allowedBlocks = filterBlocksByAllowedTools(
      chunk.content.blocks,
      allowedToolNames,
    );
    const chunkOutcome = analyzeResponseOutcome(allowedBlocks);
    return {
      hasVisibleText:
        cumulativeOutcome.hasVisibleText || chunkOutcome.hasVisibleText,
      hasThinking: cumulativeOutcome.hasThinking || chunkOutcome.hasThinking,
      hasToolCalls: cumulativeOutcome.hasToolCalls || chunkOutcome.hasToolCalls,
      isActionable: cumulativeOutcome.isActionable || chunkOutcome.isActionable,
    };
  }

  private async *handleRunError(
    e: unknown,
    req: TurnRequest,
    signal: AbortSignal,
    idleFlag: IdleFlag,
    observedProviderError: StructuredError | undefined,
  ): AsyncGenerator<ServerAgentStreamEvent> {
    if (signal.aborted) {
      yield { type: AgentEventType.UserCancelled };
      return;
    }

    const sourceFailure = historySourceFailure(e);
    if (sourceFailure !== undefined) throw sourceFailure.error;

    if (idleFlag.timedOut && observedProviderError !== undefined) {
      yield {
        type: AgentEventType.Error,
        value: { error: observedProviderError },
      };
      return;
    }

    if (idleFlag.timedOut) {
      const fire = idleFlag.fire ?? {
        guard: 'first-response' as const,
        thresholdMs: 0,
        configSource: 'default',
      };
      yield {
        type: AgentEventType.StreamIdleTimeout,
        value: {
          error: {
            message: formatStreamIdleTimeoutMessage(
              fire,
              idleFlag.livenessObserved,
            ),
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

    if (e instanceof ContextOverflowError) {
      yield {
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount: e.estimatedRequestTokenCount,
          remainingTokenCount: e.remainingTokenCount,
        },
      };
      return;
    }

    const error = toFriendlyError(e);
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    let baseUrl: string | undefined;
    try {
      baseUrl = this.chat.getResolvedBaseUrl();
    } catch (probeError) {
      throw new AggregateError([error, probeError], getErrorMessage(error));
    }
    const baseMessage = baseUrl
      ? `Error when talking to ${this.providerName} (endpoint: ${baseUrl})`
      : `Error when talking to ${this.providerName} API`;
    await reportError(
      error,
      baseMessage,
      await buildErrorReportContext(
        this.chat.getHistory(/*curated*/ true),
        req,
        baseUrl,
      ),
      'Turn.run-sendMessageStream',
    );
    const structuredError = buildStructuredError(error);
    yield { type: AgentEventType.Error, value: { error: structuredError } };
  }

  // The run method yields simpler events suitable for server logic
  private createTurnWatchdog(
    timeoutController: AbortController,
    idleFlag: IdleFlag,
  ): TurnWatchdogBundle {
    const idleResolution = resolveStreamIdleTimeoutMsSource(
      this.chat.getStreamTimeoutPolicy(),
    );
    const firstResponseResolution = resolveStreamFirstResponseTimeoutMsSource(
      this.chat.getStreamTimeoutPolicy(),
    );
    const watchdog = createStreamWatchdog({
      firstResponseMs: firstResponseResolution.ms,
      firstResponseSource: firstResponseResolution.source,
      idleMs: idleResolution.ms,
      idleSource: idleResolution.source,
      onFire: (fire) => {
        idleFlag.timedOut = true;
        idleFlag.fire = fire;
        timeoutController.abort();
      },
    });
    return { watchdog, idleMs: idleResolution.ms };
  }

  async *run(
    req: TurnRequest,
    signal: AbortSignal,
    modelParameters?: AdmittedModelParameters,
  ): AsyncGenerator<ServerAgentStreamEvent> {
    const idleFlag: IdleFlag = {
      timedOut: false,
      fire: undefined,
      livenessObserved: false,
    };
    let observedProviderError: StructuredError | undefined;
    const onProviderError = (error: StructuredError): void => {
      observedProviderError = error;
    };
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

      const { watchdog, idleMs } = this.createTurnWatchdog(
        timeoutController,
        idleFlag,
      );

      const onStreamLiveness: StreamLivenessListener = (event) => {
        idleFlag.livenessObserved = true;
        watchdog.onLiveness(event);
      };

      try {
        const { iterator, firstResult } = await this.acquireFirstStreamEvent(
          req,
          signal,
          timeoutSignal,
          watchdog,
          idleFlag,
          onProviderError,
          onStreamLiveness,
          modelParameters,
        );
        streamIterator = iterator;

        yield* this.consumeStreamEvents(
          streamIterator,
          timeoutController,
          signal,
          watchdog,
          idleMs,
          idleFlag,
          () => {
            observedProviderError = undefined;
          },
          firstResult,
        );
      } finally {
        await this.cleanupStreamResources(
          watchdog,
          timeoutController,
          streamIterator,
          signal,
          onParentAbort,
        );
      }
    } catch (e) {
      yield* this.handleRunError(
        e,
        req,
        signal,
        idleFlag,
        observedProviderError,
      );
    }
  }

  /**
   * Tears down watchdog, stream iterator, and timeout controller without
   * letting a cleanup failure mask the original stream result. Iterator
   * cleanup rejections are logged as warnings but never rethrown.
   *
   * Iterator closure is awaited before the timeout controller is aborted so
   * that a cooperative iterator's asynchronous cleanup (return()'s promise or
   * a generator's finally block) completes before the turn finishes —
   * including when the consumer exits early. The cleanup signal is omitted so
   * the turn's own abort cannot short-circuit the wait; a noncooperative
   * iterator is still bounded by closeIteratorBounded's internal timeout.
   */
  private async cleanupStreamResources(
    watchdog: StreamWatchdog,
    timeoutController: AbortController,
    streamIterator: AsyncIterator<StreamEvent> | undefined,
    signal: AbortSignal,
    onParentAbort: () => void,
  ): Promise<void> {
    watchdog.cancel();
    try {
      await closeIteratorBounded(streamIterator);
    } catch (cleanupError) {
      this.logger.warn(
        () =>
          `[stream:turn] iterator cleanup failed: ${
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
          }`,
      );
    }
    timeoutController.abort();
    signal.removeEventListener('abort', onParentAbort);
  }

  private async acquireFirstStreamEvent(
    req: TurnRequest,
    signal: AbortSignal,
    timeoutSignal: AbortSignal,
    watchdog: StreamWatchdog,
    idleFlag: IdleFlag,
    onProviderError: (error: StructuredError) => void,
    onStreamLiveness: StreamLivenessListener,
    modelParameters?: AdmittedModelParameters,
  ): Promise<{
    iterator: AsyncIterator<StreamEvent>;
    firstResult: IteratorResult<StreamEvent>;
  }> {
    if (!watchdog.isActive) {
      const iterator = await openResponseStreamIterator(
        this.chat,
        this.prompt_id,
        this.recordingExecution,
        req,
        timeoutSignal,
        onProviderError,
        onStreamLiveness,
        modelParameters,
        this.hookOwner,
      );
      try {
        const outcome = await raceReadWithAbort(iterator.next(), signal);
        if (outcome.aborted) {
          // Throwing AbortError routes cancellation through run()'s catch →
          // handleRunError, which maps it to UserCancelled because the
          // parent signal is aborted.
          throw new DOMException('Aborted', 'AbortError');
        }
        return { iterator, firstResult: outcome.value };
      } catch (error) {
        await closeIteratorBounded(iterator);
        throw error;
      }
    }

    const acquisitionPromise = openResponseStreamIterator(
      this.chat,
      this.prompt_id,
      this.recordingExecution,
      req,
      timeoutSignal,
      onProviderError,
      onStreamLiveness,
      modelParameters,
      this.hookOwner,
    );
    const acquisition = beginWatchdogBoundedAcquisition(acquisitionPromise);

    try {
      const outcome = await raceReadWithAbort(
        Promise.race([acquisition.firstEventPromise, watchdog.timeoutPromise]),
        signal,
      );
      if (outcome.aborted) {
        // Same routing as the unbounded branch: AbortError → handleRunError
        // maps an aborted parent signal to UserCancelled. The catch below
        // still sinks/closes the abandoned acquisition.
        throw new DOMException('Aborted', 'AbortError');
      }
      return outcome.value;
    } catch (error) {
      watchdog.cancel();
      const iteratorAtCatch = acquisition.acquiredIterator();
      await closeIteratorBounded(iteratorAtCatch);
      // Close a late-acquired iterator without waiting for its first next().
      closeLateAcquiredIterator(
        acquisitionPromise,
        iteratorAtCatch,
        timeoutSignal,
      );
      if (idleFlag.fire !== undefined) {
        throw new Error(
          formatStreamIdleTimeoutMessage(
            idleFlag.fire,
            idleFlag.livenessObserved,
          ),
        );
      }
      if (timeoutSignal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      throw error;
    }
  }

  getDebugResponses(): readonly ModelStreamChunk[] {
    return this.debugResponses.retained;
  }
}
