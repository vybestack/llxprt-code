/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06a
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import type { ProviderPerformanceMetrics } from '../types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

/** Clamp to non-negative finite; NaN/Infinity/-negative become 0. */
function sanitizeNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** Returns value if it is a non-negative finite number, otherwise null. */
function toSafePositiveMs(value: number | null | undefined): number | null {
  if (
    value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value >= 0
  ) {
    return value;
  }
  return null;
}

/**
 * Performance tracking utility for provider operations
 */
export class ProviderPerformanceTracker {
  private metrics: ProviderPerformanceMetrics;
  private totalGenerationTimeMs = 0;
  private totalTokensWithMeasuredTime = 0;
  // Complete session TPM accumulators (duration-based, not wall-time)
  private completeTpmSumTokens = 0;
  private completeTpmSumDuration = 0;
  private logger: DebugLogger;

  constructor(private providerName: string) {
    this.metrics = this.initializeMetrics();
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
   * Record completion of a request with performance data.
   *
   * Generation TPS uses output tokens only (not prompt-plus-output), so
   * large prompts don't inflate tokens-per-second. TPM uses total tokens
   * (input + output) for session work-rate.
   *
   * Finding #7: Generation TPS is only valid when
   * `lastTokenMs - timeToFirstToken > 0`. When there is no meaningful
   * generation window (single chunk or no tokens), TPS is left unchanged.
   * There is NO fallback to total duration.
   */
  recordCompletion(
    totalTime: number,
    timeToFirstToken: number | null,
    totalTokenCount: number,
    outputTokenCount: number,
    chunkCount: number,
    lastTokenMs?: number | null,
  ): void {
    const safeTotalTime = sanitizeNonNegative(totalTime);
    const safeTotalTokenCount = sanitizeNonNegative(totalTokenCount);
    const safeOutputTokenCount = sanitizeNonNegative(outputTokenCount);
    const safeChunkCount = sanitizeNonNegative(chunkCount);
    this.metrics.totalRequests++;
    this.metrics.totalTokens += safeTotalTokenCount;
    this.metrics.averageLatency =
      (this.metrics.averageLatency * (this.metrics.totalRequests - 1) +
        safeTotalTime) /
      this.metrics.totalRequests;

    const safeTtft = toSafePositiveMs(timeToFirstToken);
    if (safeTtft !== null) {
      this.metrics.timeToFirstToken = safeTtft;
    }

    // Finding #7: Generation TPS only uses lastTokenMs - TTFT as the
    // generation window. No duration fallback. Only accumulate when the
    // generation window is strictly positive. Uses OUTPUT tokens only.
    const safeLastToken = toSafePositiveMs(lastTokenMs);

    if (safeTtft !== null && safeLastToken !== null) {
      const generationMs = safeLastToken - safeTtft;
      if (generationMs > 0) {
        this.totalGenerationTimeMs += generationMs;
        this.totalTokensWithMeasuredTime += safeOutputTokenCount;
        this.metrics.tokensPerSecond =
          this.totalGenerationTimeMs > 0
            ? this.totalTokensWithMeasuredTime /
              (this.totalGenerationTimeMs / 1000)
            : 0;
      }
    }

    this.metrics.chunksReceived = safeChunkCount;

    // Complete TPM = 60000 * Σ(P+O) / ΣD (D in ms)
    // Uses total tokens (input + output) and summed durations, not wall-clock
    this.completeTpmSumTokens += safeTotalTokenCount;
    this.completeTpmSumDuration += safeTotalTime;
    this.metrics.tokensPerMinute =
      this.completeTpmSumDuration > 0
        ? (60000 * this.completeTpmSumTokens) / this.completeTpmSumDuration
        : 0;
  }

  /**
   * Record an error that occurred during request
   */
  recordError(
    duration: number,
    error: string,
    timeToFirstToken?: number | null,
    chunkCount?: number,
  ): void {
    const safeDuration = sanitizeNonNegative(duration);

    if (
      timeToFirstToken !== undefined &&
      timeToFirstToken !== null &&
      Number.isFinite(timeToFirstToken) &&
      timeToFirstToken > 0
    ) {
      this.metrics.timeToFirstToken = timeToFirstToken;
    }

    if (chunkCount !== undefined) {
      this.metrics.chunksReceived = sanitizeNonNegative(chunkCount);
    }

    this.metrics.errors.push({
      timestamp: Date.now(),
      duration: safeDuration,
      error: error.substring(0, 200), // Truncate long errors
    });

    // Update error rate — clamp to [0, 1].
    // Denominator is total attempts (successes + errors), not just
    // successes + 1, so multiple errors produce correct ratios.
    const totalAttempts =
      this.metrics.totalRequests + this.metrics.errors.length;
    this.metrics.errorRate = Math.min(
      1,
      totalAttempts > 0 ? this.metrics.errors.length / totalAttempts : 0,
    );
  }

  /**
   * Track throttle wait time from 429 retries
   */
  trackThrottleWaitTime(waitTimeMs: number): void {
    const safeWait = sanitizeNonNegative(waitTimeMs);
    this.metrics.throttleWaitTimeMs += safeWait;
    this.logger.debug(
      () =>
        `Tracked ${safeWait}ms throttle wait. Total: ${this.metrics.throttleWaitTimeMs}ms for ${this.providerName}`,
    );
  }

  /**
   * Get current performance metrics
   */
  getLatestMetrics(): ProviderPerformanceMetrics {
    return {
      ...this.metrics,
      averageLatency: sanitizeNonNegative(this.metrics.averageLatency),
      tokensPerSecond: sanitizeNonNegative(this.metrics.tokensPerSecond),
      tokensPerMinute: sanitizeNonNegative(this.metrics.tokensPerMinute),
      errorRate: Math.min(1, sanitizeNonNegative(this.metrics.errorRate)),
      throttleWaitTimeMs: sanitizeNonNegative(this.metrics.throttleWaitTimeMs),
    };
  }

  /**
   * Reset all metrics (useful for long-running sessions)
   */
  reset(): void {
    this.metrics = this.initializeMetrics();
    this.totalGenerationTimeMs = 0;
    this.totalTokensWithMeasuredTime = 0;
    this.completeTpmSumTokens = 0;
    this.completeTpmSumDuration = 0;
  }

  /**
   * Add throttle wait time to metrics
   */
  addThrottleWaitTime(waitTimeMs: number): void {
    const safeWait = sanitizeNonNegative(waitTimeMs);
    if (safeWait > 0) {
      this.metrics.throttleWaitTimeMs += safeWait;
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
