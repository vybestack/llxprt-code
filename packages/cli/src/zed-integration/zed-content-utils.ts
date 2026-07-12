/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent, ContentBlock } from '@vybestack/llxprt-code-core';

/**
 * Structural input for {@link extractToolResultText}: the LLM-content and
 * display fields of a tool execution result. Both the core `ToolResult` and
 * the public `AgentToolExecResult` (from `@vybestack/llxprt-code-agents`)
 * satisfy it, so Zed code can pass either without casts.
 */
export interface ToolResultTextInput {
  readonly llmContent?: unknown;
  readonly returnDisplay?: unknown;
}

/**
 * Extracts visible text from ContentBlock[] — filters thought blocks and joins
 * text segments. Local replacement for the retired core helper
 * getResponseTextFromParts (which migrated to ContentBlock[]).
 */
function isHiddenThoughtBlock(block: ContentBlock): boolean {
  return block.type === 'thinking';
}

function getResponseTextFromBlocksLocal(
  blocks: ContentBlock[],
): string | undefined {
  const textSegments = blocks
    .filter((block) => !isHiddenThoughtBlock(block))
    .map((block) => (block.type === 'text' ? block.text : undefined))
    .filter((text): text is string => typeof text === 'string');
  if (textSegments.length === 0) {
    return undefined;
  }
  return textSegments.join('');
}

export function extractToolResultText(
  toolResult: ToolResultTextInput,
): string | null {
  // llmContent is a string | ContentBlock[] | IContent at runtime for every producer (core tools
  // and the public agent handle projection); the structural input widens it
  // to unknown so both result types are accepted.
  const textFromLlmContent = extractTextFromPartList(
    toolResult.llmContent as string | ContentBlock[] | IContent | undefined,
  );
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
  llmContent: string | ContentBlock[] | IContent | undefined,
): string | null {
  if (llmContent === undefined) {
    return null;
  }

  if (typeof llmContent === 'string') {
    const trimmed = llmContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const parts = normalizeToParts(llmContent);
  const text = getResponseTextFromBlocksLocal(parts);
  if (text !== undefined) {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  for (const part of parts) {
    if (part.type !== 'tool_response') {
      continue;
    }
    const extracted = extractOutputString(part.result);
    if (extracted !== null) {
      return extracted;
    }
  }

  return null;
}

export function normalizeToParts(
  input: string | ContentBlock[] | IContent,
): ContentBlock[] {
  if (typeof input === 'string') {
    return [{ type: 'text', text: input }];
  }

  if (Array.isArray(input)) {
    return input;
  }

  if (isContent(input)) {
    return input.blocks;
  }

  return [];
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
      responseRecord.content as string | ContentBlock[] | IContent,
    );
    const text = getResponseTextFromBlocksLocal(contentParts);
    if (text !== undefined) {
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function isContent(value: unknown): value is IContent {
  if (value === undefined || value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<IContent>;
  return Array.isArray(candidate.blocks);
}
