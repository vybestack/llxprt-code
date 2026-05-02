/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type PartListUnion, type Content } from '@google/genai';

export function isThinkingSupported(model: string) {
  return !model.startsWith('gemini-2.0');
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

  const lastContent = contents[contents.length - 1];
  const hasNoFunctionCall = (content: Content | undefined): boolean => {
    const parts = content?.parts;

    return parts?.some((part) => Boolean(part.functionCall)) !== true;
  };

  if (lastSplitPoint > 0) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider client runtime payloads.
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

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider client runtime payloads.
  if (lastContent?.role === 'model' && hasNoFunctionCall(lastContent)) {
    return contents.length;
  }

  return lastSplitPoint;
}

export function extractPromptText(request: PartListUnion): string {
  if (typeof request === 'string') return request;
  if (Array.isArray(request)) {
    return request
      .map((part) => {
        if (typeof part === 'string') return part;
        // Preserve defensive runtime check: part could be null at runtime despite types.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider client runtime payloads.
        if (part !== null && typeof part === 'object' && 'text' in part) {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  // Not an array, check for single object with text
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider client runtime payloads.
  if (request !== null && typeof request === 'object' && 'text' in request) {
    return (request as { text: string }).text;
  }
  return '';
}

export function estimateTextOnlyLength(request: PartListUnion): number {
  if (typeof request === 'string') {
    return request.length;
  }

  if (!Array.isArray(request)) {
    if (
      typeof request === 'object' &&
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider client runtime payloads.
      request !== null &&
      'text' in request &&
      request.text
    ) {
      return (request as { text: string }).text.length;
    }
    return 0;
  }

  let textLength = 0;
  for (const part of request) {
    if (typeof part === 'string') {
      textLength += part.length;
    } else if (
      typeof part === 'object' &&
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Provider client runtime payloads.
      part !== null &&
      'text' in part &&
      part.text
    ) {
      textLength += part.text.length;
    }
  }
  return textLength;
}
