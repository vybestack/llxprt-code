/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { DensityDiskIndex } from '../densityDiskIndex.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import {
  highdensityRow,
  highdensitySetup,
} from './highdensity-disk-helpers.js';
import { compressionValueDigest } from './compression-value-fixture.js';

async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}

function live(rows: ReadonlyArray<WeakRef<IContent>>): number {
  return rows.filter((weak) => weak.deref() !== undefined).length;
}

async function seedRows(
  fixture: Parameters<Parameters<typeof withNativeFallbackFixture>[0]>[0],
  size: number,
): Promise<void> {
  await fixture.seed(
    (function* () {
      for (let position = 0; position < size; position++)
        yield highdensityRow(position, 64);
    })(),
  );
}

describe('native high-density pinned input and output lifetime', () => {
  it.each([512, 8192])(
    'releases decoded and transformed rows during a real %i-row native operation',
    async (size) => {
      await withNativeFallbackFixture(async (fixture) => {
        await seedRows(fixture, size);
        const { history } = fixture;
        const { handler } = highdensitySetup(history, undefined, undefined, {
          contextLimit: 1e9,
        });
        const decoded: Array<WeakRef<IContent>> = [];
        const transformed: Array<WeakRef<IContent>> = [];
        const read = JournalDumpSnapshot.prototype.readRow;
        JournalDumpSnapshot.prototype.readRow = async function (
          this: JournalDumpSnapshot,
          position: number,
        ): Promise<IContent> {
          const row = await read.call(this, position);
          decoded.push(new WeakRef(row));
          return row;
        };
        const prepare = HighDensityStrategy.prototype.prepareDisk;
        let restoreOutput = (): void => {};
        HighDensityStrategy.prototype.prepareDisk = async function (
          this: HighDensityStrategy,
          context: Parameters<HighDensityStrategy['prepareDisk']>[0],
        ): ReturnType<HighDensityStrategy['prepareDisk']> {
          const output = await prepare.call(this, context);
          if (output.kind === 'applied') {
            const readOutput = output.candidate.readRow.bind(output.candidate);
            output.candidate.readRow = async (position): Promise<IContent> => {
              const row = await readOutput(position);
              transformed.push(new WeakRef(row));
              return row;
            };
            restoreOutput = () => {
              output.candidate.readRow = readOutput;
            };
          }
          return output;
        };
        const transform = history.detachedValues.transform;
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
                  if (transformed.length % 128 === 0) await sample();
                },
              }),
            model,
            options,
          ),
        );
        let peakDecoded = 0;
        let peakTransformed = 0;
        let samples = 0;
        const sample = async (): Promise<void> => {
          await collectGarbage();
          samples++;
          peakDecoded = Math.max(peakDecoded, live(decoded));
          peakTransformed = Math.max(peakTransformed, live(transformed));
          expect(live(decoded)).toBeLessThanOrEqual(2);
          expect(live(transformed)).toBeLessThanOrEqual(2);
        };
        try {
          expect(
            await handler.performCompression('native-density-lifetime'),
          ).toBe(PerformCompressionResult.COMPRESSED);
          await collectGarbage();
          expect(live(decoded)).toBe(0);
          expect(live(transformed)).toBe(0);
          expect(samples).toBeGreaterThan(0);
          expect(decoded.length).toBeGreaterThan(size);
          expect(decoded.length).toBeLessThan(size * 6);
          expect(transformed.length).toBeGreaterThan(size / 2);
          process.stdout.write(
            JSON.stringify({
              size,
              decoded: decoded.length,
              transformed: transformed.length,
              samples,
              peakDecoded,
              peakTransformed,
            }) + '\n',
          );
        } finally {
          publication.mockRestore();
          restoreOutput();
          HighDensityStrategy.prototype.prepareDisk = prepare;
          JournalDumpSnapshot.prototype.readRow = read;
        }
      });
    },
    180_000,
  );

  it('rolls back an external output producer failure and continues on the same native writer', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await seedRows(fixture, 512);
      const { history } = fixture;
      const before = await compressionValueDigest(
        (async function* () {
          for (let position = 0; position < 512; position++)
            yield highdensityRow(position, 64);
        })(),
      );
      const { handler } = highdensitySetup(history);
      const primary = new Error('external density output producer failed');
      const transform = history.detachedValues.transform;
      let reject = true;
      const fault = spyOn(
        history.detachedValues,
        'transform',
      ).mockImplementation((producer, model, options) =>
        transform(
          async (source, sink) => {
            let count = 0;
            await producer(source, {
              ...sink,
              appendDerived: async (ordinal, row) => {
                await sink.appendDerived(ordinal, row);
                if (reject && ++count === 65) {
                  reject = false;
                  throw primary;
                }
              },
            });
          },
          model,
          options,
        ),
      );
      try {
        await expect(
          handler.performCompression('producer-failure'),
        ).rejects.toBe(primary);
        expect(
          await compressionValueDigest(history.streamRawHistory()),
        ).toStrictEqual(before);
        expect(await fixture.durable()).toStrictEqual(before);
        expect(await handler.performCompression('same-writer')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        expect(await fixture.durable()).toStrictEqual(
          await compressionValueDigest(history.streamRawHistory()),
        );
      } finally {
        fault.mockRestore();
      }
    });
  }, 180_000);

  it('preserves the publication failure and both output and pin cleanup failures', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await seedRows(fixture, 512);
      const primary = new Error('density publication rejected');
      const outputCleanup = new Error('density lookup close failed');
      const pinCleanup = new Error('density pin close failed');
      const { history } = fixture;
      const { handler } = highdensitySetup(history);
      const transform = history.detachedValues.transform;
      const fault = spyOn(
        history.detachedValues,
        'transform',
      ).mockImplementation((producer, model, options) =>
        transform(
          async (source, sink) => {
            await producer(source, sink);
            throw primary;
          },
          model,
          options,
        ),
      );
      const closeOutput = DensityDiskIndex.prototype.close;
      const output = spyOn(
        DensityDiskIndex.prototype,
        'close',
      ).mockImplementation(function (this: DensityDiskIndex) {
        closeOutput.call(this);
        throw outputCleanup;
      });
      const closePin = JournalDumpSnapshot.prototype.close;
      const pin = spyOn(
        JournalDumpSnapshot.prototype,
        'close',
      ).mockImplementation(async function (this: JournalDumpSnapshot) {
        await closePin.call(this);
        throw pinCleanup;
      });
      try {
        const failure: unknown = await handler
          .performCompression('cleanup-failures')
          .catch((error: unknown) => error);
        if (!(failure instanceof AggregateError))
          throw new Error('Expected pin cleanup aggregate');
        const operation: unknown = failure.errors[0];
        if (!(operation instanceof AggregateError))
          throw new Error('Expected output cleanup aggregate');
        expect(operation.errors).toStrictEqual([primary, outputCleanup]);
        expect(operation.cause).toBe(primary);
        expect(failure.errors).toStrictEqual([operation, pinCleanup]);
        expect(failure.cause).toBe(operation);
        expect(history.getStatistics().totalMessages).toBe(512);
      } finally {
        pin.mockRestore();
        output.mockRestore();
        fault.mockRestore();
      }
    });
  }, 180_000);
});
