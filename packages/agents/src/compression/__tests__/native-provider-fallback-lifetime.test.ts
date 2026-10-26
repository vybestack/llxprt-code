/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import {
  fallbackRow,
  nativeFallback,
} from './native-provider-fallback-helpers.js';

async function collect(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}

function live(refs: ReadonlyArray<WeakRef<IContent>>): number {
  return refs.filter((ref) => ref.deref() !== undefined).length;
}

function assertBounded(refs: ReadonlyArray<WeakRef<IContent>>): void {
  expect(live(refs)).toBeLessThanOrEqual(2);
}

describe('native fallback indexed source lifetime', () => {
  it.each([65])(
    'releases source conversions under awaited backpressure at %i rows',
    async (size) => {
      await withNativeValueFixture(async ({ history }) => {
        await history.detachedValues.replace(
          (function* (): Generator<IContent> {
            for (let index = 0; index < size; index++) yield fallbackRow(index);
          })(),
        );
        const refs: Array<WeakRef<IContent>> = [];
        let samples = 0;
        let peak = 0;
        const read = JournalDumpSnapshot.prototype.readRow;
        JournalDumpSnapshot.prototype.readRow = async function (
          this: JournalDumpSnapshot,
          index: number,
        ): Promise<IContent> {
          if (refs.length > 0 && refs.length % 8 === 0) {
            await collect();
            samples++;
            peak = Math.max(peak, live(refs));
            assertBounded(refs);
          }
          const row = await read.call(this, index);
          refs.push(new WeakRef(row));
          return row;
        };
        try {
          expect((await nativeFallback(history, size - 1)).outcome).toBe(
            'applied',
          );
        } finally {
          JournalDumpSnapshot.prototype.readRow = read;
        }
        await collect();
        expect(refs.length).toBeGreaterThanOrEqual(size * 2);
        expect(samples).toBeGreaterThan(0);
        expect(live(refs)).toBe(0);
        process.stdout.write(
          `FALLBACK_LIFETIME ${JSON.stringify({ size, reads: refs.length, samples, peak, final: live(refs) })}\n`,
        );
      });
    },
    180_000,
  );
});
