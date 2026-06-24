/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @plan:PLAN-20260617-COREAPI.P14
 * @requirement:REQ-003
 */

import {
  GeminiEventType,
  type ServerGeminiStreamEvent,
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
  type ServerToolCallConfirmationDetails,
  type StructuredError,
} from '@vybestack/llxprt-code-core/core/turn.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import type {
  ToolCall,
  CompletedToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import type { AgenticLoopEvent } from '../core/agenticLoop/types.js';
import type {
  AgentEvent,
  AgentToolCall,
  AgentToolResult,
  ToolUpdate,
  ToolConfirmation,
  AgentStopInfo,
  DoneReason,
  FinishedValue,
} from './event-types.js';

// @pseudocode event-adapter.md steps 10-12: mutable per-stream adapter state.
interface AdapterState {
  emittedDone: boolean;
  lastFinished: FinishedValue | null;
  lastStop: AgentStopInfo | null;
  pendingDoneReason: DoneReason | null;
  sawActivity: boolean;
}

/**
 * Discriminates a CompletedToolCall from a raw ToolCallResponseInfo. A
 * CompletedToolCall always carries `request` (the originating ToolCallRequest).
 */
function isCompletedToolCall(
  x: ToolCallResponseInfo | CompletedToolCall,
): x is CompletedToolCall {
  return 'request' in x;
}

/**
 * Projects a single scheduler ToolCallRequestInfo to the public AgentToolCall.
 * @pseudocode event-adapter.md Dependencies: projectToolCall
 */
function projectToolCall(v: ToolCallRequestInfo): AgentToolCall {
  return { id: v.callId, name: v.name, args: v.args };
}

/**
 * Projects a tool response to the public AgentToolResult. Handles both the
 * raw a2a stream ToolCallResponseInfo (correlated by callId, no name) and the
 * loop tools_complete CompletedToolCall (request carries the name).
 * @pseudocode event-adapter.md Dependencies: projectToolResult
 */
function projectToolResult(
  x: ToolCallResponseInfo | CompletedToolCall,
): AgentToolResult {
  // @pseudocode event-adapter.md Dependencies: discriminate CompletedToolCall
  if (isCompletedToolCall(x)) {
    return {
      id: x.request.callId,
      name: x.request.name,
      output: x.response.responseParts,
      isError:
        x.status === 'error' ||
        (x.status === 'cancelled' &&
          x.outcome === ToolConfirmationOutcome.Cancel),
    };
  }
  return {
    id: x.callId,
    name: '',
    output: x.responseParts,
    isError: x.error !== undefined,
  };
}

/**
 * Maps a scheduler tool status to the public ToolUpdateStatus.
 * `awaiting_approval` becomes the hyphenated `awaiting-approval`; all other
 * statuses pass through identically.
 * @pseudocode event-adapter.md Dependencies: projectToolUpdate
 */
function mapStatus(status: ToolCall['status']): ToolUpdate['status'] {
  if (status === 'awaiting_approval') {
    return 'awaiting-approval';
  }
  return status;
}

/**
 * Reads the liveOutput off an executing ToolCall without a type assertion.
 */
function readLiveOutput(tc: ToolCall): unknown {
  return tc.status === 'executing' &&
    'liveOutput' in tc &&
    tc.liveOutput !== undefined
    ? tc.liveOutput
    : undefined;
}

/**
 * Projects a loop tool_update ToolCall to the public ToolUpdate, surfacing
 * liveOutput when an executing tool carries it.
 * @pseudocode event-adapter.md Dependencies: projectToolUpdate
 */
function projectToolUpdate(tc: ToolCall): ToolUpdate {
  const liveOutput = readLiveOutput(tc);
  return {
    id: tc.request.callId,
    name: tc.request.name,
    status: mapStatus(tc.status),
    ...(liveOutput !== undefined ? { output: liveOutput } : {}),
    ...(tc.request.agentId !== undefined
      ? { agentId: tc.request.agentId }
      : {}),
  };
}

/**
 * Projects an incremental tool_output chunk (callId + chunk only) to a
 * ToolUpdate with the executing status and no name.
 * @pseudocode event-adapter.md Dependencies: projectToolOutput
 */
function projectToolOutput(callId: string, chunk: string): ToolUpdate {
  return { id: callId, name: '', status: 'executing', output: chunk };
}

/**
 * Projects confirmation details from a loop awaiting_approval ToolCall.
 * @pseudocode event-adapter.md Dependencies: projectConfirmation (loop ToolCall)
 */
function projectConfirmationFromToolCall(
  tc: Extract<ToolCall, { status: 'awaiting_approval' }>,
): ToolConfirmation {
  return {
    confirmationId: tc.correlationId ?? tc.request.callId,
    toolCallId: tc.request.callId,
    name: tc.request.name,
    details: tc.confirmationDetails,
  };
}

/**
 * Projects confirmation details from a raw a2a stream
 * ServerToolCallConfirmationDetails.
 * @pseudocode event-adapter.md Dependencies: projectConfirmation (raw a2a path)
 */
function projectConfirmationFromDetails(
  raw: ServerToolCallConfirmationDetails,
): ToolConfirmation {
  const details = raw.details as unknown as { correlationId?: string };
  return {
    confirmationId: details.correlationId ?? raw.request.callId,
    toolCallId: raw.request.callId,
    name: raw.request.name,
    details: raw.details,
  };
}

type StopEvent = Extract<
  ServerGeminiStreamEvent,
  {
    type:
      | GeminiEventType.AgentExecutionStopped
      | GeminiEventType.AgentExecutionBlocked;
  }
>;

/**
 * Reads the FLAT reason/systemMessage/contextCleared fields off the
 * AgentExecutionStopped/Blocked events (these variants carry NO .value).
 * @pseudocode event-adapter.md Notes for impl phase: toStopInfo contract
 */
function toStopInfo(e: StopEvent): AgentStopInfo {
  return {
    reason: e.reason,
    ...(e.systemMessage !== undefined
      ? { systemMessage: e.systemMessage }
      : {}),
    ...(e.contextCleared !== undefined
      ? { contextCleared: e.contextCleared }
      : {}),
  };
}

/**
 * Maps a Finished reason to the public DoneReason. A Finished event represents
 * normal completion; other terminal causes arrive via their own variants.
 * @pseudocode event-adapter.md step 244: mapFinishReason
 */
function mapFinishReason(_reason: string): DoneReason {
  return 'stop';
}

/**
 * Builds the terminal done event from the current adapter state.
 * @pseudocode event-adapter.md steps 250-252: makeDone
 */
function makeDone(state: AdapterState, reason: DoneReason): AgentEvent {
  return {
    type: 'done',
    reason,
    ...(state.lastFinished !== null ? { finished: state.lastFinished } : {}),
    ...(state.lastStop !== null ? { stop: state.lastStop } : {}),
  };
}

/** Yields the informational events for value-bearing stream variants. */
function* mapValueEvent(
  e: Extract<ServerGeminiStreamEvent, { value: unknown }>,
  state: AdapterState,
): Iterable<AgentEvent> {
  switch (e.type) {
    // @pseudocode event-adapter.md step 212: Content
    case GeminiEventType.Content:
      yield { type: 'text', text: e.value };
      return;
    // @pseudocode event-adapter.md step 213: Thought
    case GeminiEventType.Thought:
      yield { type: 'thinking', thought: e.value };
      return;
    // @pseudocode event-adapter.md step 214: ToolCallRequest
    case GeminiEventType.ToolCallRequest:
      yield { type: 'tool-call', call: projectToolCall(e.value) };
      return;
    // @pseudocode event-adapter.md step 215: ToolCallResponse
    case GeminiEventType.ToolCallResponse:
      yield { type: 'tool-result', result: projectToolResult(e.value) };
      return;
    // @pseudocode event-adapter.md step 216: ToolCallConfirmation
    case GeminiEventType.ToolCallConfirmation:
      yield {
        type: 'tool-confirmation',
        confirmation: projectConfirmationFromDetails(e.value),
      };
      return;
    // @pseudocode event-adapter.md step 217: UsageMetadata
    case GeminiEventType.UsageMetadata:
      yield { type: 'usage', usage: e.value };
      return;
    // @pseudocode event-adapter.md step 218: ModelInfo
    case GeminiEventType.ModelInfo:
      yield { type: 'model-info', info: e.value };
      return;
    // @pseudocode event-adapter.md step 219: SystemNotice
    case GeminiEventType.SystemNotice:
      yield { type: 'notice', message: e.value };
      return;
    // @pseudocode event-adapter.md step 220: ChatCompressed
    case GeminiEventType.ChatCompressed:
      yield { type: 'compression', info: e.value };
      return;
    // @pseudocode event-adapter.md step 221: Citation
    case GeminiEventType.Citation:
      yield { type: 'citation', citation: e.value };
      return;
    // @pseudocode event-adapter.md steps 232-233: StreamIdleTimeout
    case GeminiEventType.StreamIdleTimeout: {
      const error: StructuredError = (e.value as { error: StructuredError })
        .error;
      yield { type: 'idle-timeout', error };
      state.pendingDoneReason = 'error';
      return;
    }
    // @pseudocode event-adapter.md steps 236-237: Error
    case GeminiEventType.Error: {
      const error: StructuredError = (e.value as { error: StructuredError })
        .error;
      yield { type: 'error', error };
      state.pendingDoneReason = 'error';
      return;
    }
    // @pseudocode event-adapter.md steps 224-228: ContextWindowWillOverflow
    case GeminiEventType.ContextWindowWillOverflow: {
      const v = e.value as {
        estimatedRequestTokenCount: number;
        remainingTokenCount: number;
      };
      yield {
        type: 'context-warning',
        estimatedRequestTokenCount: v.estimatedRequestTokenCount,
        remainingTokenCount: v.remainingTokenCount,
      };
      state.pendingDoneReason = 'context-overflow';
      return;
    }
    // @pseudocode event-adapter.md steps 243-244: Finished
    case GeminiEventType.Finished: {
      const v = e.value as { reason: string };
      state.lastFinished = v;
      yield makeDone(state, mapFinishReason(v.reason));
      state.emittedDone = true;
      return;
    }
    default:
      return;
  }
}

/**
 * The 21-variant stream-event mapping table. Returns the public events
 * emitted for a single inner ServerGeminiStreamEvent and mutates `state`
 * for terminal tracking (emittedDone / pendingDoneReason / lastFinished /
 * lastStop).
 * @pseudocode event-adapter.md steps 210-246: mapStreamEvent
 */
function* mapStreamEvent(
  e: ServerGeminiStreamEvent,
  state: AdapterState,
): Iterable<AgentEvent> {
  // @pseudocode event-adapter.md step 222: Retry
  if (e.type === GeminiEventType.Retry) {
    yield { type: 'retry' };
    return;
  }
  // @pseudocode event-adapter.md step 223: InvalidStream
  if (e.type === GeminiEventType.InvalidStream) {
    yield { type: 'invalid-stream' };
    return;
  }
  // @pseudocode event-adapter.md steps 229-230: LoopDetected
  if (e.type === GeminiEventType.LoopDetected) {
    yield { type: 'loop-detected' };
    state.pendingDoneReason = 'loop-detected';
    return;
  }
  // @pseudocode event-adapter.md step 231: MaxSessionTurns
  if (e.type === GeminiEventType.MaxSessionTurns) {
    state.pendingDoneReason = 'max-turns';
    return;
  }
  // @pseudocode event-adapter.md steps 238-239: UserCancelled
  if (e.type === GeminiEventType.UserCancelled) {
    yield makeDone(state, 'aborted');
    state.emittedDone = true;
    return;
  }
  // @pseudocode event-adapter.md step 240: AgentExecutionBlocked (NON-terminal)
  if (e.type === GeminiEventType.AgentExecutionBlocked) {
    yield { type: 'hook-blocked', info: toStopInfo(e) };
    return;
  }
  // @pseudocode event-adapter.md steps 241-242: AgentExecutionStopped
  if (e.type === GeminiEventType.AgentExecutionStopped) {
    state.lastStop = toStopInfo(e);
    yield makeDone(state, 'hook-stopped');
    state.emittedDone = true;
    return;
  }
  // All value-bearing variants share the value discriminator.
  yield* mapValueEvent(e, state);
}

/**
 * Drives an AgenticLoopEvent stream, projecting each to public AgentEvent(s)
 * and guaranteeing exactly one terminal `done` at loop end (unless the stream
 * consisted solely of a non-terminal AgentExecutionBlocked).
 * @pseudocode event-adapter.md steps 10-205: mapLoopStream
 */
export async function* mapLoopStream(
  loopEvents: AsyncIterable<AgenticLoopEvent>,
): AsyncIterable<AgentEvent> {
  // @pseudocode event-adapter.md steps 11-12: initialize state
  const state: AdapterState = {
    emittedDone: false,
    lastFinished: null,
    lastStop: null,
    pendingDoneReason: null,
    sawActivity: false,
  };

  // @pseudocode event-adapter.md steps 30-50: consume loop events
  for await (const ev of loopEvents) {
    // @pseudocode event-adapter.md steps 30a-30g: sawActivity gate
    const isStandaloneBlocked =
      ev.kind === 'stream' &&
      ev.event.type === GeminiEventType.AgentExecutionBlocked;
    if (!isStandaloneBlocked) {
      state.sawActivity = true;
    }
    yield* mapLoopEvent(ev, state);
  }

  // @pseudocode event-adapter.md steps 200-205: loop-end done synthesis
  if (
    !state.emittedDone &&
    (state.sawActivity || state.pendingDoneReason !== null)
  ) {
    const reason: DoneReason = state.pendingDoneReason ?? 'stop';
    yield makeDone(state, reason);
  }
}

/** Projects a single AgenticLoopEvent to public AgentEvent(s). */
function* mapLoopEvent(
  ev: AgenticLoopEvent,
  state: AdapterState,
): Iterable<AgentEvent> {
  switch (ev.kind) {
    // @pseudocode event-adapter.md steps 32-36: stream
    case 'stream': {
      for (const pub of mapStreamEvent(ev.event, state)) {
        if (pub.type === 'done') {
          state.emittedDone = true;
        }
        yield pub;
      }
      return;
    }
    // @pseudocode event-adapter.md steps 37-39: tool_update
    case 'tool_update': {
      for (const tc of ev.toolCalls) {
        yield { type: 'tool-status', update: projectToolUpdate(tc) };
      }
      return;
    }
    // @pseudocode event-adapter.md steps 40-42: tool_output
    case 'tool_output': {
      yield {
        type: 'tool-status',
        update: projectToolOutput(ev.callId, ev.chunk),
      };
      return;
    }
    // @pseudocode event-adapter.md steps 43-45: tools_complete
    case 'tools_complete': {
      for (const ct of ev.completed) {
        yield { type: 'tool-result', result: projectToolResult(ct) };
      }
      return;
    }
    // @pseudocode event-adapter.md steps 46-48: awaiting_approval
    case 'awaiting_approval': {
      for (const tc of ev.toolCalls) {
        if (tc.status !== 'awaiting_approval') {
          continue;
        }
        yield {
          type: 'tool-confirmation',
          confirmation: projectConfirmationFromToolCall(tc),
        };
      }
      return;
    }
    default:
      return;
  }
}

export { mapStreamEvent };
