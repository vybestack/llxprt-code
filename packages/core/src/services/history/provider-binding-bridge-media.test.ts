/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { MediaAdmissionService } from '../../storage/media-admission-service.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { createHistoryProviderFileBindingStore } from './provider-file-binding.js';
import {
  withDetachedFixture,
  detachedDigest,
  detachedDurableDigest,
} from './detached-rollback-test-helpers.js';
import {
  bindingFile,
  forbidLegacyBindingTransform,
} from './provider-binding-bridge-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
function admittedImage(store: LocalMediaStore): Promise<IContent[]> {
  return new MediaAdmissionService(store).admitContents(
    [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: png,
          },
        ],
      },
    ],
    { turnId: 'binding-reservations', source: 'binding-reservations' },
  );
}

describe('binding bridge local media reservations', () => {
  it('keeps the history reservation through binding rollback and releases it when history is cleared', async () => {
    const root = await mkdtemp(join(tmpdir(), 'binding-reservations-'));
    const store = new LocalMediaStore({
      rootDirectory: root,
      quotaBytes: 1024,
    });
    try {
      await withDetachedFixture(async ({ history, recorder }) => {
        const rows = await admittedImage(store);
        const reference = rows[0].blocks[0];
        if (reference.type !== 'media' || reference.encoding !== 'reference')
          throw new Error('Expected admitted reference');
        history.registerMediaOwner(new HistoryMediaOwnership(store));
        await history.addBatch(rows);
        await history.waitForCommit();
        const inputRows = async function* () {
          yield* rows;
        };
        const expected = await detachedDigest(inputRows());
        const beforeReservation = await store.hasReservations(
          reference.contentId,
        );
        const failure = new Error('real owner binding rollback');
        history.once('tokensUpdated', () => {
          throw failure;
        });
        forbidLegacyBindingTransform(history);
        expect(
          await rejectedValue(
            createHistoryProviderFileBindingStore(history).bind(
              reference.contentId,
              bindingFile,
            ),
          ),
        ).toBe(failure);
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
        expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
        const rollbackReservation = await store.hasReservations(
          reference.contentId,
        );
        expect(await store.readVerified(reference)).toStrictEqual(
          new Uint8Array(Buffer.from(png, 'base64')),
        );
        await createHistoryProviderFileBindingStore(history).bind(
          reference.contentId,
          bindingFile,
        );
        const boundReservation = await store.hasReservations(
          reference.contentId,
        );
        history.clear();
        await history.waitForOwnershipSettlement();
        expect({
          beforeReservation,
          rollbackReservation,
          boundReservation,
          clearedReservation: await store.hasReservations(reference.contentId),
        }).toStrictEqual({
          beforeReservation: true,
          rollbackReservation: true,
          boundReservation: true,
          clearedReservation: false,
        });
      });
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
