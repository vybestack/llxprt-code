/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { foldPendingRows } from './pendingRowFold.js';
import { HistoryJournalStore } from '../services/history/historyJournalStore.js';
import {
  detachedRow,
  withDetachedFixture,
} from '../services/history/detached-rollback-test-helpers.js';
import type { IContent } from '../services/history/IContent.js';

const { gcAndSweep }: { gcAndSweep(): void } = createRequire(import.meta.url)(
  'bun:jsc',
);

function admit(
  store: HistoryJournalStore,
  size: number,
  bytes: number,
): Array<WeakRef<IContent>> {
  const rows = Array.from({ length: size }, (_, index) =>
    detachedRow(index, bytes),
  );
  for (const content of rows) store.apply({ kind: 'content', content });
  return rows.map((row) => new WeakRef(row));
}

async function collectGarbage(): Promise<void> {
  for (let index = 0; index < 4; index++) {
    await setImmediate();
    gcAndSweep();
  }
}

function consume(reader: Generator<IContent, void, unknown>): number {
  let bytes = 0;
  for (const row of reader) bytes += Buffer.byteLength(JSON.stringify(row));
  return bytes;
}

describe('completed pending owner iterator lifetime', () => {
  for (const [size, bytes] of [
    [512, 2048],
    [8192, 2048],
    [1, 9 * 1024 * 1024],
  ]) {
    it(`releases full pending rows while a completed owner iterator stays held: ${size}/${bytes}`, async () => {
      await withDetachedFixture(async (fixture) => {
        const store = new HistoryJournalStore(fixture.recorder);
        try {
          const weak = admit(store, size, bytes);
          const source = await foldPendingRows(store.capturePendingFold());
          const reader = source.pendingOwners();
          expect(consume(reader)).toBeGreaterThan(size * bytes);
          fixture.releaseWriter();
          await store.waitForDurable();
          await source.close();
          await collectGarbage();
          expect({
            survivors: weak.filter((ref) => ref.deref() !== undefined).length,
            completed: reader.next().done,
          }).toStrictEqual({ survivors: 0, completed: true });
        } finally {
          store.dispose();
        }
      }, true);
    }, 180_000);
  }

  it('disposes a partially consumed pending owner iterator without reading another row', async () => {
    await withDetachedFixture(async (fixture) => {
      const store = new HistoryJournalStore(fixture.recorder);
      try {
        admit(store, 3, 2048);
        const source = await foldPendingRows(store.capturePendingFold());
        try {
          const reader = source.pendingOwners();
          expect(reader.next().done).toBe(false);
          reader[Symbol.dispose]();
          expect(reader.next()).toStrictEqual({ done: true, value: undefined });
        } finally {
          await source.close();
        }
      } finally {
        store.dispose();
      }
    }, true);
  });
});
