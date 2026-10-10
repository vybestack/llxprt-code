/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import {
  oneshotSetup,
  oneshotRow,
  OneshotDiskHistory,
} from './oneshot-disk-helpers.js';

async function verification(size: number, fail: boolean): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const { runtime, transport } = oneshotSetup(history);
      const strategy = new OneShotStrategy();
      const snapshot = await history.openDumpSnapshot();
      const source = new HistoryDensityRows();
      const candidate = new HistoryDensityRows();
      transport.beforeSend = async () => {
        if (transport.requests.length === 2 && fail)
          throw new Error('verification transport failed');
      };
      try {
        for await (const row of snapshot.rows())
          if (isCuratedContent(row)) source.append(row);
        const metadata = await buildCompressionMetadata(
          'verify',
          runtime,
          history,
          async () => ({
            provider: transport,
            runtime: runtime.providerRuntime,
          }),
          undefined,
          undefined,
          new DebugLogger('test:oneshot-verification'),
        );
        const result = await strategy.compressDisk(
          { ...metadata, history: source, compressionVerification: true },
          candidate,
        );
        expect(result.kind).toBe('applied');
        expect(candidate.readRow(0).blocks).toStrictEqual([
          {
            type: 'text',
            text: '<state_snapshot>kept details</state_snapshot>',
          },
        ]);
        expect(strategy.summaryRequestOwnership.snapshot().liveRows).toBe(0);
        expect(transport.requests).toHaveLength(2);
        return strategy.summaryRequestOwnership.snapshot().peakRows;
      } finally {
        candidate.close();
        source.close();
        await snapshot.close();
      }
    },
    64,
    oneshotRow,
    undefined,
    (options) => new OneshotDiskHistory(options),
  );
}

describe('one-shot disk verification lifetime', () => {
  it.each([512, 8192])(
    'verifies a summary of the %i-row request without owning more than one row at a time',
    async (size) => {
      expect(await verification(size, false)).toBe(1);
    },
    180_000,
  );
  it.each([512, 8192])(
    'keeps best-effort verification semantics and releases %i-row owners on failure',
    async (size) => {
      expect(await verification(size, true)).toBe(1);
    },
    180_000,
  );
});
