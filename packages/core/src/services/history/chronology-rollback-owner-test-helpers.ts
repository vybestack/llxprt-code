/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { batchGate } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  rejectedValue,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import type { DetachedHistorySink } from './detachedHistoryMutation.js';
import type { IContent } from './IContent.js';

export function ownerFixtureRow(index: number, bytes: number): IContent {
  return {
    ...rollbackRow(index, bytes),
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  };
}

async function* ownerRows(
  size: number,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield ownerFixtureRow(index, 2048);
}

export async function pausedDensity(
  size: number,
  trap: boolean,
  kind: 'density' | 'transform' = 'density',
): Promise<{
  previous: ReturnType<RowOwnership['snapshot']>;
  transaction: ReturnType<RowOwnership['snapshot']>;
  traversed: number;
  bytes: number;
}> {
  return withNativeDetachedFixture(async ({ history, owners }) => {
    await history.detachedValues.replace(ownerRows(size));
    const previous = new RowOwnership();
    const retained: IContent[] = [];
    const ready = batchGate();
    const release = batchGate();
    const primary = new Error('paused journal rollback');
    let traversed = 0;
    let bytes = 0;
    const operation = rejectedValue(
      history.detachedValues.transform(async (source, sink) => {
        for await (const row of source.streamRows()) {
          expect(row).toStrictEqual(ownerFixtureRow(traversed, 2048));
          traversed++;
          bytes += Buffer.byteLength(JSON.stringify(row));
          previous.retain(row);
          owners.retain(row);
          if (trap) {
            retained.push(row);
          }
          try {
            await appendOwnerRow(sink, kind, traversed, size, row);
            if (traversed === size) {
              ready.resolve();
              await release.promise;
              throw primary;
            }
          } finally {
            if (!trap) {
              previous.release(row);
              owners.release(row);
            }
          }
        }
      }),
    );
    try {
      await Promise.race([
        ready.promise,
        operation.then((error) => {
          throw error ?? new Error('Missing publication pause');
        }),
      ]);
      const result = {
        previous: previous.snapshot(),
        transaction: owners.snapshot(),
        traversed,
        bytes,
      };
      release.resolve();
      expect(await operation).toBe(primary);
      for (const row of retained) {
        previous.release(row);
        owners.release(row);
      }
      retained.length = 0;
      expect(previous.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().liveRows).toBe(0);
      await expectOwnerRows(history.streamRawHistory(), size);
      return result;
    } finally {
      release.resolve();
      await operation;
    }
  });
}

async function expectOwnerRows(
  rows: AsyncIterable<IContent>,
  size: number,
): Promise<void> {
  let index = 0;
  for await (const row of rows)
    expect(row).toStrictEqual(ownerFixtureRow(index++, 2048));
  expect(index).toBe(size);
}

async function appendOwnerRow(
  sink: DetachedHistorySink,
  kind: 'density' | 'transform',
  traversed: number,
  size: number,
  row: IContent,
): Promise<void> {
  if (kind === 'density' && traversed === size)
    await sink.removeValue(traversed - 1);
  else if (kind === 'density' && traversed === Math.floor(size / 2) + 1)
    await sink.appendReplacement(traversed - 1, rollbackRow(size, 2048));
  else await sink.appendDerived(traversed - 1, row);
}
