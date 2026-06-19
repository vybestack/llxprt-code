/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { LanguageModelUsage } from 'ai';

import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  type TextBlock,
  type ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { cleanKimiTokensFromThinking } from '../reasoning/reasoningUtils.js';
import { extractThinkTagsAsBlock } from '../utils/thinkingExtraction.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';

import type { ReasoningSettings, StreamingState } from './vercelStreamTypes.js';
import type { CaptureBuffer } from './vercelReasoningCapture.js';

/**
 * Determines whether a buffered `<think>` segment should be flushed based on
 * natural sentence boundaries or a hard length cap.
 */
export function shouldFlushThinkBuffer(buffer: string): boolean {
  if (buffer.includes('\n') || buffer.length > 100) {
    return true;
  }
  return (
    buffer.endsWith('. ') || buffer.endsWith('! ') || buffer.endsWith('? ')
  );
}

export function isAbortError(error: unknown): boolean {
  if (error === null || error === undefined || typeof error !== 'object') {
    return false;
  }
  return 'name' in error && (error as { name?: string }).name === 'AbortError';
}

/**
 * Processes the text buffer and flushes complete thinking/text blocks.
 */
export function flushTextBuffer(
  buffer: string,
  isEnd: boolean,
  state: StreamingState,
  logger: DebugLogger,
): { items: IContent[]; remainingBuffer: string } {
  if (!buffer) return { items: [], remainingBuffer: '' };
  if (!isEnd && hasOpenThinkTag(buffer)) {
    return { items: [], remainingBuffer: buffer };
  }

  const items: IContent[] = [];
  const thinkBlock = extractThinkTagsAsBlock(buffer, logger);
  if (thinkBlock) {
    if (state.accumulatedThinkingContent.length > 0) {
      state.accumulatedThinkingContent += ' ';
    }
    state.accumulatedThinkingContent += thinkBlock.thought;
    logger.debug(
      () =>
        `[OpenAIVercelProvider] Accumulated thinking: ${state.accumulatedThinkingContent.length} chars`,
    );
  }

  if (
    !state.hasEmittedThinking &&
    state.accumulatedThinkingContent.length > 0 &&
    (isEnd || buffer.includes('</think>'))
  ) {
    items.push({
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: state.accumulatedThinkingContent,
          sourceField: 'think_tags',
          isHidden: false,
        } as ThinkingBlock,
      ],
    } as IContent);
    state.hasEmittedThinking = true;
    logger.debug(
      () =>
        `[OpenAIVercelProvider] Emitted thinking block: ${state.accumulatedThinkingContent.length} chars`,
    );
  }

  const sanitizedText = sanitizeProviderText(buffer, logger);
  if (sanitizedText) {
    items.push({
      speaker: 'ai',
      blocks: [{ type: 'text', text: sanitizedText } as TextBlock],
    } as IContent);
  }
  return { items, remainingBuffer: '' };
}

/**
 * Handles a text-delta stream part, buffering `<think>` content and
 * flushing plain text directly.
 */
export function handleTextDelta(
  text: string,
  state: StreamingState,
  logger: DebugLogger,
): IContent[] {
  if (!text) return [];
  const hasThinkContent =
    text.includes('<think') ||
    text.includes('</think') ||
    state.textBuffer.includes('<think');

  if (hasThinkContent) {
    state.textBuffer += text;
    if (
      !hasOpenThinkTag(state.textBuffer) &&
      shouldFlushThinkBuffer(state.textBuffer)
    ) {
      const { items } = flushTextBuffer(state.textBuffer, false, state, logger);
      state.textBuffer = '';
      return items;
    }
    return [];
  }
  return [
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text } as TextBlock],
    } as IContent,
  ];
}

/**
 * Handles a finish stream part, flushing any remaining buffer.
 */
export function handleStreamFinish(
  part: {
    totalUsage?: LanguageModelUsage;
    finishReason?: string;
  },
  state: StreamingState,
  logger: DebugLogger,
): IContent[] {
  state.totalUsage = part.totalUsage;
  state.finishReason = part.finishReason;
  const items: IContent[] = [];
  if (state.textBuffer) {
    const flushResult = flushTextBuffer(state.textBuffer, true, state, logger);
    items.push(...flushResult.items);
    state.textBuffer = '';
  }
  if (logger.enabled) {
    logger.debug(
      () =>
        `[OpenAIVercelProvider] streamText finished with reason: ${part.finishReason}`,
      {
        finishReason: part.finishReason,
        hasUsage: !!state.totalUsage,
        toolCallCount: state.collectedToolCalls.length,
      },
    );
  }
  return items;
}

/**
 * Handles a reasoning stream part.
 */
export function handleStreamReasoning(
  part: { text?: string },
  rs: ReasoningSettings,
  state: StreamingState,
  logger: DebugLogger,
): IContent[] {
  if (!rs.enabled) return [];
  const reasoning = part.text;
  if (!reasoning) return [];
  const cleaned = cleanKimiTokensFromThinking(reasoning);
  if (rs.includeInResponse && rs.format === 'native') {
    return [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: cleaned,
            sourceField: 'reasoning_content',
            isHidden: false,
          } as ThinkingBlock,
        ],
      } as IContent,
    ];
  }
  if (rs.includeInResponse) {
    if (state.accumulatedThinkingContent.length > 0) {
      state.accumulatedThinkingContent += ' ';
    }
    state.accumulatedThinkingContent += cleaned;
    logger.debug(
      () =>
        `[OpenAIVercelProvider] Accumulated reasoning: ${state.accumulatedThinkingContent.length} chars`,
    );
  }
  return [];
}

/**
 * Emits any remaining accumulated thinking or captured reasoning at
 * the end of the stream.
 */
export function emitRemainingStreamThinking(
  state: StreamingState,
  rs: ReasoningSettings,
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): IContent[] {
  const items: IContent[] = [];
  if (
    !state.hasEmittedThinking &&
    state.accumulatedThinkingContent.length > 0 &&
    rs.enabled &&
    rs.includeInResponse
  ) {
    const cleanedThought = cleanKimiTokensFromThinking(
      state.accumulatedThinkingContent,
    );
    items.push({
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: cleanedThought,
          sourceField: 'reasoning_content',
          isHidden: false,
        } as ThinkingBlock,
      ],
    } as IContent);
    state.hasEmittedThinking = true;
    logger.debug(
      () =>
        `[OpenAIVercelProvider] Emitted final thinking block: ${cleanedThought.length} chars`,
    );
  }
  if (
    !state.hasEmittedThinking &&
    captureBuffer.reasoningChunks.length > 0 &&
    rs.enabled &&
    rs.includeInResponse
  ) {
    const capturedReasoning = captureBuffer.reasoningChunks.join('');
    const cleanedReasoning = cleanKimiTokensFromThinking(capturedReasoning);
    if (cleanedReasoning.length > 0) {
      items.push({
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: cleanedReasoning,
            sourceField: 'reasoning_content',
            isHidden: false,
          } as ThinkingBlock,
        ],
      } as IContent);
      state.hasEmittedThinking = true;
      logger.debug(
        () =>
          `[OpenAIVercelProvider] Emitted captured reasoning_content: ${cleanedReasoning.length} chars from ${captureBuffer.reasoningChunks.length} chunks`,
      );
    }
  }
  return items;
}

/**
 * Processes a single stream part and returns the resulting IContent items.
 */
export function processStreamPart(
  part: {
    type: string;
    text?: string;
    toolCallId?: string;
    toolName?: string;
    input?: unknown;
    totalUsage?: LanguageModelUsage;
    finishReason?: string;
    error?: unknown;
  },
  state: StreamingState,
  rs: ReasoningSettings,
  logger: DebugLogger,
): IContent[] {
  switch (part.type) {
    case 'text-delta':
      return handleTextDelta(
        typeof part.text === 'string' ? part.text : '',
        state,
        logger,
      );
    case 'tool-call':
      if (part.toolCallId && part.toolName) {
        state.collectedToolCalls.push({
          toolCallId: String(part.toolCallId),
          toolName: String(part.toolName),
          input: part.input,
        });
      }
      return [];
    case 'finish':
      return handleStreamFinish(part, state, logger);
    case 'error':
      throw part.error ?? new Error('Streaming error from AI SDK');
    case 'reasoning':
      return handleStreamReasoning(part, rs, state, logger);
    default:
      return [];
  }
}

/**
 * Flushes any remaining text buffer at the end of the stream.
 */
export function flushRemainingTextBuffer(
  state: StreamingState,
  logger: DebugLogger,
): IContent[] {
  if (!state.textBuffer) return [];
  const { items } = flushTextBuffer(state.textBuffer, true, state, logger);
  state.textBuffer = '';
  return items;
}

function hasOpenThinkTag(text: string): boolean {
  const openCount = (text.match(/<think>/gi) ?? []).length;
  const closeCount = (text.match(/<\/think>/gi) ?? []).length;
  return openCount > closeCount;
}
