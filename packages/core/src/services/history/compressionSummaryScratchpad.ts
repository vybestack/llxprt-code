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
 * recover. Only entries tagged as compression summaries are touched.
 */

import type { ContentBlock, IContent } from './IContent.js';

const COMPLETE_SCRATCHPAD = /<scratchpad>[\s\S]*?<\/scratchpad>/gi;
const LEADING_SCRATCHPAD = /^\s*<scratchpad>/i;
const STATE_SNAPSHOT_OPEN = '<state_snapshot>';

/**
 * Remove every `<scratchpad>…</scratchpad>` block and an unterminated leading
 * `<scratchpad>` section (up to the `<state_snapshot>`, or the whole text when
 * no snapshot follows). Text without a scratchpad is returned unchanged.
 */
export function stripScratchpadSections(text: string): string {
  const withoutBlocks = text.replace(COMPLETE_SCRATCHPAD, '');
  const leading = LEADING_SCRATCHPAD.exec(withoutBlocks);
  const stripped =
    leading === null
      ? withoutBlocks
      : stripUnterminatedLeading(withoutBlocks, leading[0].length);
  return stripped === text ? text : stripped.trim();
}

function stripUnterminatedLeading(text: string, sectionStart: number): string {
  const snapshotStart = text
    .toLowerCase()
    .indexOf(STATE_SNAPSHOT_OPEN, sectionStart);
  return snapshotStart === -1 ? '' : text.slice(snapshotStart);
}

/** Compression summaries carry `isSummary` and the snapshot reason tag. */
export function isCompressionSummary(content: IContent): boolean {
  return (
    content.metadata?.isSummary === true ||
    content.metadata?.reason === 'compression-state-snapshot'
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
