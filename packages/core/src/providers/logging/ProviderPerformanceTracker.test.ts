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
});
