/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type IContent,
  type TextBlock,
  type ToolCallBlock,
  type ThinkingBlock,
  type CodeBlock,
} from '@vybestack/llxprt-code-core';
import {
  type HistoryItem,
  type IndividualToolCallDisplay,
  ToolCallStatus,
} from '../types.js';

function safeToolResultToString(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/**
 * Converts provider-agnostic IContent[] (from session recording) into
 * UI HistoryItem[] for display.  Only block types renderable in the CLI
 * are converted — MediaBlock is intentionally omitted because the CLI UI
 * does not render inline images or file attachments.
 */
export function iContentToHistoryItems(contents: IContent[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  // Negative IDs avoid collisions with live IDs (always positive).
  let idCounter = -1;

  const responseMap = new Map<string, { result: unknown; error?: string }>();
  for (const content of contents) {
    if (content.speaker !== 'tool') continue;
    for (const block of content.blocks) {
      if (block.type === 'tool_response') {
        responseMap.set(block.callId, {
          result: block.result,
          error: block.error,
        });
      }
    }
  }

  for (const content of contents) {
    if (content.speaker === 'human') {
      const text = content.blocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (text) {
        items.push({ id: idCounter--, type: 'user', text });
      }
      continue;
    }

    if (content.speaker === 'ai') {
      const textBlocks = content.blocks.filter(
        (b): b is TextBlock => b.type === 'text',
      );
      const thinkingBlocks = content.blocks.filter(
        (b): b is ThinkingBlock => b.type === 'thinking',
      );
      const codeBlocks = content.blocks.filter(
        (b): b is CodeBlock => b.type === 'code',
      );
      const toolCallBlocks = content.blocks.filter(
        (b): b is ToolCallBlock => b.type === 'tool_call',
      );

      const textParts = textBlocks.map((b) => b.text);
      for (const codeBlock of codeBlocks) {
        textParts.push(
          `\`\`\`${codeBlock.language ?? ''}\n${codeBlock.code}\n\`\`\``,
        );
      }
      const combinedText = textParts.join('\n');

      if (combinedText) {
        items.push({
          id: idCounter--,
          type: 'gemini',
          text: combinedText,
          model: content.metadata?.model,
          ...(thinkingBlocks.length > 0 ? { thinkingBlocks } : {}),
        });
      }

      if (toolCallBlocks.length > 0) {
        const tools: IndividualToolCallDisplay[] = toolCallBlocks.map((tc) => {
          const response = responseMap.get(tc.id);
          return {
            callId: tc.id,
            name: tc.name,
            description: tc.description ?? tc.name,
            resultDisplay: response
              ? safeToolResultToString(response.result)
              : undefined,
            status: response
              ? response.error
                ? ToolCallStatus.Error
                : ToolCallStatus.Success
              : ToolCallStatus.Pending,
            confirmationDetails: undefined,
          };
        });
        items.push({ id: idCounter--, type: 'tool_group', tools });
      }
    }
  }

  return items;
}
