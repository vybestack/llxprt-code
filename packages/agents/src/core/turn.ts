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
  ModelStreamChunk,
  CanonicalFinishReason,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  IContent,
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
  toFriendlyError,
} from '@vybestack/llxprt-code-core/utils/errors.js';
import { normalizeToolName } from '@vybestack/llxprt-code-tools';
import { canonicalizeToolName } from './toolGovernance.js';
import type { ChatSession } from './chatSession.js';
import {
  InvalidStreamError,
  StreamEventType,
  type StreamEvent,
} from './chatSession.js';
import { closeIteratorBounded } from './iteratorCleanup.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { getCodeAssistServer } from '@vybestack/llxprt-code-core/code_assist/codeAssist.js';
import { UserTierId } from '@vybestack/llxprt-code-core/code_assist/types.js';
import { parseThought } from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
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
import {
  DEFAULT_AGENT_ID,
  AgentEventType,
  type ToolCallRequestInfo,
  type ServerAgentStreamEvent,
  type ServerCitationEvent,
  type StructuredError,
} from '@vybestack/llxprt-code-core/core/turn.js';

type TurnRequest = string | object | readonly unknown[];
/** @deprecated Use DEFAULT_STREAM_IDLE_TIMEOUT_MS from streamIdleTimeout.js instead */
export const TURN_STREAM_IDLE_TIMEOUT_MS = DEFAULT_STREAM_IDLE_TIMEOUT_MS;

function formatStreamIdleTimeoutMessage(
  fire: StreamWatchdogFire,
  livenessObserved: boolean,
): string {
  const guardLabel =
    fire.guard === 'first-response'
      ? 'First-response'
      : 'Inter-chunk stream-idle';
  const livenessPart = livenessObserved
    ? '; provider liveness was observed before the timeout'
    : '';
  return `${guardLabel} timeout: no response received within the allowed time (threshold ${fire.thresholdMs}ms) from ${fire.configSource}${livenessPart}.`;
}

interface IdleFlag {
  timedOut: boolean;
  fire: StreamWatchdogFire | undefined;
  livenessObserved: boolean;
}

/**
 * Filters ContentBlocks by hook-restricted allowed tool names.
 * Tool-call and tool-response blocks are kept only if their tool name is in
 * the allowed set; other block types (text, thinking, media, code) always pass.
 *
 * @issue #2348 — replaces the Part[]-based filterHookRestrictedParts for the
 * block-shaped pipeline.
 */
function filterBlocksByAllowedTools(
  blocks: ContentBlock[],
  allowedToolNames: string[] | undefined,
): ContentBlock[] {
  if (allowedToolNames === undefined) {
    return [...blocks];
  }
  const allowed = new Set(allowedToolNames.map(canonicalizeToolName));
  return blocks.filter((block) => {
    if (block.type === 'tool_call') {
      return allowed.has(canonicalizeToolName(block.name));
    }
    if (block.type === 'tool_response') {
      return allowed.has(canonicalizeToolName(block.toolName));
    }
    return true;
  });
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
  private debugResponses: ModelStreamChunk[];
  finishReason: CanonicalFinishReason | undefined;
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

  private pushFilteredDebugChunk(
    chunk: ModelStreamChunk,
    allowedBlocks: ContentBlock[],
  ): void {
    this.debugResponses.push({
      ...chunk,
      content: { ...chunk.content, blocks: allowedBlocks },
    });
  }

  private *processStreamChunk(
    chunk: ModelStreamChunk,
    traceId: string | undefined,
    cumulativeOutcome: ResponseOutcome,
  ): Generator<ServerAgentStreamEvent> {
    const allBlocks = chunk.content.blocks;
    const allowedToolNames = chunk.hookRestrictions?.allowedToolNames;

    const allowedBlocks = filterBlocksByAllowedTools(
      allBlocks,
      allowedToolNames,
    );
    this.pushFilteredDebugChunk(chunk, allowedBlocks);

    for (const block of allowedBlocks) {
      if (block.type === 'thinking') {
        const thought = parseThought(block.thought);
        yield {
          type: AgentEventType.Thought,
          value: thought,
          traceId,
        };
      }
    }

    const finishReason = chunk.finishReason;
    const providerStopReason = chunk.rawStopReason;
    const text = yield* this.emitTextContent(allowedBlocks, traceId);

    const toolCallBlocks: ToolCallBlock[] = allowedBlocks.filter(
      (block): block is ToolCallBlock => block.type === 'tool_call',
    );

    for (const [functionCallIndex, fnCall] of toolCallBlocks.entries()) {
      const event = this.handlePendingFunctionCall(fnCall, functionCallIndex);
      if (event) {
        yield event;
      }
    }

    if (finishReason !== undefined) {
      yield* this.emitFinishReason({
        finishReason,
        allParts: allowedBlocks,
        functionCalls: toolCallBlocks,
        text,
        usageMetadata: chunk.usage,
        traceId,
        cumulativeOutcome,
        stopReason: providerStopReason,
      });
    } else {
      this.logNoFinishReason(
        allowedBlocks,
        toolCallBlocks,
        text,
        chunk.usage,
        traceId,
      );
    }
  }

  private *emitTextContent(
    blocks: IContent['blocks'],
    traceId: string | undefined,
  ): Generator<ServerAgentStreamEvent, string> {
    const text = blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('');
    if (text !== '') {
      yield { type: AgentEventType.Content, value: text, traceId };

      if (text.trim() !== '') {
        const citationEvent = this.emitCitation(
          'Response may contain information from external sources. Please verify important details independently.',
        );
        if (citationEvent) {
          yield citationEvent;
        }
      }
    }
    return text;
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
      } else if (watchdog.isActive) {
        // The watchdog governs the whole stream: its inter-chunk guard is
        // rearmed by both provider liveness pings and semantic events, so a
        // healthy stream never false-trips regardless of chunk cadence.
        result = await Promise.race([
          streamIterator.next(),
          watchdog.timeoutPromise,
        ]);
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
    const structuredError = buildStructuredError(error);
    yield { type: AgentEventType.Error, value: { error: structuredError } };
  }

  // The run method yields simpler events suitable for server logic
  private createTurnWatchdog(
    timeoutController: AbortController,
    idleFlag: IdleFlag,
  ): TurnWatchdogBundle {
    const idleResolution = resolveStreamIdleTimeoutMsSource(
      this.chat.getConfig(),
    );
    const firstResponseResolution = resolveStreamFirstResponseTimeoutMsSource(
      this.chat.getConfig(),
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
          timeoutSignal,
          watchdog,
          idleFlag,
          onProviderError,
          onStreamLiveness,
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
          timeoutSignal,
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
   * Tears down watchdog, timeout controller, and stream iterator without
   * letting a cleanup failure mask the original stream result. Iterator
   * cleanup rejections are logged as warnings but never rethrown.
   */
  private async cleanupStreamResources(
    watchdog: StreamWatchdog,
    timeoutController: AbortController,
    streamIterator: AsyncIterator<StreamEvent> | undefined,
    timeoutSignal: AbortSignal,
    signal: AbortSignal,
    onParentAbort: () => void,
  ): Promise<void> {
    watchdog.cancel();
    timeoutController.abort();
    try {
      await closeIteratorBounded(streamIterator, timeoutSignal);
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
    signal.removeEventListener('abort', onParentAbort);
  }

  private async acquireFirstStreamEvent(
    req: TurnRequest,
    timeoutSignal: AbortSignal,
    watchdog: StreamWatchdog,
    idleFlag: IdleFlag,
    onProviderError: (error: StructuredError) => void,
    onStreamLiveness: StreamLivenessListener,
  ): Promise<{
    iterator: AsyncIterator<StreamEvent>;
    firstResult: IteratorResult<StreamEvent>;
  }> {
    if (!watchdog.isActive) {
      const iterator = await this.openResponseStreamIterator(
        req,
        timeoutSignal,
        onProviderError,
        onStreamLiveness,
      );
      try {
        const firstResult = await iterator.next();
        return { iterator, firstResult };
      } catch (error) {
        await closeIteratorBounded(iterator, timeoutSignal);
        throw error;
      }
    }

    let acquiredIterator: AsyncIterator<StreamEvent> | undefined;
    const acquisitionPromise = this.openResponseStreamIterator(
      req,
      timeoutSignal,
      onProviderError,
      onStreamLiveness,
    );
    acquisitionPromise
      .then((iterator) => {
        acquiredIterator = iterator;
        return iterator;
      })
      .catch(() => undefined);
    const firstEventPromise = acquisitionPromise.then(async (iterator) => {
      const firstResult = await iterator.next();
      return { iterator, firstResult };
    });
    firstEventPromise.catch(() => {});

    try {
      const result = await Promise.race([
        firstEventPromise,
        watchdog.timeoutPromise,
      ]);
      return result;
    } catch (error) {
      watchdog.cancel();
      const iteratorAtCatch = acquiredIterator;
      await closeIteratorBounded(iteratorAtCatch, timeoutSignal);
      // Close a late-acquired iterator without waiting for its first next().
      acquisitionPromise
        .then((lateIterator) =>
          lateIterator === iteratorAtCatch
            ? undefined
            : closeIteratorBounded(lateIterator, timeoutSignal),
        )
        .catch(() => undefined);
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

  /**
   * Open the provider response stream and return its async iterator. Shared by
   * both the bounded and unbounded first-response paths so the request shape is
   * defined in exactly one place.
   */
  private async openResponseStreamIterator(
    req: TurnRequest,
    timeoutSignal: AbortSignal,
    onProviderError: (error: StructuredError) => void,
    onStreamLiveness?: StreamLivenessListener,
  ): Promise<AsyncIterator<StreamEvent>> {
    // Bridge: chatSession.sendMessageStream still expects Google-shaped
    // SendMessageParameters (until P21). The value is structurally compatible;
    // normalizeToolInteractionInput handles any shape at runtime.
    const responseStream = await this.chat.sendMessageStream(
      {
        message: req as Parameters<
          typeof this.chat.sendMessageStream
        >[0]['message'],
        config: {
          abortSignal: timeoutSignal,
          onProviderError,
          ...(onStreamLiveness !== undefined ? { onStreamLiveness } : {}),
        },
      },
      this.prompt_id,
    );
    return responseStream[Symbol.asyncIterator]();
  }

  private handlePendingFunctionCall(
    fnCall: ToolCallBlock,
    functionCallIndex: number,
  ): ServerAgentStreamEvent | null {
    const callId =
      fnCall.id !== ''
        ? fnCall.id
        : this.createSyntheticFunctionCallId(fnCall, functionCallIndex);

    let name = fnCall.name;
    if (!name || name.trim() === '') {
      name = 'undefined_tool_name';
    } else {
      const normalized = normalizeToolName(name);
      if (normalized) {
        name = normalized;
      } else {
        name = 'undefined_tool_name';
      }
    }

    const params = fnCall.parameters;
    const args: Record<string, unknown> =
      typeof params === 'object' && params !== null
        ? (params as Record<string, unknown>)
        : {};

    const toolCallRequest: ToolCallRequestInfo = {
      callId,
      name: name || 'undefined_tool_name',
      args,
      isClientInitiated: false,
      prompt_id: this.prompt_id,
      agentId: (this.agentId as string | undefined) ?? DEFAULT_AGENT_ID,
    };

    this.pendingToolCalls.push(toolCallRequest);

    return { type: AgentEventType.ToolCallRequest, value: toolCallRequest };
  }

  private createSyntheticFunctionCallId(
    fnCall: ToolCallBlock,
    functionCallIndex: number,
  ): string {
    const payload = safeJsonStringify({
      promptId: this.prompt_id,
      agentId: this.agentId,
      functionCallIndex,
      name: fnCall.name,
      args: fnCall.parameters ?? {},
    });
    const digest = createHash('sha256')
      .update(payload)
      .digest('hex')
      .slice(0, 16);
    const name = normalizeToolName(fnCall.name) ?? 'undefined_tool_name';
    return `${name}-${functionCallIndex}-${digest}`;
  }

  getDebugResponses(): ModelStreamChunk[] {
    return this.debugResponses;
  }
}
