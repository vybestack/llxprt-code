/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentMessageInput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AgentRequestInput } from '@vybestack/llxprt-code-core/core/clientContract.js';

export function isThinkingSupported(model: string) {
  return !model.startsWith('gemini-2.0');
}

function getLastContent(contents: IContent[]): IContent | undefined {
  return contents.length > 0 ? contents[contents.length - 1] : undefined;
}

/**
 * Returns the index of the content after the fraction of the total characters in the history.
 *
 * Exported for testing purposes.
 */
export function findCompressSplitPoint(
  contents: IContent[],
  fraction: number,
): number {
  if (fraction <= 0 || fraction >= 1) {
    throw new Error('Fraction must be between 0 and 1');
  }

  const charCounts = contents.map((content) => JSON.stringify(content).length);
  const totalCharCount = charCounts.reduce((sum, length) => sum + length, 0);
  const targetCharCount = totalCharCount * fraction;

  let lastSplitPoint = 0;
  let lastToolCallSplitPoint = 0;
  let toolCallSplitPointAfterTarget: number | null = null;
  let cumulativeCharCount = 0;
  for (let i = 0; i < contents.length; i++) {
    const content = contents[i];

    const hasFunctionResponse = content.blocks.some(
      (b) => b.type === 'tool_response',
    );

    const hasFunctionCall = content.blocks.some((b) => b.type === 'tool_call');
    if (content.speaker === 'human' && !hasFunctionResponse) {
      if (cumulativeCharCount >= targetCharCount) {
        return i;
      }
      lastSplitPoint = i;
    }
    if (content.speaker === 'ai' && hasFunctionCall) {
      if (
        cumulativeCharCount >= targetCharCount &&
        toolCallSplitPointAfterTarget === null
      ) {
        toolCallSplitPointAfterTarget = i;
      }
      lastToolCallSplitPoint = i;
    }
    cumulativeCharCount += charCounts[i];
  }

  const lastContent = getLastContent(contents);
  const hasNoFunctionCall = (content: IContent | undefined): boolean => {
    const blocks = content?.blocks;

    return blocks?.some((b) => b.type === 'tool_call') !== true;
  };

  if (lastSplitPoint > 0) {
    if (lastContent?.speaker === 'ai' && hasNoFunctionCall(lastContent)) {
      return contents.length;
    }

    return lastSplitPoint;
  }

  if (toolCallSplitPointAfterTarget !== null) {
    return toolCallSplitPointAfterTarget;
  }

  if (lastToolCallSplitPoint > 0) {
    return lastToolCallSplitPoint;
  }

  if (lastContent?.speaker === 'ai' && hasNoFunctionCall(lastContent)) {
    return contents.length;
  }

  return lastSplitPoint;
}

function hasTextProperty(value: unknown): value is { text: string } {
  return typeof value === 'object' && value !== null && 'text' in value;
}

export function extractPromptText(request: AgentRequestInput): string {
  if (typeof request === 'string') return request;
  if (Array.isArray(request)) {
    return request
      .map((part) => {
        if (typeof part === 'string') return part;
        if (hasTextProperty(part)) {
          return part.text;
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  // Not an array, check for single object with text
  if (hasTextProperty(request)) {
    return request.text;
  }
  return '';
}

/**
 * Structured, payload-aware token estimate for a pending request, used as a
 * fallback when the model-aware tokenizer (ChatSession.estimatePendingTokens)
 * is unavailable — e.g. with minimal test doubles.
 *
 * This accounts for `functionResponse` and `functionCall` payloads by
 * serializing their JSON, so a bare functionResponse continuation is no longer
 * estimated as 0 tokens. Binary payloads (`inlineData`/`fileData`) are
 * intentionally ignored so that large base64 blobs do not produce
 * false-positive overflow estimates.
 */
export function estimateRequestTokensStructured(
  request: AgentMessageInput,
): number {
  const parts = normalizeToBlocks(request);
  let charLength = 0;
  for (const part of parts) {
    charLength += charLengthForBlock(part);
  }
  return Math.floor(charLength / 4);
}

type RequestBlock = IContent['blocks'][number] | string;

function charLengthForBlock(part: RequestBlock): number {
  if (typeof part === 'string') {
    return part.length;
  }
  if (part.type === 'media') {
    return 0;
  }
  if (part.type === 'text') {
    return part.text.length;
  }
  if (part.type === 'tool_response') {
    return safeJsonLength(part.result);
  }
  if (part.type === 'tool_call') {
    return safeJsonLength(part.parameters);
  }
  // Legacy Part shapes without a `type` field (e.g. { text: "..." })
  // fall through to text-length estimation when a `text` property exists.
  if ('text' in part && typeof (part as { text?: unknown }).text === 'string') {
    return (part as { text: string }).text.length;
  }
  return 0;
}

function normalizeToBlocks(request: AgentMessageInput): RequestBlock[] {
  if (typeof request === 'string') return [request];
  if (Array.isArray(request)) {
    return request as RequestBlock[];
  }
  // Single IContent — return its blocks
  if ('blocks' in request && Array.isArray(request.blocks)) {
    return request.blocks as RequestBlock[];
  }
  return [];
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
