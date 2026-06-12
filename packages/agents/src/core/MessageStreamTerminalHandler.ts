/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type PartListUnion } from '@google/genai';
import {
  type IterationResult,
  MAX_TURNS,
  type MessageStreamDeps,
  type StreamContext,
} from './MessageStreamOrchestrator.js';
import { GeminiEventType, type ServerGeminiStreamEvent } from './turn.js';

interface TerminalState {
  hadToolCallsThisTurn: boolean;
  todoPauseSeen: boolean;
  hadThinking: boolean;
  hadContent: boolean;
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
    todoPauseSeen: false,
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
): AsyncGenerator<ServerGeminiStreamEvent, void> {
  const afterOut = await fireAfterHook(deps, ctx);
  if (afterOut?.shouldClearContext() === true) {
    yield {
      type: GeminiEventType.AgentExecutionStopped,
      reason:
        afterOut.getEffectiveReason() || 'Context cleared by AfterAgent hook',
      contextCleared: true,
    };
  }
}

function extractToolNamesFromRequest(request: PartListUnion): string[] {
  if (!Array.isArray(request)) return [];
  const names = new Set<string>();
  for (const part of request) {
    if (
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider stream and tool-call runtime payloads may include null entries.
      part != null &&
      typeof part === 'object' &&
      'functionResponse' in part
    ) {
      const funcResp = (part as { functionResponse: { name?: string } })
        .functionResponse;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider stream and tool-call runtime payloads.
      if (funcResp?.name) {
        names.add(funcResp.name);
      }
    }
  }
  return [...names];
}

async function* handle413Error(
  deps: MessageStreamDeps,
  ctx: StreamContext,
  deferredEvents: ServerGeminiStreamEvent[],
  state: TerminalState,
  initialRequest: PartListUnion,
  signal: AbortSignal,
  boundedTurns: number,
): AsyncGenerator<ServerGeminiStreamEvent, IterationResult | undefined> {
  if (ctx.is413Retry) {
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
    [{ text: message }],
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

function getErrorStatus(event: ServerGeminiStreamEvent): number | undefined {
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
  return (errorValue as { status?: number }).status;
}

async function* handleErrorEvent(
  deps: MessageStreamDeps,
  event: ServerGeminiStreamEvent,
  signal: AbortSignal,
  ctx: StreamContext,
  deferredEvents: ServerGeminiStreamEvent[],
  state: TerminalState,
  initialRequest: PartListUnion,
): AsyncGenerator<ServerGeminiStreamEvent, IterationResult | undefined> {
  const errorStatus = getErrorStatus(event);
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

  if (errorStatus === 413 && config.getContinueOnFailedApiCall()) {
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
  deferredEvents: ServerGeminiStreamEvent[],
  state: TerminalState,
): AsyncGenerator<ServerGeminiStreamEvent, IterationResult> {
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

  if (config.getContinueOnFailedApiCall() && !ctx.isInvalidStreamRetry) {
    yield* deps.sendMessageStream(
      [{ text: 'System: Please continue.' }],
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
  event: ServerGeminiStreamEvent,
  signal: AbortSignal,
  ctx: StreamContext,
  deferredEvents: ServerGeminiStreamEvent[],
  state: TerminalState,
  initialRequest: PartListUnion,
): AsyncGenerator<ServerGeminiStreamEvent, IterationResult | undefined> {
  if (event.type === GeminiEventType.Error) {
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

  if (event.type === GeminiEventType.InvalidStream) {
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
