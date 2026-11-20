/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '../services/history/IContent.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';
import { join } from 'node:path';
import {
  admittedMediaSource,
  captureAdmittedMediaSource,
} from './admitted-media-source.js';

describe('journal-bound media admission', () => {
  const directory = useTempDir('media-storage-admission-');
  it('closes only the releasing store owner while leaving frozen input unchanged', async () => {
    const stores = ['first', 'second'].map(
      (name) =>
        new LocalMediaStore({
          rootDirectory: join(directory(), name),
          quotaBytes: 1024,
        }),
    );
    const bytes = new Uint8Array([1, 2, 3]);
    try {
      const captured = await Promise.all(
        stores.map(async (store) => {
          const reference = Object.freeze(
            await store.admit({
              bytes,
              mimeType: 'image/png',
              semanticMetadata: {},
            }),
          );
          await store.reserve(reference, 'shared-owner');
          const result = captureAdmittedMediaSource(
            reference,
            store,
            'shared-owner',
          );
          expect(admittedMediaSource(reference)).toBeUndefined();
          expect(JSON.stringify(result)).toBe(JSON.stringify(reference));
          expect(Object.isFrozen(result)).toBe(true);
          return result;
        }),
      );
      const first = admittedMediaSource(captured[0]);
      const second = admittedMediaSource(captured[1]);
      if (first === undefined || second === undefined)
        throw new Error('Missing captured media source');
      await stores[0].release(captured[0].contentId, 'shared-owner');
      expect(() => first.read(captured[0])).toThrow('closed');
      expect(await second.read(captured[1])).toStrictEqual(bytes);
      await stores[1].release(captured[1].contentId, 'shared-owner');
      expect(() => second.read(captured[1])).toThrow('closed');
    } finally {
      await Promise.all(stores.map((store) => store.close()));
    }
  });

  it('verifies and reserves a stored reference without an in-memory authority copy', async () => {
    const store = new LocalMediaStore({
      rootDirectory: directory(),
      quotaBytes: 1024,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    try {
      const reference = await store.admit({
        bytes,
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const content: IContent = { speaker: 'human', blocks: [reference] };
      const context = {
        turnId: 'restore',
        source: 'journal',
        reservationOwnerScope: 'restore',
        captureSources: false,
      };
      const admission = new MediaAdmissionService(store);
      const admitted = await admission.admitContent(content, context);
      expect(admitted).toBe(content);
      expect(admittedMediaSource(reference)).toBeUndefined();
      expect(await store.hasReservations(reference.contentId)).toBe(true);
      expect(await store.readReserved(reference)).toStrictEqual(bytes);
      await admission.releaseAdmissions([
        { contents: [admitted], context, mode: 'content' },
      ]);
      expect(await store.hasReservations(reference.contentId)).toBe(false);
    } finally {
      await store.close();
    }
  });

  it('rejects an invalid stored reference before granting a journal reservation', async () => {
    const store = new LocalMediaStore({
      rootDirectory: directory(),
      quotaBytes: 1024,
    });
    try {
      const reference = await store.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const admission = new MediaAdmissionService(store);
      await expect(
        admission.admitContent(
          {
            speaker: 'human',
            blocks: [{ ...reference, byteLength: reference.byteLength + 1 }],
          },
          {
            turnId: 'restore',
            source: 'journal',
            reservationOwnerScope: 'restore',
            captureSources: false,
          },
        ),
      ).rejects.toThrow('Media admission failed');
      expect(await store.hasReservations(reference.contentId)).toBe(false);
    } finally {
      await store.close();
    }
  });
});
