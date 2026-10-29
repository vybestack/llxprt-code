/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { journalMediaParticipant } from './chronology-rollback-test-helpers.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';

describe('journal media reconciliation reads', () => {
  const directory = useTempDir('journal-media-reconcile-');

  it('reconciles every reference without reading unrelated text payloads', async () => {
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'media'),
      quotaBytes: 4096,
    });
    try {
      const reference = await media.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      const row: IContent = {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'x'.repeat(9 * 1024 * 1024) },
          reference,
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'audio/wav',
            data: 'aGVsbG8=',
          },
          reference,
        ],
      };
      await withNativeDetachedFixture(
        async ({ history, io, owners, session }) => {
          await history.detachedValues.replace([row]);
          await history.waitForCommit();
          const seen: MediaReferenceBlock[] = [];
          const effect = {
            publish: () => undefined,
            rollback: () => undefined,
          };
          const owner = {
            ...journalMediaParticipant(() => effect),
            prepareReferenceReplacement: async (
              references:
                | AsyncIterable<MediaReferenceBlock>
                | Iterable<MediaReferenceBlock>,
            ): Promise<typeof effect> => {
              for await (const item of references) seen.push(item);
              return effect;
            },
          };
          const before = io.descriptorReadBytes;
          await history.detachedValues.host().journal.reconcileMedia(owner);
          const bytes = io.descriptorReadBytes - before;
          expect(seen).toStrictEqual([reference, reference]);
          expect(bytes).toBeLessThan(256 * 1024);
          expect(history.getContextRange().totalEntries).toBe(1);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(session.store.mediaPins.oldestVersion).toBeUndefined();
        },
      );
    } finally {
      await media.close();
    }
  });
});
