/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the canonical consumer/tool/reset pipeline.
 *
 * These tests exercise the full event path: events flow through
 * UiTelemetryService.addEvent → SessionMetricsAggregator → snapshot.
 * No mocks of the aggregator or service internals.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UiTelemetryService } from './uiTelemetry.js';

let attemptCounter = 0;

function makeToolCallEvent(opts: {
  name?: string;
  callId?: string;
  duration?: number;
  success?: boolean;
  status?: string;
  startMs?: number;
  endMs?: number;
  decision?: string;
}) {
  return {
    'event.name': 'llxprt_code.tool_call' as const,
    'event.timestamp': new Date().toISOString(),
    function_name: opts.name ?? 'read_file',
    function_args: {},
    duration_ms: opts.duration ?? 100,
    success: opts.success ?? true,
    status: opts.status,
    prompt_id: 'prompt-test',
    tool_type: 'native' as const,
    agent_id: 'primary',
    call_id: opts.callId,
    start_ms: opts.startMs,
    end_ms: opts.endMs,
    decision: opts.decision,
  };
}

function makeApiResponseEvent(opts: {
  model?: string;
  attemptId?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  ttft?: number | null;
  lastTokenMs?: number | null;
  cacheReads?: number;
  cacheWrites?: number | null;
  hasUsage?: boolean;
  provider?: string;
  startMs?: number;
}) {
  return {
    'event.name': 'llxprt_code.api_response' as const,
    'event.timestamp': new Date().toISOString(),
    model: opts.model ?? 'test-model',
    duration_ms: opts.durationMs ?? 1000,
    status_code: 200,
    input_token_count: opts.inputTokens ?? 100,
    output_token_count: opts.outputTokens ?? 50,
    cached_content_token_count: opts.cachedTokens ?? 0,
    thoughts_token_count: 0,
    tool_token_count: 0,
    total_token_count: (opts.inputTokens ?? 100) + (opts.outputTokens ?? 50),
    finish_reasons: [],
    prompt_id: 'prompt-test',
    attempt_id: opts.attemptId ?? `att_${attemptCounter++}`,
    provider: opts.provider ?? 'test-provider',
    start_ms: opts.startMs,
    time_to_first_token_ms: opts.ttft ?? null,
    last_token_ms: opts.lastTokenMs ?? null,
    cache_read_input_tokens: opts.cacheReads,
    cache_creation_input_tokens: opts.cacheWrites,
    usage_metadata_present: opts.hasUsage ?? true,
    provider_owned: true,
  };
}

function makeApiErrorEvent(opts: {
  model?: string;
  attemptId?: string;
  durationMs?: number;
  error?: string;
  ttft?: number | null;
  inputTokens?: number;
  outputTokens?: number;
}) {
  return {
    'event.name': 'llxprt_code.api_error' as const,
    'event.timestamp': new Date().toISOString(),
    model: opts.model ?? 'test-model',
    error: opts.error ?? 'test error',
    duration_ms: opts.durationMs ?? 500,
    prompt_id: 'prompt-test',
    attempt_id: opts.attemptId ?? `att_${attemptCounter++}`,
    provider: 'test-provider',
    time_to_first_token_ms: opts.ttft ?? null,
    input_token_count: opts.inputTokens ?? 0,
    output_token_count: opts.outputTokens ?? 0,
    cached_content_token_count: 0,
    thoughts_token_count: 0,
    tool_token_count: 0,
    usage_metadata_present: true,
    provider_owned: true,
  };
}

describe('Canonical consumer behavior: tool calls through real event path', () => {
  let svc: UiTelemetryService;

  beforeEach(() => {
    attemptCounter = 0;
    svc = new UiTelemetryService();
  });

  it('counts success, failure, and cancelled tools separately', () => {
    svc.addEvent(makeToolCallEvent({ callId: 'c1', success: true }));
    svc.addEvent(
      makeToolCallEvent({ callId: 'c2', success: false, status: 'error' }),
    );
    svc.addEvent(makeToolCallEvent({ callId: 'c3', status: 'cancelled' }));

    const snap = svc.getSessionSnapshot();
    expect(snap.totalToolCalls).toBe(3);
    expect(snap.totalToolSuccesses).toBe(1);
    expect(snap.totalToolFailures).toBe(1);
    expect(snap.totalToolCancellations).toBe(1);
  });

  it('cancelled tool does not count as failure', () => {
    svc.addEvent(
      makeToolCallEvent({ callId: 'c1', status: 'cancelled', success: false }),
    );

    const snap = svc.getSessionSnapshot();
    expect(snap.totalToolCancellations).toBe(1);
    expect(snap.totalToolFailures).toBe(0);
    expect(snap.totalToolSuccesses).toBe(0);
  });

  it('deduplicates tool calls by call_id', () => {
    svc.addEvent(makeToolCallEvent({ callId: 'c1', duration: 100 }));
    svc.addEvent(makeToolCallEvent({ callId: 'c1', duration: 200 }));

    const snap = svc.getSessionSnapshot();
    expect(snap.totalToolCalls).toBe(1);
    expect(snap.totalToolTimeMs).toBe(100);
  });

  it('never counts an identity-less (missing call_id) tool event twice (finding #3)', () => {
    // Identity-less events have no call_id. They must NOT be counted as
    // distinct on replay — the same event replayed through the service
    // boundary must never double-count. Since there is no stable ID to
    // deduplicate by, the service drops identity-less events entirely.
    svc.addEvent(makeToolCallEvent({ callId: undefined, duration: 100 }));
    svc.addEvent(makeToolCallEvent({ callId: undefined, duration: 100 }));

    const snap = svc.getSessionSnapshot();
    // Identity-less events are not counted at all — not even once.
    expect(snap.totalToolCalls).toBe(0);
    expect(snap.totalToolTimeMs).toBe(0);
  });

  it('mixing identity-less and identified tool events does not affect identified counts (finding #3)', () => {
    svc.addEvent(makeToolCallEvent({ callId: 'c1', duration: 100 }));
    svc.addEvent(makeToolCallEvent({ callId: undefined, duration: 999 }));
    svc.addEvent(makeToolCallEvent({ callId: 'c2', duration: 200 }));

    const snap = svc.getSessionSnapshot();
    // Only identified events are counted
    expect(snap.totalToolCalls).toBe(2);
    expect(snap.totalToolTimeMs).toBe(300);
  });

  it('accumulates tool durations across calls', () => {
    svc.addEvent(makeToolCallEvent({ callId: 'c1', duration: 100 }));
    svc.addEvent(makeToolCallEvent({ callId: 'c2', duration: 200 }));
    svc.addEvent(makeToolCallEvent({ callId: 'c3', duration: 300 }));

    const snap = svc.getSessionSnapshot();
    expect(snap.totalToolTimeMs).toBe(600);
  });

  it('real interval contributes to Agent Active union', () => {
    // Tool: [100, 300) → 200ms
    svc.addEvent(
      makeToolCallEvent({
        callId: 'c1',
        duration: 200,
        startMs: 100,
      }),
    );

    const snap = svc.getSessionSnapshot();
    expect(snap.agentActiveTimeMs).toBe(200);
  });

  it('overlapping tool intervals count union once', () => {
    // Tool A: [0, 1000), Tool B: [500, 1500) → union = 1500
    svc.addEvent(
      makeToolCallEvent({
        callId: 'c1',
        duration: 1000,
        startMs: 0,
      }),
    );
    svc.addEvent(
      makeToolCallEvent({
        callId: 'c2',
        duration: 1000,
        startMs: 500,
      }),
    );

    const snap = svc.getSessionSnapshot();
    expect(snap.agentActiveTimeMs).toBe(1500);
    // Accumulated work counts both = 2000
    expect(snap.accumulatedWorkMs).toBe(2000);
  });

  it('decisions tracked per tool in metrics', () => {
    svc.addEvent(makeToolCallEvent({ callId: 'c1', decision: 'accept' }));
    svc.addEvent(makeToolCallEvent({ callId: 'c2', decision: 'reject' }));

    const metrics = svc.getMetrics();
    expect(metrics.tools.totalDecisions.accept).toBe(1);
    expect(metrics.tools.totalDecisions.reject).toBe(1);
  });
});

describe('Canonical consumer behavior: API timing through real event path', () => {
  let svc: UiTelemetryService;

  beforeEach(() => {
    svc = new UiTelemetryService();
  });

  it('TTFT last and arithmetic mean tracked', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        ttft: 200,
        durationMs: 2000,
      }),
    );
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a2',
        ttft: 400,
        durationMs: 3000,
      }),
    );

    const snap = svc.getSessionSnapshot();
    // last TTFT = 400
    expect(snap.lastTtftMs).toBe(400);
    // arithmetic mean = (200+400)/2 = 300
    expect(snap.weightedAvgTtftMs).toBe(300);
  });

  it('complete TPM uses canonical session value, not last request', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 1000,
      }),
    );
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a2',
        inputTokens: 1000,
        outputTokens: 500,
        durationMs: 100,
      }),
    );

    const snap = svc.getSessionSnapshot();
    // Session TPM = 60000 * (150+1500) / 1100 = 60000 * 1650 / 1100 = 90000
    expect(snap.completeTokensPerMinute).toBeCloseTo(90000, 0);
    // Last request TPM = 60000 * 1500 / 100 = 900000
    expect(snap.lastRequestTpm).toBeCloseTo(900000, 0);
    // The two must differ — verifies canonical vs last-request distinction
    expect(snap.completeTokensPerMinute).not.toBeCloseTo(
      snap.lastRequestTpm,
      -1,
    );
  });

  it('output generation TPS tracks last and weighted', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        outputTokens: 10,
        ttft: 1000,
        durationMs: 5000,
      }),
    );

    const snap = svc.getSessionSnapshot();
    // G = 5000-1000 = 4000, sum(O-1) = 9
    // session weighted = 9/4000*1000 = 2.25
    expect(snap.outputGenerationTps).toBeCloseTo(2.25, 5);
    // last = same as session for single request
    expect(snap.lastOutputGenerationTps).toBeCloseTo(2.25, 5);
  });

  it('attempts and errors tracked', () => {
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a1' }));
    svc.addEvent(makeApiErrorEvent({ attemptId: 'e1' }));

    const snap = svc.getSessionSnapshot();
    expect(snap.totalApiRequests).toBe(2);
    expect(snap.totalApiErrors).toBe(1);
  });

  it('average latency = accumulated API time / requests', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        durationMs: 1000,
      }),
    );
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a2',
        durationMs: 3000,
      }),
    );

    const snap = svc.getSessionSnapshot();
    expect(snap.accumulatedApiTimeMs).toBe(4000);
    // avg latency = 4000 / 2 = 2000
    expect(snap.accumulatedApiTimeMs / snap.totalApiRequests).toBe(2000);
  });
});

describe('Canonical consumer behavior: cache read/write independence', () => {
  let svc: UiTelemetryService;

  beforeEach(() => {
    svc = new UiTelemetryService();
  });

  it('cache reads tracked independently of writes', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        cacheReads: 500,
        cacheWrites: undefined,
      }),
    );

    const snap = svc.getSessionSnapshot();
    expect(snap.hasReliableCacheReads).toBe(true);
    expect(snap.hasReliableCacheWrites).toBe(false);
    expect(snap.totalCacheReads).toBe(500);
    expect(snap.totalCacheWrites).toBeNull();
  });

  it('cache writes tracked independently of reads', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        cacheReads: undefined,
        cacheWrites: 300,
      }),
    );

    const snap = svc.getSessionSnapshot();
    expect(snap.hasReliableCacheReads).toBe(false);
    expect(snap.hasReliableCacheWrites).toBe(true);
    expect(snap.totalCacheWrites).toBe(300);
  });

  it('activity counters for reads and writes separate', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        cacheReads: 100,
        cacheWrites: 200,
      }),
    );
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a2',
        cacheReads: 300,
      }),
    );

    const snap = svc.getSessionSnapshot();
    expect(snap.requestsWithCacheReads).toBe(2);
    expect(snap.requestsWithCacheWrites).toBe(1);
  });

  it('uncached input TPS only computed when cache data reliable', () => {
    // No cache data
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        inputTokens: 1000,
        ttft: 2000,
        cacheReads: undefined,
      }),
    );
    expect(svc.getSessionSnapshot().uncachedInputTps).toBeNull();

    // With cache data
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a2',
        inputTokens: 1000,
        cachedTokens: 400,
        ttft: 2000,
        cacheReads: 400,
      }),
    );
    const snap = svc.getSessionSnapshot();
    expect(snap.uncachedInputTps).not.toBeNull();
  });
});

describe('Canonical consumer behavior: clear resets all state', () => {
  let svc: UiTelemetryService;

  beforeEach(() => {
    svc = new UiTelemetryService();
  });

  it('reset clears canonical dedup, timing, and tool state', () => {
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a1', durationMs: 1000 }));
    svc.addEvent(makeToolCallEvent({ callId: 'c1', duration: 200 }));
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a2',
        cacheReads: 500,
      }),
    );

    const before = svc.getSessionSnapshot();
    expect(before.totalApiRequests).toBe(2);
    expect(before.totalToolCalls).toBe(1);

    svc.reset();

    const after = svc.getSessionSnapshot();
    expect(after.totalApiRequests).toBe(0);
    expect(after.totalApiErrors).toBe(0);
    expect(after.totalToolCalls).toBe(0);
    expect(after.agentActiveTimeMs).toBe(0);
    expect(after.completeTokensPerMinute).toBe(0);
    expect(after.totalCacheReads).toBe(0);
    expect(after.hasReliableCacheReads).toBe(false);
    // Models dict must be fully empty after reset
    expect(Object.keys(after.models)).toHaveLength(0);
  });

  it('reset clears dedup so same attempt_id can be re-counted', () => {
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a1' }));
    svc.reset();
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a1' }));
    expect(svc.getSessionSnapshot().totalApiRequests).toBe(1);
  });

  it('reset clears tool dedup so same call_id can be re-counted', () => {
    svc.addEvent(makeToolCallEvent({ callId: 'c1' }));
    svc.reset();
    svc.addEvent(makeToolCallEvent({ callId: 'c1' }));
    expect(svc.getSessionSnapshot().totalToolCalls).toBe(1);
  });

  it('reset clears provider metrics and token tracking', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
      }),
    );

    expect(Object.keys(svc.getMetrics().models)).toHaveLength(1);

    svc.reset();

    expect(Object.keys(svc.getMetrics().models)).toHaveLength(0);
    expect(svc.getMetrics().timing.completeTokensPerMinute).toBe(0);
  });

  it('polling cannot restore old values after reset', () => {
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 1000,
      }),
    );

    const canonicalBeforeReset =
      svc.getMetrics().timing.completeTokensPerMinute;
    expect(canonicalBeforeReset).toBeGreaterThan(0);

    svc.reset();

    // Polling tries to push stale values
    svc.setTokenTrackingMetrics({
      tokensPerMinute: canonicalBeforeReset,
      throttleWaitTimeMs: 0,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      sessionTokenUsage: {
        input: 100,
        output: 50,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 150,
      },
    });

    // Canonical TPM from aggregator must still be 0 after reset
    expect(svc.getMetrics().timing.completeTokensPerMinute).toBe(0);
    expect(svc.getSessionSnapshot().totalApiRequests).toBe(0);
  });
});

describe('Canonical consumer behavior: provider switch preserves session', () => {
  it('switching models preserves whole-session totals', () => {
    const svc = new UiTelemetryService();

    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        model: 'gpt-4',
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 1000,
      }),
    );
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a2',
        model: 'claude-3',
        inputTokens: 200,
        outputTokens: 100,
        durationMs: 2000,
      }),
    );

    const snap = svc.getSessionSnapshot();
    // Whole-session totals preserved
    expect(snap.totalApiRequests).toBe(2);
    expect(snap.totalInputTokens).toBe(300);
    // Per-model breakdowns split correctly
    expect(Object.keys(snap.models)).toHaveLength(2);
    expect(snap.models['gpt-4'].totalInputTokens).toBe(100);
    expect(snap.models['claude-3'].totalInputTokens).toBe(200);
    // Per-model sums reconcile with session totals
    const modelSum =
      snap.models['gpt-4'].totalInputTokens +
      snap.models['claude-3'].totalInputTokens;
    expect(modelSum).toBe(snap.totalInputTokens);
  });
});

describe('Canonical consumer behavior: fail-open aggregation', () => {
  it('malformed event does not crash the service', () => {
    const svc = new UiTelemetryService();

    // Event with unknown event.name should be ignored
    svc.addEvent({
      'event.name': 'unknown_event' as never,
    } as never);

    // Service should still work
    const snap = svc.getSessionSnapshot();
    expect(snap.totalApiRequests).toBe(0);
  });

  it('event with NaN duration does not corrupt aggregator', () => {
    const svc = new UiTelemetryService();

    svc.addEvent({
      ...makeApiResponseEvent({ attemptId: 'a1' }),
      duration_ms: Number.NaN,
    });

    const snap = svc.getSessionSnapshot();
    expect(Number.isFinite(snap.accumulatedApiTimeMs)).toBe(true);
    expect(Number.isFinite(snap.completeTokensPerMinute)).toBe(true);
  });

  it('event with Infinity tokens treated as zero', () => {
    const svc = new UiTelemetryService();

    svc.addEvent({
      ...makeApiResponseEvent({ attemptId: 'a1' }),
      input_token_count: Number.POSITIVE_INFINITY,
      output_token_count: Number.NEGATIVE_INFINITY,
    });

    const snap = svc.getSessionSnapshot();
    expect(snap.totalInputTokens).toBe(0);
    expect(snap.totalOutputTokens).toBe(0);
  });

  it('event with negative values clamped to zero', () => {
    const svc = new UiTelemetryService();

    svc.addEvent({
      ...makeApiResponseEvent({ attemptId: 'a1' }),
      input_token_count: -100,
      output_token_count: -50,
      cached_content_token_count: -20,
      duration_ms: -500,
    });

    const snap = svc.getSessionSnapshot();
    expect(snap.totalInputTokens).toBe(0);
    expect(snap.totalOutputTokens).toBe(0);
    expect(snap.totalCachedTokens).toBe(0);
    expect(snap.accumulatedApiTimeMs).toBe(0);
  });
});

describe('Canonical consumer behavior: snapshot immutability', () => {
  it('getSnapshot returns independent object each call', () => {
    const svc = new UiTelemetryService();
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a1' }));

    const snap1 = svc.getSessionSnapshot();
    const snap2 = svc.getSessionSnapshot();

    expect(snap1).not.toBe(snap2);
    expect(snap1.totalApiRequests).toBe(snap2.totalApiRequests);
    expect(snap1.models).not.toBe(snap2.models);
  });

  it('mutating returned snapshot does not affect subsequent reads', () => {
    const svc = new UiTelemetryService();
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a1' }));

    const snap1 = svc.getSessionSnapshot();
    snap1.totalApiRequests = 999;
    (snap1.models as Record<string, unknown>)['fake'] = {};

    const snap2 = svc.getSessionSnapshot();
    expect(snap2.totalApiRequests).toBe(1);
    expect(snap2.models['fake']).toBeUndefined();
  });
});

describe('Canonical consumer behavior: model breakdown reconciliation', () => {
  it('per-model request counts sum to total', () => {
    const svc = new UiTelemetryService();
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a1', model: 'm1' }));
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a2', model: 'm1' }));
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a3', model: 'm2' }));

    const snap = svc.getSessionSnapshot();
    const modelRequestSum =
      snap.models['m1'].totalRequests + snap.models['m2'].totalRequests;
    expect(modelRequestSum).toBe(snap.totalApiRequests);
  });

  it('per-model error counts sum to total errors', () => {
    const svc = new UiTelemetryService();
    svc.addEvent(makeApiResponseEvent({ attemptId: 'a1', model: 'm1' }));
    svc.addEvent(makeApiErrorEvent({ attemptId: 'e1', model: 'm1' }));
    svc.addEvent(makeApiErrorEvent({ attemptId: 'e2', model: 'm2' }));

    const snap = svc.getSessionSnapshot();
    const modelErrorSum =
      snap.models['m1'].totalErrors + snap.models['m2'].totalErrors;
    expect(modelErrorSum).toBe(snap.totalApiErrors);
  });

  it('per-model latency sums reconcile with API time', () => {
    const svc = new UiTelemetryService();
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        model: 'm1',
        durationMs: 1500,
      }),
    );
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a2',
        model: 'm2',
        durationMs: 2500,
      }),
    );

    const snap = svc.getSessionSnapshot();
    const modelLatencySum =
      snap.models['m1'].totalLatencyMs + snap.models['m2'].totalLatencyMs;
    expect(modelLatencySum).toBe(snap.accumulatedApiTimeMs);
  });
});

describe('Canonical consumer behavior: tool totals reconciliation', () => {
  it('tools.totalCalls equals snapshot totalToolCalls', () => {
    const svc = new UiTelemetryService();
    svc.addEvent(makeToolCallEvent({ callId: 'c1', success: true }));
    svc.addEvent(
      makeToolCallEvent({ callId: 'c2', success: false, status: 'error' }),
    );
    svc.addEvent(makeToolCallEvent({ callId: 'c3', status: 'cancelled' }));

    const metrics = svc.getMetrics();
    const snap = svc.getSessionSnapshot();
    expect(metrics.tools.totalCalls).toBe(snap.totalToolCalls);
    expect(metrics.tools.totalSuccess).toBe(snap.totalToolSuccesses);
    expect(metrics.tools.totalFail).toBe(snap.totalToolFailures);
    expect(metrics.tools.totalCancelled).toBe(snap.totalToolCancellations);
  });
});

describe('Canonical consumer behavior: accumulated work and agent active', () => {
  it('accumulated work = API time + tool time', () => {
    const svc = new UiTelemetryService();
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        durationMs: 2000,
      }),
    );
    svc.addEvent(
      makeToolCallEvent({
        callId: 'c1',
        duration: 1000,
      }),
    );

    const snap = svc.getSessionSnapshot();
    expect(snap.accumulatedWorkMs).toBe(3000);
  });

  it('agent active <= accumulated work (overlap counted once)', () => {
    const svc = new UiTelemetryService();
    // API and tool at same time
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        durationMs: 1000,
        startMs: 0,
      }),
    );
    svc.addEvent(
      makeToolCallEvent({
        callId: 'c1',
        duration: 1000,
        startMs: 0,
      }),
    );

    const snap = svc.getSessionSnapshot();
    // Both at [0, 1000) → union = 1000
    expect(snap.agentActiveTimeMs).toBeLessThanOrEqual(snap.accumulatedWorkMs);
    expect(snap.agentActiveTimeMs).toBe(1000);
    // Accumulated work counts both API + tool = 2000
    expect(snap.accumulatedWorkMs).toBe(2000);
  });

  it('API and tool percentages use accumulated work as denominator', () => {
    const svc = new UiTelemetryService();
    svc.addEvent(
      makeApiResponseEvent({
        attemptId: 'a1',
        durationMs: 750,
      }),
    );
    svc.addEvent(
      makeToolCallEvent({
        callId: 'c1',
        duration: 250,
      }),
    );

    const snap = svc.getSessionSnapshot();
    const apiPct = (snap.accumulatedApiTimeMs / snap.accumulatedWorkMs) * 100;
    const toolPct = (snap.totalToolTimeMs / snap.accumulatedWorkMs) * 100;
    expect(apiPct).toBeCloseTo(75, 5);
    expect(toolPct).toBeCloseTo(25, 5);
  });
});
