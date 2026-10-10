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
      );
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
    );
    expect(result).toStrictEqual({
      status: 'compressed',
      promptId: 'compression',
      originalTokenCount: 41,
      newTokenCount: 19,
    });
  });
});
