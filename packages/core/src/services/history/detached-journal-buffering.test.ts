/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { detachedRow } from './detached-rollback-test-helpers.js';

function journalWrites(): { count: () => number } {
  const descriptors = new Set<number>();
  const originalOpen = fs.openSync;
  const originalWrite = fs.writeSync;
  let writes = 0;
  vi.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
    const fd = originalOpen(path, flags, mode);
    if (String(path).includes('history-detached-')) descriptors.add(fd);
    return fd;
  });
  vi.spyOn(fs, 'writeSync').mockImplementation(
    (fd: number, data: NodeJS.ArrayBufferView, ...rest: number[]): number => {
      if (descriptors.has(fd)) writes++;
      return originalWrite(fd, data, ...rest);
    },
  );
  return { count: () => writes };
}

describe('detached journal buffered appends', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('appends thousands of rows with far fewer system writes than rows', () => {
    const writes = journalWrites();
    const journal = new DetachedHistoryJournal();
    try {
      for (let index = 0; index < 4000; index++)
        journal.append(detachedRow(index, 64));
      journal.settle();
      expect(writes.count()).toBeLessThan(100);
      expect(journal.length).toBe(4000);
      expect(journal.readRow(0)).toStrictEqual(detachedRow(0, 64));
      expect(journal.readRow(3999)).toStrictEqual(detachedRow(3999, 64));
    } finally {
      journal.close();
    }
  });

  it('reads rows and markers appended since the last flush', () => {
    const journal = new DetachedHistoryJournal();
    try {
      journal.append(detachedRow(1));
      expect(journal.readRow(0)).toStrictEqual(detachedRow(1));
      journal.append(detachedRow(2));
      journal.append(detachedRow(3));
      expect(journal.readOriginalMarker(2)).toStrictEqual({
        hadMetadata: true,
        chronology: detachedRow(3).metadata?.chronology,
      });
      expect([...journal]).toStrictEqual([
        detachedRow(1),
        detachedRow(2),
        detachedRow(3),
      ]);
    } finally {
      journal.close();
    }
  });

  it('rewrites a buffered row and keeps its original marker', () => {
    const journal = new DetachedHistoryJournal();
    try {
      for (let index = 0; index < 5; index++)
        journal.append(detachedRow(index));
      journal.writeRow(4, detachedRow(40));
      journal.writeRow(0, detachedRow(50));
      journal.append(detachedRow(5));
      expect(journal.readRow(4)).toStrictEqual(detachedRow(40));
      expect(journal.readRow(0)).toStrictEqual(detachedRow(50));
      expect(journal.readRow(5)).toStrictEqual(detachedRow(5));
      expect(journal.readOriginalMarker(4).chronology).toStrictEqual(
        detachedRow(4).metadata?.chronology,
      );
    } finally {
      journal.close();
    }
  });

  it('reports a failed write when the buffered rows are settled', () => {
    const journal = new DetachedHistoryJournal();
    try {
      journal.append(detachedRow(1));
      vi.spyOn(fs, 'writeSync').mockImplementation(() => 0);
      expect(() => journal.settle()).toThrow('I/O made no progress');
    } finally {
      vi.restoreAllMocks();
      journal.close();
    }
  });
});
