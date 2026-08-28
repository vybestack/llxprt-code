/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'bun:test';
import {
  internal_getToStyledCharactersCacheStats,
  internal_resetToStyledCharactersCache,
  toStyledCharacters,
} from '../../node_modules/ink/build/measure-text.js';

const MAX_RETAINED_STYLED_CHARACTER_CELLS = 65_536;
const CHURN_ENTRY_COUNT = 512;
const TEXT_CELL_COUNT = 512;
const ENTRIES_THAT_EXACTLY_FILL_COMBINED_BUDGET = 64;

function highEntropyText(index: number, cellCount: number): string {
  const blockCount = Math.ceil(cellCount / 64);
  const blocks = Array.from({ length: blockCount }, (_, block) =>
    createHash('sha256').update(`issue-3386:${index}:${block}`).digest('hex'),
  );
  return blocks.join('').slice(0, cellCount);
}

describe('Ink styled-character cache retention', () => {
  beforeEach(() => {
    internal_resetToStyledCharactersCache();
  });

  it('returns the same resident array and refreshes its recency on a cache hit', () => {
    const oldestText = highEntropyText(0, TEXT_CELL_COUNT);
    const secondOldestText = highEntropyText(1, TEXT_CELL_COUNT);
    const oldestResult = toStyledCharacters(oldestText);
    const secondOldestResult = toStyledCharacters(secondOldestText);
    for (
      let index = 2;
      index < ENTRIES_THAT_EXACTLY_FILL_COMBINED_BUDGET;
      index++
    ) {
      toStyledCharacters(highEntropyText(index, TEXT_CELL_COUNT));
    }

    const refreshed = toStyledCharacters(oldestText);
    toStyledCharacters(
      highEntropyText(
        ENTRIES_THAT_EXACTLY_FILL_COMBINED_BUDGET,
        TEXT_CELL_COUNT,
      ),
    );
    const oldestAfterEviction = toStyledCharacters(oldestText);
    const secondOldestAfterEviction = toStyledCharacters(secondOldestText);

    expect(refreshed).toBe(oldestResult);
    expect(oldestAfterEviction).toBe(oldestResult);
    expect(secondOldestAfterEviction).not.toBe(secondOldestResult);
  });

  it('bounds retained styled-character cells and entries after unique churn', () => {
    const texts = Array.from({ length: CHURN_ENTRY_COUNT }, (_, index) =>
      highEntropyText(index, TEXT_CELL_COUNT),
    );

    for (const text of texts) {
      toStyledCharacters(text);
    }
    const stats = internal_getToStyledCharactersCacheStats();

    expect(stats.entryCount).toBeLessThanOrEqual(
      MAX_RETAINED_STYLED_CHARACTER_CELLS / TEXT_CELL_COUNT,
    );
    expect(stats.styledCharacterCells).toBeLessThanOrEqual(
      MAX_RETAINED_STYLED_CHARACTER_CELLS,
    );
    expect(stats.dataSize).toBeLessThanOrEqual(
      MAX_RETAINED_STYLED_CHARACTER_CELLS,
    );
  });

  it('returns but does not cache one value larger than the cell budget', () => {
    const text = highEntropyText(
      CHURN_ENTRY_COUNT,
      MAX_RETAINED_STYLED_CHARACTER_CELLS + 1,
    );

    const first = toStyledCharacters(text);
    const statsAfterFirst = internal_getToStyledCharactersCacheStats();
    const second = toStyledCharacters(text);

    expect(first).toHaveLength(MAX_RETAINED_STYLED_CHARACTER_CELLS + 1);
    expect(statsAfterFirst).toEqual({
      entryCount: 0,
      dataSize: 0,
      styledCharacterCells: 0,
    });
    expect(second).not.toBe(first);
  });
});
