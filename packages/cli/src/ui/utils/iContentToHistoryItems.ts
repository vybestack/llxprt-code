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
  EmojiFilter,
  type EmojiFilterMode,
} from '@vybestack/llxprt-code-core';
import {
  type HistoryItem,
  type HistoryItemAi,
  type HistoryItemAiContent,
  type HistoryItemWithoutId,
  type IndividualToolCallDisplay,
  MessageType,
  ToolCallStatus,
} from '../types.js';

const NEWLINE = String.fromCharCode(10);

/** History item types whose text is model-authored and therefore filtered. */
const MODEL_TEXT_ITEM_TYPES: ReadonlySet<string> = new Set([
  'gemini',
  'gemini_content',
]);

/** Error item text used when replayed model text is blocked (error mode). */
export const EMOJI_BLOCKED_ERROR_TEXT =
  '[Error: Response blocked due to emoji detection]';

/**
 * Minimal settings surface needed to resolve the emoji filter mode. The
 * interactive runtime and the streaming runtime's ephemeral slice both
 * satisfy this structurally.
 */
export interface EmojiFilterSettingsSource {
  getEphemeralSetting(key: string): unknown;
}

/** Recognized `emojifilter` ephemeral setting values. */
const EMOJI_FILTER_MODES: ReadonlySet<string> = new Set([
  'allowed',
  'warn',
  'error',
  'auto',
]);

/**
 * Resolves the active emoji filter mode the same way the live streaming path
 * (useStreamState's useEmojiFilterMode) does: the `emojifilter` ephemeral
 * setting when it holds a recognized mode, otherwise 'auto'. Unrecognized
 * values fall back to 'auto' (matching nonInteractiveCli's validated
 * resolution) instead of reaching EmojiFilter unvalidated.
 */
export function resolveEmojiFilterMode(
  settings: EmojiFilterSettingsSource | null | undefined,
): EmojiFilterMode {
  const rawMode = settings?.getEphemeralSetting('emojifilter');
  return typeof rawMode === 'string' && EMOJI_FILTER_MODES.has(rawMode)
    ? (rawMode as EmojiFilterMode)
    : 'auto';
}

/**
 * Builds the emoji filter for history replay. Absent → 'auto', matching the
 * live streaming path. `allowed` disables filtering so recorded text replays
 * verbatim.
 */
export function createEmojiFilter(
  mode: EmojiFilterMode | undefined,
): EmojiFilter | undefined {
  return mode !== 'allowed'
    ? new EmojiFilter({ mode: mode ?? 'auto' })
    : undefined;
}

function filterThinkingBlocks(
  blocks: ThinkingBlock[] | undefined,
  filter: EmojiFilter,
): ThinkingBlock[] | undefined {
  if (blocks === undefined) {
    return undefined;
  }
  // Live thoughts are sanitized the same way: a blocked thought renders as
  // empty text (applyThoughtToState in agentStream/thoughtState.ts).
  return blocks.map((block) => {
    const result = filter.filterText(block.thought);
    return {
      ...block,
      thought:
        !result.blocked && typeof result.filtered === 'string'
          ? result.filtered
          : '',
    };
  });
}

/**
 * Applies the emoji filter to replayed history items, mirroring how the live
 * streaming path commits turns (commitAiPendingItem in useStreamState.ts):
 *
 * - Model items (gemini/gemini_content) have text and thinking text
 *   filtered; warn-mode system feedback is appended as an info item.
 * - A blocked model item (error mode) is replaced by the same error item the
 *   live path renders, followed by the filter's system feedback when present.
 * - User input and non-text items (e.g. tool groups) replay verbatim — the
 *   live path never filters user-authored text.
 *
 * Parity is defined on the final committed transcript: each reconstructed
 * turn is filtered as a whole, and feedback follows the live flush-time
 * ordering (after the model item). Intra-turn streaming interleavings the
 * live pipeline can produce (push-time feedback before the item, or an early
 * paragraph committed before a later emoji blocks the turn) are not
 * reproduced by replay.
 */
export function filterHistoryItems(
  items: HistoryItemWithoutId[],
  filter: EmojiFilter | undefined,
): HistoryItemWithoutId[] {
  if (filter === undefined) {
    return items;
  }
  return items.flatMap((item): HistoryItemWithoutId[] => {
    if (
      !MODEL_TEXT_ITEM_TYPES.has(item.type) ||
      typeof item.text !== 'string'
    ) {
      return [item];
    }
    const model = item as HistoryItemAi | HistoryItemAiContent;
    const result = filter.filterText(model.text);
    const feedback: HistoryItemWithoutId[] =
      result.systemFeedback !== undefined
        ? [{ type: MessageType.INFO, text: result.systemFeedback }]
        : [];
    if (result.blocked) {
      return [
        { type: MessageType.ERROR, text: EMOJI_BLOCKED_ERROR_TEXT },
        ...feedback,
      ];
    }
    const filteredText =
      typeof result.filtered === 'string' ? result.filtered : '';
    const thinkingBlocks = filterThinkingBlocks(model.thinkingBlocks, filter);
    return [
      {
        ...model,
        text: filteredText,
        ...(thinkingBlocks !== undefined ? { thinkingBlocks } : {}),
      },
      ...feedback,
    ];
  });
}

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
  items: HistoryItemWithoutId[],
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
    items.push({ type: 'tool_group', tools });
  }
}

/**
 * Converts provider-agnostic IContent[] (from session recording) into
 * UI HistoryItem[] for display.  Only block types renderable in the CLI
 * are converted — MediaBlock is intentionally omitted because the CLI UI
 * does not render inline images or file attachments.
 *
 * Reconstructed model text is filtered through the same EmojiFilter rule
 * as the live streaming path (`emojifilter` ephemeral, default `auto`), so
 * resume/restore re-displays match live filtered output (issue #2888):
 * blocked turns replay as the same error item the live path renders, and
 * warn-mode feedback is appended as an info item. User-authored text replays
 * verbatim.
 *
 * @param emojiFilterModeOverride The resolved filter mode; defaults to
 *   'auto'. Pass `'allowed'` (or `resolveEmojiFilterMode`'s output) to
 *   honor the current setting.
 */
export function iContentToHistoryItems(
  contents: IContent[],
  emojiFilterModeOverride?: EmojiFilterMode,
): HistoryItem[] {
  const filter = createEmojiFilter(emojiFilterModeOverride);
  const items: HistoryItemWithoutId[] = [];

  const responseMap = buildResponseMap(contents);

  for (const content of contents) {
    if (content.speaker === 'human') {
      const text = content.blocks
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      if (text) {
        items.push({ type: 'user', text });
      }
      continue;
    }

    if (content.speaker === 'ai') {
      processAiContent(content, responseMap, items);
    }
  }

  // Filter before assigning negative IDs (they only need to avoid collisions
  // with live IDs, which are always positive) so items expanded by the filter
  // (blocked turns become error + feedback items) each get a unique ID.
  return filterHistoryItems(items, filter).map((item, index) => ({
    ...item,
    id: -1 - index,
  }));
}
