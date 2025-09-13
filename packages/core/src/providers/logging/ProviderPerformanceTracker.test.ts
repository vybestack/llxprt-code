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
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Mock Date.now for consistent testing
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
    expect(metrics.tokensPerMinute).toBe(500000);
  });

  it('should accumulate tokens per minute correctly', () => {
    const tracker = new ProviderPerformanceTracker('test-provider');

    // Mock Date.now and add token entries within a minute
    const now = new Date('2025-01-01T00:00:00Z').getTime();
    vi.setSystemTime(now);

    tracker.recordCompletion(500, 100, 200, 5);

    vi.setSystemTime(now + 30000); // 30 seconds later
    tracker.recordCompletion(600, 120, 300, 8);

    const metrics = tracker.getLatestMetrics();
    // TPM calculation: (200+300 tokens) / (30 seconds = 0.5 minutes) = 1000 tokens/minute
    expect(metrics.tokensPerMinute).toBe(1000);

    // Add entry outside the 60-second window
    vi.setSystemTime(now + 65000); // 65 seconds later
    tracker.recordCompletion(400, 80, 150, 6);

    const updatedMetrics = tracker.getLatestMetrics();
    // After 65 seconds, the first entry (timestamp at 0s, 200 tokens) is filtered out
    // since it's now outside the 60-second window
    // Remaining entries:
    // - 2nd entry: timestamp at 30s, 300 tokens
    // - 3rd entry: timestamp at 65s, 150 tokens
    // Time span: 65s - 30s = 35 seconds = 0.583 minutes
    // Total tokens: 300 + 150 = 450
    // TPM = 450 tokens / 0.583 minutes = 771.43 tokens per minute
    expect(updatedMetrics.tokensPerMinute).toBeCloseTo(771.43, 2);
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
