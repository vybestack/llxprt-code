/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { DensityReadWriteFacts } from '@vybestack/llxprt-code-core/journal/density-read-write-facts.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ChatSession } from '../../core/chatSession.js';
import {
  buildRuntimeContext,
  buildMockContentGenerator,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import {
  densityHandler,
  densityRow,
  densityOracle,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';

async function gc(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}
function live(rows: ReadonlyArray<WeakRef<IContent>>): number {
  return rows.filter((row) => row.deref() !== undefined).length;
}
function current(rows: ReadonlyArray<WeakRef<IContent>>): void {
  expect(live(rows)).toBeLessThanOrEqual(2);
}

describe('native read/write consumer lifetime', () => {
  it.each([512, 8192])(
    'releases converted outputs at awaited backpressure over %i original rows',
    async (size) => {
      await withNativeFallbackFixture(async ({ history, seed }) => {
        await seed(
          (function* () {
            for (let index = 0; index < size; index++) yield densityRow(index);
          })(),
        );
        const refs: Array<WeakRef<IContent>> = [];
        let samples = 0;
        let peak = 0;
        const publish = JournalHistoryStore.prototype.publishDetached;
        const observer = spyOn(
          JournalHistoryStore.prototype,
          'publishDetached',
        ).mockImplementation(function (
          this: JournalHistoryStore,
          task,
          host,
          model,
          options,
        ) {
          const transform = task.transform;
          if (transform === undefined)
            throw new Error('Missing native transform');
          return publish.call(
            this,
            {
              ...task,
              transform: async (source, sink) => {
                const append = async (
                  ordinal: number,
                  row: IContent,
                  replacement: boolean,
                ): Promise<void> => {
                  refs.push(new WeakRef(row));
                  if (replacement) await sink.appendReplacement(ordinal, row);
                  else await sink.appendDerived(ordinal, row);
                  if (refs.length % 128 === 0) {
                    await gc();
                    samples++;
                    peak = Math.max(peak, live(refs));
                    current(refs);
                  }
                };
                await transform(source, {
                  ...sink,
                  appendReplacement: (ordinal, row) =>
                    append(ordinal, row, true),
                  appendDerived: (ordinal, row) => append(ordinal, row, false),
                });
              },
            },
            host,
            model,
            options,
          );
        });
        try {
          await densityHandler(history, 7).ensureDensityOptimized();
          await gc();
          expect(live(refs)).toBe(0);
          expect(refs.length).toBe(densityOracle(size, 7).length);
          expect(samples).toBeGreaterThan(0);
          expect(await digestStream(history.streamRawHistory())).toBe(
            digestRows(densityOracle(size, 7)),
          );
          process.stdout.write(
            `READ_WRITE_OUTPUT ${JSON.stringify({ size, outputs: refs.length, samples, peak, final: live(refs) })}\n`,
          );
        } finally {
          observer.mockRestore();
        }
      });
    },
    180_000,
  );
  it('preserves fact-query error identity and resumes on the same writer', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      await seed(Array.from({ length: 65 }, (_, index) => densityRow(index)));
      const before = digestRows(
        Array.from({ length: 65 }, (_, index) => densityRow(index)),
      );
      const failure = new Error('read/write point query failed');
      const fault = spyOn(
        DensityReadWriteFacts.prototype,
        'stale',
      ).mockRejectedValue(failure);
      try {
        await expect(
          densityHandler(history, 7).ensureDensityOptimized(),
        ).rejects.toBe(failure);
        expect(await digestStream(history.streamRawHistory())).toBe(before);
      } finally {
        fault.mockRestore();
      }
      await densityHandler(history, 7).ensureDensityOptimized();
      expect(await digestStream(history.streamRawHistory())).toBe(
        digestRows(densityOracle(65, 7)),
      );
    });
  });
  it('runs through ChatSession before-send and reuses unchanged read/write facts without operation files', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      await seed(Array.from({ length: 512 }, (_, index) => densityRow(index)));
      const chat = new ChatSession(
        buildRuntimeContext(history, {
          compressionStrategy: 'high-density',
          contextLimit: 1e9,
          'compression.density.optimizeThreshold': 0,
          'compression.density.readWritePruning': true,
          'compression.density.fileDedupe': true,
          'compression.density.recencyPruning': true,
          'compression.density.recencyRetention': 3,
        }),
        buildMockContentGenerator(),
        {},
        [],
      );
      await chat.ensureCompressionBeforeSend('read-write', 0, 'stream');
      expect(await digestStream(history.streamRawHistory())).toBe(
        digestRows(densityOracle(512, 7)),
      );
      chat.densityDirty = true;
      const files = await operationFileCreates(
        () => chat.ensureCompressionBeforeSend('read-write-warm', 0, 'stream'),
        true,
      );
      expect(files).toStrictEqual({ directories: [], files: [] });
      expect(await digestStream(history.streamRawHistory())).toBe(
        digestRows(densityOracle(512, 7)),
      );
    });
  }, 180_000);
});
