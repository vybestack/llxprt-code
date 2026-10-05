/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { LocalMediaStore } from './local-media-store.js';
import { RowOwnership } from '../recording/rowOwnership.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';

class ReserveFailureStore extends LocalMediaStore {
  rejectedId: string | undefined;
  override async reserve(
    reference: MediaReferenceBlock,
    ownerId: string,
  ): Promise<void> {
    if (reference.contentId === this.rejectedId)
      throw new Error('reserve fault');
    await super.reserve(reference, ownerId);
  }
}

let directory: string;

let store: ReserveFailureStore;

let owner: HistoryMediaOwnership;

async function admit(byte: number): Promise<MediaReferenceBlock> {
  return store.admit({
    bytes: new Uint8Array([byte]),
    mimeType: 'application/octet-stream',
    semanticMetadata: {},
  });
}

describe('bounded media ownership', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'media-failure-test-'));
    store = new ReserveFailureStore({
      rootDirectory: directory,
      quotaBytes: 1024,
    });
    owner = new HistoryMediaOwnership(store);
  });
  afterEach(async () => {
    await owner.releaseAll();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('finishes borrowing candidate rows before media publication and restores the previous reservation', async () => {
    const previous = await admit(1);
    const next = await admit(2);
    await owner.reconcile([], () => [{ speaker: 'human', blocks: [previous] }]);
    const ownership = new RowOwnership();
    const candidates = {
      length: 1,
      *[Symbol.iterator]() {
        const row: IContent = { speaker: 'human', blocks: [next] };
        ownership.retain(row);
        try {
          yield row;
        } finally {
          ownership.release(row);
        }
      },
    };
    const effect = owner.prepareReplacement({
      previous: [{ speaker: 'human', blocks: [previous] }],
      next: candidates,
      adopted: [],
      ownership,
    });
    expect(ownership.snapshot().peakRows).toBeGreaterThan(1);
    expect(ownership.snapshot().acquisitions).toBeGreaterThan(0);
    expect(ownership.snapshot().liveRows).toBe(0);
    await effect.publish();
    expect(await store.hasReservations(next.contentId)).toBe(true);
    expect(await store.hasReservations(previous.contentId)).toBe(false);
    await effect.rollback();
    expect(await store.hasReservations(next.contentId)).toBe(false);
    expect(await store.hasReservations(previous.contentId)).toBe(true);
  });

  it(
    'rolls back a failed reserve while preserving the prior live owner and closing the source',
    verifyRollsBackAFailedReserveWhilePreservingThePriorLiveOwnerAnd,
  );

  it(
    'rejects a retaining media consumer using the unchanged charge limits after producer cleanup',
    verifyRejectsARetainingMediaConsumerUsingTheUnchangedChargeLimitsAfterProducer,
    180000,
  );

  it(
    'cancels a cooperating source and releases incoming reservations without retiring the prior owner',
    verifyCancelsACooperatingSourceAndReleasesIncomingReservationsWithoutRetiringThePrior,
  );
  it(
    'protects distinct live objects from reclamation through disk-backed ownership',
    verifyProtectsDistinctLiveObjectsFromReclamationThroughDiskBackedOwnership,
    180000,
  );
});

async function verifyRollsBackAFailedReserveWhilePreservingThePriorLiveOwnerAnd(): Promise<void> {
  const prior = await admit(1);
  const first = await admit(2);
  const rejected = await admit(3);
  await owner.reconcile([], () => [{ speaker: 'human', blocks: [prior] }]);
  store.rejectedId = rejected.contentId;
  let closed = false;
  async function* source() {
    try {
      yield first;
      yield rejected;
    } finally {
      closed = true;
    }
  }
  const ownership = new RowOwnership();
  const effect = owner.prepareReferenceReplacement(source(), ownership);
  await expect(effect.publish()).rejects.toThrow('reserve fault');
  await effect.rollback();
  expect(closed).toBe(true);
  expect(await store.hasReservations(prior.contentId)).toBe(true);
  expect(await store.hasReservations(first.contentId)).toBe(false);
  expect(await store.hasReservations(rejected.contentId)).toBe(false);
  expect(ownership.snapshot().liveRows).toBe(0);
}

async function verifyRejectsARetainingMediaConsumerUsingTheUnchangedChargeLimitsAfterProducer(): Promise<void> {
  const reference = await admit(1);
  const ownership = new RowOwnership();
  const retained: MediaReferenceBlock[] = [];
  async function* source() {
    for (let index = 0; index < 512; index += 1) {
      const copy = {
        ...reference,
        semanticMetadata: { description: 'x'.repeat(65536) },
      };
      ownership.retain(copy);
      retained.push(copy);
      yield copy;
    }
  }
  const effect = owner.prepareReferenceReplacement(source(), ownership);
  try {
    await effect.publish();
    await effect.finalize?.();
    await owner.releaseAll();
    await mkdir('tmp/verify854/p05d', { recursive: true });
    await writeFile(
      'tmp/verify854/p05d/mediapeak-retaining-control.json',
      JSON.stringify(ownership.snapshot(), null, 2),
    );
    expect(ownership.snapshot().liveRows).toBe(512);
    expect(
      ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
    ).toBe(false);
  } finally {
    for (const reference of retained) ownership.release(reference);
  }
  expect(ownership.snapshot().liveRows).toBe(0);
}

async function verifyCancelsACooperatingSourceAndReleasesIncomingReservationsWithoutRetiringThePrior(): Promise<void> {
  const prior = await admit(1);
  const incoming = await admit(2);
  await owner.reconcile([], () => [{ speaker: 'human', blocks: [prior] }]);
  const controller = new AbortController();
  let closed = false;
  async function* source() {
    try {
      yield incoming;
      controller.abort(new Error('cancelled'));
      controller.signal.throwIfAborted();
    } finally {
      closed = true;
    }
  }
  const ownership = new RowOwnership();
  const effect = owner.prepareReferenceReplacement(source(), ownership);
  await expect(effect.publish()).rejects.toThrow('cancelled');
  await effect.rollback();
  expect(closed).toBe(true);
  expect(await store.hasReservations(prior.contentId)).toBe(true);
  expect(await store.hasReservations(incoming.contentId)).toBe(false);
  expect(ownership.snapshot().liveRows).toBe(0);
}

async function verifyProtectsDistinctLiveObjectsFromReclamationThroughDiskBackedOwnership(): Promise<void> {
  const ownership = new RowOwnership();
  async function* source() {
    for (let index = 0; index < 512; index += 1) {
      yield await store.admit({
        bytes: new Uint8Array([index % 256, Math.floor(index / 256)]),
        mimeType: 'application/octet-stream',
        semanticMetadata: { description: 'x'.repeat(32768) },
      });
    }
  }
  const effect = owner.prepareReferenceReplacement(source(), ownership);
  await effect.publish();
  await effect.finalize?.();
  await store.reclaimUnreferenced(new Set(), Date.now());
  expect(await store.getStoredByteLength()).toBe(1024);
  expect(
    ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
  ).toBe(true);
  await owner.releaseAll();
  await store.reclaimUnreferenced(new Set(), Date.now());
  expect(await store.getStoredByteLength()).toBe(0);
  await mkdir('tmp/verify854/p05d', { recursive: true });
  await writeFile(
    'tmp/verify854/p05d/mediapeak-distinct-control.json',
    JSON.stringify(ownership.snapshot(), null, 2),
  );
  expect(ownership.snapshot().liveRows).toBe(0);
}
