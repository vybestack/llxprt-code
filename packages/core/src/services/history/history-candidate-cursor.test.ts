/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import { ownerFixtureRow } from './chronology-rollback-owner-helpers.js';
import { restoreChronologyEntry } from './historyChronology.js';
import type { IContent } from './IContent.js';

function recordOwners(
  size: number,
  trap: boolean,
  ownership: RowOwnership,
): void {
  const output = process.env.CHRONOLOGY_CANDIDATE_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      JSON.stringify({ kind: 'cursor', size, trap, ...ownership.snapshot() }) +
        String.fromCharCode(10),
    );
}

function populate(candidate: HistoryDensityRows, size: number): void {
  for (let index = 0; index < size; index++) {
    candidate.append(ownerFixtureRow(index, 2048));
  }
}

async function verifyRows(
  candidate: HistoryDensityRows,
  size: number,
  expected: (index: number) => IContent,
): Promise<number> {
  let index = 0;
  let bytes = 0;
  for await (const row of candidate.streamRows()) {
    expect(row).toStrictEqual(expected(index++));
    bytes += Buffer.byteLength(JSON.stringify(row));
  }
  expect(index).toBe(size);
  return bytes;
}

async function transformRows(
  source: HistoryDensityRows,
  target: HistoryDensityRows,
  size: number,
): Promise<void> {
  let index = 0;
  for await (const row of source.streamRows()) {
    if (index < size - 1) {
      target.append(
        index === Math.floor(size / 2) ? ownerFixtureRow(size, 2048) : row,
      );
    }
    index++;
  }
  target.append(ownerFixtureRow(size + 1, 2048));
}

function transformedIndex(position: number, size: number): number {
  if (position === Math.floor(size / 2)) return size;
  if (position === size - 1) return size + 1;
  return position;
}

describe('disk candidate repeatable async cursor and row writer', () => {
  for (const size of [512, 8192]) {
    it(`replaces, appends and removes rows from the full ${size}-row source without retaining the candidate`, async () => {
      const ownership = new RowOwnership();
      const source = new HistoryDensityRows(ownership);
      const target = new HistoryDensityRows(ownership);
      try {
        populate(source, size);
        await transformRows(source, target, size);
        const bytes = await verifyRows(source, size, (position) =>
          ownerFixtureRow(position, 2048),
        );
        expect(bytes).toBeGreaterThan(size * 2048);
        for (let pass = 0; pass < 2; pass++) {
          await verifyRows(target, size, (position) =>
            ownerFixtureRow(transformedIndex(position, size), 2048),
          );
        }
        recordOwners(size, false, ownership);
        expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(440);
        expect(ownership.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
          8 * 1024 * 1024,
        );
        expect(ownership.snapshot().liveRows).toBe(0);
      } finally {
        target.close();
        source.close();
      }
    }, 120_000);
  }
});

describe('disk candidate cursor lifecycle', () => {
  it('releases a cancelled row and leaves both membership and retry cursor intact', async () => {
    const ownership = new RowOwnership();
    const candidate = new HistoryDensityRows(ownership);
    const controller = new AbortController();
    const reason = new Error('candidate cancelled');
    try {
      populate(candidate, 512);
      const cursor = candidate
        .streamRows(controller.signal)
        [Symbol.asyncIterator]();
      expect((await cursor.next()).value).toStrictEqual(
        ownerFixtureRow(0, 2048),
      );
      controller.abort(reason);
      await expect(cursor.next()).rejects.toBe(reason);
      expect(ownership.snapshot().liveRows).toBe(0);
      await verifyRows(candidate, 512, (index) => ownerFixtureRow(index, 2048));
    } finally {
      candidate.close();
    }
  });

  it('rejects a pre-aborted traversal before acquiring a row', async () => {
    const ownership = new RowOwnership();
    const candidate = new HistoryDensityRows(ownership);
    const reason = new Error('pre-aborted candidate');
    try {
      populate(candidate, 512);
      const cursor = candidate
        .streamRows(AbortSignal.abort(reason))
        [Symbol.asyncIterator]();
      await expect(cursor.next()).rejects.toBe(reason);
      expect(ownership.snapshot().peakRows).toBe(0);
    } finally {
      candidate.close();
    }
  });

  it('does not chase appends to the cursor source and releases on early return', async () => {
    const ownership = new RowOwnership();
    const candidate = new HistoryDensityRows(ownership);
    try {
      populate(candidate, 3);
      let visited = 0;
      for await (const row of candidate.streamRows()) {
        candidate.append(row);
        visited++;
      }
      expect(visited).toBe(3);
      expect(candidate.length).toBe(6);
      for await (const row of candidate.streamRows()) {
        expect(row).toStrictEqual(ownerFixtureRow(0, 2048));
        break;
      }
      expect(ownership.snapshot().liveRows).toBe(0);
    } finally {
      candidate.close();
    }
  });
});

describe('disk candidate explicit identity ownership', () => {
  it('detaches value writes but preserves explicitly pinned row and original marker identities through rollback', async () => {
    const ownership = new RowOwnership();
    const candidate = new HistoryDensityRows(ownership);
    const original = ownerFixtureRow(0, 2048);
    const marker = original.metadata?.chronology;
    try {
      candidate.append(original);
      candidate.appendIdentity(original);
      const ledger = candidate.prepareChronologyRollback();
      original.metadata = {
        chronology: { seq: 900, userTurn: 90, step: 2, recordedAt: 0 },
      };
      for (const entry of ledger) restoreChronologyEntry(entry);
      expect(original.metadata.chronology).toBe(marker);
      expect(candidate.readRow(1)).toBe(original);
      expect(candidate.readRow(0)).not.toBe(original);
      expect(candidate.readRow(0)).toStrictEqual(ownerFixtureRow(0, 2048));
      expect(ownership.snapshot().liveRows).toBe(1);
    } finally {
      candidate.close();
    }
    expect(ownership.snapshot().liveRows).toBe(0);
  });

  it('rejects writes and fresh cursors after closure without reacquiring an identity owner', async () => {
    const ownership = new RowOwnership();
    const candidate = new HistoryDensityRows(ownership);
    candidate.append(ownerFixtureRow(0, 2048));
    candidate.close();
    expect(() => candidate.appendIdentity(ownerFixtureRow(1, 2048))).toThrow(
      'Candidate rows are closed',
    );
    expect(() => candidate.append(ownerFixtureRow(2, 2048))).toThrow(
      'Candidate rows are closed',
    );
    await expect(
      candidate.streamRows()[Symbol.asyncIterator]().next(),
    ).rejects.toThrow('Candidate rows are closed');
    expect(ownership.snapshot().liveRows).toBe(0);
  });

  it('rejects a retained 8192-row identity trap rather than hiding pins as borrowed rows', () => {
    const ownership = new RowOwnership();
    const candidate = new HistoryDensityRows(ownership);
    try {
      for (let index = 0; index < 8192; index++) {
        candidate.appendIdentity(ownerFixtureRow(index, 2048));
      }
      recordOwners(8192, true, ownership);
      expect(ownership.snapshot().liveRows).toBe(8192);
      expect(ownership.snapshot().peakRows).toBeGreaterThan(440);
      expect(ownership.snapshot().peakSerializedBytes).toBeGreaterThan(
        8 * 1024 * 1024,
      );
    } finally {
      candidate.close();
    }
    expect(ownership.snapshot().liveRows).toBe(0);
  });
});
