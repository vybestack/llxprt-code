/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { historyOwnerIdFor } from '../../storage/media-admission-service.js';
import { releaseRead } from '../../journal/pinLease.js';
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

async function expectHistoryOwner(
  root: string,
  contentId: string,
  present: boolean,
): Promise<void> {
  const ownerId = historyOwnerIdFor(contentId);
  const digest = createHash('sha256').update(ownerId).digest('hex');
  const directory = join(
    root,
    'references',
    'sha256',
    contentId.slice('sha256:'.length),
  );
  const files = await readdir(directory).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return [];
    throw error;
  });
  expect(files).toStrictEqual(present ? [digest] : []);
  if (present) {
    const record: unknown = JSON.parse(
      await readFile(join(directory, digest), 'utf8'),
    );
    expect(record).toMatchObject({ ownerDigest: digest });
  }
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
): Promise<{ readonly error: unknown } | undefined> {
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
    return undefined;
  }
  const error = await failureOf(rollback);
  expect(error).toBe(owner.failure);
  expect(await collectRawHistory(history)).toStrictEqual(candidate);
  await assertDurable(candidate);
  expect(coordinator.frontier).toStrictEqual(transaction.nextFrontier);
  await expectHistoryOwner(store.rootDirectory, input.image.contentId, true);
  return { error };
}

async function commitAndRollback(
  fixture: Fixture,
  coordinator: SemanticMediaPurgeStreamCoordinator,
  transaction: SemanticPurgeStreamTransaction,
  input: Awaited<ReturnType<typeof seed>>,
  candidate: IContent[],
  failure: string,
): Promise<{ readonly error: unknown } | undefined> {
  const { history, store, owner, assertDurable } = fixture;
  if (failure === 'publication') owner.rejectPublication = true;
  const committed = coordinator.commit(transaction, success);
  if (failure === 'publication') {
    await expect(committed).rejects.toBe(owner.failure);
    expect(await collectRawHistory(history)).toStrictEqual(input.before);
    await assertDurable(input.before);
    expect(await store.hasReservations(input.image.contentId)).toBe(true);
    expect(coordinator.frontier).toStrictEqual(transaction.previousFrontier);
    return undefined;
  }
  expect(await committed).toBe(true);
  await assertDurable(candidate);
  await expectHistoryOwner(store.rootDirectory, input.image.contentId, true);
  expect(await store.hasReservations(input.kept.contentId)).toBe(true);
  expect(await collect(transaction.base)).toStrictEqual(input.before);
  return verifyRollback(
    fixture,
    coordinator,
    transaction,
    input,
    candidate,
    failure,
  );
}

async function retire(
  fixture: Fixture,
  transaction: SemanticPurgeStreamTransaction,
  failure: string,
  rollback: { readonly error: unknown } | undefined,
): Promise<void> {
  if (failure !== 'rollback-release') {
    await transaction.close();
    return;
  }
  const error = await failureOf(
    Promise.resolve(releaseRead(transaction, rollback)),
  );
  expect(error).toBeInstanceOf(AggregateError);
  if (!(error instanceof AggregateError))
    throw new Error('Expected aggregate failure');
  expect(error.errors).toStrictEqual([
    fixture.owner.failure,
    fixture.store.releaseFailure,
  ]);
  expect(error.errors[0]).toBe(fixture.owner.failure);
  expect(error.errors[1]).toBe(fixture.store.releaseFailure);
  expect(fixture.store.rejectedId).toBeUndefined();
  expect(fixture.session.store.mediaPins.oldestVersion).toBeUndefined();
  const head = await fixture.session.store.getState('rel:head');
  const tail = await fixture.session.store.getState('rel:tail');
  expect(head).not.toStrictEqual(tail);
  await fixture.owner.releaseAll();
  expect(await fixture.session.store.getState('rel:head')).toStrictEqual(tail);
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
      let rollback: { readonly error: unknown } | undefined;
      try {
        const candidate = await collect(transaction.candidate);
        expect(candidate[0].blocks).toStrictEqual([
          { type: 'text', text: 'image prompt' },
          input.kept,
        ]);
        rollback = await commitAndRollback(
          fixture,
          coordinator,
          transaction,
          input,
          candidate,
          failure,
        );
        expect(await store.hasReservations(input.kept.contentId)).toBe(true);
        await history.clear();
        await expectHistoryOwner(
          store.rootDirectory,
          input.image.contentId,
          true,
        );
        await expectHistoryOwner(
          store.rootDirectory,
          input.kept.contentId,
          true,
        );
        expect(await collect(transaction.base)).toStrictEqual(input.before);
        expect(await store.readReserved(input.image)).toStrictEqual(
          new Uint8Array([1]),
        );
        expect(await store.readReserved(input.kept)).toStrictEqual(
          new Uint8Array([2]),
        );
        expect(
          (await store.reclaimUnreferenced(new Set(), Date.now()))
            .objectsRemoved,
        ).toBe(0);
      } finally {
        await retire(fixture, transaction, failure, rollback);
      }
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().liveSerializedBytes).toBe(0);
      expect(
        owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      await expectHistoryOwner(
        store.rootDirectory,
        input.image.contentId,
        false,
      );
      await expectHistoryOwner(
        store.rootDirectory,
        input.kept.contentId,
        false,
      );
      expect(await store.hasReservations(input.image.contentId)).toBe(false);
      expect(await store.hasReservations(input.kept.contentId)).toBe(false);
      expect(
        (await store.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(2);
      const continued: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'after transaction retirement' }],
        },
      ];
      await history.addBatch(continued);
      const current = await collectRawHistory(history);
      expect(current).toHaveLength(1);
      expect(current).toMatchObject(continued);
      await fixture.assertDurable(current);
    });
  });
});
