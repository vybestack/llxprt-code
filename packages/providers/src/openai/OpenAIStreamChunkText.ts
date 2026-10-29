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

import type OpenAI from 'openai';
import type {
  IContent,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import {
  coerceMessageContentToString,
  parseStreamingReasoningDelta,
} from './OpenAIResponseParser.js';

export function extractSanitizedChunkText(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
): string {
  const choicesRuntime: unknown = chunk.choices;
  if (!Array.isArray(choicesRuntime)) {
    return '';
  }

  const choice: unknown = choicesRuntime[0];
  if (typeof choice !== 'object' || choice === null || !('delta' in choice)) {
    return '';
  }

  const deltaRuntime = choice.delta;
  if (
    typeof deltaRuntime !== 'object' ||
    deltaRuntime === null ||
    !('content' in deltaRuntime)
  ) {
    return '';
  }

  const deltaContent = coerceMessageContentToString(deltaRuntime.content);
  if (deltaContent === undefined || deltaContent === '') {
    return '';
  }
  return sanitizeProviderText(deltaContent);
}

/**
 * Returns visible continuation text and stamps token-bearing raw deltas once.
 */
export function extractContinuationChunkText(
  chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
  logger: DebugLogger,
  reasoningFieldName?: string,
  onRawTokenDelta?: () => void,
): string {
  const sanitizedText = extractSanitizedChunkText(chunk);
  const chunkChoices = (
    chunk as {
      choices?: OpenAI.Chat.Completions.ChatCompletionChunk.Choice[];
    }
  ).choices;
  const delta = chunkChoices?.[0]?.delta;
  const { thinking, toolCalls: reasoningToolCalls } =
    parseStreamingReasoningDelta(delta, logger, reasoningFieldName);
  const hasDeltaToolCalls =
    delta?.tool_calls !== undefined && delta.tool_calls.length > 0;
  if (
    sanitizedText !== '' ||
    thinking !== null ||
    reasoningToolCalls.length > 0 ||
    hasDeltaToolCalls
  ) {
    onRawTokenDelta?.();
  }
  return sanitizedText;
}

/**
 * The visible text of a continuation response, one non-empty piece per chunk,
 * ending early when the request is aborted. Continuation raw deltas are
 * token-bearing output of the same attempt (issue #3473): each token-bearing
 * delta (content, reasoning, or tool-call fragments) fires the raw-timing
 * signal exactly once so the attempt window spans the whole continuation
 * decode; only content changes visible output.
 */
export async function* continuationTexts(
  response: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  abortSignal: AbortSignal | undefined,
  logger: DebugLogger,
  reasoningFieldName?: string,
  onRawTokenDelta?: () => void,
): AsyncGenerator<string, void, unknown> {
  for await (const chunk of response) {
    if (abortSignal?.aborted === true) {
      return;
    }
    const text = extractContinuationChunkText(
      chunk,
      logger,
      reasoningFieldName,
      onRawTokenDelta,
    );
    if (text !== '') {
      yield text;
    }
  }
}

/** A model reply that holds one piece of text. */
export function aiTextContent(text: string): IContent {
  const block: TextBlock = { type: 'text', text };
  return { speaker: 'ai', blocks: [block] };
}
