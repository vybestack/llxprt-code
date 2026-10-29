/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';
import {
  probeTransformRow,
  sweepTransformRows,
  transformProbes,
} from './transform-value-test-helpers.js';

const cap = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

describe('journal producer ownership', () => {
  const cases = [512, 8192].flatMap((size) =>
    [false, true].map((retain) => ({ size, retain })),
  );
  for (const { size, retain } of cases) {
    it(`bounds a ${size}-row producer and detects external retention=${retain}`, async () => {
      await withNativeDetachedFixture(async ({ history, owners }) => {
        const probes = transformProbes();
        const retained: IContent[] = [];
        async function* source(): AsyncGenerator<IContent, void, unknown> {
          for (let index = 0; index < size; index++) {
            const row = batchRow(index);
            probeTransformRow(row, probes);
            if (retain) {
              retained.push(row);
              owners.retain(row);
            }
            yield row;
          }
        }
        try {
          await history.detachedValues.append(source());
          await sweepTransformRows();
          expect(history.length()).toBe(size);
          expect(owners.within(cap)).toBe(!retain);
          expect(
            probes.rows.filter((row) => row.deref() !== undefined).length,
          ).toBe(retain ? size : 0);
          expect(
            probes.markers.filter((row) => row.deref() !== undefined).length,
          ).toBe(retain ? size : 0);
          expect(await rowsOf(history)).toStrictEqual(
            Array.from({ length: size }, (_, index) => batchRow(index)),
          );
        } finally {
          for (const row of retained) owners.release(row);
          retained.length = 0;
        }
        expect(owners.snapshot().liveRows).toBe(0);
      });
    }, 180_000);
  }
});

describe('journal submission value semantics', () => {
  it('captures metadata and blocks before a caller mutates them after submission', async () => {
    await withNativeDetachedFixture(
      async ({ history, writerPaused, pauseWriter, releaseWriter }) => {
        pauseWriter();
        const row = batchRow(0);
        const operation = history.addBatch([row]);
        try {
          await writerPaused;
          row.blocks = [{ type: 'text', text: 'mutated after submission' }];
          if (row.metadata?.chronology === undefined)
            throw new Error('Missing marker');
          row.metadata.chronology = { ...row.metadata.chronology, seq: 999 };
          releaseWriter();
          await operation;
          expect(await rowsOf(history)).toStrictEqual([batchRow(0)]);
        } finally {
          releaseWriter();
          await operation;
        }
      },
    );
  });

  it('preserves observer error identity, compensation and retry', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      const failure = new Error('observer failed');
      history.once('contentBatchAdded', () => {
        throw failure;
      });
      expect(await rejectedValue(history.addBatch([batchRow(0)]))).toBe(
        failure,
      );
      expect(history.length()).toBe(0);
      await history.addBatch([batchRow(1)]);
      await history.waitForCommit();
      expect(await rowsOf(history)).toStrictEqual([batchRow(1)]);
      expect(owners.within(cap)).toBe(true);
    });
  });

  it('preserves a complete row larger than nine MiB without imposing the small-row cap', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      const row = batchRow(0, 9 * 1024 * 1024 + 17);
      await history.addBatch([row]);
      expect(await rowsOf(history)).toStrictEqual([row]);
      await history.waitForCommit();
      expect(await rowsOf(history)).toStrictEqual([row]);
    });
  }, 180_000);
});
