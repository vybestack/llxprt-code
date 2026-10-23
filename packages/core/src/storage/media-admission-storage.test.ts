/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '../services/history/IContent.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { LocalMediaStore } from './local-media-store.js';
import { MediaAdmissionService } from './media-admission-service.js';
import { admittedMediaSource } from './admitted-media-source.js';

describe('journal-bound media admission', () => {
  const directory = useTempDir('media-storage-admission-');
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
