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

export function calculateCacheHitRate(metrics: ModelMetrics): number {
  if (metrics.tokens.prompt === 0) {
    return 0;
  }
  return (metrics.tokens.cached / metrics.tokens.prompt) * 100;
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
