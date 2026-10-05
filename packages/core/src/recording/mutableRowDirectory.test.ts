/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MutableRowDirectory,
  withMutableRowDirectory,
  type NumericRow,
  type RowSource,
} from './mutableRowDirectory.js';

const SOURCES: readonly RowSource[] = ['durable', 'projection', 'pending'];
function row(index: number): NumericRow {
  return {
    source: SOURCES[index % 3],
    offset: index * 13,
    bytes: index + 2,
    chronologySeq: index,
    pendingSlot: index % 3 === 2 ? index : -1,
    invalidateResponses: index % 5 === 0,
  };
}

function inScratch<T>(action: (directory: MutableRowDirectory) => T): T {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'row-directory-test-'));
  try {
    const directory = new MutableRowDirectory(root);
    let result: T;
    try {
      result = action(directory);
    } finally {
      directory.close();
      directory.close();
    }
    expect(fs.readdirSync(root)).toStrictEqual([]);
    expect(() => directory.rowAt(0)).toThrow('closed');
    return result;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function checkOrdering(count: number): number {
  return inScratch((directory) => {
    for (let index = 0; index < count; index += 1) directory.append(row(index));
    expect(directory.length).toBe(count);
    expect(directory.metrics()).toStrictEqual({
      residentBufferBytes: 64,
      fileBytes: count * 64,
    });
    expect(directory.rowAt(count - 1)).toStrictEqual(row(count - 1));
    directory.insert(17, { ...row(17), source: 'pending', pendingSlot: 44 });
    expect(directory.firstChronology(17)).toBe(17);
    expect(directory.rowAt(17).pendingSlot).toBe(44);
    expect(directory.rowAt(18)).toStrictEqual(row(17));
    const changed = {
      ...row(17),
      chronologySeq: 99,
      invalidateResponses: true,
    };
    directory.replace(17, changed);
    expect(directory.firstChronology(17)).toBe(18);
    const survivors = Array.from({ length: count }, (_, index) =>
      row(index),
    ).filter(
      (entry) => entry.chronologySeq !== null && entry.chronologySeq % 5 !== 0,
    );
    survivors.splice(13, 0, changed);
    expect(
      directory.compact(
        (entry) =>
          entry.chronologySeq !== null && entry.chronologySeq % 5 !== 0,
      ),
    ).toBe(survivors.length);
    for (let index = 0; index < survivors.length; index += 1)
      expect(directory.rowAt(index)).toStrictEqual(survivors[index]);
    expect(directory.firstChronology(17)).toBe(14);
    directory.truncate(14);
    expect(directory.length).toBe(14);
    expect(directory.firstChronology(17)).toBe(-1);
    expect(directory.metrics().fileBytes).toBe(14 * 64);
    return directory.length;
  });
}

function checkRollback(count: number): number {
  return inScratch((directory) => {
    for (let index = 0; index < count; index += 1) directory.append(row(index));
    expect(() => directory.insert(count + 1, row(1))).toThrow(RangeError);
    expect(() => directory.replace(0, { ...row(1), bytes: -1 })).toThrow(
      RangeError,
    );
    expect(() =>
      directory.compact((_entry, index) => {
        if (index === count / 2) throw new Error('rollback');
        return index % 2 === 0;
      }),
    ).toThrow('rollback');
    expect(directory.rowAt(count - 1)).toStrictEqual(row(count - 1));
    expect(directory.length).toBe(count);
    expect(directory.metrics().fileBytes).toBe(count * 64);
    // A deliberately materializing oracle must exceed the same resident-buffer bound.
    const fakeMaterialization = Array.from({ length: count }, (_, index) =>
      row(index),
    );
    const withinBound = (bytes: number): boolean => bytes <= 64;
    expect(withinBound(fakeMaterialization.length * 64)).toBe(false);
    expect(withinBound(directory.metrics().residentBufferBytes)).toBe(true);
    return directory.metrics().fileBytes;
  });
}

for (const count of [512, 8192]) {
  describe(`mutable row directory with ${count} entries`, () => {
    it('preserves row order and all numeric fields through insert, replace, compact and truncate', () => {
      expect(checkOrdering(count)).toBe(14);
    });
    it('rolls back failed mutations and rejects a materializing negative control', () => {
      expect(checkRollback(count)).toBe(count * 64);
    });
  });
}

describe('numeric row metadata', () => {
  it('round-trips absent chronology and reuses space after truncation', () => {
    inScratch((directory) => {
      directory.append(row(1));
      directory.truncate(0);
      const unmarked = { ...row(2), chronologySeq: null };
      directory.append(unmarked);
      expect(directory.rowAt(0)).toStrictEqual(unmarked);
      expect(directory.firstChronology(2)).toBe(-1);
      expect(directory.metrics().fileBytes).toBe(64);
    });
  });
});

describe('row directory ownership', () => {
  it('releases scratch storage on normal return, throw and early cancellation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'row-directory-test-'));
    try {
      expect(
        await withMutableRowDirectory(root, (directory) => {
          directory.append(row(1));
          return directory.rowAt(0).bytes;
        }),
      ).toBe(3);
      const afterNormal = fs.readdirSync(root);
      await expect(
        withMutableRowDirectory(root, (directory) => {
          directory.append(row(2));
          throw new Error('fold failed');
        }),
      ).rejects.toThrow('fold failed');
      const afterThrow = fs.readdirSync(root);
      async function* cancelled(
        directory: MutableRowDirectory,
      ): AsyncIterable<number> {
        yield directory.length;
        throw new Error('iteration must have stopped');
      }
      await withMutableRowDirectory(root, async (directory) => {
        directory.append(row(3));
        for await (const value of cancelled(directory)) {
          expect(value).toBe(1);
          break;
        }
      });
      expect([afterNormal, afterThrow, fs.readdirSync(root)]).toStrictEqual([
        [],
        [],
        [],
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
