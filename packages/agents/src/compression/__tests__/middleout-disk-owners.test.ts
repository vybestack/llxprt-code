/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { MiddleOutStrategy } from '../MiddleOutStrategy.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import {
  middleoutSetup,
  middleoutRow,
  MiddleoutDiskHistory,
} from './middleout-disk-helpers.js';

class RetainingHistory extends MiddleoutDiskHistory {
  readonly retained: IContent[] = [];
  readonly copied: IContent[] = [];
  readonly borrowedOwners = new RowOwnership();
  readonly copyOwners = new RowOwnership();
  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    const snapshot = await super.openDumpSnapshot();
    let first = true;
    const { retained, copied, borrowedOwners, copyOwners } = this;
    return {
      ...snapshot,
      async *rows() {
        const retain = first;
        first = false;
        for await (const row of snapshot.rows()) {
          if (retain) {
            const copy = { ...row, blocks: [...row.blocks] };
            retained.push(row);
            copied.push(copy);
            borrowedOwners.retain(row);
            copyOwners.retain(copy);
          }
          yield row;
        }
      },
    };
  }
  release(): void {
    for (const row of this.retained) this.borrowedOwners.release(row);
    for (const row of this.copied) this.copyOwners.release(row);
    this.retained.length = 0;
    this.copied.length = 0;
  }
}

async function charge(size: number): Promise<number> {
  const candidateOwners = new RowOwnership();
  const diskBound = { rows: 440, serializedBytes: 8 * 1024 * 1024 };
  return withSuffixFixture(
    size,
    async (history, sourceOwners) => {
      const { runtime, transport } = middleoutSetup(history);
      const strategy = new MiddleOutStrategy();
      const source = new HistoryDensityRows();
      const candidate = new HistoryDensityRows(candidateOwners);
      const snapshot = await history.openDumpSnapshot();
      let liveRows = 0;
      let liveBytes = 0;
      transport.beforeSend = async () => {
        const stats = strategy.summaryRequestOwnership.snapshot();
        liveRows = stats.liveRows;
        liveBytes = stats.liveSerializedBytes;
      };
      try {
        for await (const row of snapshot.rows())
          if (isCuratedContent(row)) source.append(row);
        const metadata = await buildCompressionMetadata(
          'owners',
          runtime,
          history,
          async () => ({
            provider: transport,
            runtime: runtime.providerRuntime,
          }),
          undefined,
          undefined,
          new DebugLogger('test:owners'),
        );
        transport.failure = new DOMException(
          'summary owner cancellation',
          'AbortError',
        );
        await expect(
          strategy.compressDisk({ ...metadata, history: source }, candidate),
        ).rejects.toThrow('summary owner cancellation');
        expect(strategy.summaryRequestOwnership.snapshot().liveRows).toBe(0);
        expect(candidate.length).toBe(0);
        transport.failure = undefined;
        expect(
          (
            await strategy.compressDisk(
              { ...metadata, history: source },
              candidate,
            )
          ).kind,
        ).toBe('applied');
        for (const _row of candidate) {
          /* exercise the disk row reader owners */
        }
        expect(liveRows).toBeGreaterThan(size * 0.4);
        expect(liveBytes).toBeGreaterThan(size * 300);
        expect(strategy.summaryRequestOwnership.snapshot().liveRows).toBe(0);
        expect(candidateOwners.within(diskBound)).toBe(true);
        expect(sourceOwners.within(diskBound)).toBe(true);
        expect(
          candidateOwners.snapshot().liveRows +
            sourceOwners.snapshot().liveRows,
        ).toBe(0);
        return liveRows;
      } finally {
        candidate.close();
        source.close();
        await snapshot.close();
      }
    },
    2048,
    middleoutRow,
    undefined,
    (options) => new MiddleoutDiskHistory(options),
  );
}

async function trap(size: number, mode: string): Promise<number> {
  let created: RetainingHistory | undefined;
  return withSuffixFixture(
    size,
    async (history) => {
      const { handler } = middleoutSetup(history);
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
      expect(within).toBe(process.env.MIDDLEOUT_RETAINING_TRAP === '1');
      return stats.liveRows;
    },
    4096,
    middleoutRow,
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
describe('disk middle-out registered owners', () => {
  it.each([512, 8192])(
    'charges the whole %i-row summary request before send while disk rows remain bounded',
    async (size) => {
      expect(await charge(size)).toBeGreaterThan(size * 0.4);
    },
    180_000,
  );
  it.each(trapCases)(
    'detects deliberately retained %i-row %s owners with unchanged bounds',
    async (size, mode) => {
      expect(await trap(size, mode)).toBe(size);
    },
    180_000,
  );
});
