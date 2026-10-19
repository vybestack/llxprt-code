/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import {
  SemanticMediaPurgeStreamCoordinator,
  type SemanticPurgeStreamTransaction,
} from './semantic-purge-stream.js';
import { withNativePurgeFixture } from './__tests__/support/native-purge-fixture.js';
import type { IContent } from './IContent.js';

type Fixture = Parameters<Parameters<typeof withNativePurgeFixture>[0]>[0];
const success = { status: 'success', cachePrefixWritten: true } as const;

async function collect(source: {
  streamRows(): AsyncIterable<IContent>;
}): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of source.streamRows()) result.push(row);
  return result;
}

async function failureOf(operation: Promise<void>): Promise<unknown> {
  try {
    await operation;
  } catch (failure) {
    return failure;
  }
  throw new Error('Expected purge rollback failure');
}

async function seed({ history, store, assertDurable }: Fixture) {
  const image = await store.admit({
    bytes: new Uint8Array([1]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  const kept = await store.admit({
    bytes: new Uint8Array([2]),
    mimeType: 'application/octet-stream',
    semanticMetadata: {},
  });
  await history.addBatch([
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'image prompt' }, image, kept],
      metadata: { chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 1 } },
    },
  ]);
  const before = await collectRawHistory(history);
  await assertDurable(before);
  expect(await store.hasReservations(image.contentId)).toBe(true);
  expect(await store.hasReservations(kept.contentId)).toBe(true);
  return { image, kept, before };
}

async function verifyRollback(
  fixture: Fixture,
  coordinator: SemanticMediaPurgeStreamCoordinator,
  transaction: SemanticPurgeStreamTransaction,
  input: Awaited<ReturnType<typeof seed>>,
  candidate: IContent[],
  failure: string,
): Promise<void> {
  const { history, owner, store, assertDurable } = fixture;
  if (failure !== 'none') owner.rejectPublication = true;
  if (failure === 'rollback-release') store.rejectedId = input.image.contentId;
  const rollback = coordinator.rollback(transaction);
  if (failure === 'none') {
    await rollback;
    expect(await collectRawHistory(history)).toStrictEqual(input.before);
    await assertDurable(input.before);
    expect(await store.hasReservations(input.image.contentId)).toBe(true);
    expect(coordinator.frontier).toStrictEqual(transaction.previousFrontier);
    return;
  }
  const error = await failureOf(rollback);
  if (failure === 'rollback-release') {
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error('Expected aggregate failure');
    expect(error.errors).toContain(owner.failure);
    expect(error.errors).toContain(store.releaseFailure);
  } else expect(error).toBe(owner.failure);
  expect(await collectRawHistory(history)).toStrictEqual(candidate);
  await assertDurable(candidate);
  expect(coordinator.frontier).toStrictEqual(transaction.nextFrontier);
  expect(await store.hasReservations(input.image.contentId)).toBe(
    failure === 'rollback-release',
  );
}

async function commitAndRollback(
  fixture: Fixture,
  coordinator: SemanticMediaPurgeStreamCoordinator,
  transaction: SemanticPurgeStreamTransaction,
  input: Awaited<ReturnType<typeof seed>>,
  candidate: IContent[],
  failure: string,
): Promise<void> {
  const { history, store, owner, assertDurable } = fixture;
  if (failure === 'publication') owner.rejectPublication = true;
  const committed = coordinator.commit(transaction, success);
  if (failure === 'publication') {
    await expect(committed).rejects.toBe(owner.failure);
    expect(await collectRawHistory(history)).toStrictEqual(input.before);
    await assertDurable(input.before);
    expect(await store.hasReservations(input.image.contentId)).toBe(true);
    expect(coordinator.frontier).toStrictEqual(transaction.previousFrontier);
    return;
  }
  expect(await committed).toBe(true);
  await assertDurable(candidate);
  expect(await store.hasReservations(input.image.contentId)).toBe(false);
  expect(await store.hasReservations(input.kept.contentId)).toBe(true);
  expect(await collect(transaction.base)).toStrictEqual(input.before);
  await verifyRollback(
    fixture,
    coordinator,
    transaction,
    input,
    candidate,
    failure,
  );
}

const failures = [
  'none',
  'publication',
  'rollback-publication',
  'rollback-release',
];
describe.each(failures)('native semantic purge with %s', (failure) => {
  it('preserves persisted primary, mirror, frontier and media reservations', async () => {
    await withNativePurgeFixture(async (fixture) => {
      const { history, store, owners } = fixture;
      const input = await seed(fixture);
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: false,
        ownership: owners,
      });
      const transaction = await coordinator.begin({ mode: 'remove' });
      if (transaction === undefined)
        throw new Error('Missing purge transaction');
      try {
        const candidate = await collect(transaction.candidate);
        expect(candidate[0].blocks).toStrictEqual([
          { type: 'text', text: 'image prompt' },
          input.kept,
        ]);
        await commitAndRollback(
          fixture,
          coordinator,
          transaction,
          input,
          candidate,
          failure,
        );
        expect(await store.hasReservations(input.kept.contentId)).toBe(true);
      } finally {
        transaction.close();
      }
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().liveSerializedBytes).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      await history.dispose();
      await history.waitForOwnershipSettlement();
      expect(await store.hasReservations(input.image.contentId)).toBe(false);
      expect(await store.hasReservations(input.kept.contentId)).toBe(false);
    });
  });
});
