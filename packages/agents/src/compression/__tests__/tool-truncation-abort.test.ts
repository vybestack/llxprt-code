/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { truncateLargestToolResponses } from '../toolResultTruncator.js';
import {
  toolRankingRow,
  toolDeps,
  digestRows,
  expectedToolDigest,
} from './tool-truncation-stream-helpers.js';

function rankingFiles(history: HistoryService): string[] {
  return readdirSync(history.scratchRoots.getRoot())
    .filter((name) => name.startsWith('tool-response-ranking-'))
    .sort();
}

describe('caller cancellation of tool ranking', () => {
  it.each([65])(
    'observes timer abort for %i rows before any replacement and closes source/index',
    async (size) => {
      await withSuffixFixture(
        size,
        async (history, ownership) => {
          const before = rankingFiles(history);
          const controller = new AbortController();
          let scheduled = false;
          const deps = {
            ...toolDeps(history, async () => 0),
            signal: controller.signal,
            estimateBlockTokensAsync: async () => {
              if (!scheduled) {
                scheduled = true;
                setTimeout(
                  () => controller.abort(new Error('timer stopped ranking')),
                  0,
                );
              }
              return 100;
            },
          };
          await expect(truncateLargestToolResponses(deps, 100)).rejects.toThrow(
            'timer stopped ranking',
          );
          expect(await digestRows(history.streamRawHistory())).toBe(
            expectedToolDigest(size, 0),
          );
          expect(ownership.snapshot().liveRows).toBe(0);
          const after = rankingFiles(history);
          expect({
            added: after.filter((name) => !before.includes(name)).length,
            removed: before.filter((name) => !after.includes(name)).length,
          }).toStrictEqual({ added: 0, removed: 0 });
        },
        2048,
        toolRankingRow,
        undefined,
        (options) => new HistoryService(options),
      );
    },
    120000,
  );
  it('rejects a pre-aborted call before estimating or opening ranking scratch', async () => {
    await withSuffixFixture(
      1,
      async (history) => {
        const before = rankingFiles(history);
        const controller = new AbortController();
        controller.abort(new Error('already aborted'));
        const deps = {
          ...toolDeps(history, async () => 0),
          signal: controller.signal,
        };
        await expect(truncateLargestToolResponses(deps, 100)).rejects.toThrow(
          'already aborted',
        );
        expect(await digestRows(history.streamRawHistory())).toBe(
          expectedToolDigest(1, 0),
        );
        const after = rankingFiles(history);
        expect({
          added: after.filter((name) => !before.includes(name)).length,
          removed: before.filter((name) => !after.includes(name)).length,
        }).toStrictEqual({ added: 0, removed: 0 });
      },
      2048,
      toolRankingRow,
    );
  });
});
