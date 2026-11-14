/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { withCoreSuffixFixture } from './__tests__/support/core-suffix-fixture-test-helpers.js';
import {
  MergeRowHistory,
  mergeRow,
  oracleDigest,
  streamDigest,
} from './__tests__/support/history-merge-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

function mergeFixtureBytes(size: number): { total: number; largest: number } {
  let total = Buffer.byteLength(JSON.stringify(mergeRow(20000)));
  let largest = total;
  for (let index = 0; index < size; index++) {
    const bytes = Buffer.byteLength(JSON.stringify(mergeRow(index)));
    total += bytes;
    largest = Math.max(largest, bytes);
  }
  return { total, largest };
}
// The source row and one submitted row shell can coexist; the census is JSON bytes.
const MERGE_CONCURRENT_ROWS = 2;
class MergeOperationOwnership extends RowOwnership {
  readonly operation = new RowOwnership();
  measuring = false;
  override retain(row: object): void {
    super.retain(row);
    if (this.measuring) this.operation.retain(row);
  }
  override release(row: object): void {
    super.release(row);
    if (this.measuring) this.operation.release(row);
  }
}

describe.each(['journal'])('transactional history merge rows (%s)', () => {
  const createHistory = (
    options: ConstructorParameters<typeof HistoryService>[0],
  ): MergeRowHistory => {
    const history = new MergeRowHistory(options);
    history.setTokenizerFactory(exactTokenizer());
    return history;
  };
  for (const size of [512, 8192]) {
    it(`appends ${size} mixed rows without eager reads and preserves complete source values`, async () => {
      const owners = new MergeOperationOwnership();
      await withCoreSuffixFixture(
        size,
        async (source) => {
          await withCoreSuffixFixture(
            1,
            async (target) => {
              const prefixTokens = 4;
              expect(target.getTotalTokens()).toBe(prefixTokens);
              expect(owners.snapshot().liveRows).toBe(0);
              owners.measuring = true;
              await target.merge(source);
              expect(target.getTotalTokens()).toBe(prefixTokens + size * 4);
              await target.waitForCommit();
              expect(await streamDigest(target.streamRawHistory())).toBe(
                oracleDigest(size, 1, true),
              );
              expect(await streamDigest(source.streamRawHistory())).toBe(
                oracleDigest(size),
              );
              const fixture = mergeFixtureBytes(size);
              const allowance = MERGE_CONCURRENT_ROWS * fixture.largest;
              expect(fixture.total).toBeGreaterThan(4 * allowance);
              // Preserve the old whole-fixture gates, including 256-row seeding batches.
              expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
              expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
                8 * 1024 * 1024,
              );
              expect(owners.snapshot().liveRows).toBe(0);
              expect(
                owners.operation.within({
                  rows: MERGE_CONCURRENT_ROWS,
                  serializedBytes: allowance,
                }),
              ).toBe(true);
              process.stdout.write(
                `MERGE_BYTES ${JSON.stringify({ size, ...fixture, allowance, wholeFixture: owners.snapshot(), ...owners.operation.snapshot() })}\n`,
              );
              const held: IContent[] = [];
              try {
                for await (const row of target.streamRawHistory()) {
                  owners.operation.retain(row);
                  held.push(row);
                }
                expect(
                  owners.operation.snapshot().peakSerializedBytes,
                ).toBeGreaterThan(3 * allowance);
                process.stdout.write(
                  `MERGE_CONTROL ${JSON.stringify({ size, ...fixture, allowance, ...owners.operation.snapshot() })}\n`,
                );
              } finally {
                for (const row of held) owners.operation.release(row);
              }
              expect(owners.operation.snapshot().liveRows).toBe(0);
            },
            0,
            () => mergeRow(20000),
            owners,
            createHistory,
          );
        },
        2048,
        mergeRow,
        owners,
        createHistory,
      );
    }, 600_000);
  }
});

describe('history merge self append and large row', () => {
  it('pins self-merge once and preserves markers when the appended rows are duplicated', async () => {
    await withCoreSuffixFixture(
      3,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        await history.merge(history);
        await history.waitForCommit();
        expect(await streamDigest(history.streamRawHistory())).toBe(
          oracleDigest(3, 2),
        );
      },
      2048,
      mergeRow,
      undefined,
      (options) => new MergeRowHistory(options),
    );
  });

  it('merges every byte of a valid two-MiB row', async () => {
    const bytes = 2 * 1024 * 1024;
    await withCoreSuffixFixture(
      1,
      async (source) => {
        await withCoreSuffixFixture(
          0,
          async (target) => {
            target.setTokenizerFactory(exactTokenizer());
            await target.merge(source);
            let count = 0;
            for await (const row of target.streamRawHistory()) {
              expect(row).toStrictEqual(mergeRow(0, bytes));
              count++;
            }
            expect(count).toBe(1);
          },
          0,
          mergeRow,
          undefined,
          (options) => new MergeRowHistory(options),
        );
      },
      bytes,
      mergeRow,
      undefined,
      (options) => new MergeRowHistory(options),
    );
  }, 120_000);
});
