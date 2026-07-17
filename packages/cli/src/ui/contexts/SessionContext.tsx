/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useMemo,
  useEffect,
} from 'react';

import type {
  SessionMetrics,
  ModelMetrics,
  ToolCallStats,
} from '@vybestack/llxprt-code-telemetry';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';

export enum ToolCallDecision {
  ACCEPT = 'accept',
  REJECT = 'reject',
  MODIFY = 'modify',
  AUTO_ACCEPT = 'auto_accept',
}

function areModelMetricsEqual(a: ModelMetrics, b: ModelMetrics): boolean {
  if (
    a.api.totalRequests !== b.api.totalRequests ||
    a.api.totalErrors !== b.api.totalErrors ||
    a.api.totalLatencyMs !== b.api.totalLatencyMs
  ) {
    return false;
  }
  const inputTokensChanged =
    a.tokens.input !== b.tokens.input ||
    a.tokens.prompt !== b.tokens.prompt ||
    a.tokens.candidates !== b.tokens.candidates;
  const outputTokensChanged =
    a.tokens.total !== b.tokens.total ||
    a.tokens.cached !== b.tokens.cached ||
    a.tokens.thoughts !== b.tokens.thoughts ||
    a.tokens.tool !== b.tokens.tool;
  return !inputTokensChanged && !outputTokensChanged;
}

function areToolCallStatsEqual(a: ToolCallStats, b: ToolCallStats): boolean {
  if (a.count !== b.count) return false;
  if (a.success !== b.success) return false;
  if (a.fail !== b.fail) return false;
  if (a.cancelled !== b.cancelled) return false;
  if (a.durationMs !== b.durationMs) return false;
  if (
    a.decisions[ToolCallDecision.ACCEPT] !==
      b.decisions[ToolCallDecision.ACCEPT] ||
    a.decisions[ToolCallDecision.REJECT] !==
      b.decisions[ToolCallDecision.REJECT] ||
    a.decisions[ToolCallDecision.MODIFY] !==
      b.decisions[ToolCallDecision.MODIFY] ||
    a.decisions[ToolCallDecision.AUTO_ACCEPT] !==
      b.decisions[ToolCallDecision.AUTO_ACCEPT]
  ) {
    return false;
  }
  return true;
}

function areSessionTokenUsageMetricsEqual(
  a: SessionMetrics['tokenTracking']['sessionTokenUsage'],
  b: SessionMetrics['tokenTracking']['sessionTokenUsage'],
): boolean {
  if (a.input !== b.input) {
    return false;
  }
  if (a.output !== b.output) {
    return false;
  }
  if (a.cache !== b.cache) {
    return false;
  }
  if (a.tool !== b.tool) {
    return false;
  }
  if (a.thought !== b.thought) {
    return false;
  }
  return a.total === b.total;
}

function areTokenTrackingMetricsEqual(
  a: SessionMetrics['tokenTracking'],
  b: SessionMetrics['tokenTracking'],
): boolean {
  if (a.tokensPerMinute !== b.tokensPerMinute) {
    return false;
  }
  if (a.throttleWaitTimeMs !== b.throttleWaitTimeMs) {
    return false;
  }
  if (a.timeToFirstToken !== b.timeToFirstToken) {
    return false;
  }
  if (a.tokensPerSecond !== b.tokensPerSecond) {
    return false;
  }
  return areSessionTokenUsageMetricsEqual(
    a.sessionTokenUsage,
    b.sessionTokenUsage,
  );
}

function cloneSessionMetrics(metrics: SessionMetrics): SessionMetrics {
  const models: SessionMetrics['models'] = {};
  for (const key of Object.keys(metrics.models)) {
    const model = metrics.models[key];
    models[key] = {
      api: { ...model.api },
      tokens: { ...model.tokens },
    };
  }

  const toolsByName: SessionMetrics['tools']['byName'] = {};
  for (const key of Object.keys(metrics.tools.byName)) {
    const tool = metrics.tools.byName[key];
    toolsByName[key] = {
      count: tool.count,
      success: tool.success,
      fail: tool.fail,
      cancelled: tool.cancelled,
      durationMs: tool.durationMs,
      decisions: { ...tool.decisions },
    };
  }

  return {
    models,
    tools: {
      totalCalls: metrics.tools.totalCalls,
      totalSuccess: metrics.tools.totalSuccess,
      totalFail: metrics.tools.totalFail,
      totalCancelled: metrics.tools.totalCancelled,
      totalDurationMs: metrics.tools.totalDurationMs,
      totalDecisions: { ...metrics.tools.totalDecisions },
      byName: toolsByName,
    },
    files: { ...metrics.files },
    tokenTracking: {
      tokensPerMinute: metrics.tokenTracking.tokensPerMinute,
      throttleWaitTimeMs: metrics.tokenTracking.throttleWaitTimeMs,
      timeToFirstToken: metrics.tokenTracking.timeToFirstToken,
      tokensPerSecond: metrics.tokenTracking.tokensPerSecond,
      sessionTokenUsage: {
        ...metrics.tokenTracking.sessionTokenUsage,
      },
    },
    timing: { ...metrics.timing },
    cache: { ...metrics.cache },
  };
}

function areFilesEqual(
  a: SessionMetrics['files'],
  b: SessionMetrics['files'],
): boolean {
  return (
    a.totalLinesAdded === b.totalLinesAdded &&
    a.totalLinesRemoved === b.totalLinesRemoved
  );
}

function areToolsTotalsEqual(
  a: SessionMetrics['tools'],
  b: SessionMetrics['tools'],
): boolean {
  if (a.totalCalls !== b.totalCalls) return false;
  if (a.totalSuccess !== b.totalSuccess) return false;
  if (a.totalFail !== b.totalFail) return false;
  if (a.totalCancelled !== b.totalCancelled) return false;
  return a.totalDurationMs === b.totalDurationMs;
}

function areToolDecisionsEqual(
  a: SessionMetrics['tools']['totalDecisions'],
  b: SessionMetrics['tools']['totalDecisions'],
): boolean {
  return (
    a[ToolCallDecision.ACCEPT] === b[ToolCallDecision.ACCEPT] &&
    a[ToolCallDecision.REJECT] === b[ToolCallDecision.REJECT] &&
    a[ToolCallDecision.MODIFY] === b[ToolCallDecision.MODIFY] &&
    a[ToolCallDecision.AUTO_ACCEPT] === b[ToolCallDecision.AUTO_ACCEPT]
  );
}

function areToolsByMapsEqual(
  a: SessionMetrics['tools']['byName'],
  b: SessionMetrics['tools']['byName'],
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!areToolCallStatsEqual(a[key], b[key])) return false;
  }
  return true;
}

function areModelsEqual(
  a: SessionMetrics['models'],
  b: SessionMetrics['models'],
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!areModelMetricsEqual(a[key], b[key])) return false;
  }
  return true;
}

function areTimingThroughputMetricsEqual(
  a: SessionMetrics['timing'],
  b: SessionMetrics['timing'],
): boolean {
  if (a.completeTokensPerMinute !== b.completeTokensPerMinute) return false;
  if (a.outputGenerationTps !== b.outputGenerationTps) return false;
  if (a.effectiveInputTps !== b.effectiveInputTps) return false;
  if (a.uncachedInputTps !== b.uncachedInputTps) return false;
  return a.lastRequestTpm === b.lastRequestTpm;
}

function areTimingLatencyMetricsEqual(
  a: SessionMetrics['timing'],
  b: SessionMetrics['timing'],
): boolean {
  return (
    a.lastTtftMs === b.lastTtftMs &&
    a.weightedAvgTtftMs === b.weightedAvgTtftMs &&
    a.lastOutputGenerationTps === b.lastOutputGenerationTps &&
    a.lastEffectiveInputTps === b.lastEffectiveInputTps
  );
}

function areTimingAccumulatedMetricsEqual(
  a: SessionMetrics['timing'],
  b: SessionMetrics['timing'],
): boolean {
  return (
    a.accumulatedApiTimeMs === b.accumulatedApiTimeMs &&
    a.accumulatedToolTimeMs === b.accumulatedToolTimeMs &&
    a.agentActiveTimeMs === b.agentActiveTimeMs &&
    a.accumulatedWorkMs === b.accumulatedWorkMs
  );
}

function areCacheMetricsEqual(
  a: SessionMetrics['cache'],
  b: SessionMetrics['cache'],
): boolean {
  if (a.hasReliableCacheData !== b.hasReliableCacheData) return false;
  if (a.hasReliableCacheReads !== b.hasReliableCacheReads) return false;
  if (a.hasReliableCacheWrites !== b.hasReliableCacheWrites) return false;
  if (a.totalCacheReads !== b.totalCacheReads) return false;
  if (a.totalCacheWrites !== b.totalCacheWrites) return false;
  if (a.requestsWithCacheReads !== b.requestsWithCacheReads) return false;
  return a.requestsWithCacheWrites === b.requestsWithCacheWrites;
}

function areMetricsEqual(a: SessionMetrics, b: SessionMetrics): boolean {
  if (!areFilesEqual(a.files, b.files)) return false;

  if (!areToolsTotalsEqual(a.tools, b.tools)) return false;
  if (!areToolDecisionsEqual(a.tools.totalDecisions, b.tools.totalDecisions)) {
    return false;
  }
  if (!areToolsByMapsEqual(a.tools.byName, b.tools.byName)) return false;

  if (!areModelsEqual(a.models, b.models)) return false;

  if (!areTokenTrackingMetricsEqual(a.tokenTracking, b.tokenTracking)) {
    return false;
  }

  const ta = a.timing;
  const tb = b.timing;
  if (!areTimingThroughputMetricsEqual(ta, tb)) return false;
  if (!areTimingLatencyMetricsEqual(ta, tb)) return false;
  if (!areTimingAccumulatedMetricsEqual(ta, tb)) return false;

  return areCacheMetricsEqual(a.cache, b.cache);
}

export type { SessionMetrics, ModelMetrics };

export interface SessionStatsState {
  sessionId: string;
  sessionStartTime: Date;
  metrics: SessionMetrics;
  lastPromptTokenCount: number;
  historyTokenCount: number;
  promptCount: number;
  tokensPerMinute?: number;
  throttleWaitTimeMs?: number;
}

export interface ComputedSessionStats {
  totalApiTime: number;
  totalToolTime: number;
  agentActiveTime: number;
  apiTimePercent: number;
  toolTimePercent: number;
  cacheEfficiency: number;
  totalDecisions: number;
  successRate: number;
  agreementRate: number;
  totalCachedTokens: number;
  totalInputTokens: number;
  totalPromptTokens: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
}

// Defines the final "value" of our context, including the state
// and the functions to update it.
interface SessionStatsContextValue {
  stats: SessionStatsState;
  startNewPrompt: () => void;
  getPromptCount: () => number;
  updateHistoryTokenCount: (count: number) => void;
}

// --- Context Definition ---

const SessionStatsContext = createContext<SessionStatsContextValue | undefined>(
  undefined,
);

function createInitialSessionStats(): SessionStatsState {
  return {
    sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    sessionStartTime: new Date(),
    metrics: cloneSessionMetrics(uiTelemetryService.getMetrics()),
    lastPromptTokenCount: 0,
    historyTokenCount: 0,
    promptCount: 0,
  };
}

function applyTelemetryUpdate(
  prevState: SessionStatsState,
  metrics: SessionMetrics,
  lastPromptTokenCount: number,
): SessionStatsState {
  if (
    prevState.lastPromptTokenCount === lastPromptTokenCount &&
    areMetricsEqual(prevState.metrics, metrics)
  ) {
    return prevState;
  }
  return {
    ...prevState,
    metrics: cloneSessionMetrics(metrics),
    lastPromptTokenCount,
  };
}

function useTelemetryStatsUpdates(
  setStats: React.Dispatch<React.SetStateAction<SessionStatsState>>,
) {
  useEffect(() => {
    const handleUpdate = ({
      metrics,
      lastPromptTokenCount,
    }: {
      metrics: SessionMetrics;
      lastPromptTokenCount: number;
    }) => {
      setStats((prevState) =>
        applyTelemetryUpdate(prevState, metrics, lastPromptTokenCount),
      );
    };

    uiTelemetryService.on('update', handleUpdate);
    handleUpdate({
      metrics: uiTelemetryService.getMetrics(),
      lastPromptTokenCount: uiTelemetryService.getLastPromptTokenCount(),
    });

    return () => {
      uiTelemetryService.off('update', handleUpdate);
    };
  }, [setStats]);
}

// --- Provider Component ---

export const SessionStatsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [stats, setStats] = useState<SessionStatsState>(
    createInitialSessionStats,
  );
  useTelemetryStatsUpdates(setStats);

  const startNewPrompt = useCallback(() => {
    setStats((prevState) => ({
      ...prevState,
      promptCount: prevState.promptCount + 1,
    }));
  }, []);

  const updateHistoryTokenCount = useCallback((count: number) => {
    setStats((prevState) => {
      if (prevState.historyTokenCount === count) {
        return prevState;
      }
      return {
        ...prevState,
        historyTokenCount: count,
      };
    });
  }, []);

  // FIX: Use a ref to provide stable callback that always returns latest value
  // This prevents components from re-rendering when promptCount changes
  const promptCountRef = useRef(stats.promptCount);

  // Keep ref updated with latest value
  useEffect(() => {
    promptCountRef.current = stats.promptCount;
  }, [stats.promptCount]);

  const getPromptCount = useCallback(
    () => promptCountRef.current,
    [], // Empty dependencies = stable callback
  );

  const value = useMemo(
    () => ({
      stats,
      startNewPrompt,
      getPromptCount,
      updateHistoryTokenCount,
    }),
    [stats, startNewPrompt, getPromptCount, updateHistoryTokenCount],
  );

  return (
    <SessionStatsContext.Provider value={value}>
      {children}
    </SessionStatsContext.Provider>
  );
};

// --- Consumer Hook ---

export const useSessionStats = () => {
  const context = useContext(SessionStatsContext);
  if (context === undefined) {
    throw new Error(
      'useSessionStats must be used within a SessionStatsProvider',
    );
  }
  return context;
};
