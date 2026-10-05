/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import { curatedFixtureRow } from '../../../../core/src/services/history/curated-stream-test-helpers.js';
import {
  AttemptHistory,
  attemptHandler,
} from './compression-attempt-stream-helpers.js';

describe('compression attempt cursor exits', () => {
  for (const exit of ['return', 'throw', 'break']) {
    it(`releases the hook cursor on explicit ${exit}`, async () => {
      await withSuffixFixture(
        512,
        async (service, ownership) => {
          let finished = false;
          let failure: string | undefined;
          let liveRowsAfterExit: number | undefined;
          const handler = attemptHandler(service, async (context) => {
            await context.history.next();
            if (exit === 'return') await context.history.return();
            else if (exit === 'throw') {
              await context.history
                .throw(new Error('stop'))
                .catch((error: unknown) => {
                  if (!(error instanceof Error)) throw error;
                  failure = error.message;
                });
            } else {
              for await (const row of context.history) {
                void row;
                break;
              }
            }
            finished = true;
            liveRowsAfterExit = ownership.snapshot().liveRows;
          });
          expect(await handler.performCompression(exit)).toBe(
            PerformCompressionResult.NOOP,
          );
          expect(finished).toBe(true);
          expect(failure).toBe(exit === 'throw' ? 'stop' : undefined);
          expect(liveRowsAfterExit).toBe(0);
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        0,
        curatedFixtureRow,
        undefined,
        (options) => new AttemptHistory(options),
      );
    }, 120_000);
  }
});

describe('compression attempt row-size and retaining controls', () => {
  it('accepts a valid single hook row larger than 8 MiB', async () => {
    const payload = 8 * 1024 * 1024 + 1024;
    await withSuffixFixture(
      1,
      async (service, ownership) => {
        let observedLength = 0;
        const handler = attemptHandler(service, async (context) => {
          for await (const row of context.history) {
            const block = row.blocks[0];
            if (block.type !== 'text') throw new Error('Expected text payload');
            observedLength = block.text.length;
          }
        });
        expect(await handler.performCompression('large-row')).toBe(
          PerformCompressionResult.NOOP,
        );
        expect(observedLength).toBe(payload + 2);
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      payload,
      undefined,
      undefined,
      (options) => new AttemptHistory(options),
    );
  }, 120_000);

  it('fails both fixture bounds when an external hook deliberately retains every row', async () => {
    await withSuffixFixture(
      8192,
      async (service, ownership) => {
        const retained: IContent[] = [];
        const handler = attemptHandler(service, async (context) => {
          for await (const row of context.history) {
            ownership.retain(row);
            retained.push(row);
          }
        });
        try {
          expect(await handler.performCompression('eager-trap')).toBe(
            PerformCompressionResult.NOOP,
          );
          expect(ownership.snapshot().liveRows).toBeGreaterThan(440);
          expect(ownership.snapshot().liveSerializedBytes).toBeGreaterThan(
            8 * 1024 * 1024,
          );
          expect(
            ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(false);
        } finally {
          for (const row of retained) ownership.release(row);
        }
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      24 * 1024,
      curatedFixtureRow,
      undefined,
      (options) => new AttemptHistory(options),
    );
  }, 120_000);
});
