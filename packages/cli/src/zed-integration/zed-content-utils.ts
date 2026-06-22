/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ToolResult,
  getResponseTextFromParts,
} from '@vybestack/llxprt-code-core';
import type { Content, Part, PartListUnion } from '@google/genai';

export function extractToolResultText(toolResult: ToolResult): string | null {
  const textFromLlmContent = extractTextFromPartList(toolResult.llmContent);
  if (textFromLlmContent !== null) {
    return textFromLlmContent;
  }

  if (typeof toolResult.returnDisplay === 'string') {
    const trimmed = toolResult.returnDisplay.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

export function extractTextFromPartList(
  llmContent: PartListUnion | undefined,
): string | null {
  if (llmContent === undefined) {
    return null;
  }

  if (typeof llmContent === 'string') {
    const trimmed = llmContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const parts = normalizeToParts(llmContent);
  const text = getResponseTextFromParts(parts);
  if (text !== undefined) {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  for (const part of parts) {
    const response = part.functionResponse?.response;
    const extracted = extractOutputString(response);
    if (extracted !== null) {
      return extracted;
    }
  }

  return null;
}

export function normalizeToParts(input: PartListUnion): Part[] {
  if (typeof input === 'string') {
    return [{ text: input }];
  }

  if (Array.isArray(input)) {
    return input.flatMap((item) => normalizeToParts(item as PartListUnion));
  }

  if (isContent(input)) {
    return input.parts ?? [];
  }

  return [input];
}

export function extractOutputString(response: unknown): string | null {
  if (response === undefined || response === null) {
    return null;
  }

  if (typeof response === 'string') {
    const trimmed = response.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof response !== 'object') {
    return null;
  }

  const responseRecord = response as Record<string, unknown>;

  const output = responseRecord.output;
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  if (responseRecord.content !== undefined) {
    const contentParts = normalizeToParts(
      responseRecord.content as PartListUnion,
    );
    const text = getResponseTextFromParts(contentParts);
    if (text !== undefined) {
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function isContent(value: unknown): value is Content {
  if (value === undefined || value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Content>;
  return Array.isArray(candidate.parts);
}
