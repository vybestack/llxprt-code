/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionMetricsAggregator,
  type ApiAttemptRecord,
} from './sessionMetricsAggregator.js';

function makeAttempt(
  overrides: Partial<ApiAttemptRecord> = {},
): ApiAttemptRecord {
  return {
    attemptId: overrides.attemptId ?? `att_${Math.random()}`,
    model: overrides.model ?? 'test-model',
    provider: overrides.provider ?? 'test-provider',
    isError: overrides.isError ?? false,
    hasUsage: overrides.hasUsage ?? true,
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
    cachedTokens: overrides.cachedTokens ?? 0,
    thoughtsTokens: overrides.thoughtsTokens ?? 0,
    toolTokens: overrides.toolTokens ?? 0,
    durationMs: overrides.durationMs ?? 1000,
    timeToFirstTokenMs: overrides.timeToFirstTokenMs ?? null,
    cacheReads: overrides.cacheReads ?? undefined,
    cacheWrites: overrides.cacheWrites ?? undefined,
    timestampMs: overrides.timestampMs ?? 0,
  };
}

describe('SessionMetricsAggregator', () => {
  let agg: SessionMetricsAggregator;

  beforeEach(() => {
    agg = new SessionMetricsAggregator();
  });

  describe('deduplication (Req 2)', () => {
    it('counts each unique attempt once by attemptId', () => {
      const attempt = makeAttempt({ attemptId: 'att_1' });
      agg.recordApiAttempt(attempt);
      agg.recordApiAttempt(attempt);
      agg.recordApiAttempt(attempt);
      const snapshot = agg.getSnapshot();
      expect(snapshot.totalApiRequests).toBe(1);
    });

    it('counts different attempts separately', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'att_1' }));
      agg.recordApiAttempt(makeAttempt({ attemptId: 'att_2' }));
      agg.recordApiAttempt(makeAttempt({ attemptId: 'att_3' }));
      expect(agg.getSnapshot().totalApiRequests).toBe(3);
    });

    it('deduplicates with late-arriving second copy', () => {
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'att_1', inputTokens: 100 }),
      );
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'att_1', inputTokens: 200 }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(1);
      expect(snap.totalInputTokens).toBe(100);
    });

    it('treats prototype-like model names as ordinary keys', () => {
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'proto-attempt', model: '__proto__' }),
      );

      const snapshot = agg.getSnapshot();
      expect(snapshot.models['__proto__'].totalRequests).toBe(1);
      expect(Object.prototype).not.toHaveProperty('totalRequests');
    });

    it('counts errors as attempts', () => {
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'e1', isError: true, durationMs: 500 }),
      );
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'e2', isError: true, durationMs: 300 }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(2);
      expect(snap.totalApiErrors).toBe(2);
    });
  });

  describe('complete TPM (Req 3)', () => {
    it('calculates TPM as 60 * sum(input+output) / sum(duration_ms)', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 2000,
        }),
      );
      const snap = agg.getSnapshot();
      // 60000 * (100+50) / 2000 = 4500
      expect(snap.completeTokensPerMinute).toBeCloseTo(4500, 5);
    });

    it('accumulates across multiple requests', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 200,
          outputTokens: 100,
          durationMs: 3000,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1000,
        }),
      );
      const snap = agg.getSnapshot();
      // 60000 * (300+150) / 4000 = 6750
      expect(snap.completeTokensPerMinute).toBeCloseTo(6750, 5);
    });

    it('includes TTFT implicitly since TTFT is inside request duration', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 100,
          outputTokens: 100,
          durationMs: 5000,
          timeToFirstTokenMs: 2000,
        }),
      );
      const snap = agg.getSnapshot();
      // The full 5000ms is in the denominator, including TTFT
      expect(snap.completeTokensPerMinute).toBeCloseTo((60000 * 200) / 5000, 5);
    });

    it('excludes gaps between requests: changing only gaps does not change TPM', () => {
      // Two identical requests with different wall-clock gaps
      const gapAgg1 = new SessionMetricsAggregator();
      gapAgg1.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1000,
          timestampMs: 0,
        }),
      );
      gapAgg1.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1000,
          timestampMs: 2000, // gap = 1s
        }),
      );

      const gapAgg2 = new SessionMetricsAggregator();
      gapAgg2.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1000,
          timestampMs: 0,
        }),
      );
      gapAgg2.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1000,
          timestampMs: 60000, // huge gap
        }),
      );

      expect(gapAgg1.getSnapshot().completeTokensPerMinute).toBeCloseTo(
        gapAgg2.getSnapshot().completeTokensPerMinute,
        10,
      );
    });

    it('returns 0 TPM when no requests with positive duration', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1', durationMs: 0 }));
      expect(agg.getSnapshot().completeTokensPerMinute).toBe(0);
    });

    it('mixed invalid+valid records: only valid contribute to TPM numerator', () => {
      // Invalid: zero duration
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'invalid1',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 0,
        }),
      );
      // Invalid: error status
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'invalid2',
          isError: true,
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1000,
        }),
      );
      // Valid: success + positive duration
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'valid1',
          inputTokens: 200,
          outputTokens: 100,
          durationMs: 2000,
        }),
      );
      const snap = agg.getSnapshot();
      // Only valid1 contributes to TPM numerator and rate denominator
      // 60000 * (200+100) / 2000 = 9000
      expect(snap.completeTokensPerMinute).toBeCloseTo(9000, 5);
      // API time includes ALL attempts including errors
      expect(snap.accumulatedApiTimeMs).toBe(3000);
    });
  });

  describe('output generation TPS (Req 4)', () => {
    it('computes weighted sum(O-1)/sum(G) for O>=2 and G>0', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 10,
          durationMs: 5000,
          timeToFirstTokenMs: 1000,
        }),
      );
      const snap = agg.getSnapshot();
      // G = duration - TTFT = 5000 - 1000 = 4000
      // sum(O-1) = 9, sum(G) = 4000
      // TPS = 9/4000 = 0.00225 tok/ms = 2.25 tok/s
      expect(snap.outputGenerationTps).toBeCloseTo((9 / 4000) * 1000, 5);
    });

    it('excludes single-token outputs (O < 2)', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 1,
          durationMs: 5000,
          timeToFirstTokenMs: 1000,
        }),
      );
      expect(agg.getSnapshot().outputGenerationTps).toBe(0);
    });

    it('excludes requests with G <= 0', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 10,
          durationMs: 1000,
          timeToFirstTokenMs: 1000, // G = 0
        }),
      );
      expect(agg.getSnapshot().outputGenerationTps).toBe(0);
    });

    it('excludes requests with null TTFT', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 10,
          durationMs: 5000,
          timeToFirstTokenMs: null,
        }),
      );
      expect(agg.getSnapshot().outputGenerationTps).toBe(0);
    });

    it('accumulates across multiple qualifying requests', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 10,
          durationMs: 3000,
          timeToFirstTokenMs: 1000,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          outputTokens: 5,
          durationMs: 4000,
          timeToFirstTokenMs: 1000,
        }),
      );
      const snap = agg.getSnapshot();
      // G1 = 2000, G2 = 3000
      // sum(O-1) = 9 + 4 = 13, sum(G) = 5000
      expect(snap.outputGenerationTps).toBeCloseTo((13 / 5000) * 1000, 5);
    });
  });

  describe('effective input processing TPS (Req 5)', () => {
    it('computes effective input TPS as sum(P) / sum(TTFT)', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 500,
          timeToFirstTokenMs: 2000,
        }),
      );
      const snap = agg.getSnapshot();
      // 500 / 2000ms = 0.25 tok/ms = 250 tok/s
      expect(snap.effectiveInputTps).toBeCloseTo((500 / 2000) * 1000, 5);
    });

    it('excludes requests with null or zero TTFT', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 500,
          timeToFirstTokenMs: null,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          inputTokens: 500,
          timeToFirstTokenMs: 0,
        }),
      );
      expect(agg.getSnapshot().effectiveInputTps).toBe(0);
    });

    it('computes uncached input TPS when cache data is available', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 1000,
          cachedTokens: 400,
          timeToFirstTokenMs: 2000,
          cacheReads: 400,
        }),
      );
      const snap = agg.getSnapshot();
      // max(0, 1000-400) = 600, TTFT = 2000
      // 600/2000*1000 = 300 tok/s
      expect(snap.uncachedInputTps).toBeCloseTo(300, 5);
    });

    it('returns null uncachedInputTps when no reliable cache data', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 1000,
          cachedTokens: 400,
          timeToFirstTokenMs: 2000,
          cacheReads: undefined,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.uncachedInputTps).toBeNull();
    });
  });

  describe('token totals and session usage (Req 6)', () => {
    it('accumulates all token types', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 20,
          thoughtsTokens: 5,
          toolTokens: 10,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          inputTokens: 200,
          outputTokens: 100,
          cachedTokens: 30,
          thoughtsTokens: 10,
          toolTokens: 20,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalInputTokens).toBe(300);
      expect(snap.totalOutputTokens).toBe(150);
      expect(snap.totalCachedTokens).toBe(50);
      expect(snap.totalThoughtsTokens).toBe(15);
      expect(snap.totalToolTokens).toBe(30);
    });

    it('provides uncached input = prompt - cache', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 1000,
          cachedTokens: 300,
        }),
      );
      expect(agg.getSnapshot().totalUncachedInputTokens).toBe(700);
    });
  });

  describe('accumulated API time (Req 8)', () => {
    it('sums all request durations', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1', durationMs: 2000 }));
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a2', durationMs: 3000 }));
      expect(agg.getSnapshot().accumulatedApiTimeMs).toBe(5000);
    });

    it('includes error durations', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1', durationMs: 2000 }));
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'e1', isError: true, durationMs: 500 }),
      );
      expect(agg.getSnapshot().accumulatedApiTimeMs).toBe(2500);
    });
  });

  describe('last request metrics (Req 6)', () => {
    it('tracks last request TPM', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1000,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          inputTokens: 200,
          outputTokens: 100,
          durationMs: 2000,
        }),
      );
      const snap = agg.getSnapshot();
      // last: 60000 * 300 / 2000 = 9000
      expect(snap.lastRequestTpm).toBeCloseTo(9000, 5);
    });
  });

  describe('per-model breakdown (Req 9)', () => {
    it('tracks per-model requests and tokens', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          model: 'gpt-4',
          inputTokens: 200,
          outputTokens: 100,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a3',
          model: 'claude',
          inputTokens: 50,
          outputTokens: 25,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.models['gpt-4'].totalRequests).toBe(2);
      expect(snap.models['gpt-4'].totalInputTokens).toBe(300);
      expect(snap.models['claude'].totalRequests).toBe(1);
      expect(snap.models['claude'].totalInputTokens).toBe(50);
    });

    it('does not reset on provider/model switch', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1', model: 'gpt-4' }));
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a2', model: 'claude' }));
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(2);
      expect(Object.keys(snap.models)).toHaveLength(2);
    });
  });

  describe('edge cases (Req 11)', () => {
    it('handles missing usage (all zeros)', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 0,
          outputTokens: 0,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(1);
      expect(snap.totalInputTokens).toBe(0);
      expect(snap.totalOutputTokens).toBe(0);
    });

    it('excludes hasUsage:false records from TPM and rate calculations', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'no-usage',
          inputTokens: 500,
          outputTokens: 200,
          durationMs: 1000,
          hasUsage: false,
        }),
      );
      const snap = agg.getSnapshot();
      // The record counts as an API request but must NOT contribute
      // to rate numerators or denominators.
      expect(snap.totalApiRequests).toBe(1);
      expect(snap.completeTokensPerMinute).toBe(0);
      // Token totals are still accumulated for display
      expect(snap.totalInputTokens).toBe(500);
      expect(snap.totalOutputTokens).toBe(200);
    });

    it('handles nonfinite values by treating as zero', () => {
      agg.recordApiAttempt({
        ...makeAttempt({ attemptId: 'a1' }),
        inputTokens: Number.NaN,
        outputTokens: Number.POSITIVE_INFINITY,
        durationMs: 1000,
      });
      const snap = agg.getSnapshot();
      expect(snap.totalInputTokens).toBe(0);
      expect(snap.totalOutputTokens).toBe(0);
    });

    it('handles zero duration without NaN', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          durationMs: 0,
          inputTokens: 100,
          outputTokens: 50,
        }),
      );
      const snap = agg.getSnapshot();
      expect(Number.isFinite(snap.completeTokensPerMinute)).toBe(true);
      expect(snap.completeTokensPerMinute).toBe(0);
    });

    it('clamps negative tokens to zero', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: -100,
          outputTokens: -50,
          cachedTokens: -20,
          durationMs: 1000,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalInputTokens).toBe(0);
      expect(snap.totalOutputTokens).toBe(0);
      expect(snap.totalCachedTokens).toBe(0);
    });

    it('clamps negative duration to zero', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          durationMs: -500,
          inputTokens: 100,
          outputTokens: 50,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.accumulatedApiTimeMs).toBe(0);
      expect(Number.isFinite(snap.completeTokensPerMinute)).toBe(true);
    });

    it('treats negative TTFT as null (excluded from generation TPS)', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 10,
          durationMs: 5000,
          timeToFirstTokenMs: -100,
        }),
      );
      const snap = agg.getSnapshot();
      // With TTFT treated as null, generation TPS is not computed
      expect(snap.outputGenerationTps).toBe(0);
    });

    it('treats NaN TTFT as null', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 10,
          durationMs: 5000,
          timeToFirstTokenMs: Number.NaN,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.outputGenerationTps).toBe(0);
    });

    it('clamps negative cache reads to zero', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          cacheReads: -100,
          durationMs: 1000,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalCacheReads).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all accumulated state', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1' }));
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a2' }));
      agg.reset();
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(0);
      expect(snap.totalInputTokens).toBe(0);
      expect(Object.keys(snap.models)).toHaveLength(0);
    });
  });
});
