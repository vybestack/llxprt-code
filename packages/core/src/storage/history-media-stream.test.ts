/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryMediaOwnership } from './history-media-ownership.js';
import { LocalMediaStore } from './local-media-store.js';
import { RowOwnership } from '../recording/rowOwnership.js';

describe('bounded media ownership', () => {
  it('streams duplicates without retiring prior media before commit and rolls back source failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-stream-test-'));
    const store = new LocalMediaStore({
      rootDirectory: directory,
      quotaBytes: 1024,
    });
    const owner = new HistoryMediaOwnership(store);
    const ownership = new RowOwnership();
    try {
      const prior = await store.admit({
        bytes: new Uint8Array([1]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      const incoming = await store.admit({
        bytes: new Uint8Array([2]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      await owner.reconcile([], () => [{ speaker: 'human', blocks: [prior] }]);
      async function* source(fail: boolean) {
        for (let index = 0; index < 512; index += 1) {
          yield {
            ...incoming,
            semanticMetadata: { description: 'x'.repeat(65536) },
          };
        }
        if (fail) throw new Error('source failed');
      }
      const failed = owner.prepareReferenceReplacement(source(true), ownership);
      await expect(failed.publish()).rejects.toThrow('source failed');
      await failed.rollback();
      expect(await store.hasReservations(prior.contentId)).toBe(true);
      expect(await store.hasReservations(incoming.contentId)).toBe(false);
      const transaction = owner.prepareReferenceReplacement(
        source(false),
        ownership,
      );
      await transaction.publish();
      expect(await store.hasReservations(prior.contentId)).toBe(true);
      expect(await store.hasReservations(incoming.contentId)).toBe(true);
      await transaction.finalize?.();
      expect(await store.hasReservations(prior.contentId)).toBe(false);
      expect(
        ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(ownership.snapshot().liveRows).toBe(0);
      await owner.releaseAll();
      expect(await store.hasReservations(incoming.contentId)).toBe(false);
    } finally {
      await owner.releaseAll();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
