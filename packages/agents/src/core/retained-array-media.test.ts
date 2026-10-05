/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  detachedDigest,
  detachedDurableDigest,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  exactTokenizer,
  mediaParticipant,
  rejectedValue,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../../../core/src/services/history/IContent.js';
import { withRetainedClient } from './retained-array-test-helpers.js';
import {
  clientRows,
  forbidClientArrayRollback,
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
      throw new Error('Missing deferred media reference');
    return block;
  }
  throw new Error('Missing deferred row');
}
function registerReservation(): void {
  describe('registerReservation', () => {
    it('keeps verified bytes through compensation, transfers once to real startup and releases on disposal', async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client, store }) => {
          forbidClientArrayRollback(fixture);
          const input = imageRows();
          await client.storeHistoryForLaterUse(input);
          const reference = await firstReference(client.streamHistory());
          const expected = await detachedDigest(
            clientRows([{ ...input[0], blocks: [reference] }]),
          );
          expect(await store.readVerified(reference)).toStrictEqual(
            new Uint8Array(Buffer.from(png, 'base64')),
          );
          const reservedAtAdmission = await store.hasReservations(
            reference.contentId,
          );
          fixture.history.once('tokensUpdated', () => {
            throw new Error('deferred token observer');
          });
          await expect(client.storeHistoryForLaterUse([])).rejects.toThrow(
            'deferred token observer',
          );
          const compensated = await detachedDigest(client.streamHistory());
          expect(await detachedDurableDigest(fixture.recorder)).toStrictEqual(
            expected,
          );
          const reservedAfterRollback = await store.hasReservations(
            reference.contentId,
          );
          await client.startChat([]);
          expect({
            compensated,
            started: await detachedDigest(client.streamHistory()),
          }).toStrictEqual({ compensated: expected, started: expected });
          expect({
            admitted: reservedAtAdmission,
            compensated: reservedAfterRollback,
            started: await store.hasReservations(reference.contentId),
          }).toStrictEqual({
            admitted: true,
            compensated: true,
            started: true,
          });
          expect(input[0].blocks[0]).toMatchObject({
            encoding: 'base64',
            data: png,
          });
          await client.dispose();
          expect(await store.hasReservations(reference.contentId)).toBe(false);
        }),
      );
    });
  });
}
function registerCleanup(): void {
  describe('registerCleanup', () => {
    it('keeps failed rollback media cleanup available for disposal retry', async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client, store }) => {
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
          await client.storeHistoryForLaterUse(prior);
          const expected = await detachedDigest(clientRows(prior));
          const release = store.release.bind(store);
          let fail = true;
          store.release = async (id, owner): Promise<void> => {
            if (fail) {
              fail = false;
              throw new Error('deferred cleanup fault');
            }
            await release(id, owner);
          };
          fixture.history.registerMediaOwner(
            mediaParticipant(() => ({
              publish: () => undefined,
              finalize: () => {
                throw new Error('deferred finalize fault');
              },
              rollback: () => undefined,
            })),
          );
          const error = await rejectedValue(
            client.storeHistoryForLaterUse(imageRows()),
          );
          expect(error).toBeInstanceOf(AggregateError);
          expect(await detachedDigest(client.streamHistory())).toStrictEqual(
            expected,
          );
          expect(await detachedDurableDigest(fixture.recorder)).toStrictEqual(
            expected,
          );
          const before = await store.reclaimUnreferenced(
            new Set<string>(),
            Date.now() + 1,
          );
          expect(before.objectsRemoved).toBe(0);
          await client.dispose();
          const after = await store.reclaimUnreferenced(
            new Set<string>(),
            Date.now() + 1,
          );
          expect(after.objectsRemoved).toBe(1);
        }),
      );
    });
  });
}
function registerReplacement(): void {
  describe('registerReplacement', () => {
    it('releases array media when replaced by empty or streamed deferred history', async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client, store }) => {
          await client.storeHistoryForLaterUse(imageRows());
          const first = await firstReference(client.streamHistory());
          await client.storeHistoryForLaterUse([]);
          expect(await store.hasReservations(first.contentId)).toBe(false);
          await client.storeHistoryForLaterUse(imageRows());
          const second = await firstReference(client.streamHistory());
          async function* rows(): AsyncIterable<IContent> {
            yield {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'stream replacement' }],
            };
          }
          await client.setHistoryFromSource(rows());
          expect(await store.hasReservations(second.contentId)).toBe(false);
          expect((await detachedDigest(client.streamHistory())).count).toBe(1);
        }),
      );
    });
  });
}
function registerFailure(): void {
  describe('registerFailure', () => {
    it('releases array-origin deferred media when startup tokenization fails', async () => {
      await withDetachedFixture((fixture) =>
        withRetainedClient(fixture, async ({ client, store, config }) => {
          await client.storeHistoryForLaterUse(imageRows());
          const reference = await firstReference(client.streamHistory());
          config.setTokenizerFactory(
            exactTokenizer(() => {
              throw new Error('startup token fault');
            }),
          );
          await expect(client.startChat([])).rejects.toThrow(
            'startup token fault',
          );
          expect(client.hasChatInitialized()).toBe(false);
          expect(await store.hasReservations(reference.contentId)).toBe(false);
        }),
      );
    });
  });
}
describe('retained array media ownership', () => {
  registerReservation();
  registerCleanup();
  registerReplacement();
  registerFailure();
});
