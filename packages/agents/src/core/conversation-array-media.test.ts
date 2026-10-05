/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '../../../core/src/storage/local-media-store.js';
import { MediaAdmissionService } from '../../../core/src/storage/media-admission-service.js';
import { HistoryMediaOwnership } from '../../../core/src/storage/history-media-ownership.js';
import {
  withDetachedFixture,
  detachedDigest,
  detachedDurableDigest,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import { rejectedValue } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  conversationFor,
  forbidArrayRollback,
} from './conversation-array-test-helpers.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
const context = { turnId: 'conversation-media', source: 'conversation-media' };

function admittedRows(admission: MediaAdmissionService): Promise<IContent[]> {
  return admission.admitContents(
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
        metadata: {
          chronology: { seq: 1, userTurn: 1, step: 0, recordedAt: 0 },
        },
      },
    ],
    context,
  );
}

describe('conversation array restore real local media ownership', () => {
  it('compensates an observer failure, preserves verified media on success and releases the history reservation on removal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'conversation-media-'));
    const store = new LocalMediaStore({
      rootDirectory: root,
      quotaBytes: 1024,
    });
    const admission = new MediaAdmissionService(store);
    try {
      await withDetachedFixture(async ({ history, recorder }) => {
        const rows = await admittedRows(admission);
        const reference = rows[0].blocks[0];
        if (reference.type !== 'media' || reference.encoding !== 'reference')
          throw new Error('Missing reference');
        const expected = await detachedDigest(
          (async function* () {
            yield* rows;
          })(),
        );
        history.registerMediaOwner(new HistoryMediaOwnership(store));
        await history.addBatch(rows);
        await history.waitForCommit();
        await admission.releaseContents(rows, context);
        const failure = new Error('restored batch observer');
        history.once('contentBatchAdded', () => {
          throw failure;
        });
        forbidArrayRollback(history);
        const conversation = conversationFor(history);
        expect(
          await rejectedValue(
            conversation.setHistory([
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: 'remove media' }],
              },
            ]),
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
        await conversation.setHistory(rows);
        const restoredReservation = await store.hasReservations(
          reference.contentId,
        );
        await conversation.setHistory([]);
        expect({
          rollbackReservation,
          restoredReservation,
          removedReservation: await store.hasReservations(reference.contentId),
        }).toStrictEqual({
          rollbackReservation: true,
          restoredReservation: true,
          removedReservation: false,
        });
      });
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
