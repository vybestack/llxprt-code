/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  iContentFromAgentMessageInput,
  type AgentMessageInput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  type IterationResult,
  MAX_TURNS,
  type MessageStreamDeps,
  type StreamContext,
} from './MessageStreamOrchestrator.js';
import {
  AgentEventType,
  PerformCompressionResult,
  type ServerAgentStreamEvent,
} from './turn.js';
import {
  buildToolContentRejectionAdvice,
  describeRejectedPayload,
  extractToolNamesFromRequest,
  isToolContentRejection,
  type RejectedPayloadDescription,
} from './toolContentRejection.js';

interface TerminalState {
  hadToolCallsThisTurn: boolean;
  hadThinking: boolean;
  hadContent: boolean;
}

function canRetryFailedStream(state: TerminalState): boolean {
  return !state.hadToolCallsThisTurn && !state.hadContent && !state.hadThinking;
}

function earlyIterResult(
  hadToolCalls: boolean,
  overrides?: Partial<
    Omit<IterationResult, 'earlyReturn' | 'hadToolCallsThisTurn'>
  >,
): IterationResult {
  return {
    earlyReturn: true,
    hadToolCallsThisTurn: hadToolCalls,
    hadThinking: false,
    hadContent: false,
    deferredEvents: [],
    ...overrides,
  };
}

async function fireAfterHook(deps: MessageStreamDeps, ctx: StreamContext) {
  const responseText = ctx.responseChunks.join('');
  return deps.agentHookManager.fireAfterAgentHookSafe(
    ctx.prompt_id,
    ctx.promptText,
    responseText,
    false,
  );
}

async function* fireAfterHookAndEmitClearContext(
  deps: MessageStreamDeps,
  ctx: StreamContext,
): AsyncGenerator<ServerAgentStreamEvent, void> {
  const afterOut = await fireAfterHook(deps, ctx);
  if (afterOut?.shouldClearContext() === true) {
    yield {
      type: AgentEventType.AgentExecutionStopped,
      reason:
        afterOut.getEffectiveReason() || 'Context cleared by AfterAgent hook',
      contextCleared: true,
    };
  }
}

/**
 * Context-size 413 recovery: the pending request carries no oversized
 * tool/media payload, so the rejection came from the accumulated
 * conversation. Compress the history, escalate once to hard context-window
 * enforcement when compression cannot run or did not compress, then retry the
 * ORIGINAL pending request once. The isPayloadRecoveryRetry=true retry flag
 * keeps this bounded (see the repeated-413 guard in handle413Error).
 */
async function* handleContextSize413Error(
  deps: MessageStreamDeps,
  ctx: StreamContext,
  deferredEvents: ServerAgentStreamEvent[],
  state: TerminalState,
  initialRequest: AgentMessageInput,
  signal: AbortSignal,
  boundedTurns: number,
): AsyncGenerator<ServerAgentStreamEvent, IterationResult | undefined> {
  const chat = deps.getChat();
  let compressionSucceeded = false;
  try {
    const result = await chat.performCompression(ctx.prompt_id, {
      trigger: 'auto',
    });
    compressionSucceeded = result === PerformCompressionResult.COMPRESSED;
  } catch (error) {
    // Compression is best-effort recovery: a subsystem failure escalates to
    // enforcement rather than aborting the stream.
    deps.logger.warn(
      () =>
        `[stream:orchestrator] 413 compression attempt failed; escalating to context-window enforcement`,
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  if (!compressionSucceeded) {
    try {
      const pendingTokens = await chat.estimatePendingTokens(
        iContentFromAgentMessageInput(initialRequest),
      );
      await chat.enforceContextWindow(pendingTokens, ctx.prompt_id);
    } catch (error) {
      // Enforcement throwing means the context cannot be reduced locally;
      // end the iteration gracefully instead of crashing the stream.
      deps.logger.warn(
        () =>
          `[stream:orchestrator] 413 context-window enforcement failed; ending iteration without retry`,
        { error: error instanceof Error ? error.message : String(error) },
      );
      for (const d of deferredEvents) yield d;
      await fireAfterHook(deps, ctx);
      return earlyIterResult(state.hadToolCallsThisTurn, {
        ...state,
        deferredEvents,
      });
    }
  }
  deps.logger.warn(
    () =>
      compressionSucceeded
        ? '[stream:orchestrator] retrying original request after 413 context compression'
        : '[stream:orchestrator] retrying original request after 413 context-window enforcement',
    {
      deferredEventCount: deferredEvents.length,
      hadToolCallsThisTurn: state.hadToolCallsThisTurn,
    },
  );
  yield* deps.sendMessageStream(
    initialRequest,
    signal,
    ctx.prompt_id,
    boundedTurns - 1,
    false,
    true,
  );
  await fireAfterHook(deps, ctx);
  return earlyIterResult(state.hadToolCallsThisTurn, {
    ...state,
    deferredEvents,
  });
}

async function* handle413Error(
  deps: MessageStreamDeps,
  ctx: StreamContext,
  deferredEvents: ServerAgentStreamEvent[],
  state: TerminalState,
  initialRequest: AgentMessageInput,
  signal: AbortSignal,
  boundedTurns: number,
): AsyncGenerator<ServerAgentStreamEvent, IterationResult | undefined> {
  if (ctx.isPayloadRecoveryRetry) {
    deps.logger.warn(
      () =>
        `[stream:orchestrator] received repeated 413 after retry; ending iteration`,
      {
        deferredEventCount: deferredEvents.length,
        hadToolCallsThisTurn: state.hadToolCallsThisTurn,
      },
    );
    for (const d of deferredEvents) yield d;
    await fireAfterHook(deps, ctx);
    return earlyIterResult(state.hadToolCallsThisTurn, {
      ...state,
      deferredEvents,
    });
  }

  // Without tool-response/media evidence the 413 reflects the whole context
  // size, not an oversized payload, so compress instead of advising the model.
  const description = describeRejectedPayload(initialRequest);
  if (
    description.toolNames.length === 0 &&
    description.mediaDescriptors.length === 0
  ) {
    return yield* handleContextSize413Error(
      deps,
      ctx,
      deferredEvents,
      state,
      initialRequest,
      signal,
      boundedTurns,
    );
  }

  const toolNames = extractToolNamesFromRequest(initialRequest);
  const toolList =
    toolNames.length > 0
      ? ` The tools involved were: ${toolNames.join(', ')}.`
      : '';
  const message = `System: The previous tool calls produced a response that was too large (HTTP 413).${toolList} Please retry with fewer or more focused queries.`;
  deps.logger.warn(
    () => `[stream:orchestrator] retrying after 413 tool-response overflow`,
    {
      toolNames,
      deferredEventCount: deferredEvents.length,
      hadToolCallsThisTurn: state.hadToolCallsThisTurn,
    },
  );
  yield* deps.sendMessageStream(
    [{ type: 'text', text: message }],
    signal,
    ctx.prompt_id,
    boundedTurns - 1,
    false,
    true,
  );
  await fireAfterHook(deps, ctx);
  return earlyIterResult(state.hadToolCallsThisTurn, {
    ...state,
    deferredEvents,
  });
}

async function* handleToolContentRejection400(
  deps: MessageStreamDeps,
  ctx: StreamContext,
  deferredEvents: ServerAgentStreamEvent[],
  state: TerminalState,
  description: RejectedPayloadDescription,
  providerMessage: string,
  signal: AbortSignal,
  boundedTurns: number,
): AsyncGenerator<ServerAgentStreamEvent, IterationResult | undefined> {
  if (ctx.isPayloadRecoveryRetry) {
    deps.logger.warn(
      () =>
        `[stream:orchestrator] received repeated tool-content 400 after retry; ending iteration`,
      {
        deferredEventCount: deferredEvents.length,
        hadToolCallsThisTurn: state.hadToolCallsThisTurn,
      },
    );
    for (const d of deferredEvents) yield d;
    await fireAfterHook(deps, ctx);
    return earlyIterResult(state.hadToolCallsThisTurn, {
      ...state,
      deferredEvents,
    });
  }

  const advice = buildToolContentRejectionAdvice(description, providerMessage);
  deps.logger.warn(
    () =>
      `[stream:orchestrator] retrying after tool-content rejection (HTTP 400)`,
    {
      toolNames: description.toolNames,
      mediaDescriptors: description.mediaDescriptors,
      deferredEventCount: deferredEvents.length,
      hadToolCallsThisTurn: state.hadToolCallsThisTurn,
    },
  );
  yield* deps.sendMessageStream(
    [{ type: 'text', text: advice }],
    signal,
    ctx.prompt_id,
    boundedTurns - 1,
    false,
    true,
  );
  await fireAfterHook(deps, ctx);
  return earlyIterResult(state.hadToolCallsThisTurn, {
    ...state,
    deferredEvents,
  });
}

/**
 * Narrows the error payload carried by a terminal Error event. The payload
 * originates from provider SDKs, so its shape is genuinely external and is
 * validated structurally rather than trusted. Returns the narrowed value as a
 * plain `object`; each field is read by the accessors below with an `in` plus
 * `typeof` check, so no cast to an index-signature type is needed.
 */
function getErrorPayload(event: ServerAgentStreamEvent): object | undefined {
  if (!('value' in event)) {
    return undefined;
  }
  if (typeof event.value !== 'object' || event.value === null) {
    return undefined;
  }
  if (!('error' in event.value)) {
    return undefined;
  }
  const errorValue = event.value.error;
  if (errorValue == null || typeof errorValue !== 'object') {
    return undefined;
  }
  return errorValue;
}

function getErrorStatus(event: ServerAgentStreamEvent): number | undefined {
  const payload = getErrorPayload(event);
  if (payload === undefined || !('status' in payload)) return undefined;
  const status = payload.status;
  return typeof status === 'number' ? status : undefined;
}

function getErrorMessage(event: ServerAgentStreamEvent): string | undefined {
  const payload = getErrorPayload(event);
  if (payload === undefined || !('message' in payload)) return undefined;
  const message = payload.message;
  return typeof message === 'string' ? message : undefined;
}

async function* handleErrorEvent(
  deps: MessageStreamDeps,
  event: ServerAgentStreamEvent,
  signal: AbortSignal,
  ctx: StreamContext,
  deferredEvents: ServerAgentStreamEvent[],
  state: TerminalState,
  initialRequest: AgentMessageInput,
): AsyncGenerator<ServerAgentStreamEvent, IterationResult | undefined> {
  const errorStatus = getErrorStatus(event);
  const errorMessage = getErrorMessage(event);
  const { config } = deps;
  const boundedTurns = Math.min(ctx.turns, MAX_TURNS);

  deps.logger.debug(() => `[stream:orchestrator] handling error event`, {
    errorStatus,
    continueOnFailedApiCall: config.getContinueOnFailedApiCall(),
    deferredEventCount: deferredEvents.length,
    hadToolCallsThisTurn: state.hadToolCallsThisTurn,
    hadContent: state.hadContent,
    hadThinking: state.hadThinking,
  });

  if (
    errorStatus === 413 &&
    config.getContinueOnFailedApiCall() &&
    canRetryFailedStream(state)
  ) {
    const result = yield* handle413Error(
      deps,
      ctx,
      deferredEvents,
      state,
      initialRequest,
      signal,
      boundedTurns,
    );
    if (result) return result;
  }

  if (
    isToolContentRejection(errorStatus, errorMessage) &&
    config.getContinueOnFailedApiCall() &&
    canRetryFailedStream(state)
  ) {
    // Issue #2722 is about tool-related 400s: recovery also requires that the
    // failing request actually carried tool evidence (a tool_response or a
    // media block), so a 400 caused by user-pasted content is not mistaken for
    // rejected tool content.
    const description = describeRejectedPayload(initialRequest);
    if (
      description.toolNames.length > 0 ||
      description.mediaDescriptors.length > 0
    ) {
      const result = yield* handleToolContentRejection400(
        deps,
        ctx,
        deferredEvents,
        state,
        description,
        errorMessage ?? '',
        signal,
        boundedTurns,
      );
      if (result) return result;
    }
  }

  deps.logger.warn(
    () => `[stream:orchestrator] error event ending iteration without retry`,
    {
      errorStatus,
      deferredEventCount: deferredEvents.length,
      hadToolCallsThisTurn: state.hadToolCallsThisTurn,
      hadContent: state.hadContent,
      hadThinking: state.hadThinking,
    },
  );
  for (const d of deferredEvents) yield d;
  yield* fireAfterHookAndEmitClearContext(deps, ctx);
  return earlyIterResult(state.hadToolCallsThisTurn, {
    ...state,
    deferredEvents,
  });
}

async function* handleInvalidStreamEvent(
  deps: MessageStreamDeps,
  signal: AbortSignal,
  ctx: StreamContext,
  deferredEvents: ServerAgentStreamEvent[],
  state: TerminalState,
): AsyncGenerator<ServerAgentStreamEvent, IterationResult> {
  const { config } = deps;
  const boundedTurns = Math.min(ctx.turns, MAX_TURNS);
  deps.logger.warn(() => `[stream:orchestrator] handling InvalidStream event`, {
    continueOnFailedApiCall: config.getContinueOnFailedApiCall(),
    isInvalidStreamRetry: ctx.isInvalidStreamRetry,
    deferredEventCount: deferredEvents.length,
    hadToolCallsThisTurn: state.hadToolCallsThisTurn,
    hadContent: state.hadContent,
    hadThinking: state.hadThinking,
  });

  if (
    config.getContinueOnFailedApiCall() &&
    !ctx.isInvalidStreamRetry &&
    canRetryFailedStream(state)
  ) {
    yield* deps.sendMessageStream(
      [{ type: 'text', text: 'System: Please continue.' }],
      signal,
      ctx.prompt_id,
      boundedTurns - 1,
      true,
    );
    yield* fireAfterHookAndEmitClearContext(deps, ctx);
    return earlyIterResult(state.hadToolCallsThisTurn, {
      ...state,
      deferredEvents,
    });
  }

  if (!config.getContinueOnFailedApiCall()) {
    for (const d of deferredEvents) yield d;
  }
  yield* fireAfterHookAndEmitClearContext(deps, ctx);
  return earlyIterResult(state.hadToolCallsThisTurn, {
    ...state,
    deferredEvents,
  });
}

export async function* handleTerminalEvent(
  deps: MessageStreamDeps,
  event: ServerAgentStreamEvent,
  signal: AbortSignal,
  ctx: StreamContext,
  deferredEvents: ServerAgentStreamEvent[],
  state: TerminalState,
  initialRequest: AgentMessageInput,
): AsyncGenerator<ServerAgentStreamEvent, IterationResult | undefined> {
  if (event.type === AgentEventType.Error) {
    return yield* handleErrorEvent(
      deps,
      event,
      signal,
      ctx,
      deferredEvents,
      state,
      initialRequest,
    );
  }

  if (event.type === AgentEventType.InvalidStream) {
    return yield* handleInvalidStreamEvent(
      deps,
      signal,
      ctx,
      deferredEvents,
      state,
    );
  }

  return undefined;
}
