/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { executeCompression } from '../compression-execution.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { readCompressionTokenCount } from '../agentStatsProjector.js';

class UnreadableHistory extends HistoryService {
  override getTotalTokens(): number {
    throw new Error('History token accounting invariant failed');
  }
}

describe('compression history invariant', () => {
  it('does not convert an internal history failure into an empty compression count', () => {
    expect(() => readCompressionTokenCount(new UnreadableHistory())).toThrow(
      'History token accounting invariant failed',
    );
  });

  it('reports zero compression tokens only when history is absent', () => {
    expect(readCompressionTokenCount(null)).toBe(0);
  });
});

describe('compression result token accounting', () => {
  it('retains actual token inflation and pre-command recency without changing the monotonic public counts', async () => {
    let compressed = false;
    let prepared = false;
    const result = await executeCompression(
      'inflation',
      async () => {
        prepared = true;
      },
      async () => {
        expect(prepared).toBe(true);
        compressed = true;
        return PerformCompressionResult.COMPRESSED;
      },
      () => (compressed ? 53 : 41),
      () => !compressed,
    );
    expect(result).toStrictEqual({
      status: 'compressed',
      promptId: 'inflation',
      originalTokenCount: 53,
      newTokenCount: 53,
      detail: {
        result: PerformCompressionResult.COMPRESSED,
        originalTokenCount: 41,
        newTokenCount: 53,
        wasRecentlyCompressed: true,
      },
    });
  });

  for (const outcome of [
    PerformCompressionResult.NOOP,
    PerformCompressionResult.SKIPPED_EMPTY,
    PerformCompressionResult.SKIPPED_COOLDOWN,
    PerformCompressionResult.FAILED,
  ]) {
    it(`does not inspect retired history after ${outcome}`, async () => {
      let retired = false;
      const result = await executeCompression(
        'compression',
        async () => {},
        async () => {
          retired = true;
          return outcome;
        },
        () => {
          if (retired) throw new Error('History retired without a replacement');
          return 41;
        },
        () => true,
      );
      expect(result.detail).toStrictEqual({
        result: outcome,
        originalTokenCount: 41,
        newTokenCount: 41,
        wasRecentlyCompressed: true,
      });
      let expected: 'noop' | 'failed' | 'skipped' = 'skipped';
      if (outcome === PerformCompressionResult.NOOP) expected = 'noop';
      if (outcome === PerformCompressionResult.FAILED) expected = 'failed';
      expect(result.status).toBe(expected);
    });
  }
  it('reports the fresh history token count for successful compression', async () => {
    let compressed = false;
    const result = await executeCompression(
      'compression',
      async () => {},
      async () => {
        compressed = true;
        return PerformCompressionResult.COMPRESSED;
      },
      () => (compressed ? 19 : 41),
      () => false,
    );
    expect(result).toStrictEqual({
      status: 'compressed',
      promptId: 'compression',
      originalTokenCount: 41,
      newTokenCount: 19,
      detail: {
        result: PerformCompressionResult.COMPRESSED,
        originalTokenCount: 41,
        newTokenCount: 19,
        wasRecentlyCompressed: false,
      },
    });
  });
});
