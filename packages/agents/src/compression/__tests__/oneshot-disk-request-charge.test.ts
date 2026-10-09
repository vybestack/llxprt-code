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

function expectedCharge(request: string): { rows: number; bytes: number } {
  const expected: unknown = JSON.parse(request);
  if (!Array.isArray(expected) || !expected.every(isSpeakerContent))
    throw new Error('Invalid independent summary oracle');
  return {
    rows: expected.length,
    bytes: expected.reduce(
      (bytes, row) => bytes + Buffer.byteLength(JSON.stringify(row)),
      0,
    ),
  };
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
      let observedBytes = 0;
      transport.beforeSend = async () => {
        const owners = strategy.summaryRequestOwnership.snapshot();
        expect(owners.liveRows).toBe(expected.rows);
        expect(owners.liveSerializedBytes).toBe(expected.bytes);
        observedBytes = owners.liveSerializedBytes;
      };
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
        return observedBytes;
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
    'charges every model-facing byte from the independent %i-row oracle and releases cancellation and success',
    async (size) => {
      expect(await charge(size)).toBeGreaterThan(size * 300);
    },
    180_000,
  );
});
