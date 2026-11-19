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

const SCRATCHPAD_TAG = '<scratchpad';
const SCRATCHPAD_CLOSE = '</scratchpad>';
const STATE_SNAPSHOT_OPEN = '<state_snapshot>';
const STATE_SNAPSHOT_CLOSE = '</state_snapshot>';
const ASCII_UPPERCASE = /[A-Z]+/g;
const WORD_CHARACTER = /\w/;
const WHITESPACE = /\s/;

interface TextRange {
  readonly start: number;
  readonly end: number;
}

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
 * Tags match case-insensitively. Only ASCII letters are folded, as in a
 * non-unicode `/i` regex, so every offset in the folded text is the same
 * offset in the original. All tag searches below are index scans that run in
 * linear time, because the text comes from a model or a user.
 */
function foldTagCase(text: string): string {
  return text.replace(ASCII_UPPERCASE, (letters) => letters.toLowerCase());
}

/**
 * The element spans from its opening tag (see `findSnapshotStart`) to the
 * last `</state_snapshot>`, or to the end of the text when it never closes.
 */
function splitAroundSnapshot(text: string): SnapshotSplit {
  const folded = foldTagCase(text);
  const start = findSnapshotStart(folded);
  if (start === -1) {
    return { before: text, element: '', after: '' };
  }
  const lastClose = folded.lastIndexOf(STATE_SNAPSHOT_CLOSE);
  const end =
    lastClose < start ? text.length : lastClose + STATE_SNAPSHOT_CLOSE.length;
  return {
    before: text.slice(0, start),
    element: text.slice(start, end),
    after: text.slice(end),
  };
}

/**
 * A summarizer may name the tag while it reasons, so the element opens at the
 * first `<state_snapshot>` outside every complete scratchpad. When an
 * unterminated scratchpad precedes that tag, its reasoning runs on until the
 * real element, so a tag at the start of a line is preferred.
 */
function findSnapshotStart(folded: string): number {
  const openings = indexesOf(folded, STATE_SNAPSHOT_OPEN);
  const first = firstOutside(openings, completeScratchpads(folded));
  if (first === undefined) {
    return -1;
  }
  const precedingText = removeCompleteScratchpads(folded.slice(0, first));
  if (findScratchpadOpen(precedingText, 0) === undefined) {
    return first;
  }
  return (
    openings.find((index) => index >= first && startsLine(folded, index)) ??
    first
  );
}

function indexesOf(folded: string, needle: string): number[] {
  const indexes: number[] = [];
  let index = folded.indexOf(needle);
  while (index !== -1) {
    indexes.push(index);
    index = folded.indexOf(needle, index + needle.length);
  }
  return indexes;
}

/** `ranges` are sorted and disjoint, so one forward pass covers them all. */
function firstOutside(
  positions: readonly number[],
  ranges: readonly TextRange[],
): number | undefined {
  let rangeIndex = 0;
  for (const position of positions) {
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= position) {
      rangeIndex += 1;
    }
    if (rangeIndex === ranges.length || position < ranges[rangeIndex].start) {
      return position;
    }
  }
  return undefined;
}

/**
 * Only whitespace may precede the tag on its line. The scan stops at the
 * first other character, so scanning every tag stays linear overall.
 */
function startsLine(text: string, index: number): boolean {
  let cursor = index - 1;
  while (
    cursor >= 0 &&
    text.charAt(cursor) !== '\n' &&
    WHITESPACE.test(text.charAt(cursor))
  ) {
    cursor -= 1;
  }
  return cursor < 0 || text.charAt(cursor) === '\n';
}

function stripSegment(segment: string, snapshotFollows: boolean): string {
  const withoutBlocks = removeCompleteScratchpads(segment);
  const unterminated = findScratchpadOpen(foldTagCase(withoutBlocks), 0);
  if (unterminated === undefined) {
    return withoutBlocks;
  }
  return snapshotFollows ? '' : withoutBlocks.slice(0, unterminated.start);
}

function removeCompleteScratchpads(text: string): string {
  const ranges = completeScratchpads(foldTagCase(text));
  const keptStarts = [0, ...ranges.map((range) => range.end)];
  const keptEnds = [...ranges.map((range) => range.start), text.length];
  return keptStarts
    .map((start, index) => text.slice(start, keptEnds[index]))
    .join('');
}

/**
 * Each `<scratchpad …>` opening tag paired with the first `</scratchpad>`
 * after it. Once an opening tag has no closing tag after it, no later one
 * can have one either.
 */
function completeScratchpads(folded: string): TextRange[] {
  const ranges: TextRange[] = [];
  let opening = findScratchpadOpen(folded, 0);
  while (opening !== undefined) {
    const close = folded.indexOf(SCRATCHPAD_CLOSE, opening.end);
    if (close === -1) {
      return ranges;
    }
    const end = close + SCRATCHPAD_CLOSE.length;
    ranges.push({ start: opening.start, end });
    opening = findScratchpadOpen(folded, end);
  }
  return ranges;
}

/**
 * The first `<scratchpad` at or after `from` that is not the start of a
 * longer name, through the next `>`. When that tag never closes, no later
 * tag can either.
 */
function findScratchpadOpen(
  folded: string,
  from: number,
): TextRange | undefined {
  let start = folded.indexOf(SCRATCHPAD_TAG, from);
  while (
    start !== -1 &&
    WORD_CHARACTER.test(folded.charAt(start + SCRATCHPAD_TAG.length))
  ) {
    start = folded.indexOf(SCRATCHPAD_TAG, start + SCRATCHPAD_TAG.length);
  }
  if (start === -1) {
    return undefined;
  }
  const close = folded.indexOf('>', start + SCRATCHPAD_TAG.length);
  return close === -1 ? undefined : { start, end: close + 1 };
}

/**
 * Compression summaries carry `isSummary` and the snapshot reason tag.
 * Summaries produced before the tags existed (#2768) were human entries
 * whose only metadata was the summarizer's token usage, which no user
 * message carries. Such an entry is recognized when its whole text is a
 * scratchpad followed by a closed `<state_snapshot>` element.
 */
export function isCompressionSummary(content: IContent): boolean {
  return (
    hasSummaryTag(content) ||
    (content.metadata?.usage !== undefined && hasLegacySummaryShape(content))
  );
}

function hasSummaryTag(content: IContent): boolean {
  return (
    content.metadata?.isSummary === true ||
    content.metadata?.reason === 'compression-state-snapshot'
  );
}

/**
 * Tag the summary of a `compressed` journal record. Records written before
 * #2768 hold an untagged summary, and only compression writes that record,
 * so an entry there with the legacy summary shape is a summary even when
 * the summarizer reported no usage. Any other entry is returned unchanged.
 */
export function tagRecordedCompressionSummary(summary: IContent): IContent {
  if (hasSummaryTag(summary) || !hasLegacySummaryShape(summary)) {
    return summary;
  }
  return { ...summary, metadata: { ...summary.metadata, isSummary: true } };
}

function hasLegacySummaryShape(content: IContent): boolean {
  return (
    content.speaker === 'human' &&
    content.blocks.some(
      (block) => block.type === 'text' && isLegacySummaryText(block.text),
    )
  );
}

/**
 * After surrounding whitespace: an opening scratchpad tag first, a
 * `<state_snapshot>` after it, and `</state_snapshot>` last.
 */
function isLegacySummaryText(text: string): boolean {
  const folded = foldTagCase(text.trim());
  const opening = findScratchpadOpen(folded, 0);
  if (
    opening === undefined ||
    opening.start !== 0 ||
    !folded.endsWith(STATE_SNAPSHOT_CLOSE)
  ) {
    return false;
  }
  const snapshot = folded.indexOf(STATE_SNAPSHOT_OPEN, opening.end);
  return (
    snapshot !== -1 &&
    snapshot + STATE_SNAPSHOT_OPEN.length <=
      folded.length - STATE_SNAPSHOT_CLOSE.length
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
