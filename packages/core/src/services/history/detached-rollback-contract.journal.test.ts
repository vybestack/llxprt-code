/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { withDetachedMedia } from './__tests__/support/detached-media-fixture.js';
import {
  detachedDigest,
  detachedRow,
} from './detached-rollback-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
} from './chronology-rollback-test-helpers.js';

const stages = [
  'capture',
  'prepare',
  'publish',
  'admission-zero',
  'admission-prefix',
  'ack',
  'finalize',
  'cancel',
];

describe('native detached failure compensation', () => {
  it.each(stages)(
    'restores immutable values, owners, media and scalars after %s',
    async (stage) => {
      await withDetachedMedia(async (store, owner) => {
        await withNativeDetachedFixture(
          async ({ history, owners, durable, session, bindOrigin }) => {
            const image = await store.admit({
              bytes: new Uint8Array([1]),
              mimeType: 'image/png',
              semanticMetadata: {},
            });
            const rows = Array.from({ length: 6 }, (_, index) =>
              index === 0
                ? {
                    ...detachedRow(index),
                    blocks: [...detachedRow(index).blocks, image],
                  }
                : detachedRow(index),
            );
            const origin = {};
            await bindOrigin(origin);
            await history.registerMediaOwner(owner);
            await history.detachedValues.replace(rows, undefined, { origin });
            const expected = await detachedDigest(
              (async function* () {
                yield* rows;
              })(),
            );
            const prior = await session.store.snapshot();
            const tokens = 24 + 1000;
            const range = {
              firstSeq: 1,
              lastSeq: 6,
              totalEntries: 6,
              removedInterior: [],
              approximate: false,
            };
            const failure = new Error(stage);
            const controller = new AbortController();
            owner.stage = stage;
            let calls = 0;
            history.setTokenizerFactory(
              exactTokenizer(() => {
                if (!stage.startsWith('admission')) return;
                if (calls++ === (stage === 'admission-zero' ? 0 : 2))
                  throw failure;
              }),
            );
            try {
              const result = await rejectedValue(
                history.detachedValues.transform(
                  async (source, sink) => {
                    for await (const row of source.streamRows()) {
                      await sink.appendValue({
                        ...row,
                        blocks: [{ type: 'text', text: 'candidate' }],
                      });
                      if (stage === 'capture') throw failure;
                    }
                  },
                  undefined,
                  {
                    signal: controller.signal,
                    onAcknowledged: () => {
                      if (stage === 'ack') throw failure;
                      if (stage === 'cancel') controller.abort(failure);
                    },
                  },
                ),
              );
              expect(result).toBe(
                ['prepare', 'publish', 'finalize'].includes(stage)
                  ? owner.failure
                  : failure,
              );
              expect(
                await detachedDigest(history.streamRawHistory()),
              ).toStrictEqual(expected);
              expect(await durable()).toStrictEqual(expected);
              expect(history.getTotalTokens()).toBe(tokens);
              expect(history.getContextRange()).toStrictEqual(range);
              expect(await store.hasReservations(image.contentId)).toBe(true);
              const restored = await session.store.snapshot();
              try {
                const before = [];
                const after = [];
                for await (const entry of prior.entries())
                  before.push(entry.owner);
                for await (const entry of restored.entries())
                  after.push(entry.owner);
                expect(before.every((ownerId) => ownerId > 0)).toBe(true);
                expect(after).toStrictEqual(before);
              } finally {
                await restored.close();
              }
              expect(owners.snapshot().liveRows).toBe(0);
            } finally {
              await prior.close();
            }
          },
        );
      });
    },
  );

  it('preserves primary, compensation and participant failures in order when the restore write fails', async () => {
    await withDetachedMedia(async (_store, owner) => {
      await withNativeDetachedFixture(
        async ({ history, io, primaryRows, owners }) => {
          await history.detachedValues.replace([detachedRow(0)]);
          await history.waitForCommit();
          await history.registerMediaOwner(owner);
          const primary = new Error('publication');
          const compensation = new Error('compensation write');
          const participant = new Error('participant rollback');
          owner.rollbackFailure = participant;
          const candidate = detachedRow(1);
          const result = await rejectedValue(
            history.detachedValues.replace([candidate], undefined, {
              onAcknowledged: () => {
                io.rejectNextWrite(compensation);
                throw primary;
              },
            }),
          );
          expect(result).toBeInstanceOf(AggregateError);
          if (!(result instanceof AggregateError))
            throw new Error('Expected aggregate');
          expect(result.errors).toStrictEqual([
            primary,
            compensation,
            participant,
          ]);
          expect(await detachedDigest(primaryRows())).toStrictEqual(
            await detachedDigest(
              (async function* () {
                yield candidate;
              })(),
            ),
          );
          expect(history.getTotalTokens()).toBe(4);
          expect(history.getContextRange().lastSeq).toBe(2);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(await rejectedValue(history.waitForCommit())).toBe(
            compensation,
          );
          owner.rollbackFailure = undefined;
        },
      );
    });
  });
});
