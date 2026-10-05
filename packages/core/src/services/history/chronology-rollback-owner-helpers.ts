/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import {
  exactTokenizer,
  mediaParticipant,
  rejectedValue,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { IContent } from './IContent.js';
import type { HistoryService } from './HistoryService.js';

type MediaInput = Parameters<HistoryMediaOwner['prepareReplacement']>[0];
interface OwnerObservation {
  traversed: number;
  bytes: number;
}

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

function prepareOwners(
  input: MediaInput,
  previous: RowOwnership,
  transaction: RowOwnership,
  observation: OwnerObservation,
  trap: boolean,
): () => void {
  if (Array.isArray(input.previous)) {
    for (const row of input.previous) previous.retain(row);
  }
  const nextArray = Array.isArray(input.next) ? input.next : undefined;
  if (nextArray !== undefined) {
    for (const row of nextArray) transaction.retain(row);
  } else {
    let nextCount = 0;
    for (const row of input.next) {
      expect(row.blocks.length).toBeGreaterThan(0);
      nextCount++;
    }
    expect(nextCount).toBe(input.next.length);
  }
  const eager: IContent[] = [];
  for (const row of input.previous) {
    expect(row).toStrictEqual(ownerFixtureRow(observation.traversed, 2048));
    observation.traversed++;
    observation.bytes += Buffer.byteLength(JSON.stringify(row));
    if (trap) {
      eager.push(row);
      previous.retain(row);
      transaction.retain(row);
    }
  }
  return () => {
    if (nextArray !== undefined) {
      for (const row of nextArray) transaction.release(row);
    }
    if (Array.isArray(input.previous)) {
      for (const row of input.previous) previous.release(row);
    }
    for (const row of eager) {
      transaction.release(row);
      previous.release(row);
    }
  };
}

async function verifyRestoration(
  history: HistoryService,
  size: number,
): Promise<void> {
  let index = 0;
  for await (const row of history.getRecent(0)) {
    expect(row).toStrictEqual(ownerFixtureRow(index++, 2048));
  }
  expect(index).toBe(size);
}

async function publishOwnerRows(
  input: MediaInput,
  kind: 'density' | 'transform',
  reached: (() => void) | undefined,
  gate: Promise<void>,
  primary: Error,
): Promise<never> {
  if (kind === 'transform') {
    let published = 0;
    for (const row of input.next) {
      expect(row).toStrictEqual(ownerFixtureRow(published++, 2048));
      if (published === input.next.length) {
        reached?.();
        await gate;
        throw primary;
      }
    }
  }
  reached?.();
  await gate;
  throw primary;
}

async function observeDensity(
  history: HistoryService,
  previous: RowOwnership,
  transaction: RowOwnership,
  size: number,
  trap: boolean,
  kind: 'density' | 'transform' = 'density',
): Promise<{
  previous: ReturnType<RowOwnership['snapshot']>;
  transaction: ReturnType<RowOwnership['snapshot']>;
  traversed: number;
  bytes: number;
}> {
  history.setTokenizerFactory(exactTokenizer());
  const observation = { traversed: 0, bytes: 0 };
  let release: (() => void) | undefined;
  let reached: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const primary = new Error('paused density rollback');
  history.registerMediaOwner(
    mediaParticipant((input) => {
      const rollback = prepareOwners(
        input,
        previous,
        transaction,
        observation,
        trap,
      );
      return {
        publish: () => publishOwnerRows(input, kind, reached, gate, primary),
        rollback,
      };
    }),
  );
  const replacement = rollbackRow(size, 2048);
  if (kind === 'density') transaction.retain(replacement);
  const operation = rejectedValue(
    kind === 'transform'
      ? history.transformAll(async (source, sink) => {
          for await (const { row } of source.streamRows())
            sink.appendDetached(row);
        })
      : history.applyDensityResult({
          replacements: new Map([[Math.floor(size / 2), replacement]]),
          removals: [size - 1],
          metadata: {
            readWritePairsPruned: 0,
            fileDeduplicationsPruned: 0,
            recencyPruned: 1,
          },
        }),
  );
  await ready;
  const result = {
    previous: previous.snapshot(),
    transaction: transaction.snapshot(),
    ...observation,
  };
  release?.();
  expect(await operation).toBe(primary);
  if (kind === 'density') transaction.release(replacement);
  expect(previous.snapshot().liveRows).toBe(0);
  expect(transaction.snapshot().liveRows).toBe(0);
  await verifyRestoration(history, size);
  expect(replacement.metadata).toBeUndefined();
  return result;
}

export async function pausedDensity(
  size: number,
  trap: boolean,
  kind: 'density' | 'transform' = 'density',
): Promise<Awaited<ReturnType<typeof observeDensity>>> {
  const transaction = new RowOwnership();
  const result = await withSuffixFixture(
    size,
    (history, previous) =>
      observeDensity(history, previous, transaction, size, trap, kind),
    2048,
    ownerFixtureRow,
    transaction,
  );
  const output = process.env.CHRONOLOGY_DENSITY_OWNER_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      JSON.stringify({ size, trap, kind, ...result }) + '\n',
    );
  return result;
}
