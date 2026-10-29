import { chatSessionPorts } from '../../core/chatSessionPorts.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { DensityFileFacts } from '@vybestack/llxprt-code-core/journal/density-file-facts.js';
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
import { compressionValueDigest } from './compression-value-fixture.js';

async function gc(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}
function live(rows: ReadonlyArray<WeakRef<IContent>>): number {
  return rows.filter((row) => row.deref() !== undefined).length;
}
function assertCurrentOutput(rows: ReadonlyArray<WeakRef<IContent>>): void {
  expect(live(rows)).toBeLessThanOrEqual(2);
}
async function seed(
  fixture: Parameters<Parameters<typeof withNativeFallbackFixture>[0]>[0],
  size: number,
): Promise<void> {
  await fixture.seed(
    (function* () {
      for (let index = 0; index < size; index++) yield densityRow(index, 2048);
    })(),
  );
}

describe('native continuous file deduplication through the live journal consumer', () => {
  it('runs through real ChatSession before-send orchestration and reuses the unchanged result without operation files', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await seed(fixture, 512);
      const chat = new ChatSession(
        chatSessionPorts(
          buildRuntimeContext(fixture.history, {
            compressionStrategy: 'high-density',
            contextLimit: 1e9,
            'compression.density.optimizeThreshold': 0,
            'compression.density.readWritePruning': false,
            'compression.density.fileDedupe': true,
            'compression.density.recencyPruning': false,
            'compression.density.recencyRetention': 3,
          }),
        ),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        buildMockContentGenerator(),
        {},
        [],
      );
      await chat.ensureCompressionBeforeSend('continuous-native', 0, 'stream');
      expect(await digestStream(fixture.history.streamRawHistory())).toBe(
        digestRows(densityOracle(512, 2)),
      );
      chat.densityDirty = true;
      const files = await operationFileCreates(
        () =>
          chat.ensureCompressionBeforeSend(
            'continuous-native-warm',
            0,
            'stream',
          ),
        true,
      );
      expect(files).toStrictEqual({ directories: [], files: [] });
      expect(await digestStream(fixture.history.streamRawHistory())).toBe(
        digestRows(densityOracle(512, 2)),
      );
    });
  }, 180_000);

  it('combines read/write pruning, file deduplication and recency without operation files', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await seed(fixture, 65);
      const files = await operationFileCreates(
        () => densityHandler(fixture.history, 7).ensureDensityOptimized(),
        true,
      );
      expect(await digestStream(fixture.history.streamRawHistory())).toBe(
        digestRows(densityOracle(65, 7)),
      );
      expect(await fixture.durable()).toStrictEqual(
        await compressionValueDigest(fixture.history.streamRawHistory()),
      );
      expect(files).toStrictEqual({ directories: [], files: [] });
    });
  });

  it('preserves an output failure after row 65, compensates and continues on the same writer', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await seed(fixture, 512);
      const primary = new Error('continuous output failed');
      const publish = JournalHistoryStore.prototype.publishDetached;
      let armed = true;
      const fault = spyOn(
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
        if (transform === undefined) throw new Error('Missing transform');
        return publish.call(
          this,
          {
            ...task,
            transform: async (source, sink) => {
              let count = 0;
              const append = async (
                ordinal: number,
                row: IContent,
                replacement: boolean,
              ): Promise<void> => {
                if (replacement) await sink.appendReplacement(ordinal, row);
                else await sink.appendDerived(ordinal, row);
                if (armed && ++count === 65) {
                  armed = false;
                  throw primary;
                }
              };
              await transform(source, {
                ...sink,
                appendReplacement: (ordinal, row) => append(ordinal, row, true),
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
        await expect(
          densityHandler(fixture.history, 2).ensureDensityOptimized(),
        ).rejects.toBe(primary);
        expect(await digestStream(fixture.history.streamRawHistory())).toBe(
          digestRows(
            Array.from({ length: 512 }, (_, index) => densityRow(index, 2048)),
          ),
        );
        await densityHandler(fixture.history, 2).ensureDensityOptimized();
        expect(await digestStream(fixture.history.streamRawHistory())).toBe(
          digestRows(densityOracle(512, 2)),
        );
        expect(await fixture.durable()).toStrictEqual(
          await compressionValueDigest(fixture.history.streamRawHistory()),
        );
      } finally {
        fault.mockRestore();
      }
    });
  }, 180_000);

  it('preserves a fact-query failure by identity and keeps the old history available before continuing', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await seed(fixture, 512);
      const expected = digestRows(
        Array.from({ length: 512 }, (_, index) => densityRow(index, 2048)),
      );
      expect(await digestStream(fixture.history.streamRawHistory())).toBe(
        expected,
      );
      const primary = new Error('file deduplication fact read failed');
      const fault = spyOn(
        DensityFileFacts.prototype,
        'latest',
      ).mockRejectedValue(primary);
      try {
        await expect(
          densityHandler(fixture.history, 2).ensureDensityOptimized(),
        ).rejects.toBe(primary);
        expect(await digestStream(fixture.history.streamRawHistory())).toBe(
          expected,
        );
      } finally {
        fault.mockRestore();
      }
      await densityHandler(fixture.history, 2).ensureDensityOptimized();
      expect(await digestStream(fixture.history.streamRawHistory())).toBe(
        digestRows(densityOracle(512, 2)),
      );
    });
  }, 180_000);

  it.each([65])(
    'holds at most the current converted output during %i-row publication',
    async (size) => {
      await withNativeFallbackFixture(async (fixture) => {
        await seed(fixture, size);
        const references: Array<WeakRef<IContent>> = [];
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
          if (transform === undefined) throw new Error('Missing transform');
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
                  references.push(new WeakRef(row));
                  if (replacement) await sink.appendReplacement(ordinal, row);
                  else await sink.appendDerived(ordinal, row);
                  if (references.length % 8 === 0) {
                    await gc();
                    samples++;
                    peak = Math.max(peak, live(references));
                    assertCurrentOutput(references);
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
          await densityHandler(fixture.history, 2).ensureDensityOptimized();
          await gc();
          expect(live(references)).toBe(0);
          expect(references.length).toBe(size);
          expect(samples).toBeGreaterThan(0);
          expect(await digestStream(fixture.history.streamRawHistory())).toBe(
            digestRows(densityOracle(size, 2)),
          );
          process.stdout.write(
            `CONTINUOUS_OUTPUT ${JSON.stringify({ size, outputs: references.length, samples, peak, final: live(references) })}\n`,
          );
        } finally {
          observer.mockRestore();
        }
      });
    },
    180_000,
  );
});
