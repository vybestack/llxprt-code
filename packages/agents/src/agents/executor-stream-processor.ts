/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { StreamEventType, type StreamEvent } from '../core/chatSession.js';
import type {
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { FunctionCall } from './types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseThought } from '@vybestack/llxprt-code-core/utils/thoughtUtils.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { ChatSession } from '../core/chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { EmitActivityFn } from './executor-tool-dispatch.js';
import { isToolNameRestricted } from '../core/hookToolRestrictions.js';

/** Minimal structural type for chat sendMessage params. */
interface LocalSendMessageParams {
  message: unknown;
  config?: {
    abortSignal?: AbortSignal;
    tools?: unknown;
  };
}

/**
 * @plan PLAN-20260707-AGENTNEUTRAL.P25
 * @requirement REQ-005.5b
 */

export interface AgentModelResult {
  functionCalls: FunctionCall[];
  textResponse: string;
}

type StreamEventRead =
  | { kind: 'done' }
  | { kind: 'skip' }
  | { kind: 'chunk'; value: ModelStreamChunk };

/**
 * Calls the model via a streaming chat session, consumes the entire stream,
 * and returns the accumulated function calls and text response.
 */
export async function callModelAndConsumeStream(
  chat: ChatSession,
  message: IContent,
  tools: unknown,
  signal: AbortSignal,
  promptId: string,
  runtimeContext: Config,
  emitActivity: EmitActivityFn,
): Promise<AgentModelResult> {
  const timeoutController = new AbortController();
  const timeoutSignal = timeoutController.signal;
  const onAbort = () => timeoutController.abort();
  signal.addEventListener('abort', onAbort, { once: true });

  const messageParams: LocalSendMessageParams = {
    message,
    config: {
      abortSignal: timeoutSignal,
      tools,
    },
  };

  let streamIterator: AsyncIterator<StreamEvent> | undefined;
  const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(runtimeContext);

  try {
    const responseStream = await chat.sendMessageStream(
      messageParams as never,
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
  emitActivity: EmitActivityFn,
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

/** Checks if a block is a ToolCallBlock. */
function isToolCallBlock(block: ContentBlock): block is ToolCallBlock {
  return block.type === 'tool_call';
}

/**
 * Normalizes ToolCallBlock.parameters (typed `unknown`) into a plain record.
 * Returns `{}` for null, arrays, and primitives so downstream dispatch
 * always receives a well-formed argument object.
 */
function normalizeToolCallParameters(
  parameters: unknown,
): Record<string, unknown> {
  if (
    typeof parameters === 'object' &&
    parameters !== null &&
    !Array.isArray(parameters)
  ) {
    return parameters as Record<string, unknown>;
  }
  return {};
}

/** Checks if a block is a TextBlock. */
function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === 'text';
}

/** Checks if a block is a ThinkingBlock. */
function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === 'thinking';
}

/** Processes a single stream chunk, extracting thoughts, function calls, and text. */
function processStreamChunk(
  chunk: ModelStreamChunk,
  functionCalls: FunctionCall[],
  onText: (text: string) => void,
  emitActivity: EmitActivityFn,
): boolean {
  const blocks = chunk.content.blocks;
  const allowedTools = chunk.hookRestrictions?.allowedToolNames;

  // Extract thoughts from thinking blocks
  const thoughtBlock = blocks.find(isThinkingBlock);
  if (thoughtBlock) {
    const { subject } = parseThought(thoughtBlock.thought);
    if (subject !== '') {
      emitActivity('THOUGHT_CHUNK', { text: subject });
    }
  }

  // Filter and collect tool calls (convert ToolCallBlock → FunctionCall for
  // the executor pipeline which still uses local types)
  const toolCallBlocks = blocks.filter(isToolCallBlock);
  const filteredToolCallBlocks = allowedTools
    ? toolCallBlocks.filter(
        (tc) => !isToolNameRestricted(tc.name, allowedTools),
      )
    : toolCallBlocks;
  for (const tc of filteredToolCallBlocks) {
    functionCalls.push({
      id: tc.id,
      name: tc.name,
      args: normalizeToolCallParameters(tc.parameters),
    });
  }

  // Accumulate visible text (non-thought text blocks)
  const text = blocks
    .filter(isTextBlock)
    .map((b) => b.text)
    .join('');

  if (text.length > 0) {
    onText(text);
  }

  return chunk.hookRestrictions?.hadFilteredRestrictedCalls === true;
}
