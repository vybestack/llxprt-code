/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P10
 * @requirement:REQ-003
 *
 * Event-characterization harness (T16). Builds authentic AgenticLoopEvent
 * streams that exercise every GeminiEventType variant at its real emission
 * site, then drives the (not-yet-implemented) mapLoopStream adapter via a
 * variable-specifier dynamic import so the spec fails NATURALLY at RED.
 *
 * Deep imports of core/providers/tools types are expected here — this file
 * lives under __tests__/helpers/ which is excluded from the P09 boundary scan.
 */

import { FinishReason, type Part } from '@google/genai';
import {
  GeminiEventType,
  DEFAULT_AGENT_ID,
  type ServerGeminiStreamEvent,
  type ToolCallRequestInfo,
  type ToolCallResponseInfo,
  type ServerToolCallConfirmationDetails,
  type StructuredError,
  type ChatCompressionInfo,
  type ModelInfo,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type { AgenticLoopEvent } from '../../../core/agenticLoop/types.js';
import type { AgentEvent } from '../../event-types.js';
// Static-import adapter drivers live in a dedicated helper so this harness
// stays under the max-lines budget; re-exported below for spec ergonomics.
import {
  runAdapterStatic,
  driveSingleStreamEvent,
} from './eventAdapterStatic.js';
import type { ThoughtSummary } from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
import type {
  ToolCall,
  CompletedToolCall,
} from '@vybestack/llxprt-code-core/scheduler/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

// ─── Adapter driver (variable-specifier dynamic import → natural RED) ───────

const ADAPTER_MODULE = '../../eventAdapter.js';

/**
 * Drives mapLoopStream via a variable-specifier dynamic import so TS cannot
 * statically resolve the module. At RED the import rejects (module missing);
 * at GREEN (P14) it resolves and drains to an AgentEvent[].
 */
export async function runAdapter(
  loopEvents: readonly AgenticLoopEvent[],
): Promise<AgentEvent[]> {
  const mod: Record<string, unknown> = await import(ADAPTER_MODULE);
  const fn = mod['mapLoopStream'];
  if (typeof fn !== 'function') {
    throw new Error('mapLoopStream not available');
  }
  const mapLoopStream = fn as (
    events: AsyncIterable<AgenticLoopEvent>,
  ) => AsyncIterable<AgentEvent>;
  const out: AgentEvent[] = [];
  for await (const pub of mapLoopStream(asyncIterOf(loopEvents))) {
    out.push(pub);
  }
  return out;
}

/** Wraps a readonly array as a one-shot async iterable. */
async function* asyncIterOf<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

// Re-export the static-import adapter drivers so specs can keep importing
// them from this harness (the definitions live in eventAdapterStatic.ts to
// keep this file under the max-lines budget).
export { runAdapterStatic, driveSingleStreamEvent };

// ─── ServerGeminiStreamEvent builders (REAL GeminiEventType + value shapes) ─

export function streamContent(text: string): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Content, value: text };
}

export function streamThought(
  thought: ThoughtSummary,
): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Thought, value: thought };
}

export function streamCitation(citation: string): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Citation, value: citation };
}

export function streamUsage(usage: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
}): ServerGeminiStreamEvent {
  return { type: GeminiEventType.UsageMetadata, value: usage };
}

export function streamModelInfo(info: ModelInfo): ServerGeminiStreamEvent {
  return { type: GeminiEventType.ModelInfo, value: info };
}

export function streamNotice(message: string): ServerGeminiStreamEvent {
  return { type: GeminiEventType.SystemNotice, value: message };
}

export function streamCompressed(
  info: ChatCompressionInfo | null,
): ServerGeminiStreamEvent {
  return { type: GeminiEventType.ChatCompressed, value: info };
}

export function streamRetry(): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Retry };
}

export function streamInvalid(): ServerGeminiStreamEvent {
  return { type: GeminiEventType.InvalidStream };
}

export function streamIdleTimeout(
  error: StructuredError,
): ServerGeminiStreamEvent {
  return {
    type: GeminiEventType.StreamIdleTimeout,
    value: { error },
  };
}

export function streamError(error: StructuredError): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Error, value: { error } };
}

export function streamLoopDetected(): ServerGeminiStreamEvent {
  return { type: GeminiEventType.LoopDetected };
}

export function streamContextOverflow(
  estimatedRequestTokenCount: number,
  remainingTokenCount: number,
): ServerGeminiStreamEvent {
  return {
    type: GeminiEventType.ContextWindowWillOverflow,
    value: { estimatedRequestTokenCount, remainingTokenCount },
  };
}

export function streamMaxTurns(): ServerGeminiStreamEvent {
  return { type: GeminiEventType.MaxSessionTurns };
}

export function streamFinished(
  reason: FinishReason = FinishReason.STOP,
): ServerGeminiStreamEvent {
  return { type: GeminiEventType.Finished, value: { reason } };
}

export function streamUserCancelled(): ServerGeminiStreamEvent {
  return { type: GeminiEventType.UserCancelled };
}

export function streamToolCallRequest(
  callId: string,
  name: string,
  args: Record<string, unknown> = {},
): ServerGeminiStreamEvent {
  const value: ToolCallRequestInfo = {
    callId,
    name,
    args,
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  return { type: GeminiEventType.ToolCallRequest, value };
}

export function streamToolCallResponse(
  callId: string,
  responseParts: Part[],
  overrides: Partial<ToolCallResponseInfo> = {},
): ServerGeminiStreamEvent {
  const value: ToolCallResponseInfo = {
    callId,
    responseParts,
    resultDisplay: undefined,
    error: undefined,
    errorType: undefined,
    ...overrides,
  };
  return { type: GeminiEventType.ToolCallResponse, value };
}

export function streamToolCallConfirmation(
  request: ToolCallRequestInfo,
  details: ServerToolCallConfirmationDetails['details'],
): ServerGeminiStreamEvent {
  const value: ServerToolCallConfirmationDetails = { request, details };
  return { type: GeminiEventType.ToolCallConfirmation, value };
}

/**
 * Builds a minimal ToolExecuteConfirmationDetails for raw a2a stream
 * ToolCallConfirmation events. The adapter projects these to
 * tool-confirmation without needing onConfirm to fire.
 */
export function buildExecuteConfirmationDetails(
  title: string,
  command: string,
): ServerToolCallConfirmationDetails['details'] {
  return {
    type: 'exec',
    title,
    command,
    rootCommand: command,
    rootCommands: [command],
    onConfirm: async () => {},
  } as ServerToolCallConfirmationDetails['details'];
}

/** AgentExecutionStopped — FLAT fields, no .value wrapper (turn.ts:274-279). */
export function streamStopped(
  reason: string,
  systemMessage?: string,
  contextCleared: boolean | undefined = undefined,
): ServerGeminiStreamEvent {
  const e: ServerGeminiStreamEvent = {
    type: GeminiEventType.AgentExecutionStopped,
    reason,
  };
  if (systemMessage !== undefined) {
    (e as { systemMessage?: string }).systemMessage = systemMessage;
  }
  if (contextCleared !== undefined) {
    (e as { contextCleared?: boolean }).contextCleared = contextCleared;
  }
  return e;
}

/** AgentExecutionBlocked — FLAT fields, no .value wrapper (turn.ts:281-286). */
export function streamBlocked(
  reason: string,
  systemMessage?: string,
  contextCleared: boolean | undefined = undefined,
): ServerGeminiStreamEvent {
  const e: ServerGeminiStreamEvent = {
    type: GeminiEventType.AgentExecutionBlocked,
    reason,
  };
  if (systemMessage !== undefined) {
    (e as { systemMessage?: string }).systemMessage = systemMessage;
  }
  if (contextCleared !== undefined) {
    (e as { contextCleared?: boolean }).contextCleared = contextCleared;
  }
  return e;
}

// ─── AgenticLoopEvent wrappers ──────────────────────────────────────────────

export function wrapStream(e: ServerGeminiStreamEvent): AgenticLoopEvent {
  return { kind: 'stream', event: e };
}

/** Builds a sequence of stream-wrapped loop events. */
export function loopStream(
  ...events: readonly ServerGeminiStreamEvent[]
): AgenticLoopEvent[] {
  return events.map((e) => wrapStream(e));
}

// ─── Type-narrowing helpers (no casts in assertions) ────────────────────────

export function isDoneEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'done' }> {
  return e.type === 'done';
}

export function isTextEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'text' }> {
  return e.type === 'text';
}

export function isThinkingEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'thinking' }> {
  return e.type === 'thinking';
}

export function isToolCallEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'tool-call' }> {
  return e.type === 'tool-call';
}

export function isToolResultEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'tool-result' }> {
  return e.type === 'tool-result';
}

export function isToolConfirmationEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'tool-confirmation' }> {
  return e.type === 'tool-confirmation';
}

export function isToolStatusEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'tool-status' }> {
  return e.type === 'tool-status';
}

export function isUsageEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'usage' }> {
  return e.type === 'usage';
}

export function isModelInfoEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'model-info' }> {
  return e.type === 'model-info';
}

export function isNoticeEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'notice' }> {
  return e.type === 'notice';
}

export function isCompressionEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'compression' }> {
  return e.type === 'compression';
}

export function isContextWarningEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'context-warning' }> {
  return e.type === 'context-warning';
}

export function isRetryEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'retry' }> {
  return e.type === 'retry';
}

export function isCitationEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'citation' }> {
  return e.type === 'citation';
}

export function isLoopDetectedEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'loop-detected' }> {
  return e.type === 'loop-detected';
}

export function isIdleTimeoutEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'idle-timeout' }> {
  return e.type === 'idle-timeout';
}

export function isInvalidStreamEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'invalid-stream' }> {
  return e.type === 'invalid-stream';
}

export function isHookBlockedEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'hook-blocked' }> {
  return e.type === 'hook-blocked';
}

export function isErrorEvent(
  e: AgentEvent,
): e is Extract<AgentEvent, { type: 'error' }> {
  return e.type === 'error';
}

// ─── Loop-native event builders (tool_update / tool_output / tools_complete /
//     awaiting_approval) ─────────────────────────────────────────────────────

/**
 * Builds a tools_complete AgenticLoopEvent from a minimal SuccessfulToolCall.
 * Used to drive the scheduler-continuation projection for tool-result.
 */
export function loopToolsComplete(
  callId: string,
  name: string,
  output: string,
): AgenticLoopEvent {
  const completed = buildSuccessfulToolCall(callId, name, output);
  return { kind: 'tools_complete', completed: [completed] };
}

/** Builds an awaiting_approval AgenticLoopEvent with a WaitingToolCall. */
export function loopAwaitingApproval(
  callId: string,
  name: string,
): AgenticLoopEvent {
  const toolCall = buildWaitingToolCall(callId, name);
  return { kind: 'awaiting_approval', toolCalls: [toolCall] };
}

/** Builds a tool_update AgenticLoopEvent with a tool at the given status. */
export function loopToolUpdate(
  callId: string,
  name: string,
  status: ToolCall['status'],
): AgenticLoopEvent {
  return {
    kind: 'tool_update',
    toolCalls: [buildToolCallByStatus(callId, name, status)],
  };
}

/** Builds a tool_output AgenticLoopEvent (incremental output chunk). */
export function loopToolOutput(
  callId: string,
  chunk: string,
): AgenticLoopEvent {
  return { kind: 'tool_output', callId, chunk };
}

// ─── Targeted projection builders (tool-result isError / liveOutput / agentId /
//     confirmation correlationId) ──────────────────────────────────────────

/**
 * Builds a tools_complete with an ERRORED CompletedToolCall (status==='error').
 * Projects to a tool-result whose isError is true.
 */
export function loopToolsCompleteError(
  callId: string,
  name: string,
): AgenticLoopEvent {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  const completed = {
    status: 'error',
    request,
    tool: undefined as never,
    invocation: undefined as never,
    response: {
      callId,
      responseParts: [{ text: 'boom' }] as Part[],
      resultDisplay: undefined,
      error: new Error('boom'),
      errorType: undefined,
    },
  } as unknown as CompletedToolCall;
  return { kind: 'tools_complete', completed: [completed] };
}

/**
 * Builds a tools_complete with a CANCELLED CompletedToolCall. When `userCancel`
 * is true the outcome is Cancel (projects to isError true); otherwise the
 * outcome is a non-Cancel value (projects to isError false).
 */
export function loopToolsCompleteCancelled(
  callId: string,
  name: string,
  userCancel: boolean,
): AgenticLoopEvent {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  const completed = {
    status: 'cancelled',
    outcome: userCancel
      ? ToolConfirmationOutcome.Cancel
      : ToolConfirmationOutcome.ProceedOnce,
    request,
    tool: undefined as never,
    invocation: undefined as never,
    response: {
      callId,
      responseParts: [{ text: 'cancelled' }] as Part[],
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
    },
  } as unknown as CompletedToolCall;
  return { kind: 'tools_complete', completed: [completed] };
}

/**
 * Builds an executing tool_update carrying liveOutput. Projects to a
 * tool-status whose `output` echoes the liveOutput value.
 */
export function loopToolUpdateLiveOutput(
  callId: string,
  name: string,
  liveOutput: string,
): AgenticLoopEvent {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  const toolCall = {
    status: 'executing',
    request,
    tool: undefined as never,
    invocation: undefined as never,
    liveOutput,
  } as unknown as ToolCall;
  return { kind: 'tool_update', toolCalls: [toolCall] };
}

/**
 * Builds an EXECUTING tool_update that carries NO liveOutput property at all
 * (the key is absent, not merely undefined). The adapter's readLiveOutput
 * `'liveOutput' in tc` guard must therefore omit the output field — this
 * distinguishes the executing-status conjunct from the property-presence
 * conjunct.
 */
export function loopToolUpdateExecutingNoLiveOutput(
  callId: string,
  name: string,
): AgenticLoopEvent {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  const toolCall = {
    status: 'executing',
    request,
    tool: undefined as never,
    invocation: undefined as never,
  } as unknown as ToolCall;
  return { kind: 'tool_update', toolCalls: [toolCall] };
}

/**
 * Builds a SCHEDULED (non-executing) tool_update that nonetheless carries a
 * liveOutput property. The adapter must NOT surface output because the status
 * is not 'executing' — this distinguishes the status conjunct from the
 * property-presence conjunct in readLiveOutput.
 */
export function loopToolUpdateScheduledWithLiveOutput(
  callId: string,
  name: string,
  liveOutput: string,
): AgenticLoopEvent {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  const toolCall = {
    status: 'scheduled',
    request,
    tool: undefined as never,
    invocation: undefined as never,
    liveOutput,
  } as unknown as ToolCall;
  return { kind: 'tool_update', toolCalls: [toolCall] };
}

/**
 * Builds a scheduled tool_update whose request carries NO agentId. Projects to
 * a tool-status with no agentId field.
 */
export function loopToolUpdateNoAgentId(
  callId: string,
  name: string,
): AgenticLoopEvent {
  const request = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
  } as unknown as ToolCallRequestInfo;
  const toolCall = {
    status: 'scheduled',
    request,
    tool: undefined as never,
    invocation: undefined as never,
  } as unknown as ToolCall;
  return { kind: 'tool_update', toolCalls: [toolCall] };
}

/**
 * Builds an awaiting_approval loop event whose WaitingToolCall carries a
 * correlationId distinct from its callId. Projects to a tool-confirmation
 * whose confirmationId equals the correlationId (not the callId).
 */
export function loopAwaitingApprovalCorrelated(
  callId: string,
  name: string,
  correlationId: string,
): AgenticLoopEvent {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  const toolCall = {
    status: 'awaiting_approval',
    correlationId,
    request,
    tool: undefined as never,
    invocation: undefined as never,
    confirmationDetails: {
      kind: 'execute',
      title: name,
      onConfirm: async () => {},
      onReject: async () => {},
    },
  } as unknown as ToolCall;
  return { kind: 'awaiting_approval', toolCalls: [toolCall] };
}

/**
 * Builds an awaiting_approval loop event containing a NON-awaiting tool call
 * (status executing) alongside one genuinely-awaiting call. The adapter must
 * skip the non-awaiting entry and project only the awaiting one.
 */
export function loopAwaitingApprovalMixed(
  awaitingCallId: string,
  skippedCallId: string,
  name: string,
): AgenticLoopEvent {
  const mk = (id: string): ToolCallRequestInfo => ({
    callId: id,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: id,
    agentId: DEFAULT_AGENT_ID,
  });
  const skipped = {
    status: 'executing',
    request: mk(skippedCallId),
    tool: undefined as never,
    invocation: undefined as never,
  } as unknown as ToolCall;
  const awaiting = {
    status: 'awaiting_approval',
    request: mk(awaitingCallId),
    tool: undefined as never,
    invocation: undefined as never,
    confirmationDetails: {
      kind: 'execute',
      title: name,
      onConfirm: async () => {},
      onReject: async () => {},
    },
  } as unknown as ToolCall;
  return { kind: 'awaiting_approval', toolCalls: [skipped, awaiting] };
}

/**
 * Builds a raw a2a ToolCallConfirmation whose details carry a correlationId.
 * Projects to a tool-confirmation whose confirmationId equals that
 * correlationId rather than the request callId.
 */
export function streamToolCallConfirmationCorrelated(
  callId: string,
  name: string,
  correlationId: string,
): ServerGeminiStreamEvent {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  const details = {
    type: 'exec',
    title: name,
    command: name,
    rootCommand: name,
    rootCommands: [name],
    correlationId,
    onConfirm: async () => {},
  } as unknown as ServerToolCallConfirmationDetails['details'];
  const value: ServerToolCallConfirmationDetails = { request, details };
  return { type: GeminiEventType.ToolCallConfirmation, value };
}

// ─── ToolCall / CompletedToolCall construction helpers ──────────────────────
// These mirror the real scheduler output shapes. They use the narrowest valid
// object for each status; only the fields the adapter projection reads are
// populated with meaningful values.

function buildSuccessfulToolCall(
  callId: string,
  name: string,
  output: string,
): CompletedToolCall {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  return {
    status: 'success',
    request,
    tool: undefined as never,
    invocation: undefined as never,
    response: {
      callId,
      responseParts: [{ text: output }] as Part[],
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
    },
  } as unknown as CompletedToolCall;
}

function buildWaitingToolCall(callId: string, name: string): ToolCall {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  return {
    status: 'awaiting_approval',
    request,
    tool: undefined as never,
    invocation: undefined as never,
    confirmationDetails: {
      kind: 'execute',
      title: name,
      onConfirm: async () => {},
      onReject: async () => {},
    },
  } as unknown as ToolCall;
}

function buildToolCallByStatus(
  callId: string,
  name: string,
  status: ToolCall['status'],
): ToolCall {
  const request: ToolCallRequestInfo = {
    callId,
    name,
    args: {},
    isClientInitiated: false,
    prompt_id: callId,
    agentId: DEFAULT_AGENT_ID,
  };
  const base = { request };
  if (status === 'success') {
    return {
      ...base,
      status: 'success',
      tool: undefined as never,
      invocation: undefined as never,
      response: {
        callId,
        responseParts: [{ text: 'ok' }] as Part[],
        resultDisplay: undefined,
        error: undefined,
        errorType: undefined,
      },
    } as unknown as ToolCall;
  }
  if (status === 'awaiting_approval') {
    return buildWaitingToolCall(callId, name);
  }
  return {
    ...base,
    status,
    tool: undefined as never,
    invocation: undefined as never,
  } as unknown as ToolCall;
}

// ─── Real-loop driver re-exports ────────────────────────────────────────────
// The real AgenticLoop drivers live in realLoopHarness.ts to keep this file
// under the max-lines budget; re-exported here so specs keep a single import.
export {
  fakeProviderContentLoopEvents,
  runRealLoopExecuteTool,
  runRealLoopAbort,
} from './realLoopHarness.js';
