/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  highdensitySetup,
  highdensityRow,
  HighdensityDiskHistory,
} from './highdensity-disk-helpers.js';

class RetainingHistory extends HighdensityDiskHistory {
  readonly retained: IContent[] = [];
  readonly copied: IContent[] = [];
  readonly borrowedOwners = new RowOwnership();
  readonly copyOwners = new RowOwnership();
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    // The compressor reads rows through the pinned checkpoint, so the trap
    // holds references to the rows of the first pass over that checkpoint.
    const real = this.detachedValues;
    let first = true;
    const hold = (row: IContent): void => this.hold(row);
    Object.defineProperty(this, 'detachedValues', {
      value: {
        ...real,
        withCheckpoint: <T>(
          execute: (checkpoint: HistoryIndexedRows) => Promise<T>,
          signal?: AbortSignal,
        ): Promise<T> =>
          real.withCheckpoint((checkpoint) => {
            let retain = first;
            first = false;
            return execute({
              length: checkpoint.length,
              readRow: (index) => checkpoint.readRow(index),
              *[Symbol.iterator]() {
                const pass = retain;
                retain = false;
                for (const row of checkpoint) {
                  if (pass) hold(row);
                  yield row;
                }
              },
            });
          }, signal),
      },
    });
  }
  private hold(row: IContent): void {
    const copy = { ...row, blocks: [...row.blocks] };
    this.retained.push(row);
    this.copied.push(copy);
    this.borrowedOwners.retain(row);
    this.copyOwners.retain(copy);
  }
  release(): void {
    for (const row of this.retained) this.borrowedOwners.release(row);
    for (const row of this.copied) this.copyOwners.release(row);
    this.retained.length = 0;
    this.copied.length = 0;
  }
}

async function trap(size: number, mode: string): Promise<number> {
  let created: RetainingHistory | undefined;
  return withSuffixFixture(
    size,
    async (history) => {
      const { handler } = highdensitySetup(history);
      await handler.performCompression('trap');
      if (created === undefined)
        throw new Error('Missing retaining participant');
      const owner =
        mode === 'borrowed' ? created.borrowedOwners : created.copyOwners;
      const stats = owner.snapshot();
      const within = owner.within({
        rows: 440,
        serializedBytes: 8 * 1024 * 1024,
      });
      created.release();
      expect(
        created.borrowedOwners.snapshot().liveRows +
          created.copyOwners.snapshot().liveRows,
      ).toBe(0);
      expect(stats.liveRows).toBe(size);
      expect(stats.liveSerializedBytes).toBeGreaterThan(
        size === 8192 ? 8 * 1024 * 1024 : 0,
      );
      expect(within).toBe(false);
      return stats.liveRows;
    },
    4096,
    highdensityRow,
    undefined,
    (options) => {
      created = new RetainingHistory(options);
      return created;
    },
  );
}

const trapCases: Array<[number, string]> = [
  [512, 'borrowed'],
  [512, 'copy'],
  [8192, 'borrowed'],
  [8192, 'copy'],
];
describe('disk high-density registered owners', () => {
  it.each(trapCases)(
    'detects deliberately retained %i-row %s owners with unchanged bounds',
    async (size, mode) => {
      expect(await trap(size, mode)).toBe(size);
    },
    180_000,
  );
});
