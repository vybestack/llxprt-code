/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { useTempDir as tempDirectory } from '../journal/__tests__/support/useTempDir.js';
import { JournalMediaPins } from '../journal/journalMediaPins.js';
import { JournalRecordingService } from '../recording/journalRecordingService.js';
import { batchGate } from '../services/history/__tests__/support/addbatch-stream-test-helpers.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalSession } from '../services/history/journalSession.js';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { HistoryMediaReleaseGate } from './history-media-release-gate.js';
import { LocalMediaStore } from './local-media-store.js';
import {
  historyOwnerIdFor,
  MediaAdmissionService,
} from './media-admission-service.js';
import { RequestMediaResolver } from './request-media-resolver.js';

const directory = tempDirectory('native-media-gate-');
describe('rollback checkpoint media release', () => {
  it('releases candidate media after restoring and closing the checkpoint', async () => {
    const recording = JournalRecordingService.create({
      sessionId: 'rollback-media',
      projectHash: 'test',
      chatsDir: join(directory(), 'chats'),
      workspaceDirs: ['/work'],
      provider: 'test',
      model: 'test',
    });
    const history = new HistoryService({ recording });
    await history.waitForCommit();
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'rollback-checkpoint'),
      quotaBytes: 1024,
    });
    const prior = await media.admit({
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const candidate = await media.admit({
      bytes: new Uint8Array([2]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await history.registerMediaOwner(new HistoryMediaOwnership(media));
    try {
      await history.detachedValues.replace([
        { speaker: 'human', blocks: [prior] },
      ]);
      await history.detachedValues.withRollbackCheckpoint(async (restore) => {
        await history.detachedValues.replace([
          { speaker: 'human', blocks: [candidate] },
        ]);
        expect(await media.hasReservations(prior.contentId)).toBe(true);
        expect(await media.hasReservations(candidate.contentId)).toBe(true);
        await restore();
      });
      expect(await media.hasReservations(prior.contentId)).toBe(true);
      expect(await media.hasReservations(candidate.contentId)).toBe(false);
    } finally {
      await history.dispose();
      await recording.dispose();
      await media.close();
    }
  });
});

describe('media release while the gate is draining', () => {
  it('drains a newly queued release when its old pin closes before the queue commit returns', async () => {
    const session = await JournalSession.create(
      join(directory(), 'enqueuing-release.llxj'),
    );
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'enqueuing-media'),
      quotaBytes: 1024,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([2, 3, 9]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await media.reserve(reference, historyOwnerIdFor(reference.contentId));
    const gate = new HistoryMediaReleaseGate(session.store, media, () => false);
    await gate.open();
    const pins = session.store.mediaPins;
    const release = pins.retain(0);
    const commit = session.store.commit.bind(session.store);
    const committing = spyOn(session.store, 'commit').mockImplementationOnce(
      async (edits) => {
        const ack = await commit(edits);
        await pins.afterReaderRelease(release);
        return ack;
      },
    );
    try {
      await gate.release(reference.contentId);
      expect(await gate.pendingCount()).toBe(0);
      expect(await media.hasReservations(reference.contentId)).toBe(false);
    } finally {
      committing.mockRestore();
      await session.close();
      await media.close();
    }
  });
  it('finishes a release when the last old pin closes during the busy drain', async () => {
    const session = await JournalSession.create(
      join(directory(), 'busy-release.llxj'),
    );
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'busy-media'),
      quotaBytes: 1024,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([7, 3, 9]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await media.reserve(reference, historyOwnerIdFor(reference.contentId));
    const gate = new HistoryMediaReleaseGate(session.store, media, () => false);
    await gate.open();
    const pins = session.store.mediaPins;
    const release = pins.retain(0);
    const boundary = Object.getOwnPropertyDescriptor(
      JournalMediaPins.prototype,
      'oldestVersion',
    );
    if (boundary?.get === undefined) throw new Error('Missing pin boundary');
    const oldest = boundary.get.bind(pins);
    const retirement = { closed: false, closing: Promise.resolve() };
    let armed = false;
    const read = session.store.getState.bind(session.store);
    await gate.release(reference.contentId);
    const reading = spyOn(session.store, 'getState').mockImplementation(
      async (key) => {
        const value = await read(key);
        armed = true;
        return value;
      },
    );
    try {
      Object.defineProperty(pins, 'oldestVersion', {
        configurable: true,
        get() {
          const version: number | undefined = oldest();
          if (armed && !retirement.closed) {
            retirement.closed = true;
            retirement.closing = Promise.resolve(
              pins.afterReaderRelease(release),
            );
          }
          return version;
        },
      });
      await gate.settle();
      await retirement.closing;
      expect(retirement.closed).toBe(true);
      expect(await gate.pendingCount()).toBe(0);
      expect(await media.hasReservations(reference.contentId)).toBe(false);
    } finally {
      reading.mockRestore();
      Reflect.deleteProperty(pins, 'oldestVersion');
      if (!retirement.closed) await pins.afterReaderRelease(release);
      await session.close();
      await media.close();
    }
  });
});

describe('version-pinned history media ownership', () => {
  it('drains releases after reader failure and preserves a single failure identity', async () => {
    const pins = new JournalMediaPins();
    let drained = false;
    pins.bind(
      () => {
        drained = true;
      },
      () => false,
    );
    const failure = new Error('reader retirement failed');
    await expect(
      Promise.resolve(
        pins.afterReaderRelease(() => {
          throw failure;
        }),
      ),
    ).rejects.toBe(failure);
    expect(drained).toBe(true);
  });
  it('preserves reader and drain failures in cleanup order', async () => {
    const pins = new JournalMediaPins();
    const reader = new Error('reader');
    const drain = new Error('drain');
    pins.bind(
      () => {
        throw drain;
      },
      () => false,
    );
    await expect(
      Promise.resolve(
        pins.afterReaderRelease(() => {
          throw reader;
        }),
      ),
    ).rejects.toMatchObject({ errors: [reader, drain] });
  });
  it('rejects same-length corrupt blob bytes at the selected unit with its original verification cause', async () => {
    const history = new HistoryService({});
    const root = join(directory(), 'corrupt');
    const media = new LocalMediaStore({
      rootDirectory: root,
      quotaBytes: 1024,
    });
    const bytes = new Uint8Array([4, 6, 8]);
    const reference = await media.admit({
      bytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await history.registerMediaOwner(new HistoryMediaOwnership(media));
    await history.addBatch([
      {
        speaker: 'human',
        blocks: [reference],
        metadata: { turnId: 'corrupt-unit' },
      },
    ]);
    const source = await history.prepareCuratedForProviderSnapshot();
    const path = join(
      root,
      'objects',
      'sha256',
      reference.contentId.slice('sha256:'.length),
    );
    try {
      await writeFile(path, new Uint8Array([8, 6, 4]));
      await expect(
        new RequestMediaResolver(media).resolve({
          contents: [await source.readAt(0)],
          requestId: 'corrupt',
          turnId: 'fallback',
          aggregateBudgetBytes: 1024,
          lease: source.native?.mediaLease,
        }),
      ).rejects.toMatchObject({
        name: 'RequestMediaResolutionError',
        contentId: reference.contentId,
        turnId: 'corrupt-unit',
        cause: expect.objectContaining({
          name: 'MediaObjectHashMismatchError',
        }),
      });
    } finally {
      await writeFile(path, bytes);
      await source.close();
      await history.clear();
      await history.waitForOwnershipSettlement();
      await history.dispose();
      await media.close();
    }
  });
  it('retires an in-progress blob reader before releasing its history pin', async () => {
    const history = new HistoryService({});
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'paused-read'),
      quotaBytes: 1024,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([2, 4, 6]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await history.registerMediaOwner(new HistoryMediaOwnership(media));
    await history.addBatch([{ speaker: 'human', blocks: [reference] }]);
    const source = await history.prepareCuratedForProviderSnapshot();
    const row = await source.readAt(0);
    await history.clear();
    await history.waitForOwnershipSettlement();
    const entered = batchGate();
    const resume = batchGate();
    const read = media.readReserved.bind(media);
    const paused = spyOn(media, 'readReserved').mockImplementation(
      async (ref) => {
        entered.resolve();
        await resume.promise;
        return read(ref);
      },
    );
    const resolving = new RequestMediaResolver(media).resolve({
      contents: [row],
      requestId: 'paused',
      turnId: 'unit-one',
      aggregateBudgetBytes: 1024,
      lease: source.native?.mediaLease,
    });
    const outcome = resolving.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await entered.promise;
    let closed = false;
    const closing = Promise.resolve(source.close()).then(() => {
      closed = true;
    });
    try {
      await setImmediate();
      expect(closed).toBe(false);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
      resume.resolve();
      const result = await outcome;
      if ('value' in result) await result.value.release();
      await closing;
      expect(closed).toBe(true);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
    } finally {
      resume.resolve();
      paused.mockRestore();
      const result = await outcome;
      if ('value' in result) await result.value.release();
      await closing;
      await history.dispose();
      await media.close();
    }
  });
  it('does not remove a fresh history claim when an old pin drains', async () => {
    const history = new HistoryService({});
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'readopted'),
      quotaBytes: 1024,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([9, 7, 5]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await history.registerMediaOwner(new HistoryMediaOwnership(media));
    const row: IContent = { speaker: 'human', blocks: [reference] };
    await history.addBatch([row]);
    const source = await history.prepareCuratedForProviderSnapshot();
    try {
      await history.clear();
      await history.waitForOwnershipSettlement();
      await history.addBatch([row]);
      await source.close();
      expect(await media.hasReservations(reference.contentId)).toBe(true);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
      await history.clear();
      await history.waitForOwnershipSettlement();
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
    } finally {
      await source.close();
      await history.dispose();
      await media.close();
    }
  });
  it('gates admission history releases through the same native owner', async () => {
    const history = new HistoryService({});
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'admission'),
      quotaBytes: 1024,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([5, 3, 1]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const owner = new HistoryMediaOwnership(media);
    await history.registerMediaOwner(owner);
    const admission = new MediaAdmissionService(media);
    admission.bindHistoryRelease((id) => owner.releaseReference(id));
    await history.addBatch([{ speaker: 'human', blocks: [reference] }]);
    const source = await history.prepareCuratedForProviderSnapshot();
    try {
      await admission.releaseReference(reference.contentId);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
      await history.clear();
      await history.waitForOwnershipSettlement();
      expect(await media.readReserved(reference)).toStrictEqual(
        new Uint8Array([5, 3, 1]),
      );
      await source.close();
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
    } finally {
      await source.close();
      await history.dispose();
      await media.close();
    }
  });
  it('reserves existing rows before granting a native lease to a newly registered owner', async () => {
    const history = new HistoryService({});
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'adopted'),
      quotaBytes: 1024,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([8, 6, 4]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await history.addBatch([{ speaker: 'human', blocks: [reference] }]);
    await history.registerMediaOwner(new HistoryMediaOwnership(media));
    const source = await history.prepareCuratedForProviderSnapshot();
    try {
      expect(source.native?.mediaLease).toBeDefined();
      expect(await media.hasReservations(reference.contentId)).toBe(true);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
    } finally {
      await source.close();
      await history.clear();
      await history.waitForOwnershipSettlement();
      await history.dispose();
      await media.close();
    }
  });
  it('reads a native historical reference after clear and reclaims after source close', async () => {
    const history = new HistoryService({});
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'media'),
      quotaBytes: 1024,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const reference = await media.admit({
      bytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const resolver = new RequestMediaResolver(media);
    await history.registerMediaOwner(new HistoryMediaOwnership(media));
    await history.addBatch([{ speaker: 'human', blocks: [reference] }]);
    const source = await history.prepareCuratedForProviderSnapshot();
    try {
      const lease = source.native?.mediaLease;
      expect(lease).toBeDefined();
      await history.clear();
      await history.waitForOwnershipSettlement();
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
      {
        const row = await source.readAt(0);
        const resolved = await resolver.resolve({
          contents: [row],
          requestId: 'native',
          turnId: 'one',
          aggregateBudgetBytes: 1024,
          lease,
        });
        try {
          expect(
            resolved.withContents((contents) => contents[0].blocks),
          ).toContainEqual(
            expect.objectContaining({
              encoding: 'base64',
              data: Buffer.from(bytes).toString('base64'),
            }),
          );
          expect(resolved.accounting().reservedContentCount).toBe(0);
        } finally {
          await resolved.release();
        }
      }
      await source.close();
      await expect(
        resolver.resolve({
          contents: [{ speaker: 'human', blocks: [reference] }],
          requestId: 'stale-native-pin',
          turnId: 'one',
          aggregateBudgetBytes: 1024,
          lease,
        }),
      ).rejects.toMatchObject({
        name: 'RequestMediaResolutionError',
        cause: expect.objectContaining({
          message: 'Provider request snapshot is closed',
        }),
      });
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
    } finally {
      await source.close();
      await history.dispose();
      await media.close();
    }
  });
  it('holds three real blobs until the last old-version pin closes and then reclaims them', async () => {
    const session = await JournalSession.create(
      join(directory(), 'history.llxj'),
    );
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'media'),
      quotaBytes: 1024,
    });
    const references = [];
    for (let index = 1; index <= 3; index++) {
      const reference = await media.admit({
        bytes: new Uint8Array([index, 9, 7]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      await media.reserve(reference, historyOwnerIdFor(reference.contentId));
      references.push(reference);
    }
    const gate = new HistoryMediaReleaseGate(session.store, media, () => false);
    await gate.open();
    const first = await session.store.snapshot();
    const second = await session.store.snapshot();
    try {
      await session.store.commit([
        { kind: 'setState', key: 'changed', value: new Uint8Array([1]) },
      ]);
      for (const reference of references)
        await gate.release(reference.contentId);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
      for (const reference of references)
        expect(await media.readReserved(reference)).toStrictEqual(
          new Uint8Array([references.indexOf(reference) + 1, 9, 7]),
        );
      await first.close();
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
      await second.close();
      expect(await gate.pendingCount()).toBe(0);
      for (const reference of references)
        expect(await media.hasReservations(reference.contentId)).toBe(false);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(3);
    } finally {
      await session.close();
      await media.close();
    }
  });
});
