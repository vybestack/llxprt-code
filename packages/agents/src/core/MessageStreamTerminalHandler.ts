/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  type IterationResult,
  MAX_TURNS,
  type MessageStreamDeps,
  type StreamContext,
} from './MessageStreamOrchestrator.js';
import { AgentEventType, type ServerAgentStreamEvent } from './turn.js';

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
 * Extracts a tool name from a single request part in neutral or legacy form.
 *
 * Recognizes:
 * - Neutral `tool_response`: `{ type: 'tool_response', toolName }`
 * - Neutral `tool_call`: `{ type: 'tool_call', name }`
 * - Legacy Google `functionResponse`: `{ functionResponse: { name } }`
 *
 * Returns the extracted name, or `undefined` if the part is not a
 * tool-response/tool-call shape.
 */
function extractToolName(part: unknown): string | undefined {
  if (part == null || typeof part !== 'object') return undefined;
  const obj = part as Record<string, unknown>;

  if (obj['type'] === 'tool_response') {
    const toolName = obj['toolName'];
    if (typeof toolName === 'string' && toolName.length > 0) return toolName;
    return undefined;
  }

  if (obj['type'] === 'tool_call') {
    const name = obj['name'];
    if (typeof name === 'string' && name.length > 0) return name;
    return undefined;
  }

  if ('functionResponse' in obj) {
    const funcResp = obj['functionResponse'] as { name?: string } | undefined;
    if (funcResp?.name) return funcResp.name;
  }

  return undefined;
}

function extractToolNamesFromRequest(request: AgentMessageInput): string[] {
  if (!Array.isArray(request)) return [];
  const names = new Set<string>();
  for (const rawPart of request) {
    const name = extractToolName(rawPart);
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names];
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

function getErrorStatus(event: ServerAgentStreamEvent): number | undefined {
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
  event: ServerAgentStreamEvent,
  signal: AbortSignal,
  ctx: StreamContext,
  deferredEvents: ServerAgentStreamEvent[],
  state: TerminalState,
  initialRequest: AgentMessageInput,
): AsyncGenerator<ServerAgentStreamEvent, IterationResult | undefined> {
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

  if (config.getContinueOnFailedApiCall() && !ctx.isInvalidStreamRetry) {
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
