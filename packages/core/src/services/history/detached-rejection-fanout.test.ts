/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import { requireJournalRecorder } from './recorderBackend.js';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRows,
} from './detached-rollback-test-helpers.js';

describe('rejected detached publication mirror delivery', () => {
  for (const count of [0, 3]) {
    it(`settles the restored ${count}-row mirror before rejecting with the original error`, async () => {
      await withNativeDetachedFixture(async ({ history, recording }) => {
        await history.detachedValues.replace(detachedRows(count));
        const mirror = await requireJournalRecorder(recording).session();
        const commit = mirror.store.commit.bind(mirror.store);
        mirror.store.commit = async (edits) => {
          await Bun.sleep(30);
          return commit(edits);
        };
        const failure = new Error('publication rejected');
        const error = await rejectedValue(
          history.detachedValues.replace(detachedRows(1), undefined, {
            afterPublication: async () => {
              await history.detachedValues.host().journal.settleFanout();
              throw failure;
            },
          }),
        );
        expect(error).toBe(failure);
        const expected = await detachedDigest(detachedRows(count));
        expect(await detachedDurableDigest(recording)).toStrictEqual(expected);
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
      });
    });
  }

  it('keeps publication and task cleanup errors in order while settling rollback delivery', async () => {
    await withNativeDetachedFixture(async ({ history, recording }) => {
      await history.detachedValues.replace(detachedRows(3));
      const failure = new Error('publication rejected');
      const cleanup = new Error('task cleanup failed');
      const fanout = new Error('mirror settlement failed');
      const host = history.detachedValues.host();
      const settle = host.journal.settleFanout.bind(host.journal);
      const error = await rejectedValue(
        host.journal.publishDetached(
          {
            transform: async (_source, sink) => {
              for await (const row of detachedRows(1))
                await sink.appendValue(row);
            },
            dispose: () => {
              throw cleanup;
            },
          },
          host,
          undefined,
          {
            afterPublication: async () => {
              await settle();
              host.journal.settleFanout = async () => {
                await settle();
                throw fanout;
              };
              throw failure;
            },
          },
        ),
      );
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError))
        throw new Error('Missing publication cleanup failure');
      expect(error.cause).toBe(failure);
      expect(error.errors).toStrictEqual([failure, cleanup, fanout]);
      host.journal.settleFanout = settle;
      await history.waitForCommit();
      expect(await detachedDurableDigest(recording)).toStrictEqual(
        await detachedDigest(detachedRows(3)),
      );
    });
  });
});
