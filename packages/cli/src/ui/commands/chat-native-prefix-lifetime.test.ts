/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { describe, expect, it, spyOn } from 'bun:test';
import {
  operationFileCreates,
  runCommand,
  useTempDir,
  withCLI,
} from './native-prefix-test-helpers.js';

async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}
function live(rows: ReadonlyArray<WeakRef<IContent>>): number {
  return rows.filter((value) => value.deref() !== undefined).length;
}
function assertBounded(rows: ReadonlyArray<WeakRef<IContent>>): void {
  expect(live(rows)).toBeLessThanOrEqual(2);
}

describe('actual CLI native prefix decoded-row lifetime', () => {
  const directory = useTempDir('cli-prefix-lifetime-');
  for (const size of [65]) {
    it(`releases converted prefix rows at sink backpressure over ${size} rows`, async () => {
      await withCLI(directory(), size, async ({ context }) => {
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
            throw new Error('Missing native prefix transform');
          return publish.call(
            this,
            {
              ...task,
              transform: async (source, sink) => {
                await transform(source, {
                  ...sink,
                  appendDerived: async (ordinal, content) => {
                    refs.push(new WeakRef(content));
                    await sink.appendDerived(ordinal, content);
                    if (refs.length % 8 === 0) {
                      await collectGarbage();
                      samples++;
                      peak = Math.max(peak, live(refs));
                      assertBounded(refs);
                    }
                  },
                });
              },
            },
            host,
            model,
            options,
          );
        });
        try {
          expect(
            await operationFileCreates(async () => {
              expect(await runCommand(context, 'restore', '1')).toBeUndefined();
            }, true),
          ).toStrictEqual({ directories: [], files: [] });
          await collectGarbage();
          expect(refs.length).toBe(size - (size % 2 === 0 ? 2 : 1));
          expect(samples).toBeGreaterThan(0);
          expect(live(refs)).toBe(0);
          process.stdout.write(
            `CLI_PREFIX_LIFETIME ${JSON.stringify({ size, outputs: refs.length, samples, peak, final: live(refs) })}\n`,
          );
        } finally {
          observer.mockRestore();
        }
      });
    });
  }
});
