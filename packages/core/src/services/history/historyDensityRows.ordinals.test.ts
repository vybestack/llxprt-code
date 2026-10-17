/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryDensityRows } from './historyDensityRows.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('HistoryDensityRows source ordinals', () => {
  it('returns the ordinal a row was appended with and undefined for a row appended without one', () => {
    const rows = new HistoryDensityRows();
    try {
      rows.append(row('a'), 7);
      rows.append(row('summary'));
      rows.append(row('b'), 0);
      expect(
        [0, 1, 2].map((index) => rows.sourceOrdinalAt(index)),
      ).toStrictEqual([7, undefined, 0]);
      expect(rows.readRow(2)).toStrictEqual(row('b'));
    } finally {
      rows.close();
    }
  });

  it('keeps the ordinal of a row that is rewritten in place', () => {
    const rows = new HistoryDensityRows();
    try {
      rows.append(row('a'), 4);
      rows.append(row('b'), 5);
      rows.writeRow(0, row('rewritten'));
      expect(rows.readRow(0)).toStrictEqual(row('rewritten'));
      expect(rows.sourceOrdinalAt(0)).toBe(4);
      expect(rows.sourceOrdinalAt(1)).toBe(5);
    } finally {
      rows.close();
    }
  });

  it('refuses an index outside the appended rows', () => {
    const rows = new HistoryDensityRows();
    try {
      rows.append(row('a'), 1);
      expect(() => rows.sourceOrdinalAt(1)).toThrow('ordinal is invalid');
      expect(() => rows.sourceOrdinalAt(-1)).toThrow('ordinal is invalid');
    } finally {
      rows.close();
    }
  });
});
