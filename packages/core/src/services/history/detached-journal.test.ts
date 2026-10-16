/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { detachedRow } from './detached-rollback-test-helpers.js';

describe('ordinal detached value journal', () => {
  it('preserves original markers by ordinal after candidate updates and releases returned cursors', () => {
    const owners = new RowOwnership();
    const journal = new DetachedHistoryJournal(owners);
    try {
      const alias = detachedRow(0);
      journal.append(alias);
      journal.append(alias);
      journal.writeRow(0, detachedRow(8));
      expect(journal.readRow(0).metadata?.chronology?.seq).toBe(9);
      expect(journal.readRow(1)).toStrictEqual(detachedRow(0));
      expect(journal.readOriginalMarker(0)).toStrictEqual({
        hadMetadata: true,
        chronology: detachedRow(0).metadata?.chronology,
      });
      const cursor = journal[Symbol.iterator]();
      cursor.next();
      expect(owners.snapshot().liveRows).toBe(1);
      cursor.return();
      expect(owners.snapshot().liveRows).toBe(0);
    } finally {
      journal.close();
    }
    expect(() => journal.readRow(0)).toThrow('closed');
  });
});
