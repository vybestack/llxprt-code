/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  JsonStreamEventType,
  type StreamJsonFormatter,
  type EmojiFilter,
  type SessionMetrics,
  FatalTurnLimitedError,
  debugLogger,
} from '@vybestack/llxprt-code-core';
import type {
  AgentEvent,
  AgentToolResult,
  StructuredError,
} from '@vybestack/llxprt-code-agents';
import { MAX_TURNS_MESSAGE } from './utils/errors.js';

type StreamConsumerContext = {
  config: Config;
  jsonOutput: boolean;
  streamJsonOutput: boolean;
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
): void {
  formatter?.emitEvent({
    type: JsonStreamEventType.ERROR,
    timestamp: new Date().toISOString(),
    severity,
    message,
  });
}

function flushThoughtBuffer(
  thoughtBuffer: string,
  includeThinking: boolean,
): string {
  if (!includeThinking || !thoughtBuffer.trim()) {
    return '';
  }
  process.stdout.write(`<think>${thoughtBuffer.trim()}</think>\n`);
  return '';
}

function flushEmojiBuffer(
  context: StreamConsumerContext,
  jsonResponseText: string,
): string {
  const remainingBuffered = context.emojiFilter?.flushBuffer();
  if (!remainingBuffered) {
    return jsonResponseText;
  }
  if (context.streamFormatter) {
    context.streamFormatter.emitEvent({
      type: JsonStreamEventType.MESSAGE,
      timestamp: new Date().toISOString(),
      role: 'assistant',
      content: remainingBuffered,
      delta: true,
    });
    return jsonResponseText;
  }
  if (context.jsonOutput) {
    return jsonResponseText + remainingBuffered;
  }
  process.stdout.write(remainingBuffered);
  return jsonResponseText;
}

function handleThinking(
  thought: { subject?: string; description?: string },
  context: StreamConsumerContext,
  writeProfileName: () => void,
  thoughtBuffer: string,
  includeThinking: boolean,
): string {
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
  return thoughtBuffer ? `${thoughtBuffer} ${thoughtText}` : thoughtText;
}

function handleText(
  text: string,
  context: StreamConsumerContext,
  writeProfileName: () => void,
  jsonResponseText: string,
): string {
  writeProfileName();
  let outputValue = text;
  if (context.emojiFilter) {
    const filterResult = context.emojiFilter.filterStreamChunk(outputValue);
    if (filterResult.blocked) {
      if (!context.jsonOutput) {
        process.stderr.write(
          '[Error: Response blocked due to emoji detection]\n',
        );
      }
      return jsonResponseText;
    }
    outputValue =
      typeof filterResult.filtered === 'string' ? filterResult.filtered : '';
    if (filterResult.systemFeedback && !context.jsonOutput) {
      process.stderr.write(`Warning: ${filterResult.systemFeedback}\n`);
    }
  }
  if (context.streamFormatter) {
    if (outputValue !== '') {
      context.streamFormatter.emitEvent({
        type: JsonStreamEventType.MESSAGE,
        timestamp: new Date().toISOString(),
        role: 'assistant',
        content: outputValue,
        delta: true,
      });
    }
    return jsonResponseText;
  }
  if (context.jsonOutput) {
    return jsonResponseText + outputValue;
  }
  process.stdout.write(outputValue);
  return jsonResponseText;
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
    process.stdout.write(`${result.display}\n`);
  }
}

function emitFinalResult(
  context: StreamConsumerContext,
  jsonResponseText: string,
  startTime: number,
  metrics: SessionMetrics,
): void {
  if (context.streamFormatter) {
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
    process.stdout.write(
      `${JSON.stringify(
        {
          session_id: context.config.getSessionId(),
          response: jsonResponseText.trimEnd(),
          stats: metrics,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write('\n');
  }
}

/**
 * Rebuilds an Error from a public StructuredError so the caller's catch
 * (parseAndFormatApiError) receives an Error instance, matching the legacy
 * GeminiEventType.Error throw path. The optional HTTP status is preserved as a
 * property without a type assertion.
 */
function reconstructError(structured: StructuredError): Error {
  const err: Error & { status?: number } = new Error(structured.message);
  if (structured.status !== undefined) {
    err.status = structured.status;
  }
  return err;
}

function handleDone(
  event: Extract<AgentEvent, { type: 'done' }>,
  context: StreamConsumerContext,
  jsonResponseText: string,
  startTime: number,
  getMetrics: () => SessionMetrics,
): void {
  switch (event.reason) {
    case 'stop':
    case 'loop-detected':
    case 'context-overflow':
      emitFinalResult(context, jsonResponseText, startTime, getMetrics());
      return;
    case 'hook-stopped': {
      const stop = event.stop;
      const stopMessage = `Agent execution stopped: ${
        stop?.systemMessage?.trim() ?? stop?.reason ?? ''
      }`;
      process.stderr.write(`${stopMessage}\n`);
      return;
    }
    case 'aborted':
      debugLogger.error('Operation cancelled.');
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
  thoughtBuffer: string,
  jsonResponseText: string,
  pendingDone: Extract<AgentEvent, { type: 'done' }> | null,
  context: StreamConsumerContext,
  includeThinking: boolean,
  startTime: number,
  getMetrics: () => SessionMetrics,
): void {
  flushThoughtBuffer(thoughtBuffer, includeThinking);
  const finalText = flushEmojiBuffer(context, jsonResponseText);
  if (pendingDone !== null) {
    handleDone(pendingDone, context, finalText, startTime, getMetrics);
  } else {
    emitFinalResult(context, finalText, startTime, getMetrics());
  }
}

interface StreamState {
  thoughtBuffer: string;
  jsonResponseText: string;
  pendingDone: Extract<AgentEvent, { type: 'done' }> | null;
}

function dispatchAgentEvent(
  event: AgentEvent,
  state: StreamState,
  context: StreamConsumerContext,
  writeProfileName: () => void,
  includeThinking: boolean,
): void {
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
      state.thoughtBuffer = flushThoughtBuffer(
        state.thoughtBuffer,
        includeThinking,
      );
      state.jsonResponseText = handleText(
        event.text,
        context,
        writeProfileName,
        state.jsonResponseText,
      );
      return;
    case 'tool-call':
      state.thoughtBuffer = flushThoughtBuffer(
        state.thoughtBuffer,
        includeThinking,
      );
      emitToolUse(event.call, context.streamFormatter);
      return;
    case 'tool-result':
      state.thoughtBuffer = flushThoughtBuffer(
        state.thoughtBuffer,
        includeThinking,
      );
      emitToolResult(event.result, context.streamFormatter);
      displayToolResult(event.result, context);
      return;
    case 'loop-detected':
      emitStreamError(
        context.streamFormatter,
        'warning',
        'Loop detected, stopping execution',
      );
      return;
    case 'hook-blocked': {
      const info = event.info;
      const blockMessage = `Agent execution blocked: ${
        info.systemMessage?.trim() ?? info.reason
      }`;
      process.stderr.write(`[WARNING] ${blockMessage}\n`);
      return;
    }
    case 'idle-timeout':
      emitStreamError(
        context.streamFormatter,
        'error',
        'Stream idle timeout: no response received within the allowed time.',
      );
      throw reconstructError(event.error);
    case 'error':
      throw reconstructError(event.error);
    case 'done':
      state.pendingDone = event;
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
 * The loop emits a per-turn `done` (from `Finished`); when a tool is requested
 * the loop continues past it. This consumer records each `done` and acts only
 * on the final one at stream exhaustion — returning early would abandon the
 * generator mid-loop and prevent tool execution.
 */
export async function processAgentStream(
  events: AsyncIterable<AgentEvent>,
  context: StreamConsumerContext,
  startTime: number,
  getMetrics: () => SessionMetrics,
): Promise<void> {
  const writeProfileName = context.createProfileNameWriter();
  const includeThinking =
    !context.jsonOutput &&
    !context.streamJsonOutput &&
    context.config.getEphemeralSetting('reasoning.includeInResponse') !== false;
  const state: StreamState = {
    thoughtBuffer: '',
    jsonResponseText: '',
    pendingDone: null,
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
  finalizeStream(
    state.thoughtBuffer,
    state.jsonResponseText,
    state.pendingDone,
    context,
    includeThinking,
    startTime,
    getMetrics,
  );
}
