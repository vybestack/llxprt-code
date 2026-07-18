/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  calculateAverageLatency,
  calculateCachedTokenRatio,
  calculateErrorRate,
  computeSessionStats,
} from './computeStats.js';
import type {
  ModelMetrics,
  SessionMetrics,
} from '../contexts/SessionContext.js';

describe('calculateErrorRate', () => {
  it('should return 0 if totalRequests is 0', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 0, totalErrors: 0, totalLatencyMs: 0 },
      tokens: {
        input: 0,
        prompt: 0,
        candidates: 0,
        total: 0,
        cached: 0,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateErrorRate(metrics)).toBe(0);
  });

  it('should calculate the error rate correctly', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 10, totalErrors: 2, totalLatencyMs: 0 },
      tokens: {
        input: 0,
        prompt: 0,
        candidates: 0,
        total: 0,
        cached: 0,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateErrorRate(metrics)).toBe(20);
  });
});

describe('calculateAverageLatency', () => {
  it('should return 0 if totalRequests is 0', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 0, totalErrors: 0, totalLatencyMs: 1000 },
      tokens: {
        input: 0,
        prompt: 0,
        candidates: 0,
        total: 0,
        cached: 0,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateAverageLatency(metrics)).toBe(0);
  });

  it('should calculate the average latency correctly', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 10, totalErrors: 0, totalLatencyMs: 1500 },
      tokens: {
        input: 0,
        prompt: 0,
        candidates: 0,
        total: 0,
        cached: 0,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateAverageLatency(metrics)).toBe(150);
  });
});

describe('calculateCachedTokenRatio', () => {
  it('should return 0 if prompt tokens is 0', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 0, totalErrors: 0, totalLatencyMs: 0 },
      tokens: {
        input: 0,
        prompt: 0,
        candidates: 0,
        total: 0,
        cached: 100,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateCachedTokenRatio(metrics)).toBe(0);
  });

  it('should calculate the cached token ratio correctly', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 0, totalErrors: 0, totalLatencyMs: 0 },
      tokens: {
        input: 150,
        prompt: 200,
        candidates: 0,
        total: 0,
        cached: 50,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateCachedTokenRatio(metrics)).toBe(25);
  });

  it('should clamp to 100 when cached exceeds prompt (cached > prompt)', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 0, totalErrors: 0, totalLatencyMs: 0 },
      tokens: {
        input: 1000,
        prompt: 1000,
        candidates: 0,
        total: 0,
        cached: 2000,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateCachedTokenRatio(metrics)).toBe(100);
  });

  it('should clamp to 0 for invalid (NaN/Infinity) token values', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 0, totalErrors: 0, totalLatencyMs: 0 },
      tokens: {
        input: Number.NaN,
        prompt: Number.POSITIVE_INFINITY,
        candidates: 0,
        total: 0,
        cached: Number.NaN,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateCachedTokenRatio(metrics)).toBe(0);
  });

  it('should clamp negative cached tokens to 0', () => {
    const metrics: ModelMetrics = {
      api: { totalRequests: 0, totalErrors: 0, totalLatencyMs: 0 },
      tokens: {
        input: 1000,
        prompt: 1000,
        candidates: 0,
        total: 0,
        cached: -500,
        thoughts: 0,
        tool: 0,
      },
    };
    expect(calculateCachedTokenRatio(metrics)).toBe(0);
  });
});

describe('computeSessionStats', () => {
  const baseMetrics: SessionMetrics = {
    models: {},
    tools: {
      totalCalls: 0,
      totalSuccess: 0,
      totalFail: 0,
      totalCancelled: 0,
      totalDurationMs: 0,
      totalDecisions: { accept: 0, reject: 0, modify: 0, auto_accept: 0 },
      byName: {},
    },
    files: {
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
    tokenTracking: {
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      timeToFirstToken: null,
      tokensPerSecond: 0,
      sessionTokenUsage: {
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      },
    },
    timing: {
      completeTokensPerMinute: 0,
      outputGenerationTps: 0,
      effectiveInputTps: 0,
      uncachedInputTps: null,
      lastRequestTpm: 0,
      accumulatedApiTimeMs: 0,
      accumulatedToolTimeMs: 0,
      agentActiveTimeMs: 0,
      accumulatedWorkMs: 0,
      lastTtftMs: null,
      weightedAvgTtftMs: null,
      lastOutputGenerationTps: 0,
      lastEffectiveInputTps: 0,
    },
    cache: {
      hasReliableCacheData: false,
      hasReliableCacheReads: false,
      hasReliableCacheWrites: false,
      requestsWithCacheReads: 0,
      requestsWithCacheWrites: 0,
      totalCacheReads: 0,
      totalCacheWrites: null,
    },
  };

  it('should return all zeros for initial empty metrics', () => {
    const result = computeSessionStats(baseMetrics);

    expect(result).toStrictEqual({
      totalApiTime: 0,
      totalToolTime: 0,
      agentActiveTime: 0,
      apiTimePercent: 0,
      toolTimePercent: 0,
      cacheEfficiency: 0,
      totalDecisions: 0,
      successRate: 0,
      agreementRate: 0,
      totalPromptTokens: 0,
      totalInputTokens: 0,
      totalCachedTokens: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    });
  });

  it('should correctly calculate API and tool time percentages', () => {
    const metrics: SessionMetrics = {
      ...baseMetrics,
      timing: {
        ...baseMetrics.timing,
        accumulatedApiTimeMs: 750,
        accumulatedToolTimeMs: 250,
        agentActiveTimeMs: 1000,
        accumulatedWorkMs: 1000,
      },
      models: {
        'gemini-pro': {
          api: { totalRequests: 1, totalErrors: 0, totalLatencyMs: 750 },
          tokens: {
            input: 10,
            prompt: 10,
            candidates: 10,
            total: 20,
            cached: 0,
            thoughts: 0,
            tool: 0,
          },
        },
      },
      tools: {
        ...baseMetrics.tools,
        totalCalls: 1,
        totalSuccess: 1,
        totalDurationMs: 250,
      },
    };

    const result = computeSessionStats(metrics);

    expect(result.totalApiTime).toBe(750);
    expect(result.totalToolTime).toBe(250);
    expect(result.agentActiveTime).toBe(1000);
    expect(result.apiTimePercent).toBe(75);
    expect(result.toolTimePercent).toBe(25);
  });

  it('should correctly calculate cache efficiency', () => {
    const metrics: SessionMetrics = {
      ...baseMetrics,
      models: {
        'gemini-pro': {
          api: { totalRequests: 2, totalErrors: 0, totalLatencyMs: 1000 },
          tokens: {
            input: 100,
            prompt: 150,
            candidates: 10,
            total: 160,
            cached: 50,
            thoughts: 0,
            tool: 0,
          },
        },
      },
    };

    const result = computeSessionStats(metrics);

    expect(result.cacheEfficiency).toBeCloseTo(33.33); // 50 / 150
  });

  it('should correctly calculate success and agreement rates', () => {
    const metrics: SessionMetrics = {
      ...baseMetrics,
      tools: {
        ...baseMetrics.tools,
        totalCalls: 10,
        totalSuccess: 8,
        totalFail: 2,
        totalDurationMs: 1000,
        totalDecisions: { accept: 6, reject: 2, modify: 2, auto_accept: 0 },
      },
    };

    const result = computeSessionStats(metrics);

    expect(result.successRate).toBe(80); // 8 / 10
    expect(result.agreementRate).toBe(60); // 6 / 10
  });

  it('should include auto_accept in agreement rate', () => {
    const metrics: SessionMetrics = {
      ...baseMetrics,
      tools: {
        ...baseMetrics.tools,
        totalCalls: 4,
        totalSuccess: 4,
        totalDurationMs: 1000,
        totalDecisions: { accept: 1, reject: 1, modify: 0, auto_accept: 2 },
      },
    };

    const result = computeSessionStats(metrics);

    // (accept + auto_accept) / total = (1 + 2) / 4 = 75%
    expect(result.agreementRate).toBe(75);
    expect(result.totalDecisions).toBe(4);
  });

  it('should handle division by zero gracefully', () => {
    const result = computeSessionStats(baseMetrics);

    expect(result.apiTimePercent).toBe(0);
    expect(result.toolTimePercent).toBe(0);
    expect(result.cacheEfficiency).toBe(0);
    expect(result.successRate).toBe(0);
    expect(result.agreementRate).toBe(0);
  });

  it('should correctly include line counts', () => {
    const metrics: SessionMetrics = {
      ...baseMetrics,
      files: {
        totalLinesAdded: 42,
        totalLinesRemoved: 18,
      },
    };

    const result = computeSessionStats(metrics);

    expect(result.totalLinesAdded).toBe(42);
    expect(result.totalLinesRemoved).toBe(18);
  });
});
