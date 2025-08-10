/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderPerformanceMetrics } from '../types.js';

/**
 * Performance tracking utility for provider operations
 */
export class ProviderPerformanceTracker {
  private metrics: ProviderPerformanceMetrics;

  constructor(private providerName: string) {
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): ProviderPerformanceMetrics {
    return {
      providerName: this.providerName,
      totalRequests: 0,
      totalTokens: 0,
      averageLatency: 0,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      chunksReceived: 0,
      errorRate: 0,
      errors: [],
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
  }

  /**
   * Estimate token count from text content (rough approximation)
   */
  estimateTokenCount(text: string): number {
    // Rough token estimation (actual tokenization would be provider-specific)
    return Math.ceil(text.length / 4); // Approximate tokens per character
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
