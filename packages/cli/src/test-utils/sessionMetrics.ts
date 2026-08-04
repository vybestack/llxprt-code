/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A complete, zeroed `SessionMetrics` for tests.
 *
 * `computeSessionStats` reads `timing`, `tokenTracking` and `cache` eagerly, so
 * a partial literal makes components throw during render rather than fail an
 * assertion. Building from this baseline keeps a test's literal focused on the
 * few numbers it actually cares about, and means a new required sub-object is
 * added in one place instead of in every fixture.
 */
import type { SessionMetrics } from '../ui/contexts/SessionContext.js';

export function createSessionMetrics(
  overrides: Partial<SessionMetrics> = {},
): SessionMetrics {
  return {
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
    files: { totalLinesAdded: 0, totalLinesRemoved: 0 },
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
    ...overrides,
  };
}
