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
    // The previous implementation rebuilt the array per line with
    // `[...content, line]`, so accumulating L lines cost O(L^2). Array identity
    // is a deterministic witness for that: a copying implementation cannot keep
    // the same array across appends. This is checked by identity rather than by
    // elapsed time so it cannot flake on a loaded machine.
    const content: string[] = [];
    const identityAtStart = content;
    for (const line of makeLines(10_000)) {
      appendCodeBlockLine(content, line, false, undefined);
    }
    expect({
      sameArray: content === identityAtStart,
      length: content.length,
    }).toStrictEqual({ sameArray: true, length: 10_000 });
  });

  it('leaves a closed block untouched while the next one accumulates', () => {
    // RenderCodeBlock receives the array when a fence closes and a fresh array
    // replaces it, so in-place appending must never reach back into the one
    // already handed off.
    const closed: string[] = [];
    appendCodeBlockLine(closed, 'first-block', false, undefined);

    const next: string[] = [];
    for (const line of makeLines(50)) {
      appendCodeBlockLine(next, line, false, undefined);
    }

    expect(closed).toStrictEqual(['first-block']);
  });

  it('still retains a line when the terminal is too short to display any', () => {
    // availableTerminalHeight below the reserved lines must not cap retention
    // at zero, or the block would render empty instead of showing the
    // "code is being written" placeholder.
    const content = accumulate(makeLines(100), true, 0);
    expect(content.length).toBeGreaterThan(0);
  });
});
