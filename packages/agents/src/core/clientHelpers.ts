/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type PartListUnion, type Part, type Content } from '@google/genai';

export function isThinkingSupported(model: string) {
  return !model.startsWith('gemini-2.0');
}

function getLastContent(contents: Content[]): Content | undefined {
  return contents.length > 0 ? contents[contents.length - 1] : undefined;
}

/**
 * Returns the index of the content after the fraction of the total characters in the history.
 *
 * Exported for testing purposes.
 */
export function findCompressSplitPoint(
  contents: Content[],
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

    const hasFunctionResponse =
      content.parts?.some((part) => Boolean(part.functionResponse)) === true;

    const hasFunctionCall =
      content.parts?.some((part) => Boolean(part.functionCall)) === true;
    if (content.role === 'user' && !hasFunctionResponse) {
      if (cumulativeCharCount >= targetCharCount) {
        return i;
      }
      lastSplitPoint = i;
    }
    if (content.role === 'model' && hasFunctionCall) {
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
  const hasNoFunctionCall = (content: Content | undefined): boolean => {
    const parts = content?.parts;

    return parts?.some((part) => Boolean(part.functionCall)) !== true;
  };

  if (lastSplitPoint > 0) {
    if (lastContent?.role === 'model' && hasNoFunctionCall(lastContent)) {
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

  if (lastContent?.role === 'model' && hasNoFunctionCall(lastContent)) {
    return contents.length;
  }

  return lastSplitPoint;
}

function hasTextProperty(value: unknown): value is { text: string } {
  return typeof value === 'object' && value !== null && 'text' in value;
}

export function extractPromptText(request: PartListUnion): string {
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
  request: PartListUnion,
): number {
  const parts = normalizeToParts(request);
  let charLength = 0;
  for (const part of parts) {
    charLength += charLengthForPart(part);
  }
  return Math.floor(charLength / 4);
}

/**
 * Computes the character length contribution of a single part for the
 * structured fallback. Returns 0 for binary payloads (inlineData/fileData)
 * so large base64 blobs do not inflate the estimate.
 */
function charLengthForPart(part: Part | string): number {
  if (typeof part === 'string') {
    return part.length;
  }
  if ('inlineData' in part || 'fileData' in part) {
    return 0;
  }
  if ('text' in part && typeof part.text === 'string') {
    return part.text.length;
  }
  if ('functionResponse' in part && part.functionResponse != null) {
    return safeJsonLength(part.functionResponse);
  }
  if ('functionCall' in part && part.functionCall != null) {
    return safeJsonLength(part.functionCall);
  }
  return 0;
}

function normalizeToParts(request: PartListUnion): Array<Part | string> {
  if (typeof request === 'string') return [request];
  return Array.isArray(request) ? request : [request];
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
