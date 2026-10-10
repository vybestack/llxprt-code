/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import {
  detachedRow,
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
  type DetachedFixture,
} from './detached-rollback-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';

const { gcAndSweep }: { gcAndSweep(): void } = createRequire(import.meta.url)(
  'bun:jsc',
);

async function collectGarbage(): Promise<void> {
  for (let index = 0; index < 4; index++) {
    await setImmediate();
    gcAndSweep();
  }
}

function submit(
  fixture: DetachedFixture,
  size: number,
  bytes: number,
): { weak: Array<WeakRef<IContent>>; operation: Promise<void> } {
  const rows = Array.from({ length: size }, (_, index) =>
    detachedRow(index, bytes),
  );
  return {
    weak: rows.map((row) => new WeakRef(row)),
    operation: fixture.history.replaceAll(rows),
  };
}

function survivors(weak: ReadonlyArray<WeakRef<IContent>>): number {
  return weak.filter((ref) => ref.deref() !== undefined).length;
}

function expectClosed(snapshot: HistoryMutationSnapshot): void {
  const operations = [
    (): unknown => snapshot.readRow(0),
    (): unknown => snapshot[Symbol.iterator](),
    (): unknown => snapshot.append(detachedRow(0)),
    (): unknown => snapshot.isPendingRow(0),
    (): unknown => snapshot.restorePendingChronology(),
  ];
  for (const operation of operations)
    expect(operation).toThrow('History mutation snapshot is closed');
}

for (const [size, bytes] of [
  [512, 2048],
  [8192, 2048],
  [1, 9 * 1024 * 1024],
]) {
  describe(`held closed snapshot ${size}/${bytes}`, () => {
    it(`drops captured rows and closes a held snapshot after a failing callback: ${size}/${bytes}`, async () => {
      await withDetachedFixture(async (fixture) => {
        const active = submit(fixture, size, bytes);
        await active.operation;
        const held: { snapshot?: HistoryMutationSnapshot } = {};
        const readers: Array<Generator<IContent, void, unknown>> = [];
        const failure = new Error('held snapshot callback');
        const operation = rejectedValue(
          fixture.history.withRawHistorySnapshot(async (snapshot) => {
            held.snapshot = snapshot;
            readers.push(snapshot[Symbol.iterator]());
            expect(readers[0].next().value).toStrictEqual(
              detachedRow(0, bytes),
            );
            throw failure;
          }),
        );
        expect(await operation).toBe(failure);
        await collectGarbage();
        expect(survivors(active.weak)).toBe(0);
        expect(held.snapshot?.length).toBe(size);
        for (const reader of readers) expect(reader.next().done).toBe(true);
        if (held.snapshot === undefined)
          throw new Error('Missing held snapshot');
        expectClosed(held.snapshot);
        await held.snapshot.close();
        expect(fixture.owners.snapshot().liveRows).toBe(0);
        const live = await detachedDigest(fixture.history.streamRawHistory());
        expect(live).toStrictEqual(
          await detachedDurableDigest(fixture.recorder),
        );
        expect(live.count).toBe(size);
        await fixture.history.withRawHistorySnapshot(async (snapshot) => {
          expect(snapshot.length).toBe(size);
          expect(snapshot.readRow(0).blocks).toStrictEqual(
            detachedRow(0, bytes).blocks,
          );
        });
      });
    }, 180_000);
  });
}

describe('held closed snapshot caller and disposal', () => {
  it('keeps rows the caller copied out of a snapshot valid after close and does not retain the submitted rows', async () => {
    await withDetachedFixture(async (fixture) => {
      const active = submit(fixture, 8192, 2048);
      await active.operation;
      const held: { snapshot?: HistoryMutationSnapshot; rows?: IContent[] } =
        {};
      await fixture.history.withRawHistorySnapshot(async (snapshot) => {
        held.snapshot = snapshot;
        held.rows = [...snapshot];
      });
      await collectGarbage();
      expect(survivors(active.weak)).toBe(0);
      expect(held.rows).toHaveLength(8192);
      expect(held.rows?.[0].blocks).toStrictEqual(detachedRow(0, 2048).blocks);
      expect(held.rows?.[8191].blocks).toStrictEqual(
        detachedRow(8191, 2048).blocks,
      );
      expect(held.snapshot?.length).toBe(8192);
      expect(fixture.owners.snapshot().liveRows).toBe(0);
    });
  }, 180_000);
  it('disposes a partially consumed snapshot reader before the callback exits', async () => {
    await withDetachedFixture(async (fixture) => {
      await fixture.history.detachedValues.replace([detachedRow(0)]);
      await fixture.history.withRawHistorySnapshot(async (snapshot) => {
        const reader = snapshot[Symbol.iterator]();
        expect(reader.next().done).toBe(false);
        reader[Symbol.dispose]();
        expect({
          completed: reader.next().done,
          owners: fixture.owners.snapshot().liveRows,
        }).toStrictEqual({ completed: true, owners: 0 });
      });
    });
  });
});
