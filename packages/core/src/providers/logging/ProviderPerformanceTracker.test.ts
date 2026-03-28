/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { ProviderPerformanceTracker } from './ProviderPerformanceTracker.js';

describe('ProviderPerformanceTracker', () => {
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
    expect(metrics.errors).toEqual([]);
    expect(metrics.sessionTokenUsage).toEqual({
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    });
  });

  it('should record completion metrics correctly', () => {
    vi.useFakeTimers();
    const tracker = new ProviderPerformanceTracker('test-provider');

    const mockDate = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(mockDate);

    tracker.recordCompletion(1000, 200, 500, 10);

    const metrics = tracker.getLatestMetrics();

    expect(metrics.totalRequests).toBe(1);
    expect(metrics.totalTokens).toBe(500);
    expect(metrics.averageLatency).toBe(1000);
    expect(metrics.timeToFirstToken).toBe(200);
    expect(metrics.tokensPerSecond).toBe(500);
    expect(metrics.chunksReceived).toBe(10);
    expect(metrics.tokensPerMinute).toBe(30000);

    vi.useRealTimers();
  });

  it('should accumulate tokens per minute correctly', () => {
    vi.useFakeTimers();
    const tracker = new ProviderPerformanceTracker('test-provider');

    const now = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);

    tracker.recordCompletion(500, 100, 200, 5);

    vi.setSystemTime(now + 30000);
    tracker.recordCompletion(600, 120, 300, 8);

    const metrics = tracker.getLatestMetrics();
    expect(metrics.tokensPerMinute).toBeCloseTo(983.61, 1);

    vi.setSystemTime(now + 65000);
    tracker.recordCompletion(400, 80, 150, 6);

    const updatedMetrics = tracker.getLatestMetrics();
    expect(updatedMetrics.tokensPerMinute).toBeCloseTo(758.43, 1);

    vi.useRealTimers();
  });

  it('should not produce inflated TPM when requests complete close together after long delays', () => {
    vi.useFakeTimers();
    const tracker = new ProviderPerformanceTracker('test-provider');

    const now = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);

    tracker.recordCompletion(90000, null, 10000, 50);

    vi.setSystemTime(now + 2000);
    tracker.recordCompletion(90000, null, 10000, 50);

    const metrics = tracker.getLatestMetrics();
    expect(metrics.tokensPerMinute).toBeLessThan(20000);
    expect(metrics.tokensPerMinute).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('should produce accurate TPM for long-running request', () => {
    vi.useFakeTimers();
    const tracker = new ProviderPerformanceTracker('test-provider');

    const now = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);

    tracker.recordCompletion(60000, null, 10000, 100);

    const metrics = tracker.getLatestMetrics();
    expect(metrics.tokensPerMinute).toBe(10000);

    vi.useRealTimers();
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
    tracker.recordCompletion(1000, 200, 500, 10);

    // Record an error
    tracker.recordError(500, 'Test error');

    const metrics = tracker.getLatestMetrics();
    expect(metrics.errorRate).toBe(0.5); // 1 error / 2 attempts
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
    tracker.recordCompletion(1000, 200, 500, 10);
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
    tracker.recordCompletion(1000, 200, 500, 10);
    tracker.recordError(500, 'Test error');

    const summary = tracker.getPerformanceSummary();
    expect(summary).toBe(
      'Provider: test-provider, Requests: 1, Avg Latency: 1000.00ms, Tokens/sec: 500.00, Error Rate: 50.0%',
    );
  });

  describe('Issue #1805: TPM numerator uses total tokens (input + output)', () => {
    it('should accumulate totalTokens as input + output for each completion', () => {
      vi.useRealTimers();
      const tracker = new ProviderPerformanceTracker('test-provider');
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00Z').getTime());

      // Simulate: 100 input + 50 output = 150 total tokens
      tracker.recordCompletion(1000, null, 150, 1);
      expect(tracker.getLatestMetrics().totalTokens).toBe(150);

      // Simulate: 200 input + 100 output = 300 total tokens
      tracker.recordCompletion(1000, null, 300, 1);
      expect(tracker.getLatestMetrics().totalTokens).toBe(450);

      vi.useRealTimers();
    });

    it('should compute TPM from total tokens (input+output), not just output tokens', () => {
      vi.useRealTimers();
      const tracker = new ProviderPerformanceTracker('test-provider');
      vi.useFakeTimers();
      const now = new Date('2025-01-01T00:00:00Z').getTime();
      vi.setSystemTime(now);

      // 150 total tokens (input+output), not 50 output-only
      tracker.recordCompletion(1000, null, 150, 1);
      const metrics = tracker.getLatestMetrics();
      expect(metrics.totalTokens).toBe(150);
      expect(metrics.tokensPerMinute).toBeGreaterThan(0);

      vi.useRealTimers();
    });
  });

  describe('Issue #1805: TTFT (timeToFirstToken) tracking', () => {
    it('should store timeToFirstToken when provided', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      tracker.recordCompletion(1000, 250, 100, 3);
      expect(tracker.getLatestMetrics().timeToFirstToken).toBe(250);
    });

    it('should keep timeToFirstToken as null when not provided', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      tracker.recordCompletion(1000, null, 100, 3);
      expect(tracker.getLatestMetrics().timeToFirstToken).toBeNull();
    });

    it('should update TTFT only when non-null', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      tracker.recordCompletion(1000, null, 100, 1);
      expect(tracker.getLatestMetrics().timeToFirstToken).toBeNull();

      tracker.recordCompletion(1000, 300, 100, 1);
      expect(tracker.getLatestMetrics().timeToFirstToken).toBe(300);
    });
  });

  describe('Issue #1805: chunkCount tracking', () => {
    it('should track chunkCount from recordCompletion', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      tracker.recordCompletion(1000, null, 100, 42);
      expect(tracker.getLatestMetrics().chunksReceived).toBe(42);
    });

    it('should reflect last chunkCount when multiple completions recorded', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');
      tracker.recordCompletion(500, null, 50, 5);
      tracker.recordCompletion(600, null, 60, 10);
      // chunksReceived is set to the last value, not accumulated
      expect(tracker.getLatestMetrics().chunksReceived).toBe(10);
    });
  });

  describe('Issue #1805: tokensPerSecond cumulative rolling average', () => {
    it('should compute tokensPerSecond as cumulative average across completions', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // First request: 100 tokens in 1000ms = 100 tok/s
      tracker.recordCompletion(1000, null, 100, 1);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(100, 1);

      // Second request: 200 tokens in 1000ms
      // Cumulative: 300 tokens / 2000ms = 150 tok/s
      tracker.recordCompletion(1000, null, 200, 1);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(150, 1);

      // Third request: 300 tokens in 2000ms
      // Cumulative: 600 tokens / 4000ms = 150 tok/s
      tracker.recordCompletion(2000, null, 300, 1);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(150, 1);
    });

    it('should ignore token-only completions with zero elapsed time for cumulative rate', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      tracker.recordCompletion(1000, null, 100, 1);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(100, 1);

      // Zero-time completion should not change the cumulative measured rate
      tracker.recordCompletion(0, null, 500, 1);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(100, 1);
    });

    it('should reset totalGenerationTimeMs on reset()', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      tracker.recordCompletion(1000, null, 100, 1);
      tracker.reset();
      tracker.recordCompletion(1000, null, 200, 1);

      // After reset, tokensPerSecond = 200/1 = 200 (not (200+100)/2)
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(200, 1);
    });

    it('should not overwrite tokensPerSecond but accumulate generation time', () => {
      const tracker = new ProviderPerformanceTracker('test-provider');

      // First: 1000 tokens in 500ms = 2000 tok/s
      tracker.recordCompletion(500, null, 1000, 1);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(2000, 1);

      // Second: 1000 tokens in 500ms, cumulative: 2000 tokens / 1000ms = 2000 tok/s
      tracker.recordCompletion(500, null, 1000, 1);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(2000, 1);

      // Third: 1000 tokens in 3000ms, cumulative: 3000 tokens / 4000ms = 750 tok/s
      tracker.recordCompletion(3000, null, 1000, 1);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBeCloseTo(750, 1);
    });
  });
});
