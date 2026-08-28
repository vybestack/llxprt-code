/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'bun:test';
import Ink from '../../node_modules/ink/build/ink.js';
import {
  clearStringWidthCache,
  inkCharacterWidth,
  internal_getToStyledCharactersCacheStats,
  internal_getWidthCacheStats,
  internal_resetToStyledCharactersCache,
  toStyledCharacters,
} from '../../node_modules/ink/build/measure-text.js';

const MAX_CACHE_DATA_SIZE = 65_536;
const MAX_RETAINED_STATIC_OUTPUT_CODE_UNITS = 4 * 1024 * 1024;
const MAX_RETAINED_STATIC_OUTPUT_CHUNKS = 1_024;
const CHURN_ENTRY_COUNT = 512;
const WIDTH_CHURN_ENTRY_COUNT = 12_000;
const TEXT_CELL_COUNT = 512;
const ENTRIES_THAT_EXACTLY_FILL_COMBINED_BUDGET = 64;

interface InkStaticOutputInternals {
  fullStaticOutputChunks: string[];
  fullStaticOutputLength: number;
  readonly fullStaticOutput: string;
  appendStaticOutput(output: string): boolean;
  staticOutputForRender(output: string): string;
}

function inkStaticOutputInternals(): InkStaticOutputInternals {
  const ink = Object.create(Ink.prototype) as InkStaticOutputInternals;
  ink.fullStaticOutputChunks = [];
  ink.fullStaticOutputLength = 0;
  return ink;
}

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
      MAX_CACHE_DATA_SIZE / TEXT_CELL_COUNT,
    );
    expect(stats.styledCharacterCells).toBeLessThanOrEqual(MAX_CACHE_DATA_SIZE);
    expect(stats.dataSize).toBeLessThanOrEqual(MAX_CACHE_DATA_SIZE);
  });

  it('returns but does not cache one value larger than the cell budget', () => {
    const text = highEntropyText(CHURN_ENTRY_COUNT, MAX_CACHE_DATA_SIZE + 1);

    const first = toStyledCharacters(text);
    const statsAfterFirst = internal_getToStyledCharactersCacheStats();
    const second = toStyledCharacters(text);

    expect(first).toHaveLength(MAX_CACHE_DATA_SIZE + 1);
    expect(statsAfterFirst).toEqual({
      entryCount: 0,
      dataSize: 0,
      styledCharacterCells: 0,
    });
    expect(second).not.toBe(first);
  });
});

describe('Ink string-width cache retention', () => {
  beforeEach(() => {
    clearStringWidthCache();
  });

  it('keeps multi-code-unit grapheme churn within both cache budgets', () => {
    for (let index = 0; index < WIDTH_CHURN_ENTRY_COUNT; index += 1) {
      inkCharacterWidth(`👩🏽‍💻${index.toString(36).padStart(4, '0')}`);
    }

    const stats = internal_getWidthCacheStats();
    expect(stats.entryCount).toBeLessThanOrEqual(10_000);
    expect(stats.dataSize).toBeLessThanOrEqual(MAX_CACHE_DATA_SIZE);
    expect(stats.maxKeyLength).toBeGreaterThan(1);
  });

  it('refreshes width-cache recency on a cache hit', () => {
    const firstKey = 'A';
    inkCharacterWidth(firstKey);
    for (let index = 0; index < 9_999; index += 1) {
      inkCharacterWidth(String.fromCharCode(0x3000 + index));
    }

    inkCharacterWidth(firstKey);
    inkCharacterWidth('Z');

    const stats = internal_getWidthCacheStats();
    expect(stats.entryCount).toBe(10_000);
    expect(stats.oldestKey).not.toBe(firstKey);
    expect(stats.newestKey).toBe('Z');
  });
});

describe('Ink lifetime static-output retention', () => {
  it('evicts whole oldest chunks when retained output crosses the budget', () => {
    const ink = inkStaticOutputInternals();
    const chunkLength = MAX_RETAINED_STATIC_OUTPUT_CODE_UNITS / 2;
    const first = 'a'.repeat(chunkLength);
    const second = 'b'.repeat(chunkLength);
    const third = 'c'.repeat(chunkLength);

    expect(ink.appendStaticOutput(first)).toBe(true);
    expect(ink.appendStaticOutput(second)).toBe(true);
    expect(ink.appendStaticOutput(third)).toBe(true);

    expect(ink.fullStaticOutputLength).toBe(
      MAX_RETAINED_STATIC_OUTPUT_CODE_UNITS,
    );
    expect(ink.fullStaticOutputChunks).toEqual([second, third]);
    expect(ink.fullStaticOutput).toBe(second + third);
  });

  it('bounds retained chunk count when static writes are small', () => {
    const ink = inkStaticOutputInternals();

    for (
      let index = 0;
      index <= MAX_RETAINED_STATIC_OUTPUT_CHUNKS;
      index += 1
    ) {
      expect(ink.appendStaticOutput(`${index}\n`)).toBe(true);
    }

    expect(ink.fullStaticOutputChunks).toHaveLength(
      MAX_RETAINED_STATIC_OUTPUT_CHUNKS,
    );
    expect(ink.fullStaticOutputChunks[0]).toBe('1\n');
  });

  it('does not retain one current-render chunk larger than the budget', () => {
    const ink = inkStaticOutputInternals();
    const retained = 'retained history\n';
    const oversized = 'x'.repeat(MAX_RETAINED_STATIC_OUTPUT_CODE_UNITS + 1);

    expect(ink.appendStaticOutput(retained)).toBe(true);
    expect(ink.staticOutputForRender(oversized)).toBe(retained + oversized);

    expect(ink.fullStaticOutputLength).toBe(retained.length);
    expect(ink.fullStaticOutputChunks).toEqual([retained]);
    expect(ink.fullStaticOutput).toBe(retained);
  });
});
