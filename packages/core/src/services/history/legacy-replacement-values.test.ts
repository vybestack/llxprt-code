/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { setImmediate } from 'node:timers/promises';
import { appendFileSync } from 'node:fs';
import {
  detachedDigest,
  detachedDurableDigest,
  detachedRow,
  detachedRows,
  withDetachedFixture,
} from './detached-rollback-test-helpers.js';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';
import type { IContent, ChronologyMarker } from './IContent.js';
import type { HistoryService } from './HistoryService.js';

function record(value: object): void {
  const output = process.env.LEGACY_VALUE_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(value) + '\n');
}

async function sweep(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await setImmediate();
    gcAndSweep();
  }
  await setImmediate();
}

function submitted(
  size: number,
  offset = 0,
): {
  rows: IContent[];
  readonly weakRows: ReadonlyArray<WeakRef<IContent>>;
  readonly weakMarkers: ReadonlyArray<WeakRef<ChronologyMarker>>;
} {
  const rows = Array.from({ length: size }, (_, index) =>
    detachedRow(index + offset),
  );
  return {
    rows,
    weakRows: rows.map((row) => new WeakRef(row)),
    weakMarkers: rows.map((row) => {
      const marker = row.metadata?.chronology;
      if (marker === undefined) throw new Error('Missing submitted marker');
      return new WeakRef(marker);
    }),
  };
}

function expectReleased(input: ReturnType<typeof submitted>): void {
  expect({
    callerRows: input.weakRows.filter((row) => row.deref() !== undefined)
      .length,
    callerMarkers: input.weakMarkers.filter(
      (marker) => marker.deref() !== undefined,
    ).length,
  }).toStrictEqual({ callerRows: 0, callerMarkers: 0 });
}

function replace(
  history: HistoryService,
  mode: string,
  rows: readonly IContent[],
  afterPublication: () => Promise<void>,
): Promise<void> {
  return mode === 'batch'
    ? history.replaceBatch(rows, undefined, { afterPublication })
    : history.replaceAll(rows, undefined, { afterPublication });
}

for (const mode of ['batch', 'all']) {
  describe('replacement entry points use disk values', () => {
    for (const size of [512, 8192]) {
      it(`${mode} releases ${size} caller rows and markers before a suspended failure and recovers durable values`, async () => {
        await withDetachedFixture(async ({ history, recorder, owners }) => {
          await history.detachedValues.replace(detachedRows(3));
          const baseline = await detachedDigest(detachedRows(3));
          const input = submitted(size);
          const failure = new Error('suspended value failure');
          const operation = replace(history, mode, input.rows, async () => {
            await sweep();
            const held = owners.snapshot();
            const liveRows = input.weakRows.filter(
              (row) => row.deref() !== undefined,
            ).length;
            const liveMarkers = input.weakMarkers.filter(
              (marker) => marker.deref() !== undefined,
            ).length;
            record({ mode, size, held, liveRows, liveMarkers });
            expect(held.liveRows).toBeLessThanOrEqual(440);
            expect(held.liveSerializedBytes).toBeLessThanOrEqual(
              8 * 1024 * 1024,
            );
            expect(liveRows).toBe(0);
            expect(liveMarkers).toBe(0);
            const candidate = await detachedDigest(history.streamRawHistory());
            expect(candidate).toStrictEqual(
              await detachedDigest(detachedRows(size)),
            );
            expect(candidate.bytes / size).toBeGreaterThan(20_000_000 / 8192);
            throw failure;
          });
          input.rows = [];
          expect(await rejectedValue(operation)).toBe(failure);
          await sweep();
          expectReleased(input);
          expect(
            await detachedDigest(history.streamRawHistory()),
          ).toStrictEqual(baseline);
          expect(await detachedDurableDigest(recorder)).toStrictEqual(baseline);
          expect(history.getTotalTokens()).toBe(12);
          expect(owners.snapshot().liveRows).toBe(0);
          await history.replaceAll([detachedRow(4)]);
          expect((await rowsOf(history))[0]).toStrictEqual(detachedRow(4));
        });
      }, 180_000);
    }
  });
}

describe('replacement value admission', () => {
  it('stamps repeated caller aliases by logical ordinal without mutating frozen inputs', async () => {
    await withDetachedFixture(async ({ history, recorder }) => {
      const row = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'alias' }],
        metadata: Object.freeze({ id: 'caller' }),
      } satisfies IContent;
      await history.replaceBatch([row, row]);
      const stored = await rowsOf(history);
      expect(row.metadata).toStrictEqual({ id: 'caller' });
      expect(
        stored.map((value) => value.metadata?.chronology?.seq),
      ).toStrictEqual([1, 2]);
      expect(stored.map((value) => value.blocks)).toStrictEqual([
        row.blocks,
        row.blocks,
      ]);
      expect((await detachedDurableDigest(recorder)).count).toBe(2);
    });
  });

  it('accepts a complete value larger than nine MiB through replaceAll without caller stamping', async () => {
    await withDetachedFixture(async ({ history, recorder }) => {
      const row = detachedRow(0, 9 * 1024 * 1024 + 1);
      await history.replaceAll([row]);
      expect((await rowsOf(history))[0]).toStrictEqual(row);
      expect((await detachedDurableDigest(recorder)).bytes).toBeGreaterThan(
        9 * 1024 * 1024,
      );
    });
  }, 180_000);
});

describe('density replacement values', () => {
  it('releases replacement roots before failure while preserving inherited chronology and media values', async () => {
    await withDetachedFixture(async ({ history, recorder, owners }) => {
      await history.detachedValues.replace(detachedRows(512));
      const baseline = await detachedDigest(detachedRows(512));
      const input = submitted(512, 512);
      const failure = new Error('density value publication');
      history.once('tokensUpdated', () => {
        throw failure;
      });
      let census = -1;
      history.registerMediaOwner({
        adopt: () => undefined,
        reconcile: async () => undefined,
        releaseAll: async () => undefined,
        prepareReplacement: ({ next }) => ({
          publish: async () => {
            await sweep();
            census = input.weakRows.filter(
              (row) => row.deref() !== undefined,
            ).length;
            record({
              mode: 'density',
              held: owners.snapshot(),
              liveRows: census,
            });
            expect(census).toBe(0);
            expect(
              input.weakMarkers.filter((marker) => marker.deref() !== undefined)
                .length,
            ).toBe(0);
            expect(owners.snapshot().liveRows).toBeLessThanOrEqual(440);
            expect(owners.snapshot().liveSerializedBytes).toBeLessThanOrEqual(
              8 * 1024 * 1024,
            );
            let ordinal = 0;
            for (const row of next) {
              expect(row.metadata?.chronology).toStrictEqual(
                detachedRow(ordinal).metadata?.chronology,
              );
              expect(row.blocks).toStrictEqual(
                detachedRow(ordinal + 512).blocks,
              );
              ordinal++;
            }
            expect(ordinal).toBe(512);
          },
          rollback: () => undefined,
        }),
      });
      const operation = history.applyDensityResult({
        removals: [],
        replacements: new Map(input.rows.map((row, index) => [index, row])),
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 0,
        },
      });
      input.rows = [];
      expect(await rejectedValue(operation)).toBe(failure);
      await sweep();
      expectReleased(input);
      expect(await detachedDigest(history.streamRawHistory())).toStrictEqual(
        baseline,
      );
      expect(await detachedDurableDigest(recorder)).toStrictEqual(baseline);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  }, 180_000);
});
