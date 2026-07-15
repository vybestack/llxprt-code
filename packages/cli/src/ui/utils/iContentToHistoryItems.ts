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
} from '@vybestack/llxprt-code-core';
import {
  type HistoryItem,
  type IndividualToolCallDisplay,
  ToolCallStatus,
} from '../types.js';

const NEWLINE = String.fromCharCode(10);

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

function toToolCallStatus(
  response: { result: unknown; error?: string } | undefined,
): ToolCallStatus {
  if (!response) {
    return ToolCallStatus.Pending;
  }
  return response.error ? ToolCallStatus.Error : ToolCallStatus.Success;
}

function buildResponseMap(
  contents: IContent[],
): Map<string, { result: unknown; error?: string }> {
  const map = new Map<string, { result: unknown; error?: string }>();
  for (const content of contents) {
    if (content.speaker !== 'tool') continue;
    for (const block of content.blocks) {
      if (block.type === 'tool_response') {
        map.set(block.callId, { result: block.result, error: block.error });
      }
    }
  }
  return map;
}

interface MarkdownSegment {
  kind: 'text' | 'code';
  value: string;
}

function appendTextSegment(segments: MarkdownSegment[], text: string): void {
  if (text === '') return;
  const lastSegment = segments.at(-1);
  if (lastSegment?.kind === 'text') {
    lastSegment.value += text;
  } else {
    segments.push({ kind: 'text', value: text });
  }
}

function combineMarkdownSegments(segments: MarkdownSegment[]): string {
  return segments.reduce((combined, segment) => {
    const needsSeparator =
      combined !== '' &&
      !combined.endsWith(NEWLINE) &&
      !segment.value.startsWith(NEWLINE);
    return combined + (needsSeparator ? NEWLINE : '') + segment.value;
  }, '');
}

function processAiContent(
  content: IContent,
  responseMap: Map<string, { result: unknown; error?: string }>,
  items: HistoryItem[],
  idCounter: { value: number },
): void {
  const segments: MarkdownSegment[] = [];
  const thinkingBlocks: ThinkingBlock[] = [];
  const toolCallBlocks: ToolCallBlock[] = [];

  for (const block of content.blocks) {
    switch (block.type) {
      case 'text':
        appendTextSegment(segments, block.text);
        break;
      case 'code':
        segments.push({
          kind: 'code',
          value: `\`\`\`${block.language ?? ''}\n${block.code}\n\`\`\``,
        });
        break;
      case 'thinking':
        thinkingBlocks.push(block);
        break;
      case 'tool_call':
        toolCallBlocks.push(block);
        break;
      default:
        break;
    }
  }
  const combinedText = combineMarkdownSegments(segments);

  if (combinedText) {
    items.push({
      id: idCounter.value--,
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
        status: toToolCallStatus(response),
        confirmationDetails: undefined,
      };
    });
    items.push({ id: idCounter.value--, type: 'tool_group', tools });
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
  const idCounter = { value: -1 };

  const responseMap = buildResponseMap(contents);

  for (const content of contents) {
    if (content.speaker === 'human') {
      const text = content.blocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (text) {
        items.push({ id: idCounter.value--, type: 'user', text });
      }
      continue;
    }

    if (content.speaker === 'ai') {
      processAiContent(content, responseMap, items, idCounter);
    }
  }

  return items;
}
