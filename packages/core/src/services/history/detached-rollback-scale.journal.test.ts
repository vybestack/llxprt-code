/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { withDetachedMedia } from './__tests__/support/detached-media-fixture.js';
import {
  detachedDigest,
  detachedRow,
  detachedRows,
} from './detached-rollback-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
} from './chronology-rollback-test-helpers.js';
import type { RowOwnershipStats } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';

const limits = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
function bounded(stats: RowOwnershipStats): boolean {
  return (
    stats.liveRows <= limits.rows &&
    stats.liveSerializedBytes <= limits.serializedBytes
  );
}
const matrix = [512, 8192].flatMap((size) =>
  ['zero', 'prefix', 'ack'].map((stage) => ({ size, stage })),
);

describe('native detached rollback scale', () => {
  it.each([512, 8192])(
    'charges %i borrowed inputs immediately and releases before acknowledgement',
    async (size) => {
      await withNativeDetachedFixture(async ({ history, owners, durable }) => {
        const submitted = {
          rows: Array.from({ length: size }, (_, index) => detachedRow(index)),
        };
        let acknowledged: RowOwnershipStats | undefined;
        const failure = new Error('post ack rejection');
        const operation = history.detachedValues.replace(
          submitted.rows,
          undefined,
          {
            onAcknowledged: () => {
              acknowledged = owners.snapshot();
              throw failure;
            },
          },
        );
        expect(owners.snapshot().liveRows).toBe(size);
        expect(owners.snapshot().liveSerializedBytes).toBeGreaterThan(
          size * 2048,
        );
        submitted.rows = [];
        expect(await rejectedValue(operation)).toBe(failure);
        if (acknowledged === undefined)
          throw new Error('Missing acknowledgement');
        expect(bounded(acknowledged)).toBe(true);
        expect(history.getContextRange().totalEntries).toBe(0);
        expect((await durable()).count).toBe(0);
        expect(owners.snapshot().liveRows).toBe(0);
      });
    },
    180_000,
  );

  it.each(matrix)(
    'restores all $size mixed values after $stage admission failure',
    async ({ size, stage }) => {
      await withNativeDetachedFixture(
        async ({ history, owners, durable, session }) => {
          await history.detachedValues.replace(detachedRows(size));
          const expected = await detachedDigest(detachedRows(size));
          const failure = new Error(stage);
          let held: RowOwnershipStats | undefined;
          let calls = 0;
          history.setTokenizerFactory(
            exactTokenizer(() => {
              if (stage !== 'ack' && calls++ === (stage === 'zero' ? 0 : 8))
                throw failure;
            }),
          );
          const before = session.store.published?.commitSeq;
          expect(
            await rejectedValue(
              history.detachedValues.transform(
                async (source, sink) => {
                  for await (const row of source.streamRows())
                    await sink.appendValue({
                      ...row,
                      metadata: { ...row.metadata, turnId: 'changed' },
                    });
                },
                undefined,
                {
                  onAcknowledged: () => {
                    held = owners.snapshot();
                    throw failure;
                  },
                },
              ),
            ),
          ).toBe(failure);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(expected);
          expect(await durable()).toStrictEqual(expected);
          expect(history.getTotalTokens()).toBe(size * 4);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(session.store.published?.commitSeq).toBe(
            (before ?? 0) + (stage === 'ack' ? 2 : 0),
          );
          if (stage === 'ack' && held === undefined)
            throw new Error('Missing acknowledgement');
          expect(bounded(held ?? owners.snapshot())).toBe(true);
        },
      );
    },
    180_000,
  );

  it.each([
    { kind: 'objects', count: 441, bytes: 0 },
    {
      kind: 'bytes',
      count: 439,
      bytes: Math.floor((8 * 1024 * 1024) / 439) + 1,
    },
  ])(
    'detects near-limit $kind participant retention at acknowledgement',
    async ({ kind, count, bytes }) => {
      await withDetachedMedia(async (_store, owner) => {
        await withNativeDetachedFixture(async ({ history, owners }) => {
          await history.registerMediaOwner(owner);
          const retained: IContent[] = [];
          owner.onPrepare = () => {
            for (let index = 0; index < count; index++) {
              const row = detachedRow(index, bytes);
              retained.push(row);
              owners.retain(row);
            }
          };
          owner.onRollback = () => {
            for (const row of retained) owners.release(row);
            retained.length = 0;
          };
          let held: RowOwnershipStats | undefined;
          const failure = new Error('trap rollback');
          expect(
            await rejectedValue(
              history.detachedValues.replace(detachedRows(1), undefined, {
                onAcknowledged: () => {
                  held = owners.snapshot();
                  throw failure;
                },
              }),
            ),
          ).toBe(failure);
          if (held === undefined) throw new Error('Missing trap census');
          expect(bounded(held)).toBe(false);
          expect(
            kind === 'objects'
              ? held.liveRows / limits.rows
              : held.liveSerializedBytes / limits.serializedBytes,
          ).toBeGreaterThan(1);
          expect(owners.snapshot().liveRows).toBe(0);
        });
      });
    },
  );
});
