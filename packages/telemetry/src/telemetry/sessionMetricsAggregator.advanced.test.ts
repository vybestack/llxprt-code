/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Advanced behavioral tests for SessionMetricsAggregator covering tool
 * accumulation, agent active time, inter-request gaps, generation TPS,
 * model switch, reset, parallel activity, cache data, and error paths.
 *
 * Split from sessionMetricsAggregator.test.ts to stay within the maximum
 * lines limit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    ...(overrides.lastTokenMs !== undefined
      ? { lastTokenMs: overrides.lastTokenMs }
      : {}),
  };
}

describe('SessionMetricsAggregator', () => {
  let agg: SessionMetricsAggregator;

  beforeEach(() => {
    agg = new SessionMetricsAggregator();
  });

  describe('tool time accumulation', () => {
    it('accumulates tool durations', () => {
      agg.recordToolActivity('tool1', 500, true, 'call_a');
      agg.recordToolActivity('tool2', 300, false, 'call_b');
      const snap = agg.getSnapshot();
      expect(snap.totalToolTimeMs).toBe(800);
      expect(snap.totalToolCalls).toBe(2);
      expect(snap.totalToolSuccesses).toBe(1);
      expect(snap.totalToolFailures).toBe(1);
    });

    it('handles duplicate tool calls by callId', () => {
      agg.recordToolActivity('tool1', 500, true, 'call_1');
      agg.recordToolActivity('tool1', 500, true, 'call_1');
      const snap = agg.getSnapshot();
      expect(snap.totalToolCalls).toBe(1);
      expect(snap.totalToolTimeMs).toBe(500);
    });
  });

  describe('agent active time (Req 8)', () => {
    it('computes union of API and tool intervals with overlap counted once', () => {
      // API: [0, 1000), Tool: [500, 1500)
      // Union = [0, 1500) = 1500ms
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          durationMs: 1000,
          timestampMs: 0,
        }),
      );
      agg.recordToolActivity(
        'tool1',
        1000,
        true,
        'c1',
        500, // startTimestampMs
      );
      const snap = agg.getSnapshot();
      expect(snap.agentActiveTimeMs).toBe(1500);
    });

    it('accumulated work = api time + tool time (overlap counted twice)', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          durationMs: 1000,
          timestampMs: 0,
        }),
      );
      agg.recordToolActivity('tool1', 1000, true, 'c1', 500);
      const snap = agg.getSnapshot();
      expect(snap.accumulatedWorkMs).toBe(2000);
    });

    it('does not exceed wall time when intervals fully overlap', () => {
      // API: [0, 2000), Tool: [0, 2000) -> union = 2000
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          durationMs: 2000,
          timestampMs: 0,
        }),
      );
      agg.recordToolActivity('tool1', 2000, true, 'c1', 0);
      const snap = agg.getSnapshot();
      expect(snap.agentActiveTimeMs).toBe(2000);
      expect(snap.agentActiveTimeMs).toBeLessThanOrEqual(
        snap.accumulatedWorkMs,
      );
    });
  });

  describe('inter-request gaps do not affect TPM', () => {
    it('TPM is unchanged regardless of wall-clock gaps between requests', () => {
      const base = {
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 1000,
        timeToFirstTokenMs: 200,
      };

      const aggSmallGap = new SessionMetricsAggregator();
      aggSmallGap.recordApiAttempt(
        makeAttempt({ attemptId: 'a1', ...base, timestampMs: 0 }),
      );
      aggSmallGap.recordApiAttempt(
        makeAttempt({ attemptId: 'a2', ...base, timestampMs: 1100 }),
      );

      const aggHugeGap = new SessionMetricsAggregator();
      aggHugeGap.recordApiAttempt(
        makeAttempt({ attemptId: 'a1', ...base, timestampMs: 0 }),
      );
      aggHugeGap.recordApiAttempt(
        makeAttempt({ attemptId: 'a2', ...base, timestampMs: 100000 }),
      );

      expect(aggSmallGap.getSnapshot().completeTokensPerMinute).toBeCloseTo(
        aggHugeGap.getSnapshot().completeTokensPerMinute,
        10,
      );
    });

    it('TPM is unchanged when tool/idle gaps are inserted between requests', () => {
      const base = {
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 1000,
      };

      const aggWithTools = new SessionMetricsAggregator();
      aggWithTools.recordApiAttempt(
        makeAttempt({ attemptId: 'a1', ...base, timestampMs: 0 }),
      );
      aggWithTools.recordToolActivity('edit', 5000, true, 't1', 1000);
      aggWithTools.recordApiAttempt(
        makeAttempt({ attemptId: 'a2', ...base, timestampMs: 6000 }),
      );

      const aggWithoutTools = new SessionMetricsAggregator();
      aggWithoutTools.recordApiAttempt(
        makeAttempt({ attemptId: 'a1', ...base, timestampMs: 0 }),
      );
      aggWithoutTools.recordApiAttempt(
        makeAttempt({ attemptId: 'a2', ...base, timestampMs: 1000 }),
      );

      expect(aggWithTools.getSnapshot().completeTokensPerMinute).toBeCloseTo(
        aggWithoutTools.getSnapshot().completeTokensPerMinute,
        10,
      );
    });
  });

  describe('standard generation TPS excludes TTFT', () => {
    it('generation gap G = duration - TTFT, not duration', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 11,
          durationMs: 10000,
          timeToFirstTokenMs: 3000,
        }),
      );
      const snap = agg.getSnapshot();
      // G = 10000 - 3000 = 7000ms
      // sum(O-1) = 10, sum(G) = 7000
      // TPS = 10/7000*1000 = 1.4286 tok/s
      expect(snap.outputGenerationTps).toBeCloseTo((10 / 7000) * 1000, 4);
    });

    it('one-token output does not contribute to generation TPS', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          outputTokens: 1,
          durationMs: 1000,
          timeToFirstTokenMs: 500,
        }),
      );
      expect(agg.getSnapshot().outputGenerationTps).toBe(0);
    });
  });

  describe('first and final token timing', () => {
    it('uses request start for TPM denominator, not first token time', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 5000,
          timeToFirstTokenMs: 3000,
          timestampMs: 0,
        }),
      );
      const snap = agg.getSnapshot();
      // Denominator = 5000 (full duration), not 2000 (post-TTFT)
      // 60000 * 150 / 5000 = 1800
      expect(snap.completeTokensPerMinute).toBeCloseTo(1800, 2);
    });
  });

  describe('provider/model switch preserves aggregates', () => {
    it('keeps whole-session totals while splitting per-model', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          model: 'gpt-4',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 1000,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a2',
          model: 'claude-3',
          inputTokens: 200,
          outputTokens: 100,
          durationMs: 2000,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(2);
      expect(snap.totalInputTokens).toBe(300);
      expect(snap.totalOutputTokens).toBe(150);
      expect(snap.models['gpt-4'].totalInputTokens).toBe(100);
      expect(snap.models['claude-3'].totalInputTokens).toBe(200);
      // Per-model sums reconcile with session totals
      const modelInputSum =
        snap.models['gpt-4'].totalInputTokens +
        snap.models['claude-3'].totalInputTokens;
      expect(modelInputSum).toBe(snap.totalInputTokens);
    });

    it('per-model duration reconciles with session API time', () => {
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'a1', model: 'gpt-4', durationMs: 1500 }),
      );
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'a2', model: 'claude-3', durationMs: 2500 }),
      );
      const snap = agg.getSnapshot();
      const modelDurationSum =
        snap.models['gpt-4'].totalLatencyMs +
        snap.models['claude-3'].totalLatencyMs;
      expect(modelDurationSum).toBe(snap.accumulatedApiTimeMs);
    });
  });

  describe('reset clears all session accumulators', () => {
    it('clears timing, tokens, models, tools, and cache', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 20,
          durationMs: 1000,
          timeToFirstTokenMs: 200,
          cacheReads: 20,
          timestampMs: 0,
        }),
      );
      agg.recordToolActivity('tool1', 500, true, 'c1', 0);

      const beforeReset = agg.getSnapshot();
      expect(beforeReset.totalApiRequests).toBe(1);
      expect(beforeReset.totalToolCalls).toBe(1);

      agg.reset();
      const after = agg.getSnapshot();
      expect(after.totalApiRequests).toBe(0);
      expect(after.totalInputTokens).toBe(0);
      expect(after.completeTokensPerMinute).toBe(0);
      expect(after.outputGenerationTps).toBe(0);
      expect(after.totalToolCalls).toBe(0);
      expect(after.agentActiveTimeMs).toBe(0);
      expect(after.hasReliableCacheData).toBe(false);
      expect(Object.keys(after.models)).toHaveLength(0);
    });

    it('allows recording fresh data after reset', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1' }));
      agg.reset();
      agg.recordApiAttempt(makeAttempt({ attemptId: 'b1' }));
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(1);
    });

    it('dedup state is cleared by reset', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1' }));
      agg.reset();
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1' }));
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(1);
    });
  });

  describe('parallel activity does not double-count agent active time', () => {
    it('two parallel API requests with same interval count union once', () => {
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'a1', durationMs: 1000, timestampMs: 0 }),
      );
      agg.recordApiAttempt(
        makeAttempt({ attemptId: 'a2', durationMs: 1000, timestampMs: 0 }),
      );
      const snap = agg.getSnapshot();
      // Both [0,1000) -> union = 1000
      expect(snap.agentActiveTimeMs).toBe(1000);
      // Accumulated work counts both = 2000
      expect(snap.accumulatedWorkMs).toBe(2000);
    });

    it('exact union across many disjoint intervals (no compaction)', () => {
      // Insert far more disjoint intervals than any internal limit.
      // The union must remain exact — every interval contributes its
      // duration, gaps are never bridged, and no interval is evicted.
      const clockNow = vi.spyOn(performance, 'now');
      const fixedNow = 1_000_000;
      clockNow.mockReturnValue(fixedNow);
      try {
        for (let i = 0; i < 250; i++) {
          agg.recordApiAttempt(
            makeAttempt({
              attemptId: `disjoint_${i}`,
              durationMs: 10,
              timestampMs: i * 20,
            }),
          );
        }
        const snap = agg.getSnapshot();
        // Exact union: 250 intervals of 10ms each, 10ms gaps excluded.
        expect(snap.agentActiveTimeMs).toBe(250 * 10);
      } finally {
        clockNow.mockRestore();
      }
    });

    it('rejects non-finite interval endpoints', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          durationMs: 1000,
          timestampMs: Number.NaN,
        }),
      );
      const snap = agg.getSnapshot();
      // NaN timestamp should be rejected — no interval added
      expect(snap.agentActiveTimeMs).toBe(0);
    });

    it('rejects Infinity and -Infinity timestamps', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a-inf',
          durationMs: 1000,
          timestampMs: Number.POSITIVE_INFINITY,
        }),
      );
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a-neg-inf',
          durationMs: 1000,
          timestampMs: Number.NEGATIVE_INFINITY,
        }),
      );
      const snap = agg.getSnapshot();
      // Non-finite timestamps should be rejected — no intervals added
      expect(snap.agentActiveTimeMs).toBe(0);
    });
  });

  describe('cache data', () => {
    it('tracks cache reads and writes', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          cacheReads: 500,
          cacheWrites: 200,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.hasReliableCacheData).toBe(true);
      expect(snap.totalCacheReads).toBe(500);
      expect(snap.totalCacheWrites).toBe(200);
    });

    it('accumulates cache reads across requests', () => {
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a1', cacheReads: 100 }));
      agg.recordApiAttempt(makeAttempt({ attemptId: 'a2', cacheReads: 300 }));
      expect(agg.getSnapshot().totalCacheReads).toBe(400);
    });

    it('uncached input TPS is null when no reliable cache data', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'a1',
          cachedTokens: 50,
          timeToFirstTokenMs: 1000,
          cacheReads: undefined,
        }),
      );
      expect(agg.getSnapshot().uncachedInputTps).toBeNull();
    });

    it('uncached input TPS computed when cache data is reliable', () => {
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
      // max(0, 1000-400) = 600, TTFT = 2000ms
      // 600/2000*1000 = 300 tok/s
      expect(snap.uncachedInputTps).toBeCloseTo(300, 2);
    });
  });

  describe('error and abort paths', () => {
    it('error before first token still counts as a request', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'e1',
          isError: true,
          durationMs: 200,
          timeToFirstTokenMs: null,
          inputTokens: 0,
          outputTokens: 0,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalApiRequests).toBe(1);
      expect(snap.totalApiErrors).toBe(1);
      expect(snap.accumulatedApiTimeMs).toBe(200);
    });

    it('abort after first token does NOT contribute to TPM numerator (error excluded)', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'abort1',
          isError: true,
          inputTokens: 100,
          outputTokens: 10,
          durationMs: 3000,
          timeToFirstTokenMs: 500,
        }),
      );
      const snap = agg.getSnapshot();
      // Errors are excluded from rate numerator per finding #2
      expect(snap.completeTokensPerMinute).toBe(0);
      // But API time still includes the error duration
      expect(snap.accumulatedApiTimeMs).toBe(3000);
    });
  });

  describe('recordApiAttempt returns dedup status', () => {
    it('returns true for first record, false for duplicate', () => {
      expect(agg.recordApiAttempt(makeAttempt({ attemptId: 'a1' }))).toBe(true);
      expect(agg.recordApiAttempt(makeAttempt({ attemptId: 'a1' }))).toBe(
        false,
      );
    });
  });

  describe('recordToolActivity returns dedup status', () => {
    it('returns false for duplicate tool callId', () => {
      expect(agg.recordToolActivity('tool1', 100, true, 'c1')).toBe(true);
      expect(agg.recordToolActivity('tool1', 100, true, 'c1')).toBe(false);
    });
  });

  describe('boundary: cachedTokens >= inputTokens', () => {
    it('clamps totalUncachedInputTokens to 0 when cached equals input', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'c1',
          inputTokens: 500,
          cachedTokens: 500,
          hasUsage: true,
          cacheReads: 500,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalUncachedInputTokens).toBe(0);
      // uncachedInputTps should be 0, not negative
      expect(snap.uncachedInputTps).toBe(0);
    });

    it('clamps totalUncachedInputTokens to 0 when cached exceeds input', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'c2',
          inputTokens: 300,
          cachedTokens: 500,
          hasUsage: true,
          cacheReads: 500,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalUncachedInputTokens).toBe(0);
    });
  });

  describe('output generation TPS uses lastTokenMs when available', () => {
    it('computes generation gap from lastTokenMs - TTFT', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'tps1',
          inputTokens: 100,
          outputTokens: 50,
          durationMs: 2000,
          timeToFirstTokenMs: 200,
          lastTokenMs: 1000,
        }),
      );
      const snap = agg.getSnapshot();
      // Gap = lastTokenMs - TTFT = 800ms
      // outputGenerationTps = (50-1) / 800 * 1000 = 61.25
      expect(snap.outputGenerationTps).toBeCloseTo(61.25, 1);
    });
  });

  describe('negative value sanitization for all token fields', () => {
    it('clamps negative thoughtsTokens to 0', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'neg1',
          thoughtsTokens: -100,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalThoughtsTokens).toBe(0);
    });

    it('clamps negative toolTokens to 0', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'neg2',
          toolTokens: -50,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalToolTokens).toBe(0);
    });

    it('clamps negative cacheWrites to 0', () => {
      agg.recordApiAttempt(
        makeAttempt({
          attemptId: 'neg3',
          cacheWrites: -200,
          hasUsage: true,
        }),
      );
      const snap = agg.getSnapshot();
      expect(snap.totalCacheWrites).toBe(0);
    });
  });

  describe('exact interval union (no lossy compaction)', () => {
    it('preserves exact union across >200 disjoint intervals', () => {
      // Each attempt occupies a non-overlapping interval of 10ms.
      // Total active = totalAttempts * stepMs regardless of count —
      // no compaction, no eviction.
      const stepMs = 10;
      const gapMs = 5;
      const totalAttempts = 210;
      let cursor = 0;
      for (let i = 0; i < totalAttempts; i++) {
        agg.recordApiAttempt(
          makeAttempt({
            attemptId: `compact-${i}`,
            timestampMs: cursor,
            durationMs: stepMs,
          }),
        );
        cursor += stepMs + gapMs;
      }

      const snap = agg.getSnapshot();
      expect(snap.agentActiveTimeMs).toBe(totalAttempts * stepMs);
    });

    it('preserves exact union with explicit gaps', () => {
      const stepMs = 100;
      const gapMs = 50;
      const totalAttempts = 205;
      let cursor = 0;
      for (let i = 0; i < totalAttempts; i++) {
        agg.recordApiAttempt(
          makeAttempt({
            attemptId: `gap-${i}`,
            timestampMs: cursor,
            durationMs: stepMs,
          }),
        );
        cursor += stepMs + gapMs;
      }

      const snap = agg.getSnapshot();
      expect(snap.agentActiveTimeMs).toBe(totalAttempts * stepMs);
    });

    it('201 disjoint intervals then late overlapping interval gives exact union including cross API/tool overlap', () => {
      // Regression: after more than 200 disjoint API intervals, a
      // late-arriving interval that overlaps an earlier one must be
      // merged exactly — not double-counted, not lost to compaction,
      // and not bridging any gaps.
      const stepMs = 10;
      const gapMs = 10;
      const totalDisjoint = 201;
      let cursor = 0;
      for (let i = 0; i < totalDisjoint; i++) {
        agg.recordApiAttempt(
          makeAttempt({
            attemptId: `disjoint-${i}`,
            timestampMs: cursor,
            durationMs: stepMs,
          }),
        );
        cursor += stepMs + gapMs;
      }

      const beforeOverlap = agg.getSnapshot();
      const expectedDisjoint = totalDisjoint * stepMs;
      expect(beforeOverlap.agentActiveTimeMs).toBe(expectedDisjoint);

      // Now add a late tool interval that overlaps the very first API
      // interval [0, 10). Tool: [5, 15) overlaps [0,10) and the gap,
      // and reaches into the second interval [20,30)? No — it only
      // reaches [5,15), overlapping [0,10) and the gap [10,20).
      // The union of [0,10) + [5,15) = [0,15) = 15ms (5ms gained over
      // the first 10ms, 5ms of the gap bridged into the first interval).
      // Since the first interval was already 10ms, the net gain is 5ms.
      agg.recordToolActivity(
        'late-tool',
        10, // duration
        true,
        'late-tool-call',
        5, // startTimestampMs → [5, 15)
      );

      const afterOverlap = agg.getSnapshot();
      // The late interval overlaps the first API interval, adding 5ms
      // of previously-gap time to the union (gap [10,15) is now active).
      expect(afterOverlap.agentActiveTimeMs).toBe(expectedDisjoint + 5);

      // Cross API/tool overlap: a tool interval fully inside an API
      // interval must not add any time.
      agg.recordToolActivity(
        'inner-tool',
        5,
        true,
        'inner-tool-call',
        2, // [2,7) fully inside [0,15) (merged first interval)
      );
      const afterInner = agg.getSnapshot();
      expect(afterInner.agentActiveTimeMs).toBe(expectedDisjoint + 5);
    });
  });

  describe('tool dedup only applies producer-provided callId (finding #5)', () => {
    it('deduplicates the same callId on reprocessing', () => {
      const accepted1 = agg.recordToolActivity('tool', 100, true, 'call-1');
      const accepted2 = agg.recordToolActivity('tool', 100, true, 'call-1');
      expect(accepted1).toBe(true);
      expect(accepted2).toBe(false);
      const snap = agg.getSnapshot();
      expect(snap.totalToolCalls).toBe(1);
    });

    it('rejects identity-less tool events (no callId) — finding #3', () => {
      // Finding #3: identity-less records must not be accepted as
      // distinct. Without a stable callId there is no way to prevent
      // double-counting on replay, so the boundary rejects them.
      const accepted1 = agg.recordToolActivity('tool', 100, true);
      const accepted2 = agg.recordToolActivity('tool', 100, true);
      expect(accepted1).toBe(false);
      expect(accepted2).toBe(false);
      const snap = agg.getSnapshot();
      expect(snap.totalToolCalls).toBe(0);
    });

    it('rejects tool events with empty/whitespace-only callId — finding #3', () => {
      const accepted1 = agg.recordToolActivity('tool', 100, true, '');
      const accepted2 = agg.recordToolActivity('tool', 100, true, '   ');
      expect(accepted1).toBe(false);
      expect(accepted2).toBe(false);
      const snap = agg.getSnapshot();
      expect(snap.totalToolCalls).toBe(0);
    });

    it('rejects the same tool name repeatedly when callId is missing — finding #3', () => {
      for (let i = 0; i < 5; i++) {
        agg.recordToolActivity('repeated-tool', 50, true);
      }
      const snap = agg.getSnapshot();
      expect(snap.totalToolCalls).toBe(0);
    });
  });
});
