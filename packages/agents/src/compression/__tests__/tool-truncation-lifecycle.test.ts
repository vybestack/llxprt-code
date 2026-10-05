/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  truncateLargestToolResponses,
  truncateOversizedToolResponsesUnified,
} from '../toolResultTruncator.js';
import { replaceRankedToolResponse } from '../toolResponseDiskRanking.js';
import {
  BoundedToolHistory,
  toolRankingRow,
  toolDeps,
  digestRows,
  expectedToolDigest,
} from './tool-truncation-stream-helpers.js';

function scratch(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('tool-response-ranking-'))
    .sort();
}

describe('tool ranking lifetime', () => {
  it('rejects stale pinned rank length inside the publication transaction', async () => {
    await withSuffixFixture(
      1,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        const block = {
          type: 'tool_response' as const,
          callId: 'duplicate-0',
          toolName: 'read_file',
          result: 'stub',
        };
        const replaced = await replaceRankedToolResponse(
          history,
          {
            location: 'history',
            entryIndex: 0,
            blockIndex: 2,
            block,
            estimatedTokens: 100,
            historyLength: 0,
          },
          block,
          'test',
        );
        expect(replaced).toBe(false);
        expect(await digestRows(history.streamRawHistory())).toBe(
          expectedToolDigest(1, 0),
        );
      },
      2048,
      toolRankingRow,
    );
  });
  it('skips a stale addressed target without publishing or changing token accounting', async () => {
    await withSuffixFixture(
      1,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        let publications = 0;
        history.on('tokensUpdated', () => publications++);
        const block = {
          type: 'tool_response' as const,
          callId: 'missing',
          toolName: 'read_file',
          result: 'stub',
        };
        const before = history.getTotalTokens();
        const replaced = await replaceRankedToolResponse(
          history,
          {
            historyLength: 1,
            location: 'history',
            entryIndex: 0,
            blockIndex: 2,
            block,
            estimatedTokens: 100,
          },
          block,
          'test',
        );
        expect({
          replaced,
          publications,
          tokens: history.getTotalTokens() - before,
        }).toStrictEqual({ replaced: false, publications: 0, tokens: 0 });
        expect(await digestRows(history.streamRawHistory())).toBe(
          expectedToolDigest(1, 0),
        );
      },
      2048,
      toolRankingRow,
    );
  });
});

describe('captured pending block identity', () => {
  it('keeps pending block identity captured before an estimator yields', async () => {
    await withSuffixFixture(0, async (history) => {
      const pending = toolRankingRow(10);
      const deps = {
        ...toolDeps(history, async () => 0),
        pendingContents: [pending],
        estimateBlockTokensAsync: async () => {
          pending.blocks[2] = {
            type: 'tool_response',
            callId: 'changed',
            toolName: 'other',
            result: 'changed',
          };
          return 100;
        },
      };
      const result = await truncateOversizedToolResponsesUnified(deps, 100);
      expect(result).toMatchObject({ success: true, replacedCount: 1 });
      expect(result.transformedPending?.[0].blocks[2]).toMatchObject({
        callId: 'duplicate-1',
        providerMetadata: { contextTruncated: true },
      });
      expect(pending.blocks[2]).toMatchObject({ callId: 'changed' });
    });
  });
});

describe('tool ranking abort and oversized rows', () => {
  it.each([512, 8192])(
    'unwinds a pinned %i-row source on estimator abort without publication or scratch leaks',
    async (size) => {
      const before = scratch();
      await withSuffixFixture(
        size,
        async (history, ownership) => {
          const controller = new AbortController();
          const deps = {
            ...toolDeps(history, async () => 0),
            estimateBlockTokensAsync: async () => {
              controller.abort(new Error('tool ranking aborted'));
              controller.signal.throwIfAborted();
              return 100;
            },
          };
          await expect(truncateLargestToolResponses(deps, 100)).rejects.toThrow(
            'tool ranking aborted',
          );
          expect(await digestRows(history.streamRawHistory())).toBe(
            expectedToolDigest(size, 0),
          );
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        2048,
        toolRankingRow,
        undefined,
        (options) => new BoundedToolHistory(options),
      );
      const after = scratch();
      expect({
        added: after.filter((name) => !before.includes(name)).length,
        removed: before.filter((name) => !after.includes(name)).length,
      }).toStrictEqual({ added: 0, removed: 0 });
    },
    120000,
  );

  it('accepts and replaces a valid tool result larger than eight MiB', async () => {
    await withSuffixFixture(
      1,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        const result = await truncateLargestToolResponses(
          toolDeps(history, async () => 0),
          100,
        );
        expect(result).toStrictEqual({
          success: true,
          replacedCount: 1,
          projected: 0,
        });
        let bytes = 0;
        for await (const row of history.streamRawHistory())
          bytes += Buffer.byteLength(JSON.stringify(row));
        expect(bytes).toBeLessThan(2048);
      },
      9 * 1024 * 1024,
      toolRankingRow,
      undefined,
      (options) => new BoundedToolHistory(options),
    );
  }, 120000);
});
