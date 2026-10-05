/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  densityHandler,
  densityOracle,
  densityRow,
  digestRows,
  digestStream,
  DensityDiskHistory,
} from './density-disk-helpers.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';

async function pinnedAppend(
  size: number,
): Promise<ReturnType<RowOwnership['snapshot']>> {
  const owners = new RowOwnership();
  return withSuffixFixture(
    size,
    async (history, reader) => {
      const handler = densityHandler(history);
      let release: (() => void) | undefined;
      let reached: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let suspended = false;
      const factory = exactTokenizer();
      history.setTokenizerFactory({
        ...factory,
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: async () => {
            if (!suspended) {
              suspended = true;
              reached?.();
              await gate;
            }
            return 1;
          },
        }),
      });
      const work = handler.ensureDensityOptimized();
      await ready;
      const pending = {
        speaker: 'human' as const,
        blocks: [
          {
            type: 'text' as const,
            text: 'append during pinned candidate estimate',
          },
        ],
      };
      history.add(pending);
      const paused = owners.snapshot();
      expect(paused.peakRows).toBeLessThanOrEqual(440);
      expect(paused.peakSerializedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(reader.snapshot().peakRows).toBeLessThanOrEqual(440);
      release?.();
      await work;
      await history.waitForTokenUpdates();
      const expected = [...densityOracle(size), pending];
      expect(await digestStream(history.streamRawHistory())).toBe(
        digestRows(expected),
      );
      return owners.snapshot();
    },
    2048,
    densityRow,
    owners,
  );
}

describe('pinned density membership and hard context window', () => {
  for (const size of [512, 8192])
    it(`keeps ${size}-row decisions pinned while appends wait and publishes their original order`, async () => {
      const owners = await pinnedAppend(size);
      expect(owners.liveRows).toBe(0);
      expect(owners.liveSerializedBytes).toBe(0);
    }, 600_000);
  it('uses density before a hard-limit projection and avoids unnecessary array compression', async () => {
    await withSuffixFixture(
      512,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        await history.transformRows(async (_source, sink) => {
          for (let index = 0; index < 512; index++)
            sink.appendDetached(densityRow(index));
        });
        const before = history.getTotalTokens();
        const runtime = buildRuntimeContext(history, {
          compressionStrategy: 'high-density',
          contextLimit: 1600,
          'compression.density.optimizeThreshold': 0,
          'compression.density.readWritePruning': true,
          'compression.density.fileDedupe': true,
          'compression.density.recencyPruning': true,
          'compression.density.recencyRetention': 3,
        });
        const handler = new CompressionHandler(
          runtime,
          history,
          { maxOutputTokens: 1 },
          () => {
            throw new Error('No LLM during density');
          },
          async () => {},
        );
        await handler.enforceContextWindow(1, 'hard-limit');
        expect(before + 2).toBeGreaterThan(603);
        expect(history.getTotalTokens() + 2).toBeLessThanOrEqual(603);
        expect(handler.densityDirty).toBe(false);
        expect(await digestStream(history.streamRawHistory())).toBe(
          digestRows(densityOracle(512)),
        );
      },
      2048,
      densityRow,
      undefined,
      (options) => new DensityDiskHistory(options),
    );
  }, 180_000);
});
