/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream chunk extraction utilities extracted from LoggingProviderWrapper
 * to keep the main wrapper file under the lint line budget.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** Extract token usage, finish reason, and text from a stream chunk. */
export function extractChunkMetadata(
  chunk: IContent,
  onUsage: (usage: UsageStats) => void,
  onFinishReason: (reason: string) => void,
  shouldAccumulateText: boolean,
  onText: (text: string) => void,
): void {
  const content = chunk;
  if (content.metadata?.usage) {
    onUsage(content.metadata.usage);
  }
  const metaFinishReason =
    (content.metadata as Record<string, unknown> | undefined)?.finishReason ??
    content.metadata?.stopReason;
  if (typeof metaFinishReason === 'string') {
    onFinishReason(metaFinishReason);
  }
  if (shouldAccumulateText && Array.isArray(content.blocks)) {
    for (const block of content.blocks) {
      if (block.type === 'text') {
        onText(block.text);
      }
    }
  }
}

/** Check whether a chunk carries token-bearing output (text/thinking/code/tool_call). */
export function hasTokenBearingOutput(chunk: unknown): boolean {
  if (typeof chunk !== 'object' || chunk === null) {
    return false;
  }

  const contentChunk = chunk as Partial<IContent>;
  if (Array.isArray(contentChunk.blocks)) {
    return contentChunk.blocks.some((block) => {
      if (block.type === 'text') {
        return typeof block.text === 'string' && block.text.length > 0;
      }
      return (
        block.type === 'thinking' ||
        block.type === 'code' ||
        block.type === 'tool_call'
      );
    });
  }

  const extractedContent = extractSimpleContent(chunk);
  return extractedContent.length > 0;
}

/** Extract simple content string from an OpenAI-style delta chunk. */
export function extractSimpleContent(chunk: unknown): string {
  if (typeof chunk !== 'object' || chunk === null) {
    return '';
  }

  const obj = chunk as Record<string, unknown>;

  // Try common content paths
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const choice = obj.choices[0] as Record<string, unknown>;
    if (
      'delta' in choice &&
      typeof choice.delta === 'object' &&
      choice.delta !== null
    ) {
      const delta = choice.delta as Record<string, unknown>;
      if (typeof delta.content === 'string') {
        return delta.content;
      }
    }
  }

  return '';
}
