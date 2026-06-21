/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { StreamEventType, type StreamEvent } from '../core/chatSession.js';
import type {
  Content,
  Part,
  FunctionCall,
  FunctionDeclaration,
  GenerateContentResponse,
} from '@google/genai';
import {
  filterHookRestrictedFunctionCalls,
  filterHookRestrictedParts,
  getHookRestrictedAllowedTools,
  getHookRestrictedFunctionCallsFromParts,
  hasFilteredHookRestrictedToolCalls,
  mergeHookRestrictedFunctionCalls,
} from '../core/hookToolRestrictions.js';
import { parseThought } from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { ChatSession } from '../core/chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentActivityEventType } from './types.js';

/** Result from the model call. */
export type AgentModelResult = {
  functionCalls: FunctionCall[];
  textResponse: string;
};

/** Callback for emitting activity events. */
export type StreamEmitActivityFn = (
  type: SubagentActivityEventType,
  data: Record<string, unknown>,
) => void;

/**
 * Discriminated result for a single stream-event read.
 */
type StreamEventRead =
  | { kind: 'done' }
  | { kind: 'chunk'; value: GenerateContentResponse }
  | { kind: 'skip' };

/**
 * Calls the generative model with the current context and tools, consuming
 * the response stream and accumulating function calls and text.
 *
 * @returns The model's response, including any tool calls or text.
 */
export async function callModelAndConsumeStream(
  chat: ChatSession,
  message: Content,
  tools: Array<{ functionDeclarations: FunctionDeclaration[] }> | undefined,
  signal: AbortSignal,
  promptId: string,
  runtimeContext: Config,
  emitActivity: StreamEmitActivityFn,
): Promise<AgentModelResult> {
  const timeoutController = new AbortController();
  const timeoutSignal = timeoutController.signal;
  const onAbort = () => timeoutController.abort();
  signal.addEventListener('abort', onAbort, { once: true });

  const messageParams = {
    message: message.parts ?? [],
    config: {
      abortSignal: timeoutSignal,
      tools,
    },
  };

  let streamIterator: AsyncIterator<StreamEvent> | undefined;
  const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(runtimeContext);

  try {
    const responseStream = await chat.sendMessageStream(
      messageParams,
      promptId,
    );

    const functionCalls: FunctionCall[] = [];
    let textResponse = '';
    streamIterator = responseStream[Symbol.asyncIterator]();

    await consumeStream(
      streamIterator,
      effectiveTimeoutMs,
      signal,
      timeoutSignal,
      timeoutController,
      functionCalls,
      (text) => {
        textResponse += text;
      },
      emitActivity,
    );

    return {
      functionCalls,
      textResponse,
    };
  } finally {
    streamIterator?.return?.().catch(() => {});
    timeoutController.abort();
    signal.removeEventListener('abort', onAbort);
  }
}

/** Consumes a response stream, accumulating function calls and text. */
async function consumeStream(
  streamIterator: AsyncIterator<StreamEvent>,
  effectiveTimeoutMs: number,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
  timeoutController: AbortController,
  functionCalls: FunctionCall[],
  onText: (text: string) => void,
  emitActivity: StreamEmitActivityFn,
): Promise<void> {
  for (;;) {
    const event = await readStreamEvent(
      streamIterator,
      effectiveTimeoutMs,
      signal,
      timeoutSignal,
      timeoutController,
    );
    if (event.kind === 'done') {
      break;
    }
    if (event.kind === 'chunk') {
      processStreamChunk(event.value, functionCalls, onText, emitActivity);
    }
  }
}

/** Read and validate a single stream event. */
async function readStreamEvent(
  streamIterator: AsyncIterator<StreamEvent>,
  effectiveTimeoutMs: number,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
  timeoutController: AbortController,
): Promise<StreamEventRead> {
  let result: IteratorResult<StreamEvent>;
  if (effectiveTimeoutMs > 0) {
    result = await nextStreamEventWithIdleTimeout({
      iterator: streamIterator,
      timeoutMs: effectiveTimeoutMs,
      signal: timeoutSignal,
      onTimeout: () => {
        if (signal.aborted) {
          return;
        }
        timeoutController.abort();
      },
      createTimeoutError: () => createAbortError(),
    });
  } else {
    result = await streamIterator.next();
  }
  if (result.done === true) {
    return { kind: 'done' };
  }
  if (signal.aborted) {
    return { kind: 'done' };
  }
  const resp = result.value;
  if (resp.type === StreamEventType.CHUNK) {
    return { kind: 'chunk', value: resp.value };
  }
  return { kind: 'skip' };
}

/** Processes a single stream chunk, extracting thoughts, function calls, and text. */
function processStreamChunk(
  chunk: GenerateContentResponse,
  functionCalls: FunctionCall[],
  onText: (text: string) => void,
  emitActivity: StreamEmitActivityFn,
): boolean {
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  const allowedTools = getHookRestrictedAllowedTools(chunk);
  const filteredParts = filterHookRestrictedParts(parts, allowedTools);
  const { subject } = parseThought(
    filteredParts.find((p: Part) => p.thought === true)?.text ?? '',
  );

  if (subject !== '') {
    emitActivity('THOUGHT_CHUNK', { text: subject });
  }

  const partCalls = getHookRestrictedFunctionCallsFromParts(
    filteredParts,
    allowedTools,
  );
  const topLevelCalls = filterHookRestrictedFunctionCalls(
    chunk.functionCalls ?? [],
    allowedTools,
  );
  const allowedFunctionCalls = mergeHookRestrictedFunctionCalls(
    partCalls,
    topLevelCalls,
  );
  if (allowedFunctionCalls.length > 0) {
    functionCalls.push(...allowedFunctionCalls);
  }

  const text = filteredParts
    .filter((p: Part) => p.thought !== true && typeof p.text === 'string')
    .map((p: Part) => p.text)
    .join('');

  if (text.length > 0) {
    onText(text);
  }

  return hasFilteredHookRestrictedToolCalls(chunk);
}
