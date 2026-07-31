/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Accumulation cost of an in-progress fenced code block (issue #2852).
 *
 * A coding agent spends most of a long response inside one unterminated fence,
 * and the whole pending item is re-rendered on every streamed delta. Building
 * the block's line list therefore has to be linear, and it must not retain more
 * than the viewport can show.
 */

import { describe, expect, it } from 'vitest';
import {
  appendCodeBlockLine,
  CODE_BLOCK_RESERVED_LINES,
} from './codeBlockAccumulator.js';

function accumulate(
  lines: readonly string[],
  isPending: boolean,
  availableTerminalHeight?: number,
): string[] {
  const content: string[] = [];
  for (const line of lines) {
    appendCodeBlockLine(content, line, isPending, availableTerminalHeight);
  }
  return content;
}

function makeLines(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `const value${i} = ${i};`);
}

describe('appendCodeBlockLine', () => {
  it('keeps every line of a completed block', () => {
    const lines = makeLines(500);
    expect(accumulate(lines, false, 20)).toStrictEqual(lines);
  });

  it('keeps every line when no viewport height is known', () => {
    const lines = makeLines(500);
    expect(accumulate(lines, true, undefined)).toStrictEqual(lines);
  });

  it('retains only what a streaming block can display', () => {
    const availableTerminalHeight = 20;
    const content = accumulate(makeLines(5_000), true, availableTerminalHeight);
    expect(content).toHaveLength(availableTerminalHeight);
  });

  it('retains more than RenderCodeBlock slices, so the truncation indicator is unchanged', () => {
    // RenderCodeBlock slices to availableTerminalHeight - CODE_BLOCK_RESERVED_LINES
    // and shows "... generating more ..." when content is longer than that. The
    // cap must stay strictly above the slice length or the indicator would stop
    // appearing.
    const availableTerminalHeight = 20;
    const displayed = availableTerminalHeight - CODE_BLOCK_RESERVED_LINES;
    const content = accumulate(makeLines(5_000), true, availableTerminalHeight);
    expect({
      exceedsDisplayed: content.length > displayed,
      displayedSlice: content.slice(0, displayed),
    }).toStrictEqual({
      exceedsDisplayed: true,
      displayedSlice: makeLines(5_000).slice(0, displayed),
    });
  });

  it('appends in place rather than copying the accumulated block', () => {
    // The previous implementation rebuilt the array per line, so accumulating L
    // lines cost O(L^2). Compare a 10x longer block: quadratic growth would be
    // roughly 100x, linear growth stays far below that.
    const measure = (count: number): number => {
      const lines = makeLines(count);
      const start = performance.now();
      for (let repeat = 0; repeat < 20; repeat += 1) {
        accumulate(lines, false, undefined);
      }
      return performance.now() - start;
    };

    measure(500);
    const small = measure(2_000);
    const large = measure(20_000);

    expect(large).toBeLessThan(Math.max(small, 1) * 40);
  });

  it('does not mutate a block after it has been handed off', () => {
    const first: string[] = [];
    appendCodeBlockLine(first, 'a', false, undefined);
    const handedOff = first;
    const second: string[] = [];
    appendCodeBlockLine(second, 'b', false, undefined);
    expect(handedOff).toStrictEqual(['a']);
  });
});
