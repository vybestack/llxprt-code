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
  AgentEventType,
  type ServerAgentStreamEvent,
  type ServerUsageMetadataEvent,
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
  type ServerToolCallConfirmationDetails,
  type StructuredError,
  type ModelInfo,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ThoughtSummary } from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
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
  UsageMetadataValue,
  ChatCompressionInfo as CompressionInfo,
} from './event-types.js';

/**
 * Mutable per-stream adapter state.
 *
 * No field records "a done was already emitted" because no per-event branch
 * emits one. Every terminal signal is accumulated here and the single public
 * `done` is synthesized once, at loop end. See {@link mapLoopStream}.
 *
 * @pseudocode event-adapter.md steps 10-12: mutable per-stream adapter state.
 */
interface AdapterState {
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
      ...(x.response.resultDisplay !== undefined
        ? { display: x.response.resultDisplay }
        : {}),
      ...(x.response.suppressDisplay === true ? { suppressDisplay: true } : {}),
      ...(x.response.errorType !== undefined
        ? { errorType: x.response.errorType }
        : {}),
    };
  }
  return {
    id: x.callId,
    name: '',
    output: x.responseParts,
    isError: x.error !== undefined,
    ...(x.resultDisplay !== undefined ? { display: x.resultDisplay } : {}),
    ...(x.suppressDisplay === true ? { suppressDisplay: true } : {}),
    ...(x.errorType !== undefined ? { errorType: x.errorType } : {}),
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
  ServerAgentStreamEvent,
  {
    type:
      | AgentEventType.AgentExecutionStopped
      | AgentEventType.AgentExecutionBlocked;
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
 * Maps neutral UsageStats to the Gemini-named public UsageMetadataValue.
 *
 * The internal Finished event carries a neutral UsageStats (promptTokens,
 * completionTokens, totalTokens). The public wire type
 * (UsageMetadataValue) stays Gemini-named (promptTokenCount, etc.) for
 * backward compatibility. This mapper is the sole bridge.
 *
 * Per OQ-14 PUBLIC-out-of-scope: reasoning / thinking token counts are
 * NOT emitted to the public wire.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P19
 * @requirement:REQ-007.2
 */
function usageStatsToPublicUsageMetadata(
  usage: UsageStats | undefined,
): UsageMetadataValue | undefined {
  if (usage === undefined) {
    return undefined;
  }
  return {
    promptTokenCount: usage.promptTokens,
    candidatesTokenCount: usage.completionTokens,
    totalTokenCount: usage.totalTokens,
    ...(usage.cachedTokens !== undefined
      ? { cachedContentTokenCount: usage.cachedTokens }
      : {}),
  };
}

/**
 * Maps the internal ServerUsageMetadataEvent value (neutral
 * inputTokenCount/outputTokenCount vocabulary, #2627) to the Gemini-named
 * public UsageMetadataValue wire type.
 *
 * The public wire type stays Gemini-named (promptTokenCount, etc.) for
 * backward compatibility; this explicit mapping — not a cast — is the
 * bridge, so the renamed internal fields can never silently leak onto the
 * wire as zeroed Gemini-named counts.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P19
 * @requirement:REQ-007.2
 */
function internalUsageToPublic(value: unknown): UsageMetadataValue {
  const usage = value as ServerUsageMetadataEvent['value'];
  return {
    ...(usage.inputTokenCount !== undefined
      ? { promptTokenCount: usage.inputTokenCount }
      : {}),
    ...(usage.outputTokenCount !== undefined
      ? { candidatesTokenCount: usage.outputTokenCount }
      : {}),
    ...(usage.totalTokenCount !== undefined
      ? { totalTokenCount: usage.totalTokenCount }
      : {}),
    ...(usage.cachedTokenCount !== undefined
      ? { cachedContentTokenCount: usage.cachedTokenCount }
      : {}),
  };
}

/**
 * Maps a Finished value to the public DoneReason. A Finished event represents
 * normal completion; other terminal causes arrive via their own variants. When
 * the raw provider stop reason is `'refusal'` (the model's safety classifier
 * declined the request, e.g. Anthropic Claude Fable 5), the done carries
 * `reason: 'refusal'` so consumers can surface a refusal-specific notice;
 * otherwise the done is a normal `'stop'`.
 * @pseudocode event-adapter.md step 244: mapFinishReason
 * @issue:2329
 */
function mapFinishReason(stopReason: string | undefined): DoneReason {
  return stopReason === 'refusal' ? 'refusal' : 'stop';
}

/**
 * Builds the single terminal done event from the accumulated adapter state.
 * Called exactly once, from {@link mapLoopStream}'s loop-end synthesis.
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
  e: Extract<ServerAgentStreamEvent, { value: unknown }>,
  state: AdapterState,
): Iterable<AgentEvent> {
  yield* mapValueEventInner(e, e.value, state);
}

function* mapValueEventInner(
  e: Extract<ServerAgentStreamEvent, { value: unknown }>,
  value: unknown,
  state: AdapterState,
): Iterable<AgentEvent> {
  switch (e.type) {
    case AgentEventType.Content:
      yield { type: 'text', text: value as string };
      return;
    case AgentEventType.Thought:
      yield { type: 'thinking', thought: value as ThoughtSummary };
      return;
    case AgentEventType.ToolCallRequest:
      yield {
        type: 'tool-call',
        call: projectToolCall(value as ToolCallRequestInfo),
      };
      return;
    case AgentEventType.ToolCallResponse:
      yield {
        type: 'tool-result',
        result: projectToolResult(
          value as ToolCallResponseInfo | CompletedToolCall,
        ),
      };
      return;
    case AgentEventType.ToolCallConfirmation:
      yield {
        type: 'tool-confirmation',
        confirmation: projectConfirmationFromDetails(
          value as ServerToolCallConfirmationDetails,
        ),
      };
      return;
    case AgentEventType.UsageMetadata:
      yield { type: 'usage', usage: internalUsageToPublic(value) };
      return;
    case AgentEventType.ModelInfo:
      yield { type: 'model-info', info: value as ModelInfo };
      return;
    case AgentEventType.SystemNotice:
      yield { type: 'notice', message: value as string };
      return;
    case AgentEventType.ChatCompressed:
      yield { type: 'compression', info: value as CompressionInfo };
      return;
    case AgentEventType.Citation:
      yield { type: 'citation', citation: value as string };
      return;
    default:
      yield* mapValueEventComplex(e, value, state);
  }
}

function* mapValueEventComplex(
  e: Extract<ServerAgentStreamEvent, { value: unknown }>,
  value: unknown,
  state: AdapterState,
): Iterable<AgentEvent> {
  switch (e.type) {
    case AgentEventType.StreamIdleTimeout: {
      const error: StructuredError = (value as { error: StructuredError })
        .error;
      yield { type: 'idle-timeout', error };
      state.pendingDoneReason = 'error';
      return;
    }
    case AgentEventType.Error: {
      const error: StructuredError = (value as { error: StructuredError })
        .error;
      yield { type: 'error', error };
      state.pendingDoneReason = 'error';
      return;
    }
    case AgentEventType.ContextWindowWillOverflow: {
      const v = value as {
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
    // Finished means "this MODEL ITERATION ended", not "the agentic turn
    // ended": turn.ts emits it for every provider chunk carrying a
    // finishReason, tool-call turns included, and
    // MessageStreamOrchestrator flushes it BEFORE AgenticLoop schedules the
    // turn's tools. Projecting it straight to a public `done` therefore
    // published a terminal event mid-turn and once per iteration (@issue:3087).
    // It only records the finished payload now; the terminal done is
    // synthesized at loop end.
    case AgentEventType.Finished: {
      const v = value as {
        reason: string;
        stopReason?: string;
        usageMetadata?: UsageStats;
      };
      // A tool turn spans several model iterations and a provider only reports
      // usage on the iterations whose terminal chunk carries it. The single
      // terminal done must still surface the turn's most recent usage: while
      // one done per iteration was emitted, consumers kept the last DEFINED
      // usageMetadata (see drainToResult in agentBootstrap.ts), so letting a
      // usage-less final iteration blank it would silently drop token
      // accounting.
      const publicUsage =
        usageStatsToPublicUsageMetadata(v.usageMetadata) ??
        state.lastFinished?.usageMetadata;
      state.lastFinished = {
        reason: v.reason,
        ...(publicUsage !== undefined ? { usageMetadata: publicUsage } : {}),
        ...(v.stopReason !== undefined ? { stopReason: v.stopReason } : {}),
      };
      return;
    }
    default:
      return;
  }
}

/**
 * The 21-variant stream-event mapping table. Returns the public events
 * emitted for a single inner ServerAgentStreamEvent and mutates `state`
 * for terminal tracking (pendingDoneReason / lastFinished / lastStop).
 * It NEVER yields a `done`: terminal variants only record their reason so
 * {@link mapLoopStream} can emit the single terminal event at loop end.
 * @pseudocode event-adapter.md steps 210-246: mapStreamEvent
 */
function* mapStreamEvent(
  e: ServerAgentStreamEvent,
  state: AdapterState,
): Iterable<AgentEvent> {
  // @pseudocode event-adapter.md step 222: Retry
  if (e.type === AgentEventType.Retry) {
    yield { type: 'retry' };
    return;
  }
  // @pseudocode event-adapter.md step 223: InvalidStream
  if (e.type === AgentEventType.InvalidStream) {
    yield { type: 'invalid-stream' };
    return;
  }
  // @pseudocode event-adapter.md steps 229-230: LoopDetected
  if (e.type === AgentEventType.LoopDetected) {
    yield { type: 'loop-detected' };
    state.pendingDoneReason = 'loop-detected';
    return;
  }
  // @pseudocode event-adapter.md step 231: MaxSessionTurns
  if (e.type === AgentEventType.MaxSessionTurns) {
    state.pendingDoneReason = 'max-turns';
    return;
  }
  // @pseudocode event-adapter.md steps 238-239: UserCancelled
  if (e.type === AgentEventType.UserCancelled) {
    state.pendingDoneReason = 'aborted';
    return;
  }
  // @pseudocode event-adapter.md step 240: AgentExecutionBlocked (NON-terminal)
  if (e.type === AgentEventType.AgentExecutionBlocked) {
    yield { type: 'hook-blocked', info: toStopInfo(e) };
    return;
  }
  // @pseudocode event-adapter.md steps 241-242: AgentExecutionStopped
  // The AfterAgent hook can raise this from the same end-of-iteration flush
  // that carries Finished, i.e. still before AgenticLoop schedules the
  // turn's tools, so it records the stop and defers the done to loop end
  // exactly like Finished does (@issue:3087).
  if (e.type === AgentEventType.AgentExecutionStopped) {
    state.lastStop = toStopInfo(e);
    state.pendingDoneReason = 'hook-stopped';
    return;
  }
  // All value-bearing variants share the value discriminator.
  yield* mapValueEvent(e, state);
}

/**
 * Drives an AgenticLoopEvent stream, projecting each to public AgentEvent(s).
 *
 * Contract: AT MOST ONE `done` is emitted, and when it is emitted it is the
 * FINAL public event of the stream. No terminal reason is projected where it
 * arrives — the inner stream's terminal variants (Finished, UserCancelled,
 * AgentExecutionStopped, Error, LoopDetected, MaxSessionTurns,
 * ContextWindowWillOverflow, StreamIdleTimeout) only record their reason and
 * payload in the adapter state. The loop stream ending is the sole honest
 * signal that the agentic turn is over, because a model iteration that
 * requested tools finishes — and flushes its Finished event — before those
 * tools are scheduled (@issue:3087).
 *
 * No `done` is emitted when the stream carried no activity at all, i.e. an
 * empty stream or one consisting solely of a non-terminal
 * AgentExecutionBlocked.
 *
 * NOTE ON THE `@pseudocode` ANCHORS in this file: they point at
 * project-plans/issue1594/analysis/pseudocode/event-adapter.md, which predates
 * @issue:3087 and still describes an `emittedDone` flag plus immediate `done`
 * projection from Finished / UserCancelled / AgentExecutionStopped. Those
 * emission steps are SUPERSEDED by the single loop-end synthesis below; the
 * anchors are retained only as a map of the projection table.
 *
 * @pseudocode event-adapter.md steps 10-205: mapLoopStream
 */
export async function* mapLoopStream(
  loopEvents: AsyncIterable<AgenticLoopEvent>,
): AsyncIterable<AgentEvent> {
  // @pseudocode event-adapter.md steps 11-12: initialize state
  const state: AdapterState = {
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
      ev.event.type === AgentEventType.AgentExecutionBlocked;
    if (!isStandaloneBlocked) {
      state.sawActivity = true;
    }
    yield* mapLoopEvent(ev, state);
  }

  // @pseudocode event-adapter.md steps 200-205: loop-end done synthesis —
  // the single emission point for the public terminal event.
  if (state.sawActivity || state.pendingDoneReason !== null) {
    // An explicit terminal reason takes precedence over the Finished-derived
    // one, because Finished only reports how a MODEL ITERATION ended while
    // error / overflow / max-turns / loop-detected / aborted / hook-stopped
    // report how the TURN ended. There is no priority ordering AMONG those
    // explicit reasons: each branch assigns pendingDoneReason outright, so the
    // last one recorded is the one reported.
    //
    // With no explicit reason the reason is derived from the stored Finished
    // value, so a preserved refusal stopReason is honored on the
    // synthesized-completion path (@issue:2329).
    const reason: DoneReason =
      state.pendingDoneReason ??
      mapFinishReason(state.lastFinished?.stopReason);
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
    case 'stream':
      yield* mapStreamEvent(ev.event, state);
      return;
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
