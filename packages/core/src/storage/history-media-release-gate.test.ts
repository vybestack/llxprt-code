/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import { LocalMediaStore } from './local-media-store.js';
import { HistoryMediaReleaseGate } from './history-media-release-gate.js';
import { historyOwnerIdFor } from './media-admission-service.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { RequestMediaResolver } from './request-media-resolver.js';

const directory = useTempDir('native-media-gate-');

describe('version-pinned history media ownership', () => {
  it('reads a native historical reference after clear and reclaims after source close', async () => {
    const history = new HistoryService({ backend: 'journal' });
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
        expect(await media.readReserved(reference)).toEqual(
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
