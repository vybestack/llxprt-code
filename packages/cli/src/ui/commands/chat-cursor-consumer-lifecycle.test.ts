/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-core/services/history/history-suffix-test-helpers.js';
import { deferred } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  publicChat,
  publicRow,
  PublicCursorHistory,
} from '../../test-utils/public-history-cursor.js';

for (const size of [512, 8192]) {
  describe(`public consumer callbacks over ${size} journal rows`, () => {
    it('applies callback backpressure with bounded external copies and closes every owner on consumer error', async () => {
      const entered = deferred();
      const resume = deferred();
      const consumer = new RowOwnership();
      let observed: PublicCursorHistory | undefined;
      async function callback(row: IContent): Promise<void> {
        const copy = { ...row, blocks: [...row.blocks] };
        consumer.retain(row);
        consumer.retain(copy);
        try {
          entered.resolve();
          await resume.promise;
          throw new Error('consumer callback fault');
        } finally {
          consumer.release(copy);
          consumer.release(row);
        }
      }
      await withSuffixFixture(
        size,
        async (history, reader, counters) => {
          if (!observed) throw new Error('missing observed history');
          const consume = async (): Promise<void> => {
            for await (const row of publicChat(history).streamHistory())
              await callback(row);
          };
          const task = consume();
          const settled = task.catch((error: unknown) => error);
          await Promise.race([entered.promise, settled]);
          try {
            expect(counters.snapshot()).toMatchObject({
              rowsDecoded: 1,
              peakDecodedRows: 1,
            });
            for (const owner of [reader, observed.borrowed, observed.copies])
              expect(owner.snapshot().liveRows).toBe(1);
            expect(consumer.snapshot().liveRows).toBe(2);
            for (const owner of [
              reader,
              observed.borrowed,
              observed.copies,
              consumer,
            ])
              expect(
                owner.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
              ).toBe(true);
          } finally {
            resume.resolve();
          }
          expect(await settled).toMatchObject({
            message: 'consumer callback fault',
          });
          expect(counters.snapshot().rowsDecoded).toBe(1);
          for (const owner of [
            reader,
            observed.borrowed,
            observed.copies,
            consumer,
          ])
            expect(owner.snapshot().liveRows).toBe(0);
        },
        2048,
        publicRow,
        undefined,
        (options) => {
          observed = new PublicCursorHistory(options);
          return observed;
        },
      );
    }, 120_000);
  });
}
