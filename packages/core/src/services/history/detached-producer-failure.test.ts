/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

describe.each([0, 1, 3])(
  'detached producer fails after %i candidate rows',
  (completed) => {
    const directory = useTempDir('detached-producer-failure-');
    it('keeps committed rows and media, publishes nothing and releases candidate values and media', async () => {
      const media = new LocalMediaStore({
        rootDirectory: join(directory(), 'media'),
        quotaBytes: 4096,
      });
      const owner = new HistoryMediaOwnership(media);
      const candidate = await media.admit({
        bytes: new Uint8Array([1]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      const previous = await media.admit({
        bytes: new Uint8Array([2]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });
      const values = new RowOwnership();
      const reader = new RowOwnership();
      const history = new HistoryService({
        mutationOwnership: values,
        attachmentCounters: {
          ...createRowCounters().counters,
          ownership: reader,
        },
      });
      try {
        try {
          await history.registerMediaOwner(owner);
          await history.addBatch([{ speaker: 'human', blocks: [previous] }]);
          const before: IContent[] = [];
          for await (const row of history.streamRawHistory()) before.push(row);
          const events: string[] = [];
          for (const event of [
            'contentAdded',
            'contentBatchAdded',
            'tokensUpdated',
            'contextRangeChanged',
          ])
            history.on(event, () => events.push(event));
          const failure = new Error('detached producer failed');
          await expect(
            history.detachedValues.transform(
              async (_source, sink) => {
                for (let index = 0; index < completed; index++)
                  await sink.appendValue({
                    speaker: 'human',
                    blocks: [
                      { type: 'text', text: `candidate ${index}` },
                      candidate,
                    ],
                  });
                throw failure;
              },
              undefined,
              { publishBatch: true },
            ),
          ).rejects.toBe(failure);
          const after: IContent[] = [];
          for await (const row of history.streamRawHistory()) after.push(row);
          expect(after).toStrictEqual(before);
          expect(events).toStrictEqual([]);
          expect(await media.hasReservations(previous.contentId)).toBe(true);
          expect(await media.hasReservations(candidate.contentId)).toBe(false);
          expect(reader.snapshot().liveRows).toBe(0);
          expect(values.snapshot().liveRows).toBe(0);
        } finally {
          await history.dispose();
          await history.waitForOwnershipSettlement();
        }
        expect(await media.hasReservations(previous.contentId)).toBe(false);
      } finally {
        await owner.releaseAll();
        await media.close();
      }
    });
  },
);
