/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
function collectGarbage(): void {
  const runtime: unknown = Reflect.get(globalThis, 'Bun');
  if (typeof runtime !== 'object' || runtime === null)
    throw new Error('Bun runtime is unavailable');
  if (!('gc' in runtime) || typeof runtime.gc !== 'function')
    throw new Error('Bun GC is unavailable');
  runtime.gc(true);
}
import {
  withRollbackFixture,
  rowsOf,
  durableRowsOf,
  rejectedValue,
  exactTokenizer,
} from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  densityHandler,
  densityRow,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';

async function admissionRollback(
  size: number,
): Promise<{ before: string; after: string }> {
  return withRollbackFixture(async (history, recorder) => {
    for (let index = 0; index < size; index++)
      await recorder.commit('content', { content: densityRow(index) });
    const before = digestRows(
      Array.from({ length: size }, (_, index) => densityRow(index)),
    );
    history.syncTotalTokens(size * 4);
    const handler = densityHandler(history);
    recorder.failAdmissionAfter(2);
    expect(await rejectedValue(handler.ensureDensityOptimized())).toBe(
      recorder.failure,
    );
    expect(await digestStream(history.streamRawHistory())).toBe(before);
    expect(history.getTotalTokens()).toBe(size * 4);
    expect(handler.densityDirty).toBe(false);
    await history.waitForCommit();
    expect(digestRows(await durableRowsOf(recorder))).toBe(before);
    handler.markDensityDirty();
    await handler.ensureDensityOptimized();
    return { before, after: await digestStream(history.streamRawHistory()) };
  });
}

describe('disk density publication and lifetime', () => {
  for (const size of [512, 8192])
    it(`restores the entire pinned ${size}-row journal after partial admission and permits retry`, async () => {
      const result = await admissionRollback(size);
      expect(result.after).not.toBe(result.before);
    }, 600_000);
  it('preserves pending caller row and chronology marker identity on rejected publication', async () => {
    await withRollbackFixture(async (history) => {
      const before = Array.from({ length: 12 }, (_, index) =>
        densityRow(index, 0),
      );
      await history.addBatch(before);
      const first = before[0];
      const marker = first.metadata?.chronology;
      const failure = new Error('density publication rejected');
      history.once('tokensUpdated', () => {
        first.metadata = {
          chronology: { seq: 900, userTurn: 99, step: 2, recordedAt: 0 },
        };
        collectGarbage();
        throw failure;
      });
      const handler = densityHandler(history);
      expect(await rejectedValue(handler.ensureDensityOptimized())).toBe(
        failure,
      );
      const restored = await rowsOf(history);
      expect(restored).toHaveLength(before.length);
      expect(restored[0]).toBe(first);
      expect(restored[0].metadata?.chronology).toBe(marker);
      expect(handler.densityDirty).toBe(false);
    }, true);
  });
  it('retries a transient candidate token estimate over the same pinned disk rows', async () => {
    await withSuffixFixture(
      512,
      async (history) => {
        const handler = densityHandler(history);
        let failed = false;
        history.setTokenizerFactory(
          exactTokenizer(() => {
            if (!failed) {
              failed = true;
              throw Object.assign(new Error('temporary estimate transport'), {
                status: 503,
              });
            }
          }),
        );
        await handler.ensureDensityOptimized();
        expect(failed).toBe(true);
        expect(handler.densityDirty).toBe(false);
        let count = 0;
        for await (const row of history.streamRawHistory()) {
          expect(row.blocks.length).toBeGreaterThan(0);
          count++;
        }
        expect(count).toBeLessThan(512);
      },
      2048,
      densityRow,
    );
  }, 180_000);
  it('accepts a valid surviving row larger than eight MiB without a cap', async () => {
    const large = 9 * 1024 * 1024;
    await withSuffixFixture(
      512,
      async (history) => {
        await densityHandler(history).ensureDensityOptimized();
        let last;
        for await (const row of history.streamRawHistory()) last = row;
        expect(last).toStrictEqual(densityRow(511, large));
      },
      2048,
      (index, bytes) => densityRow(index, index === 511 ? large : bytes),
    );
  }, 180_000);
});
