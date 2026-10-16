/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  truncateLargestToolResponses,
  truncateOversizedToolResponsesUnified,
} from '../toolResultTruncator.js';
import {
  BoundedToolHistory,
  toolRankingRow,
  toolDeps,
  digestRows,
  expectedToolDigest,
} from './tool-truncation-stream-helpers.js';

describe('disk-backed production tool truncation', () => {
  it.each([512, 8192])(
    'preserves the exact legacy suffix rewrite for %i mixed rows',
    async (size) => {
      const mutations = new RowOwnership();
      await withSuffixFixture(
        size,
        async (history, ownership) => {
          history.setTokenizerFactory(exactTokenizer());
          let projections = 0;
          const deps = toolDeps(history, async () =>
            ++projections < 2 ? 200 : 0,
          );
          const result = await truncateLargestToolResponses(deps, 100);
          expect(result).toStrictEqual({
            replacedCount: 2,
            projected: 0,
            success: true,
          });
          expect(await digestRows(history.streamRawHistory())).toBe(
            expectedToolDigest(size, 2),
          );
          expect(
            ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect(
            mutations.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect([
            ownership.snapshot().liveRows,
            mutations.snapshot().liveRows,
          ]).toStrictEqual([0, 0]);
        },
        2048,
        toolRankingRow,
        mutations,
        (options) => new BoundedToolHistory(options),
      );
    },
    120000,
  );
});

describe('pending tool ranking precedence', () => {
  it.each([512, 8192])(
    'ranks pending ahead of equally sized history at %i rows without changing caller blocks',
    async (size) => {
      await withSuffixFixture(
        size,
        async (history) => {
          history.setTokenizerFactory(exactTokenizer());
          const original = {
            type: 'tool_response' as const,
            callId: `duplicate-${size % 3}`,
            toolName: 'read_file',
            result: { index: size, payload: 'x'.repeat(2048) },
          };
          const fixture = toolRankingRow(size);
          const pending = {
            ...fixture,
            blocks: fixture.blocks.map((block, index) =>
              index === 2 ? original : block,
            ),
          };
          const deps = {
            ...toolDeps(history, async () => 0),
            pendingContents: [pending],
          };
          const result = await truncateOversizedToolResponsesUnified(deps, 100);
          expect(result.replacedCount).toBe(1);
          expect(result.success).toBe(true);
          expect(pending.blocks[2]).toBe(original);
          expect(result.transformedPending?.[0].blocks[2]).toMatchObject({
            callId: `duplicate-${size % 3}`,
            providerMetadata: { contextTruncated: true },
          });
          expect(await digestRows(history.streamRawHistory())).toBe(
            expectedToolDigest(size, 0),
          );
        },
        2048,
        toolRankingRow,
        undefined,
        (options) => new BoundedToolHistory(options),
      );
    },
    120000,
  );
});
