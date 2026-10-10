/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { isSpeakerContent } from '@vybestack/llxprt-code-core/services/history/historyJournalGuards.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import {
  oneshotSetup,
  oneshotOracle,
  oneshotRow,
  OneshotDiskHistory,
} from './oneshot-disk-helpers.js';

function expectedCharge(request: string): { rows: number } {
  const expected: unknown = JSON.parse(request);
  if (!Array.isArray(expected) || !expected.every(isSpeakerContent))
    throw new Error('Invalid independent summary oracle');
  return { rows: expected.length };
}

async function charge(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const oracle = await oneshotOracle(history, size);
      const expected = expectedCharge(oracle.requests[0]);
      const { runtime, transport } = oneshotSetup(history);
      const strategy = new OneShotStrategy();
      const snapshot = await history.openDumpSnapshot();
      const source = new HistoryDensityRows();
      const candidate = new HistoryDensityRows();
      try {
        for await (const row of snapshot.rows())
          if (isCuratedContent(row)) source.append(row);
        const metadata = await buildCompressionMetadata(
          'charge',
          runtime,
          history,
          async () => ({
            provider: transport,
            runtime: runtime.providerRuntime,
          }),
          async () => 'finish the experiment',
          () => '/fixture/session.jsonl',
          new DebugLogger('test:oneshot-charge'),
        );
        transport.failure = new DOMException(
          'charge cancellation',
          'AbortError',
        );
        await expect(
          strategy.compressDisk({ ...metadata, history: source }, candidate),
        ).rejects.toThrow('charge cancellation');
        expect(candidate.length).toBe(0);
        expect(strategy.summaryRequestOwnership.snapshot().liveRows).toBe(0);
        expect(
          strategy.summaryRequestOwnership.snapshot().liveSerializedBytes,
        ).toBe(0);
        transport.failure = undefined;
        expect(
          (
            await strategy.compressDisk(
              { ...metadata, history: source },
              candidate,
            )
          ).kind,
        ).toBe('applied');
        expect(transport.requests).toStrictEqual([
          oracle.requests[0],
          oracle.requests[0],
        ]);
        expect(strategy.summaryRequestOwnership.snapshot().liveRows).toBe(0);
        expect(
          strategy.summaryRequestOwnership.snapshot().liveSerializedBytes,
        ).toBe(0);
        const owners = strategy.summaryRequestOwnership.snapshot();
        // Both attempts stream the journal rows: each row is owned only until
        // the next pull, never all at once, and every history row is charged.
        expect(owners.peakRows).toBeLessThanOrEqual(1);
        expect(owners.acquisitions).toBeGreaterThanOrEqual(
          2 * (expected.rows - 6),
        );
        expect(owners.acquisitions).toBeLessThanOrEqual(2 * expected.rows);
        return owners.peakSerializedBytes;
      } finally {
        candidate.close();
        source.close();
        await snapshot.close();
      }
    },
    2048,
    oneshotRow,
    undefined,
    (options) => new OneshotDiskHistory(options),
  );
}
describe('complete one-shot disk summary request charge', () => {
  it.each([512, 8192])(
    'streams the independent %i-row oracle request one owned row at a time and releases cancellation and success',
    async (size) => {
      // One 2 KiB fixture row at a time, not the whole range.
      expect(await charge(size)).toBeLessThan(16 * 1024);
    },
    180_000,
  );
});
