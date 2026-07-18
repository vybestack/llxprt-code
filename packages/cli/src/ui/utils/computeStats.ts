/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SessionMetrics,
  ComputedSessionStats,
  ModelMetrics,
} from '../contexts/SessionContext.js';

export function calculateErrorRate(metrics: ModelMetrics): number {
  if (metrics.api.totalRequests === 0) {
    return 0;
  }
  return (metrics.api.totalErrors / metrics.api.totalRequests) * 100;
}

export function calculateAverageLatency(metrics: ModelMetrics): number {
  if (metrics.api.totalRequests === 0) {
    return 0;
  }
  return metrics.api.totalLatencyMs / metrics.api.totalRequests;
}

/**
 * Computes the cached-token ratio: the percentage of prompt tokens that
 * were served from cache. This is a TOKEN ratio (cached/prompt), not a
 * request hit rate.
 *
 * The result is always a finite value in [0, 100]:
 * - Returns 0 when prompt tokens is 0 or invalid.
 * - Clamps negative cached tokens to 0.
 * - Clamps the ratio to a maximum of 100 (cached > prompt yields 100).
 */
export function calculateCachedTokenRatio(metrics: ModelMetrics): number {
  return computeCachedTokenRatio(metrics.tokens.cached, metrics.tokens.prompt);
}

/**
 * Centralized cached-token ratio helper. Returns a finite nonnegative
 * percentage in [0, 100]. NaN/Infinity/negative inputs are treated as 0.
 * Used by both CacheStatsDisplay and ModelStatsDisplay.
 */
export function computeCachedTokenRatio(
  cachedTokens: number,
  promptTokens: number,
): number {
  if (!Number.isFinite(cachedTokens) || !Number.isFinite(promptTokens)) {
    return 0;
  }
  if (promptTokens <= 0) {
    return 0;
  }
  const clampedCached = Math.max(0, cachedTokens);
  const ratio = (clampedCached / promptTokens) * 100;
  return Math.min(100, Math.max(0, ratio));
}

export const computeSessionStats = (
  metrics: SessionMetrics,
): ComputedSessionStats => {
  const { models, tools, files, timing } = metrics;

  const totalApiTime = timing.accumulatedApiTimeMs;
  const totalToolTime = timing.accumulatedToolTimeMs;
  const accumulatedWork = timing.accumulatedWorkMs;
  const agentActiveTime = timing.agentActiveTimeMs;
  // Percentages are relative to accumulated work (API + Tool), which is
  // the denominator that makes the parts sum to 100%.
  const apiTimePercent =
    accumulatedWork > 0 ? (totalApiTime / accumulatedWork) * 100 : 0;
  const toolTimePercent =
    accumulatedWork > 0 ? (totalToolTime / accumulatedWork) * 100 : 0;

  const totalCachedTokens = Object.values(models).reduce(
    (acc, model) => acc + model.tokens.cached,
    0,
  );
  const totalInputTokens = Object.values(models).reduce(
    (acc, model) => acc + model.tokens.input,
    0,
  );
  const totalPromptTokens = Object.values(models).reduce(
    (acc, model) => acc + model.tokens.prompt,
    0,
  );
  const cacheEfficiency =
    totalPromptTokens > 0 ? (totalCachedTokens / totalPromptTokens) * 100 : 0;

  const totalDecisions =
    tools.totalDecisions.accept +
    tools.totalDecisions.reject +
    tools.totalDecisions.modify +
    tools.totalDecisions.auto_accept;
  const successRate =
    tools.totalCalls > 0 ? (tools.totalSuccess / tools.totalCalls) * 100 : 0;
  const agreementRate =
    totalDecisions > 0
      ? ((tools.totalDecisions.accept + tools.totalDecisions.auto_accept) /
          totalDecisions) *
        100
      : 0;

  return {
    totalApiTime,
    totalToolTime,
    agentActiveTime,
    apiTimePercent,
    toolTimePercent,
    cacheEfficiency,
    totalDecisions,
    successRate,
    agreementRate,
    totalCachedTokens,
    totalInputTokens,
    totalPromptTokens,
    totalLinesAdded: files.totalLinesAdded,
    totalLinesRemoved: files.totalLinesRemoved,
  };
};
