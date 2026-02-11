/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06a
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import type { ProviderPerformanceMetrics } from '../types.js';
import { DebugLogger } from '../../debug/index.js';

/**
 * Performance tracking utility for provider operations
 */
export class ProviderPerformanceTracker {
  private metrics: ProviderPerformanceMetrics;
  private tokenTimestamps: Array<{
    startTimestamp: number;
    completionTimestamp: number;
    tokenCount: number;
  }>;
  private logger: DebugLogger;

  constructor(private providerName: string) {
    this.metrics = this.initializeMetrics();
    this.tokenTimestamps = [];
    this.logger = new DebugLogger('llxprt:performance:tracker');
  }

  private initializeMetrics(): ProviderPerformanceMetrics {
    return {
      providerName: this.providerName,
      totalRequests: 0,
      totalTokens: 0,
      averageLatency: 0,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      chunksReceived: 0,
      errorRate: 0,
      errors: [],
      sessionTokenUsage: {
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      },
    };
  }

  /**
   * Record a streaming chunk being received
   */
  recordChunk(chunkNumber: number, _contentLength: number): void {
    // Track streaming performance
    this.metrics.chunksReceived = chunkNumber;
  }

  /**
   * Record completion of a request with performance data
   */
  recordCompletion(
    totalTime: number,
    timeToFirstToken: number | null,
    tokenCount: number,
    chunkCount: number,
  ): void {
    this.metrics.totalRequests++;
    this.metrics.totalTokens += tokenCount;
    this.metrics.averageLatency =
      (this.metrics.averageLatency * (this.metrics.totalRequests - 1) +
        totalTime) /
      this.metrics.totalRequests;

    if (timeToFirstToken !== null) {
      this.metrics.timeToFirstToken = timeToFirstToken;
    }

    if (totalTime > 0) {
      this.metrics.tokensPerSecond = tokenCount / (totalTime / 1000);
    }

    this.metrics.chunksReceived = chunkCount;

    const now = Date.now();
    this.tokenTimestamps.push({
      startTimestamp: now - totalTime,
      completionTimestamp: now,
      tokenCount,
    });
    this.calculateTokensPerMinute();
  }

  /**
   * Record an error that occurred during request
   */
  recordError(duration: number, error: string): void {
    this.metrics.errors.push({
      timestamp: Date.now(),
      duration,
      error: error.substring(0, 200), // Truncate long errors
    });

    // Update error rate
    const totalAttempts = this.metrics.totalRequests + 1;
    this.metrics.errorRate = this.metrics.errors.length / totalAttempts;
  }

  /**
   * Track throttle wait time from 429 retries
   */
  trackThrottleWaitTime(waitTimeMs: number): void {
    this.metrics.throttleWaitTimeMs += waitTimeMs;
    this.logger.debug(
      () =>
        `Tracked ${waitTimeMs}ms throttle wait. Total: ${this.metrics.throttleWaitTimeMs}ms for ${this.providerName}`,
    );
  }

  /**
   * Get current performance metrics
   */
  getLatestMetrics(): ProviderPerformanceMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset all metrics (useful for long-running sessions)
   */
  reset(): void {
    this.metrics = this.initializeMetrics();
    this.tokenTimestamps = [];
  }

  /**
   * Calculate tokens per minute based on recent token usage
   */
  private calculateTokensPerMinute(): void {
    const now = Date.now();
    this.tokenTimestamps = this.tokenTimestamps.filter(
      (entry) => now - entry.completionTimestamp <= 60000,
    );

    const totalRecentTokens = this.tokenTimestamps.reduce(
      (sum, entry) => sum + entry.tokenCount,
      0,
    );

    if (this.tokenTimestamps.length === 0) {
      this.metrics.tokensPerMinute = 0;
      return;
    }

    const oldestStartTimestamp = Math.min(
      ...this.tokenTimestamps.map((entry) => entry.startTimestamp),
    );
    let timeSpanInMinutes = (now - oldestStartTimestamp) / 60000;

    if (timeSpanInMinutes <= 0) {
      timeSpanInMinutes = 0.001;
    }

    if (
      timeSpanInMinutes > 0 &&
      !isNaN(totalRecentTokens) &&
      isFinite(totalRecentTokens / timeSpanInMinutes)
    ) {
      this.metrics.tokensPerMinute = totalRecentTokens / timeSpanInMinutes;
    } else {
      this.metrics.tokensPerMinute = 0;
    }
  }

  /**
   * Add throttle wait time to metrics
   */
  addThrottleWaitTime(waitTimeMs: number): void {
    // Only add positive wait times
    if (waitTimeMs > 0) {
      this.metrics.throttleWaitTimeMs += waitTimeMs;
    }
  }

  /**
   * Get performance summary as human-readable string
   */
  getPerformanceSummary(): string {
    const metrics = this.metrics;
    return (
      `Provider: ${metrics.providerName}, ` +
      `Requests: ${metrics.totalRequests}, ` +
      `Avg Latency: ${metrics.averageLatency.toFixed(2)}ms, ` +
      `Tokens/sec: ${metrics.tokensPerSecond.toFixed(2)}, ` +
      `Error Rate: ${(metrics.errorRate * 100).toFixed(1)}%`
    );
  }
}
