/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ProviderPerformanceTracker } from './ProviderPerformanceTracker.js';

describe('ProviderPerformanceTracker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('should initialize metrics correctly', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');
    const metrics = tracker.getLatestMetrics();

    expect(metrics.providerName).toBe('test-provider');
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.totalTokens).toBe(0);
    expect(metrics.averageLatency).toBe(0);
    expect(metrics.timeToFirstToken).toBeNull();
    expect(metrics.tokensPerSecond).toBe(0);
    expect(metrics.tokensPerMinute).toBe(0);
    expect(metrics.throttleWaitTimeMs).toBe(0);
    expect(metrics.chunksReceived).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.errors).toStrictEqual([]);
    expect(metrics.sessionTokenUsage).toStrictEqual({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    });
  });

  it('should record completion metrics correctly', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Finding #7: TPS requires lastTokenMs. TTFT=200, lastToken=1200 → gen=1000ms
    // 250 output tokens / 1000ms = 250 tok/s (TPS uses output only)
    tracker.recordCompletion(1000, 200, 500, 250, 10, 1200);

    const metrics = tracker.getLatestMetrics();

    expect(metrics.totalRequests).toBe(1);
    expect(metrics.totalTokens).toBe(500);
    expect(metrics.averageLatency).toBe(1000);
    expect(metrics.timeToFirstToken).toBe(200);
    expect(metrics.tokensPerSecond).toBe(250);
    expect(metrics.chunksReceived).toBe(10);
    // TPM = 60000 * Σ(P+O) / ΣD = 60000 * 500 / 1000 = 30000
    expect(metrics.tokensPerMinute).toBe(30000);
  });

  it('should accumulate TPM as 60000 * Σ(tokens) / Σ(duration) - independent of wall-clock gaps', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Request 1: 200 tokens in 500ms
    tracker.recordCompletion(500, 100, 200, 100, 5);
    // Request 2: 300 tokens in 600ms
    // TPM = 60000 * (200+300) / (500+600) = 60000 * 500 / 1100 = 27272.7...
    tracker.recordCompletion(600, 120, 300, 150, 8);
    const metrics = tracker.getLatestMetrics();
    expect(metrics.tokensPerMinute).toBeCloseTo(27272.7, 0);

    // Request 3: 150 tokens in 400ms
    // TPM = 60000 * (500+150) / (1100+400) = 60000 * 650 / 1500 = 26000
    tracker.recordCompletion(400, 80, 150, 75, 6);
    const updatedMetrics = tracker.getLatestMetrics();
    expect(updatedMetrics.tokensPerMinute).toBeCloseTo(26000, 0);
  });

  it('should compute TPM as 60000*Σ(P+O)/ΣD independent of wall-clock gaps between requests', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Two requests with same token counts and durations
    tracker.recordCompletion(5000, null, 1000, 500, 10);
    tracker.recordCompletion(5000, null, 1000, 500, 10);

    // TPM = 60000 * 2000 / 10000 = 12000
    const metrics = tracker.getLatestMetrics();
    expect(metrics.tokensPerMinute).toBe(12000);

    // Adding a huge wall-clock gap between requests should NOT change TPM
    // because TPM is based on summed durations, not wall span.
    tracker.recordCompletion(5000, null, 1000, 500, 10);
    // TPM = 60000 * 3000 / 15000 = 12000
    const metricsAfterGap = tracker.getLatestMetrics();
    expect(metricsAfterGap.tokensPerMinute).toBe(12000);
  });

  it('should produce accurate TPM for long-running request', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    tracker.recordCompletion(60000, null, 10000, 5000, 100);

    const metrics = tracker.getLatestMetrics();
    // TPM = 60000 * 10000 / 60000 = 10000
    expect(metrics.tokensPerMinute).toBe(10000);
  });

  it('should record error metrics correctly', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Mock Date.now for consistent testing
    const mockDate = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(mockDate);

    tracker.recordError(500, 'Test error');

    const metrics = tracker.getLatestMetrics();

    expect(metrics.errors).toHaveLength(1);
    expect(metrics.errors[0].timestamp).toBe(mockDate);
    expect(metrics.errors[0].duration).toBe(500);
    expect(metrics.errors[0].error).toBe('Test error');
    expect(metrics.errorRate).toBe(1); // 1 error / 1 attempt
  });

  it('should calculate error rate correctly with multiple requests', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Mock Date.now for consistent testing
    const mockDate = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(mockDate);

    // Record successful completion first
    tracker.recordCompletion(1000, 200, 500, 250, 10, 1200);

    // Record an error
    tracker.recordError(500, 'Test error');

    const metrics = tracker.getLatestMetrics();
    expect(metrics.errorRate).toBe(0.5); // 1 error / 2 attempts
  });

  it('should calculate error rate correctly with multiple errors', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    tracker.recordCompletion(1000, 200, 500, 250, 10, 1200);
    tracker.recordError(500, 'Error 1');
    tracker.recordError(300, 'Error 2');

    const metrics = tracker.getLatestMetrics();
    // 2 errors / (1 success + 2 errors) = 2/3 ≈ 0.667
    expect(metrics.errorRate).toBeCloseTo(2 / 3, 2);
  });

  it('should retain partial TTFT and chunk metadata when recording stream errors', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    tracker.recordError(750, 'Stream interrupted', 180, 4);

    const metrics = tracker.getLatestMetrics();
    expect(metrics.timeToFirstToken).toBe(180);
    expect(metrics.chunksReceived).toBe(4);
    expect(metrics.errors).toHaveLength(1);
    expect(metrics.errorRate).toBe(1);
  });

  it('should add throttle wait time correctly', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    tracker.addThrottleWaitTime(1000);
    tracker.addThrottleWaitTime(500);

    const metrics = tracker.getLatestMetrics();
    expect(metrics.throttleWaitTimeMs).toBe(1500);
  });

  it('should reset metrics correctly', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Mock Date.now for consistent testing
    const mockDate = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(mockDate);

    // Record some metrics
    tracker.recordCompletion(1000, 200, 500, 250, 10, 1200);
    tracker.recordError(500, 'Test error');
    tracker.addThrottleWaitTime(1000);

    // Verify metrics are not empty
    const preResetMetrics = tracker.getLatestMetrics();
    expect(preResetMetrics.totalRequests).toBe(1);
    expect(preResetMetrics.errors).toHaveLength(1);
    expect(preResetMetrics.throttleWaitTimeMs).toBe(1000);

    // Reset metrics
    tracker.reset();

    // Verify metrics are back to initial state
    const postResetMetrics = tracker.getLatestMetrics();
    expect(postResetMetrics.totalRequests).toBe(0);
    expect(postResetMetrics.errors).toHaveLength(0);
    expect(postResetMetrics.throttleWaitTimeMs).toBe(0);
    expect(postResetMetrics.tokensPerMinute).toBe(0);
  });

  it('should generate performance summary correctly', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Mock Date.now for consistent testing
    const mockDate = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(mockDate);

    // Record some metrics
    tracker.recordCompletion(1000, 200, 500, 250, 10, 1200);
    tracker.recordError(500, 'Test error');

    const summary = tracker.getPerformanceSummary();
    expect(summary).toBe(
      'Provider: test-provider, Requests: 1, Avg Latency: 1000.00ms, Tokens/sec: 250.00, Error Rate: 50.0%',
    );
  });

  describe('Issue #1805: TPM numerator uses total tokens (input + output)', () => {
    it('should accumulate totalTokens as input + output for each completion', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z').getTime());

      // Simulate: 100 input + 50 output = 150 total tokens
      tracker.recordCompletion(1000, null, 150, 50, 1);
      expect(tracker.getLatestMetrics().totalTokens).toBe(150);

      // Simulate: 200 input + 100 output = 300 total tokens
      tracker.recordCompletion(1000, null, 300, 100, 1);
      expect(tracker.getLatestMetrics().totalTokens).toBe(450);
    });

    it('should compute TPM from total tokens (input+output), not just output tokens', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      vi.useFakeTimers();
      const now = new Date('2025-01-01T00:00:00Z').getTime();
      vi.setSystemTime(now);

      // 150 total tokens (input+output), not 50 output-only
      tracker.recordCompletion(1000, null, 150, 50, 1);
      const metrics = tracker.getLatestMetrics();
      expect(metrics.totalTokens).toBe(150);
      expect(metrics.tokensPerMinute).toBeGreaterThan(0);
    });
  });

  describe('Issue #1805: TTFT (timeToFirstToken) tracking', () => {
    it('should store timeToFirstToken when provided', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      tracker.recordCompletion(1000, 250, 100, 50, 3);
      expect(tracker.getLatestMetrics().timeToFirstToken).toBe(250);
    });

    it('should keep timeToFirstToken as null when not provided', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      tracker.recordCompletion(1000, null, 100, 50, 3);
      expect(tracker.getLatestMetrics().timeToFirstToken).toBeNull();
    });

    it('should update TTFT only when non-null', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      tracker.recordCompletion(1000, null, 100, 50, 1);
      expect(tracker.getLatestMetrics().timeToFirstToken).toBeNull();

      tracker.recordCompletion(1000, 300, 100, 50, 1);
      expect(tracker.getLatestMetrics().timeToFirstToken).toBe(300);
    });
  });

  describe('Issue #1805: chunkCount tracking', () => {
    it('should track chunkCount from recordCompletion', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      tracker.recordCompletion(1000, null, 100, 50, 42);
      expect(tracker.getLatestMetrics().chunksReceived).toBe(42);
    });

    it('should reflect last chunkCount when multiple completions recorded', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      tracker.recordCompletion(500, null, 50, 25, 5);
      tracker.recordCompletion(600, null, 60, 30, 10);
      // chunksReceived is set to the last value, not accumulated
      expect(tracker.getLatestMetrics().chunksReceived).toBe(10);
    });
  });

  describe('Issue #1805: tokensPerSecond cumulative rolling average', () => {
    it('should compute tokensPerSecond as cumulative average across completions', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // First request: TTFT=100ms, lastToken=1100ms → generation=1000ms
      // 100 output tokens / 1000ms = 100 tok/s
      tracker.recordCompletion(1200, 100, 200, 100, 1, 1100);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(100, 1);

      // Second request: TTFT=100ms, lastToken=1100ms → generation=1000ms
      // Cumulative: 300 output tokens / 2000ms = 150 tok/s
      tracker.recordCompletion(1200, 100, 400, 200, 1, 1100);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(150, 1);

      // Third request: TTFT=200ms, lastToken=2200ms → generation=2000ms
      // Cumulative: 600 output tokens / 4000ms = 150 tok/s
      tracker.recordCompletion(2400, 200, 600, 300, 1, 2200);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(150, 1);
    });

    it('should ignore completions with zero generation window for cumulative rate', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // TTFT=100, lastToken=1100 → generation=1000ms → 100 tok/s
      tracker.recordCompletion(1000, 100, 200, 100, 1, 1100);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(100, 1);

      // Zero generation window (lastToken == TTFT) should not change rate
      tracker.recordCompletion(0, 100, 700, 500, 1, 100);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(100, 1);
    });

    it('should reset totalGenerationTimeMs on reset()', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // TTFT=100, lastToken=1100 → generation=1000ms → 100 tok/s
      tracker.recordCompletion(1000, 100, 200, 100, 1, 1100);
      tracker.reset();
      // TTFT=100, lastToken=1100 → generation=1000ms → 200 tok/s
      tracker.recordCompletion(1000, 100, 400, 200, 1, 1100);

      // After reset, tokensPerSecond = 200 / (1000/1000) = 200
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(200, 1);
    });

    it('should not overwrite tokensPerSecond but accumulate generation time', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // TTFT=100, lastToken=600 → generation=500ms → 1000/0.5 = 2000 tok/s
      tracker.recordCompletion(700, 100, 2000, 1000, 1, 600);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(2000, 1);

      // TTFT=100, lastToken=600 → generation=500ms
      // Cumulative: 2000 output tokens / 1000ms = 2000 tok/s
      tracker.recordCompletion(700, 100, 4000, 1000, 1, 600);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(2000, 1);

      // TTFT=200, lastToken=3200 → generation=3000ms
      // Cumulative: 3000 output tokens / 4000ms = 750 tok/s
      tracker.recordCompletion(3400, 200, 5000, 1000, 1, 3200);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(750, 1);
    });

    it('Finding #7: TPS should be 0 when no lastTokenMs provided (no duration fallback)', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // TTFT=200, but no lastTokenMs → no generation window → TPS stays 0
      tracker.recordCompletion(1000, 200, 500, 250, 10);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBe(0);
    });

    it('Finding #7: TPS should be 0 when TTFT is null (no generation window)', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // No TTFT, lastTokenMs=800 → can't compute generation window → TPS stays 0
      tracker.recordCompletion(1000, null, 500, 250, 10, 800);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBe(0);
    });

    it('Finding #7: TPS should be 0 when lastTokenMs <= TTFT', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // TTFT=500, lastToken=500 → generation=0 → no valid window → TPS stays 0
      tracker.recordCompletion(600, 500, 200, 100, 1, 500);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBe(0);
    });
  });
});
