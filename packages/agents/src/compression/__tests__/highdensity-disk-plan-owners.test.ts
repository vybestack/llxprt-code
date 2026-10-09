/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  highdensitySetup,
  highdensityRow,
  HighdensityDiskHistory,
} from './highdensity-disk-helpers.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { deferred } from './highdensity-disk-fault-helpers.js';

function ownerMetadata(
  history: Parameters<typeof highdensitySetup>[0],
): ReturnType<typeof buildCompressionMetadata> {
  const { runtime, transport } = highdensitySetup(history);
  return buildCompressionMetadata(
    'owners',
    runtime,
    history,
    async () => ({ provider: transport, runtime: runtime.providerRuntime }),
    undefined,
    undefined,
    new DebugLogger('test:highdensity-owner'),
  );
}

async function owners(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history, sourceOwner) => {
      const strategy = new HighDensityStrategy();
      const rows = new HistoryDensityRows();
      const candidate = new HistoryDensityRows(
        strategy.diskCompressionOwnership,
      );
      const snapshot = await history.openDumpSnapshot();
      const started = deferred();
      const release = deferred();
      const failure = new DOMException(
        'paused disk estimate cancelled',
        'AbortError',
      );
      try {
        for await (const row of snapshot.rows())
          if (isCuratedContent(row)) rows.append(row);
        const metadata = await ownerMetadata(history);
        const attempt = strategy
          .compressDisk(
            {
              ...metadata,
              history: rows,
              estimateTokens: async (contents) => {
                for await (const _row of contents) {
                  started.resolve();
                  await release.promise;
                  throw failure;
                }
                return metadata.estimateTokens(contents);
              },
            },
            candidate,
          )
          .then(
            () => undefined,
            (error: unknown) => error,
          );
        await started.promise;
        const live = strategy.diskCompressionOwnership.snapshot();
        expect(live.liveRows).toBeGreaterThan(0);
        expect(
          strategy.diskCompressionOwnership.within({
            rows: 440,
            serializedBytes: 8 * 1024 * 1024,
          }),
        ).toBe(true);
        expect(
          sourceOwner.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        release.resolve();
        expect(await attempt).toBe(failure);
        expect(
          strategy.diskCompressionOwnership.snapshot().liveRows +
            sourceOwner.snapshot().liveRows,
        ).toBe(0);
        expect(candidate.length).toBe(rows.length);
        return live.peakRows;
      } finally {
        release.resolve();
        candidate.close();
        rows.close();
        await snapshot.close();
      }
    },
    2048,
    highdensityRow,
    undefined,
    (options) => new HighdensityDiskHistory(options),
  );
}

describe('high-density disk registered decision and candidate owners', () => {
  it.each([512, 8192])(
    'keeps actual paused %i-row estimation owners within the unchanged fixture limits and releases on abort',
    async (size) => {
      expect(await owners(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
