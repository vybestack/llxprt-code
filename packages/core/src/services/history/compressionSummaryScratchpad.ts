/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scratchpad removal for compression summaries (issue #4128).
 *
 * Anthropic refuses any request whose context contains a `<scratchpad>` as
 * `reasoning_extraction`. Older compression prompts asked the summarizer for
 * one, and a summary that kept it poisoned every later request of the
 * session. Summaries are cleaned when they are produced and again when
 * history is converted for a provider, so sessions that already carry one
 * recover. Only compression summaries are touched.
 */

import type { ContentBlock, IContent } from './IContent.js';

const COMPLETE_SCRATCHPAD = /<scratchpad\b[^>]*>[\s\S]*?<\/scratchpad>/gi;
const SCRATCHPAD_OPEN = /<scratchpad\b[^>]*>/i;
const STATE_SNAPSHOT_OPEN = '<state_snapshot>';
const STATE_SNAPSHOT_CLOSE = '</state_snapshot>';

interface SnapshotSplit {
  readonly before: string;
  readonly element: string;
  readonly after: string;
}

/**
 * Remove scratchpad sections outside the `<state_snapshot>` element: every
 * `<scratchpad …>…</scratchpad>` block, everything before the snapshot when
 * an unterminated scratchpad opens there, and an unterminated scratchpad
 * after the snapshot (or in text without one) up to the end. The element
 * itself is never altered, because a snapshot may quote the tag. Text
 * without a scratchpad is returned unchanged.
 */
export function stripScratchpadSections(text: string): string {
  const { before, element, after } = splitAroundSnapshot(text);
  const stripped =
    stripSegment(before, element !== '') + element + stripSegment(after, false);
  return stripped === text ? text : stripped.trim();
}

/**
 * The element spans the first `<state_snapshot>` to the last
 * `</state_snapshot>`, or to the end of the text when it never closes.
 */
function splitAroundSnapshot(text: string): SnapshotSplit {
  const lower = text.toLowerCase();
  const start = lower.indexOf(STATE_SNAPSHOT_OPEN);
  if (start === -1) {
    return { before: text, element: '', after: '' };
  }
  const lastClose = lower.lastIndexOf(STATE_SNAPSHOT_CLOSE);
  const end =
    lastClose < start ? text.length : lastClose + STATE_SNAPSHOT_CLOSE.length;
  return {
    before: text.slice(0, start),
    element: text.slice(start, end),
    after: text.slice(end),
  };
}

function stripSegment(segment: string, snapshotFollows: boolean): string {
  const withoutBlocks = segment.replace(COMPLETE_SCRATCHPAD, '');
  const unterminated = SCRATCHPAD_OPEN.exec(withoutBlocks);
  if (unterminated === null) {
    return withoutBlocks;
  }
  return snapshotFollows ? '' : withoutBlocks.slice(0, unterminated.index);
}

const LEGACY_SUMMARY_START = /^\s*<scratchpad\b/i;

/**
 * Compression summaries carry `isSummary` and the snapshot reason tag.
 * Summaries recorded before the tags existed (#2768) are recognized by shape:
 * a human entry that opens with a scratchpad and holds a `<state_snapshot>`.
 */
export function isCompressionSummary(content: IContent): boolean {
  return (
    content.metadata?.isSummary === true ||
    content.metadata?.reason === 'compression-state-snapshot' ||
    hasLegacySummaryShape(content)
  );
}

function hasLegacySummaryShape(content: IContent): boolean {
  return (
    content.speaker === 'human' &&
    content.blocks.some(
      (block) =>
        block.type === 'text' &&
        LEGACY_SUMMARY_START.test(block.text) &&
        block.text.includes(STATE_SNAPSHOT_OPEN),
    )
  );
}

/**
 * Strip scratchpad sections from the compression summaries in `contents`.
 * Every other entry, and every summary without a scratchpad, is returned as
 * the same object. A summary left with no content at all is dropped.
 */
export function stripScratchpadFromCompressionSummaries(
  contents: readonly IContent[],
): IContent[] {
  return contents.flatMap((content) => {
    if (!isCompressionSummary(content)) {
      return [content];
    }
    const blocks = stripBlocks(content.blocks);
    if (blocks === content.blocks) {
      return [content];
    }
    return blocks.length === 0 ? [] : [{ ...content, blocks }];
  });
}

function stripBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const stripped = blocks.flatMap((block): ContentBlock[] => {
    if (block.type !== 'text') {
      return [block];
    }
    const text = stripScratchpadSections(block.text);
    if (text === block.text) {
      return [block];
    }
    return text === '' ? [] : [{ ...block, text }];
  });
  const unchanged =
    stripped.length === blocks.length &&
    stripped.every((block, index) => block === blocks[index]);
  return unchanged ? blocks : stripped;
}
