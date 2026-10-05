/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import {
  mediaParticipant,
  rejectedValue,
  rowsOf,
} from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  conversationFor,
  forbidArrayRollback,
  boundedOwners,
  recordArrayProof,
} from './conversation-array-test-helpers.js';
import type { RowOwnershipStats } from '../../../core/src/recording/rowOwnership.js';

for (const size of [512, 8192]) {
  describe('real ConversationManager array replacement', () => {
    it(`replaces ${size} rows without entering either old array route`, async () => {
      await withDetachedFixture(async ({ history, recorder, owners }) => {
        forbidArrayRollback(history);
        history.setBaseTokenOffset(17);
        history.setCacheAnchorSeq(1);
        let held: RowOwnershipStats | undefined;
        history.registerMediaOwner(
          mediaParticipant(() => ({
            publish: () => undefined,
            rollback: () => undefined,
            finalize: () => {
              held = owners.snapshot();
            },
          })),
        );
        const result = await conversationFor(history).setHistory(
          Array.from({ length: size }, (_, index) => detachedRow(index)),
        );
        const expected = await detachedDigest(detachedRows(size));
        expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
          expected,
        );
        expect(await detachedDurableDigest(recorder)).toStrictEqual(expected);
        expect(history.getTotalTokens()).toBe(size * 4 + 17);
        expect(history.getCacheAnchorSeq()).toBe(0);
        expect(result).toBeUndefined();
        if (held === undefined) throw new Error('Missing post-ack checkpoint');
        expect(boundedOwners(held)).toBe(true);
        expect(owners.snapshot().liveRows).toBe(0);
        recordArrayProof({
          kind: 'success',
          size,
          expected,
          held,
          returnedRows: 0,
        });
      });
    }, 180_000);
  });
}

describe('ConversationManager restore value contract', () => {
  describe('conversation restore promise rejection', () => {
    it('returns a rejected promise when reading caller metadata fails', async () => {
      await withDetachedFixture(async ({ history }) => {
        const failure = new Error('caller metadata read');
        const caller: import('../../../core/src/services/history/IContent.js').IContent =
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'caller' }],
            get metadata(): never {
              throw failure;
            },
          };
        const operation = conversationFor(history).setHistory([caller]);
        expect(await rejectedValue(operation)).toBe(failure);
        expect(history.getContextRange().totalEntries).toBe(0);
      });
    });
  });
  it('preserves frozen stamped inputs and gives fresh unstamped entries turn keys without model attribution', async () => {
    await withDetachedFixture(async ({ history }) => {
      const stamped = {
        ...detachedRow(0),
        metadata: Object.freeze(detachedRow(0).metadata),
      };
      const fresh = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'fresh' }],
      } satisfies import('../../../core/src/services/history/IContent.js').IContent;
      forbidArrayRollback(history);
      await conversationFor(history).setHistory([stamped, stamped, fresh]);
      const rows = await rowsOf(history);
      expect(rows.slice(0, 2)).toStrictEqual([stamped, stamped]);
      expect(rows[2].metadata?.turnId).toMatch(/^turn_/);
      expect(rows[2].metadata?.model).toBeUndefined();
      expect(fresh).toStrictEqual({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'fresh' }],
      });
    });
  });

  it('accepts and restores a valid nine-MiB row without stamping its frozen input', async () => {
    await withDetachedFixture(async ({ history, recorder }) => {
      const caller = {
        ...detachedRow(0, 9 * 1024 * 1024),
        metadata: Object.freeze(detachedRow(0).metadata),
      };
      const failure = new Error('large observer');
      forbidArrayRollback(history);
      history.once('tokensUpdated', () => {
        throw failure;
      });
      expect(
        await rejectedValue(conversationFor(history).setHistory([caller])),
      ).toBe(failure);
      expect(history.getContextRange().totalEntries).toBe(0);
      await conversationFor(history).setHistory([caller]);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        await detachedDigest(detachedRows(1, 9 * 1024 * 1024)),
      );
      expect((await detachedDurableDigest(recorder)).bytes).toBeGreaterThan(
        9 * 1024 * 1024,
      );
    });
  }, 180_000);
});
