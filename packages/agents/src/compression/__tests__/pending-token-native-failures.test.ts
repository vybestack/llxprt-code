/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import { pendingTokenDeps } from './pending-token-native-helpers.js';
import { truncateLargestToolResponses } from '../toolResultTruncator.js';

const score = async (): Promise<number> => 1000;

describe('pending-token native ranking failures and retirement', () => {
  it('preserves a token measurement error and permits the next ranking on the same writer', async () => {
    await withNativeFallbackFixture(async ({ history, seed, durable }) => {
      await seed([toolRankingRow(0, 64)]);
      const before = await durable();
      const failure = new Error('pending-token measurement failed');
      await expect(
        truncateLargestToolResponses(
          {
            ...pendingTokenDeps(history),
            estimateBlockTokensAsync: async () => {
              throw failure;
            },
          },
          0,
        ),
      ).rejects.toBe(failure);
      expect(await durable()).toStrictEqual(before);
      expect(
        await truncateLargestToolResponses(
          { ...pendingTokenDeps(history), estimateBlockTokensAsync: score },
          1000,
        ),
      ).toMatchObject({ replacedCount: 1, success: true });
    });
  });
  it('retains the original row-65 replacement admission error and prior durable rows, then continues on the same writer', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      const { history, seed, durable } = fixture;
      await seed(
        Array.from(
          { length: 65 },
          (_, index): IContent => ({
            speaker: index === 0 ? 'tool' : 'human',
            blocks:
              index === 0
                ? [
                    {
                      type: 'tool_response',
                      callId: 'first',
                      toolName: 'read_file',
                      result: 'payload',
                    },
                  ]
                : [{ type: 'text', text: `row ${index}` }],
          }),
        ),
      );
      const before = await durable();
      const failure = fixture.failAdmissionAfter(64);
      await expect(
        truncateLargestToolResponses(
          { ...pendingTokenDeps(history), estimateBlockTokensAsync: score },
          0,
        ),
      ).rejects.toBe(failure);
      expect(await durable()).toStrictEqual(before);
      history.setTokenizerFactory(exactTokenizer());
      expect(
        await truncateLargestToolResponses(
          { ...pendingTokenDeps(history), estimateBlockTokensAsync: score },
          1000,
        ),
      ).toMatchObject({ replacedCount: 1, success: true });
    });
  }, 180_000);
  it('keeps a ranking query failure ahead of snapshot retirement failures', async () => {
    await withNativeFallbackFixture(async ({ history, seed }) => {
      await seed([toolRankingRow(0, 64)]);
      const failure = new Error('pending-token rank query failed');
      const cleanup = new Error('pending-token pin retirement failed');
      const openRanking = history.openToolResponseRanking.bind(history);
      const restores: Array<() => void> = [];
      const open = spyOn(history, 'openToolResponseRanking').mockImplementation(
        async (...args) => {
          const snapshot = await openRanking(...args);
          if (snapshot === undefined)
            throw new Error('Missing native ranking snapshot');
          const originalClose = snapshot.close.bind(snapshot);
          const query = spyOn(snapshot, 'toolRanking').mockRejectedValue(
            failure,
          );
          const close = spyOn(snapshot, 'close').mockImplementation(
            async () => {
              await originalClose();
              throw cleanup;
            },
          );
          restores.push(
            () => query.mockRestore(),
            () => close.mockRestore(),
          );
          return snapshot;
        },
      );
      try {
        const error: unknown = await truncateLargestToolResponses(
          { ...pendingTokenDeps(history), estimateBlockTokensAsync: score },
          0,
        ).catch((error: unknown) => error);
        expect(error).toBeInstanceOf(AggregateError);
        if (!(error instanceof AggregateError))
          throw new Error('Missing ordered cleanup errors');
        expect(error.errors).toStrictEqual([failure, cleanup]);
        expect(error.cause).toBe(failure);
      } finally {
        open.mockRestore();
        for (const restore of restores) restore();
      }
    });
  });
  it('preserves abort identity before ranking and leaves old durable bytes intact', async () => {
    await withNativeFallbackFixture(async ({ history, seed, durable }) => {
      await seed([toolRankingRow(0, 64)]);
      const before = await durable();
      const controller = new AbortController();
      const failure = new Error('pending-token ranking aborted');
      controller.abort(failure);
      await expect(
        truncateLargestToolResponses(
          {
            ...pendingTokenDeps(history),
            estimateBlockTokensAsync: score,
            signal: controller.signal,
          },
          0,
        ),
      ).rejects.toBe(failure);
      expect(await durable()).toStrictEqual(before);
    });
  });
});
