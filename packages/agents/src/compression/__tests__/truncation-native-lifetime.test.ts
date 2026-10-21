/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import {
  executeTruncation,
  truncationValues,
} from './truncation-value-helpers.js';

async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}

function live(rows: ReadonlyArray<WeakRef<IContent>>): number {
  return rows.filter((weak) => weak.deref() !== undefined).length;
}

describe('native truncation decoded-row lifetime', () => {
  it.each([512, 8192])(
    'releases prior decoded rows at actual sink backpressure over %i source rows',
    async (size) => {
      await withNativeFallbackFixture(async ({ history }) => {
        await history.detachedValues.replace(truncationValues(size, 0, 64));
        const decoded: Array<WeakRef<IContent>> = [];
        const read = JournalDumpSnapshot.prototype.readRow;
        JournalDumpSnapshot.prototype.readRow = async function (
          this: JournalDumpSnapshot,
          position: number,
        ): Promise<IContent> {
          const row = await read.call(this, position);
          decoded.push(new WeakRef(row));
          return row;
        };
        const transform = history.detachedValues.transform;
        let appended = 0;
        let samples = 0;
        let peak = 0;
        const sample = async (): Promise<void> => {
          await collectGarbage();
          samples++;
          const count = live(decoded);
          peak = Math.max(peak, count);
          expect(count).toBeLessThanOrEqual(2);
        };
        const publication = spyOn(
          history.detachedValues,
          'transform',
        ).mockImplementation((producer, model, options) =>
          transform(
            async (source, sink) =>
              producer(source, {
                ...sink,
                appendDerived: async (ordinal, row) => {
                  await sink.appendDerived(ordinal, row);
                  if (++appended % 128 === 0) await sample();
                },
              }),
            model,
            options,
          ),
        );
        try {
          expect((await executeTruncation(history, size)).outcome).toBe(
            'applied',
          );
          await collectGarbage();
          expect(live(decoded)).toBe(0);
          expect(samples).toBeGreaterThan(0);
          expect(appended).toBe(size - 11);
          expect(decoded.length).toBeGreaterThan(size);
          process.stdout.write(
            `NATIVE_TRUNCATION_LIFETIME ${JSON.stringify({ size, decoded: decoded.length, samples, peak, final: live(decoded) })}\n`,
          );
        } finally {
          publication.mockRestore();
          JournalDumpSnapshot.prototype.readRow = read;
        }
      });
    },
    180_000,
  );
});
