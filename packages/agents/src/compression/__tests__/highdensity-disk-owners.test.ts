/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionInputSnapshot } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
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
  override async openCompressionInput(): Promise<CompressionInputSnapshot> {
    const input = await super.openCompressionInput();
    for await (const row of input.previous.rows()) this.hold(row);
    return input;
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
