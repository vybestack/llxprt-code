/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import {
  FIRST_NEXT_LABEL,
  LABEL_STEP,
  allocateAppendLabels,
  compressionLabel,
  labelBetween,
} from './labels.js';

describe('append labels (design 2.6)', () => {
  it('hands out nextLabel and then moves it on by 2^20 for each row', () => {
    const { labels, nextLabel } = allocateAppendLabels(5n, 3);

    expect(labels).toStrictEqual([5n, 5n + LABEL_STEP, 5n + 2n * LABEL_STEP]);
    expect(nextLabel).toBe(5n + 3n * LABEL_STEP);
    expect(LABEL_STEP).toBe(1048576n);
  });

  it('allocates nothing for no rows', () => {
    expect(allocateAppendLabels(9n, 0)).toStrictEqual({
      labels: [],
      nextLabel: 9n,
    });
  });

  it('starts above 0 with room below the first row', () => {
    const { labels } = allocateAppendLabels(FIRST_NEXT_LABEL, 1);

    expect(labels[0]).toBeGreaterThan(1n);
  });

  it('refuses a label that would pass 64 bits', () => {
    expect(() => allocateAppendLabels((1n << 64n) - 1n, 1)).toThrow(
      JournalFormatError,
    );
  });

  it('never reuses a label: the next label only grows', () => {
    const first = allocateAppendLabels(FIRST_NEXT_LABEL, 4);
    const second = allocateAppendLabels(first.nextLabel, 4);

    const all = [...first.labels, ...second.labels];
    expect(new Set(all).size).toBe(8);
    expect(all).toStrictEqual([...all].sort((a, b) => (a < b ? -1 : 1)));
  });
});

describe('insert labels', () => {
  it('is the midpoint of the two neighbours', () => {
    expect(labelBetween(10n, 20n)).toBe(15n);
    expect(labelBetween(10n, 13n)).toBe(11n);
  });

  it('has no midpoint between adjacent labels, which tells the caller to relabel the run', () => {
    expect(labelBetween(10n, 11n)).toBeUndefined();
    expect(labelBetween(10n, 10n)).toBeUndefined();
  });

  it('refuses neighbours out of order', () => {
    expect(() => labelBetween(20n, 10n)).toThrow(JournalFormatError);
  });
});

describe('compression label', () => {
  it('sits just below the first retained row', () => {
    expect(compressionLabel(100n, 500n)).toBe(99n);
  });

  it('is nextLabel when nothing is retained', () => {
    expect(compressionLabel(undefined, 500n)).toBe(500n);
  });

  it('refuses a first retained row that leaves no label below it', () => {
    expect(() => compressionLabel(1n, 500n)).toThrow(JournalFormatError);
  });
});
