/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import { rejectedValue } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../../../core/src/services/history/IContent.js';
import {
  forbidClientArrayRollback,
  withArrayClient,
  withClientOracle,
  clientRows,
  waitForNextMillisecond,
} from './client-array-test-helpers.js';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
function imageRows(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'media', encoding: 'base64', mimeType: 'image/png', data: png },
      ],
      metadata: { chronology: { seq: 1, userTurn: 1, step: 0, recordedAt: 0 } },
    },
  ];
}
async function firstReference(
  source: AsyncIterable<IContent>,
): Promise<MediaReferenceBlock> {
  for await (const row of source) {
    const block = row.blocks[0];
    if (block.type !== 'media' || block.encoding !== 'reference')
      throw new Error('Missing restored reference');
    return block;
  }
  throw new Error('Missing restored media');
}
function registerPublishedMedia(): void {
  describe('registerPublishedMedia', () => {
    it('transfers verified bytes, compensates observer failure, and releases history ownership on removal', async () => {
      await withDetachedFixture((fixture) =>
        withArrayClient(fixture, async ({ client, store }) => {
          const { history, recorder } = fixture;
          forbidClientArrayRollback(fixture);
          const input = imageRows();
          const expected = await withClientOracle(
            store,
            imageRows(),
            (admitted) => detachedDigest(clientRows(admitted)),
          );
          await client.restoreHistory(input);
          const reference = await firstReference(history.streamRawHistory());
          expect(await store.readVerified(reference)).toStrictEqual(
            new Uint8Array(Buffer.from(png, 'base64')),
          );
          const initialReservation = await store.hasReservations(
            reference.contentId,
          );
          expect(initialReservation).toBe(true);
          expect(input[0].blocks[0]).toMatchObject({
            encoding: 'base64',
            data: png,
          });
          history.setCacheAnchorSeq(1);
          history.once('contentBatchAdded', () => {
            throw new Error('client media observer failure');
          });
          const error = await rejectedValue(
            client.restoreHistory([
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'replacement' }],
              },
            ]),
          );
          expect(error).toBeInstanceOf(Error);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
          expect(history.getCacheAnchorSeq()).toBe(1);
          expect(await store.hasReservations(reference.contentId)).toBe(true);
          await client.restoreHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'remove media' }],
            },
          ]);
          expect(await store.hasReservations(reference.contentId)).toBe(false);
        }),
      );
    });
  });
}
function registerCleanupFailure(): void {
  describe('registerCleanupFailure', () => {
    it('compensates admitted media when post-publication admission release fails and preserves prior rows', async () => {
      await withDetachedFixture((fixture) =>
        withArrayClient(fixture, async ({ client, store }) => {
          const { history, recorder, owners } = fixture;
          forbidClientArrayRollback(fixture);
          const prior: IContent[] = [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'prior' }],
              metadata: {
                chronology: { seq: 1, userTurn: 1, step: 0, recordedAt: 0 },
              },
            },
          ];
          const expected = await detachedDigest(clientRows(prior));
          await client.restoreHistory(prior);
          const release = store.release.bind(store);
          let failNext = false;
          store.release = async (contentId, ownerId): Promise<void> => {
            if (failNext) {
              failNext = false;
              throw new Error('admitted media release failure');
            }
            await release(contentId, ownerId);
          };
          history.once('contentBatchAdded', () => {
            failNext = true;
          });
          const error = await rejectedValue(client.restoreHistory(imageRows()));
          expect(error).toBeInstanceOf(Error);
          if (!(error instanceof Error))
            throw new Error('Missing admission cleanup failure');
          expect(error.message).toContain(
            'Restored history publication cleanup failed',
          );
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
          await waitForNextMillisecond();
          const reclaimed = await store.reclaimUnreferenced(
            new Set<string>(),
            Date.now() + 1,
          );
          expect(reclaimed.objectsRemoved).toBe(1);
          expect(await store.getStoredByteLength()).toBe(0);
          expect(owners.snapshot().liveRows).toBe(0);
        }),
      );
    });
  });
}
describe('AgentClient admitted restore authentic PNG and rollback', () => {
  registerPublishedMedia();
  registerCleanupFailure();
});
