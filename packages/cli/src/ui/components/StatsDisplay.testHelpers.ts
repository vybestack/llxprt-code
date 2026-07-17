/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionMetrics } from '../contexts/SessionContext.js';

export const defaultTokenTracking = {
  tokensPerMinute: 0,
  throttleWaitTimeMs: 0,
  timeToFirstToken: null as number | null,
  tokensPerSecond: 0,
  sessionTokenUsage: {
    input: 0,
    output: 0,
    cache: 0,
    tool: 0,
    thought: 0,
    total: 0,
  },
};

export const defaultTiming = {
  completeTokensPerMinute: 0,
  outputGenerationTps: 0,
  effectiveInputTps: 0,
  uncachedInputTps: null as number | null,
  lastRequestTpm: 0,
  accumulatedApiTimeMs: 0,
  accumulatedToolTimeMs: 0,
  agentActiveTimeMs: 0,
  accumulatedWorkMs: 0,
  lastTtftMs: null,
  weightedAvgTtftMs: null,
  lastOutputGenerationTps: 0,
  lastEffectiveInputTps: 0,
};

export const defaultCache = {
  hasReliableCacheData: false,
  hasReliableCacheReads: false,
  hasReliableCacheWrites: false,
  requestsWithCacheReads: 0,
  requestsWithCacheWrites: 0,
  totalCacheReads: 0,
  totalCacheWrites: null as number | null,
};

type TestMetricsInput = {
  models?: SessionMetrics['models'];
  files?: SessionMetrics['files'];
  tokenTracking?: Partial<SessionMetrics['tokenTracking']>;
  timing?: Partial<SessionMetrics['timing']>;
  cache?: Partial<SessionMetrics['cache']>;
  tools?: Partial<Omit<SessionMetrics['tools'], 'totalDecisions'>> & {
    totalDecisions?: SessionMetrics['tools']['totalDecisions'];
  };
};

export type { TestMetricsInput };

export const withTokenTracking = (
  partial: TestMetricsInput,
): SessionMetrics => ({
  models: partial.models ?? {},
  tools: {
    totalCalls: partial.tools?.totalCalls ?? 0,
    totalSuccess: partial.tools?.totalSuccess ?? 0,
    totalFail: partial.tools?.totalFail ?? 0,
    totalCancelled: partial.tools?.totalCancelled ?? 0,
    totalDurationMs: partial.tools?.totalDurationMs ?? 0,
    totalDecisions: partial.tools?.totalDecisions ?? {
      accept: 0,
      reject: 0,
      modify: 0,
      auto_accept: 0,
    },
    byName: partial.tools?.byName ?? {},
  },
  files: partial.files ?? { totalLinesAdded: 0, totalLinesRemoved: 0 },
  tokenTracking: { ...defaultTokenTracking, ...partial.tokenTracking },
  timing: { ...defaultTiming, ...partial.timing },
  cache: { ...defaultCache, ...partial.cache },
});

export const defaultZeroMetrics: SessionMetrics = {
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
  tokenTracking: { ...defaultTokenTracking },
  timing: { ...defaultTiming },
  cache: { ...defaultCache },
};
