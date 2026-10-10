/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type JsonOutput,
  JsonStreamEventType,
  type StreamJsonFormatter,
  type EmojiFilter,
  FatalTurnLimitedError,
} from '@vybestack/llxprt-code-core';
import {
  type SessionMetrics,
  debugLogger,
} from '@vybestack/llxprt-code-telemetry';
import type {
  AgentEvent,
  AgentToolResult,
  StructuredError,
} from '@vybestack/llxprt-code-agents';
import { MAX_TURNS_MESSAGE } from './utils/errors.js';
import { markMachineErrorReported } from './session/machineErrorReporting.js';
import { REFUSAL_NOTICE_MESSAGE } from './utils/refusalNotice.js';
import { AttemptSeparator } from './nonInteractiveAttemptSeparator.js';

/** The slice of Config the printer reads, so callers need no full Config. */
export type StreamConsumerConfig = Pick<
  Config,
  'getSessionId' | 'getEphemeralSetting'
>;

type StreamConsumerContext = {
  config: StreamConsumerConfig;
  jsonOutput: boolean;
  streamJsonOutput: boolean;
  quiet: boolean;
  streamFormatter: StreamJsonFormatter | null;
  emojiFilter: EmojiFilter | undefined;
  createProfileNameWriter: () => () => void;
};

function formatThoughtText(thought: {
  subject?: string;
  description?: string;
}): string {
  if (thought.subject && thought.description) {
    return `${thought.subject}: ${thought.description}`;
  }
  return thought.subject ?? thought.description ?? '';
}

function emitStreamError(
  formatter: StreamJsonFormatter | null,
  severity: 'warning' | 'error',
  message: string,
  structured?: Pick<StructuredError, 'status' | 'category' | 'reason'>,
): void {
  formatter?.emitEvent({
    type: JsonStreamEventType.ERROR,
    timestamp: new Date().toISOString(),
    severity,
    message,
    ...(structured?.status !== undefined ? { status: structured.status } : {}),
    ...(structured?.category !== undefined
      ? { category: structured.category }
      : {}),
    ...(structured?.reason !== undefined ? { reason: structured.reason } : {}),
  });
}

type ThoughtBufferEntry = {
  streamId?: string;
  text: string;
};

type ThoughtBuffer = ThoughtBufferEntry[];

/**
 * Whether assistant text is accumulated in a buffer that a later discard can
 * empty (quiet and plain-JSON output). Plain text and stream-JSON output are
 * already out the moment they are written.
 */
function buffersAssistantText(context: StreamConsumerContext): boolean {
  return (
    context.quiet || (context.jsonOutput && context.streamFormatter === null)
  );
}

/**
 * Shows already filtered assistant text the way the output mode displays it.
 * `shown` is passed through the separator first, so attempt breaks and
 * held-back trailing newlines follow what is actually displayed.
 */
function publishAssistantText(
  shown: string,
  context: StreamConsumerContext,
  state: StreamState,
  writeEmpty: boolean,
): void {
  const displayed = state.separator.display(shown);
  if (context.quiet) {
    state.quietTextBuffer += displayed;
    return;
  }
  if (context.streamFormatter) {
    if (displayed !== '') {
      context.streamFormatter.emitEvent({
        type: JsonStreamEventType.MESSAGE,
        timestamp: new Date().toISOString(),
        role: 'assistant',
        content: displayed,
        delta: true,
      });
    }
    return;
  }
  if (context.jsonOutput) {
    state.responseText += displayed;
    return;
  }
  if (writeEmpty || displayed !== '') {
    process.stdout.write(displayed);
  }
}

/**
 * Displays whatever the emoji filter still holds, in stream order. Called
 * before output that must not overtake earlier text (a thought block, an
 * attempt boundary) and when the stream ends.
 */
function flushEmojiBuffer(
  context: StreamConsumerContext,
  state: StreamState,
): void {
  const remainingBuffered = context.emojiFilter?.flushBuffer();
  if (remainingBuffered) {
    publishAssistantText(remainingBuffered, context, state, false);
  }
}

function flushThoughtBuffer(
  state: StreamState,
  context: StreamConsumerContext,
  includeThinking: boolean,
): void {
  const thoughtText = state.thoughtBuffer
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join(' ');
  state.thoughtBuffer = [];
  if (!includeThinking || !thoughtText) {
    return;
  }
  flushEmojiBuffer(context, state);
  process.stdout.write(
    state.separator.display(`<think>${thoughtText}</think>\n`),
  );
}

function handleThinking(
  thought: {
    subject?: string;
    description?: string;
    streamId?: string;
  },
  context: StreamConsumerContext,
  writeProfileName: () => void,
  thoughtBuffer: ThoughtBuffer,
  includeThinking: boolean,
): ThoughtBuffer {
  if (!includeThinking) {
    return thoughtBuffer;
  }
  writeProfileName();
  let thoughtText = formatThoughtText(thought);
  if (!thoughtText.trim()) {
    return thoughtBuffer;
  }
  if (context.emojiFilter) {
    const filterResult = context.emojiFilter.filterText(thoughtText);
    if (filterResult.blocked) {
      return thoughtBuffer;
    }
    if (typeof filterResult.filtered === 'string') {
      thoughtText = filterResult.filtered;
    }
  }
  if (!thoughtText.trim()) {
    return thoughtBuffer;
  }
  if (thought.streamId === undefined) {
    return [...thoughtBuffer, { text: thoughtText }];
  }
  const existingIndex = thoughtBuffer.findIndex(
    (entry) => entry.streamId === thought.streamId,
  );
  if (existingIndex < 0) {
    return [
      ...thoughtBuffer,
      { streamId: thought.streamId, text: thoughtText },
    ];
  }
  return thoughtBuffer.map((entry, index) =>
    index === existingIndex ? { ...entry, text: thoughtText } : entry,
  );
}

function handleText(
  text: string,
  context: StreamConsumerContext,
  writeProfileName: () => void,
  state: StreamState,
): void {
  writeProfileName();
  let shown = text;
  if (context.emojiFilter) {
    const filterResult = context.emojiFilter.filterStreamChunk(text);
    if (filterResult.blocked) {
      if (context.quiet) {
        state.quietBlocked = true;
      } else if (!context.jsonOutput) {
        process.stderr.write(
          '[Error: Response blocked due to emoji detection]\n',
        );
      }
      return;
    }
    shown =
      typeof filterResult.filtered === 'string' ? filterResult.filtered : '';
    if (filterResult.systemFeedback && !context.jsonOutput && !context.quiet) {
      process.stderr.write(`Warning: ${filterResult.systemFeedback}\n`);
    }
  }
  publishAssistantText(shown, context, state, true);
}

function emitToolUse(
  call: { id: string; name: string; args: Readonly<Record<string, unknown>> },
  formatter: StreamJsonFormatter | null,
): void {
  formatter?.emitEvent({
    type: JsonStreamEventType.TOOL_USE,
    timestamp: new Date().toISOString(),
    tool_name: call.name,
    tool_id: call.id,
    parameters: { ...call.args },
  });
}

function emitToolResult(
  result: AgentToolResult,
  formatter: StreamJsonFormatter | null,
): void {
  const output =
    typeof result.display === 'string' ? result.display : undefined;
  const error =
    result.isError === true
      ? {
          type: result.errorType ?? 'TOOL_EXECUTION_ERROR',
          message:
            typeof result.display === 'string'
              ? result.display
              : `${result.name} failed`,
        }
      : undefined;
  formatter?.emitEvent({
    type: JsonStreamEventType.TOOL_RESULT,
    timestamp: new Date().toISOString(),
    tool_id: result.id,
    status: result.isError === true ? 'error' : 'success',
    output,
    error,
  });
}

function shouldDisplayToolResult(
  result: AgentToolResult,
  context: StreamConsumerContext,
): boolean {
  if (context.jsonOutput || context.streamJsonOutput) {
    return false;
  }
  if (result.suppressDisplay === true) {
    return false;
  }
  return typeof result.display === 'string' && result.display.length > 0;
}

function displayToolResult(
  result: AgentToolResult,
  context: StreamConsumerContext,
  separator: AttemptSeparator,
): void {
  if (result.isError === true) {
    if (!context.jsonOutput && !context.streamJsonOutput) {
      const display = result.display;
      const msg =
        typeof display === 'string' && display.length > 0
          ? display
          : `${result.name} failed`;
      debugLogger.error(`Error executing tool ${result.name}: ${msg}`);
    }
    return;
  }
  if (shouldDisplayToolResult(result, context)) {
    process.stdout.write(separator.display(`${result.display}\n`));
  }
}

function emitFinalResult(
  context: StreamConsumerContext,
  responseText: string,
  startTime: number,
  metrics: SessionMetrics,
  finishReason?: 'refusal',
): void {
  if (context.streamFormatter) {
    if (context.quiet) {
      context.streamFormatter.emitEvent({
        type: JsonStreamEventType.MESSAGE,
        timestamp: new Date().toISOString(),
        role: 'assistant',
        content: responseText,
      });
    }
    context.streamFormatter.emitEvent({
      type: JsonStreamEventType.RESULT,
      timestamp: new Date().toISOString(),
      status: 'success',
      stats: context.streamFormatter.convertToStreamStats(
        metrics,
        Date.now() - startTime,
      ),
    });
  } else if (context.jsonOutput) {
    const payload: JsonOutput = {
      session_id: context.config.getSessionId(),
      response: responseText.trimEnd(),
      stats: metrics,
    };
    if (finishReason !== undefined) {
      payload.finish_reason = finishReason;
    }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${responseText}\n`);
  }
}

/**
 * Rebuilds an Error from a public StructuredError so the caller's catch
 * (parseAndFormatApiError) receives an Error instance, matching the legacy
 * AgentEventType.Error throw path. The optional HTTP status is preserved as a
 * property without a type assertion.
 */
function reconstructError(structured: StructuredError): Error {
  const err: Error & {
    status?: number;
    category?: StructuredError['category'];
    reason?: StructuredError['reason'];
  } = new Error(structured.message);
  if (structured.status !== undefined) {
    err.status = structured.status;
  }
  if (structured.category !== undefined) {
    err.category = structured.category;
  }
  if (structured.reason !== undefined) {
    err.reason = structured.reason;
  }
  return err;
}

function throwStructuredStreamError(
  structured: StructuredError,
  formatter: StreamJsonFormatter | null,
  message = structured.message,
): never {
  emitStreamError(formatter, 'error', message, structured);
  const error = reconstructError(structured);
  if (formatter !== null) {
    markMachineErrorReported(error);
  }
  throw error;
}

function handleDone(
  event: Extract<AgentEvent, { type: 'done' }>,
  context: StreamConsumerContext,
  responseText: string,
  startTime: number,
  getMetrics: () => SessionMetrics,
): void {
  switch (event.reason) {
    case 'stop':
    case 'loop-detected':
    case 'context-overflow':
      emitFinalResult(context, responseText, startTime, getMetrics());
      return;
    case 'refusal': {
      // @issue:2329 — surface the safety-classifier refusal as a user-visible
      // warning while still emitting the final result so stdout/json output
      // is preserved. DoneReason is authoritative here, so the shared notice
      // constant is used directly. Plain-JSON consumers get a finish_reason
      // field; stream-json already carried the warning event below.
      //
      // The unstructured stderr warning is emitted only in pure text mode
      // (no streamFormatter and no jsonOutput). In stream-json mode the
      // structured warning event carries the signal; in plain-JSON mode the
      // finish_reason field carries it.
      //
      // In quiet mode all warning emissions are suppressed (issue #728).
      if (
        !context.quiet &&
        !context.jsonOutput &&
        context.streamFormatter === null
      ) {
        process.stderr.write(`WARNING: ${REFUSAL_NOTICE_MESSAGE}\n`);
      }
      if (!context.quiet) {
        emitStreamError(
          context.streamFormatter,
          'warning',
          REFUSAL_NOTICE_MESSAGE,
        );
      }
      emitFinalResult(
        context,
        responseText,
        startTime,
        getMetrics(),
        'refusal',
      );
      return;
    }
    case 'hook-stopped': {
      if (!context.quiet) {
        const stop = event.stop;
        const stopMessage = `Agent execution stopped: ${
          stop?.systemMessage?.trim() ?? stop?.reason ?? ''
        }`;
        process.stderr.write(`${stopMessage}\n`);
      }
      return;
    }
    case 'aborted':
      if (!context.quiet) {
        debugLogger.error('Operation cancelled.');
      }
      return;
    case 'max-turns':
      throw new FatalTurnLimitedError(MAX_TURNS_MESSAGE);
    case 'error':
      // processAgentStream normally throws the preceding 'error' AgentEvent
      // (carrying the StructuredError) before this terminal done arrives.
      // Reaching here means done{reason:'error'} had no error event.
      throw new Error(
        'Agent execution failed with no structured error details provided.',
      );
    default:
      return;
  }
}

function finalizeStream(
  state: StreamState,
  context: StreamConsumerContext,
  includeThinking: boolean,
  startTime: number,
  getMetrics: () => SessionMetrics,
): void {
  flushThoughtBuffer(state, context, includeThinking);
  flushEmojiBuffer(context, state);
  let finalText = state.responseText;
  if (context.quiet) {
    finalText = state.quietBlocked ? '' : state.quietTextBuffer;
  }
  if (state.pendingDone !== null) {
    handleDone(state.pendingDone, context, finalText, startTime, getMetrics);
  } else {
    emitFinalResult(context, finalText, startTime, getMetrics());
  }
}

interface StreamState {
  thoughtBuffer: ThoughtBuffer;
  responseText: string;
  quietTextBuffer: string;
  /** The emoji filter blocked quiet output (error mode); the response is empty. */
  quietBlocked: boolean;
  pendingDone: Extract<AgentEvent, { type: 'done' }> | null;
  separator: AttemptSeparator;
}

function handleQuietEvent(
  event: AgentEvent,
  state: StreamState,
  context: StreamConsumerContext,
  writeProfileName: () => void,
): boolean {
  switch (event.type) {
    case 'text':
      // Buffer text instead of writing immediately; only the final turn's
      // text (after the last tool call) is emitted at stream completion.
      handleText(event.text, context, writeProfileName, state);
      return true;
    case 'attempt-boundary':
      flushEmojiBuffer(context, state);
      state.separator.markBoundary();
      return true;
    case 'tool-call':
      // Discard intermediate talk before tool calls so only the final
      // response remains in the buffer (issue #728). What the emoji filter
      // still holds belongs to that discarded talk.
      context.emojiFilter?.flushBuffer();
      state.quietTextBuffer = '';
      state.quietBlocked = false;
      state.separator.reset();
      return true;
    case 'tool-result':
      // Suppress all tool result display in quiet mode.
      state.separator.endCall();
      return true;
    case 'loop-detected':
      // Suppress non-essential stream warnings/errors in quiet mode.
      return true;
    case 'hook-blocked':
      // Suppress hook-blocked stderr messages in quiet mode.
      return true;
    default:
      return false;
  }
}

/**
 * Discards every per-attempt accumulator that the abandoned attempt populated
 * (REQ-3048-010). The emoji filter's held partial chunk belongs to that
 * attempt, so it is drained via flushBuffer() and the returned fragment is
 * thrown away. pendingDone is intentionally untouched — a retry precedes the
 * replacement attempt, and clearing it would mask an ordering bug.
 * Already-written stdout / stream-json deltas are unretractable (spec §8) and
 * are not compensated.
 */
function discardAbandonedAttempt(
  state: StreamState,
  context: StreamConsumerContext,
): void {
  context.emojiFilter?.flushBuffer();
  state.responseText = '';
  state.quietTextBuffer = '';
  state.quietBlocked = false;
  state.thoughtBuffer = [];
  // Quiet and plain-JSON output keep the text in a buffer that was just
  // emptied; stdout and stream-JSON deltas are already out and stay.
  if (buffersAssistantText(context)) {
    state.separator.reset();
  }
}

function writeHookBlockedWarning(info: {
  reason: string;
  systemMessage?: string;
}): void {
  const blockMessage = `Agent execution blocked: ${
    info.systemMessage?.trim() ?? info.reason
  }`;
  process.stderr.write(`[WARNING] ${blockMessage}\n`);
}

function dispatchAgentEvent(
  event: AgentEvent,
  state: StreamState,
  context: StreamConsumerContext,
  writeProfileName: () => void,
  includeThinking: boolean,
): void {
  if (
    context.quiet &&
    handleQuietEvent(event, state, context, writeProfileName)
  ) {
    return;
  }
  switch (event.type) {
    case 'thinking':
      state.thoughtBuffer = handleThinking(
        event.thought,
        context,
        writeProfileName,
        state.thoughtBuffer,
        includeThinking,
      );
      return;
    case 'text':
      flushThoughtBuffer(state, context, includeThinking);
      handleText(event.text, context, writeProfileName, state);
      return;
    case 'attempt-boundary':
      // The earlier attempt's buffered thinking is displayed first, so each
      // attempt's <think> block stays in order and apart from the next one.
      flushThoughtBuffer(state, context, includeThinking);
      flushEmojiBuffer(context, state);
      state.separator.markBoundary();
      return;
    case 'tool-call':
      flushThoughtBuffer(state, context, includeThinking);
      // Discard intermediate talk emitted before a tool call so only the
      // final iteration's answer remains in responseText — the JSON-mode
      // counterpart of quiet mode's quietTextBuffer discard (issue #728).
      // Without this, models that state the answer before calling tools
      // yield a duplicated response (issue #3226).
      state.responseText = '';
      emitToolUse(event.call, context.streamFormatter);
      return;
    case 'tool-result':
      flushThoughtBuffer(state, context, includeThinking);
      emitToolResult(event.result, context.streamFormatter);
      displayToolResult(event.result, context, state.separator);
      state.separator.endCall();
      return;
    case 'loop-detected':
      emitStreamError(
        context.streamFormatter,
        'warning',
        'Loop detected, stopping execution',
      );
      return;
    case 'hook-blocked':
      writeHookBlockedWarning(event.info);
      return;
    case 'idle-timeout':
      if (context.quiet) throw reconstructError(event.error);
      return throwStructuredStreamError(
        event.error,
        context.streamFormatter,
        'Stream idle timeout: no response received within the allowed time.',
      );
    case 'error':
      return throwStructuredStreamError(event.error, context.streamFormatter);
    case 'done':
      state.pendingDone = event;
      return;
    case 'retry':
      discardAbandonedAttempt(state, context);
      return;
    default:
      return;
  }
}

/**
 * Consumes a public {@link AgentEvent} stream produced by `agent.stream()` and
 * maps each event onto the existing non-interactive output helpers (stdout
 * write, JSON accumulation, stream-JSON emission), preserving the user-visible
 * output, exit-code, and stderr behavior of the legacy manual turn loop.
 *
 * The loop emits a single terminal `done` as its LAST event (issue #3087).
 * This consumer still records it and acts on it only at stream exhaustion:
 * returning early on `done` would abandon the generator instead of letting it
 * complete.
 */
export async function processAgentStream(
  events: AsyncIterable<AgentEvent>,
  context: StreamConsumerContext,
  startTime: number,
  getMetrics: () => SessionMetrics,
): Promise<void> {
  const writeProfileName = context.quiet
    ? (): void => {}
    : context.createProfileNameWriter();
  const includeThinking =
    !context.quiet &&
    !context.jsonOutput &&
    !context.streamJsonOutput &&
    context.config.getEphemeralSetting('reasoning.includeInResponse') !== false;
  const state: StreamState = {
    thoughtBuffer: [],
    responseText: '',
    quietTextBuffer: '',
    pendingDone: null,
    quietBlocked: false,
    separator: new AttemptSeparator(
      context.quiet ||
        (!context.jsonOutput && context.streamFormatter === null),
    ),
  };
  for await (const event of events) {
    dispatchAgentEvent(
      event,
      state,
      context,
      writeProfileName,
      includeThinking,
    );
  }
  finalizeStream(state, context, includeThinking, startTime, getMetrics);
}
