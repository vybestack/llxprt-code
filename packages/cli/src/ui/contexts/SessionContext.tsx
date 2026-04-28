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
} from '@vybestack/llxprt-code-core';
import { uiTelemetryService } from '@vybestack/llxprt-code-core';

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
  if (
    a.tokens.input !== b.tokens.input ||
    a.tokens.prompt !== b.tokens.prompt ||
    a.tokens.candidates !== b.tokens.candidates ||
    a.tokens.total !== b.tokens.total ||
    a.tokens.cached !== b.tokens.cached ||
    a.tokens.thoughts !== b.tokens.thoughts ||
    a.tokens.tool !== b.tokens.tool
  ) {
    return false;
  }
  return true;
}

function areToolCallStatsEqual(a: ToolCallStats, b: ToolCallStats): boolean {
  if (
    a.count !== b.count ||
    a.success !== b.success ||
    a.fail !== b.fail ||
    a.durationMs !== b.durationMs
  ) {
    return false;
  }
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
  };
}

function areMetricsEqual(a: SessionMetrics, b: SessionMetrics): boolean {
  // Compare files
  if (
    a.files.totalLinesAdded !== b.files.totalLinesAdded ||
    a.files.totalLinesRemoved !== b.files.totalLinesRemoved
  ) {
    return false;
  }

  // Compare tools
  const toolsA = a.tools;
  const toolsB = b.tools;
  if (
    toolsA.totalCalls !== toolsB.totalCalls ||
    toolsA.totalSuccess !== toolsB.totalSuccess ||
    toolsA.totalFail !== toolsB.totalFail ||
    toolsA.totalDurationMs !== toolsB.totalDurationMs
  ) {
    return false;
  }

  // Compare tool decisions
  if (
    toolsA.totalDecisions[ToolCallDecision.ACCEPT] !==
      toolsB.totalDecisions[ToolCallDecision.ACCEPT] ||
    toolsA.totalDecisions[ToolCallDecision.REJECT] !==
      toolsB.totalDecisions[ToolCallDecision.REJECT] ||
    toolsA.totalDecisions[ToolCallDecision.MODIFY] !==
      toolsB.totalDecisions[ToolCallDecision.MODIFY] ||
    toolsA.totalDecisions[ToolCallDecision.AUTO_ACCEPT] !==
      toolsB.totalDecisions[ToolCallDecision.AUTO_ACCEPT]
  ) {
    return false;
  }

  // Compare tools.byName
  const toolsByNameAKeys = Object.keys(toolsA.byName);
  const toolsByNameBKeys = Object.keys(toolsB.byName);
  if (toolsByNameAKeys.length !== toolsByNameBKeys.length) return false;

  for (const key of toolsByNameAKeys) {
    if (!Object.prototype.hasOwnProperty.call(toolsB.byName, key)) {
      return false;
    }

    if (!areToolCallStatsEqual(toolsA.byName[key], toolsB.byName[key])) {
      return false;
    }
  }

  // Compare models
  const modelsAKeys = Object.keys(a.models);
  const modelsBKeys = Object.keys(b.models);
  if (modelsAKeys.length !== modelsBKeys.length) return false;

  for (const key of modelsAKeys) {
    if (!Object.prototype.hasOwnProperty.call(b.models, key)) {
      return false;
    }

    if (!areModelMetricsEqual(a.models[key], b.models[key])) {
      return false;
    }
  }

  return areTokenTrackingMetricsEqual(a.tokenTracking, b.tokenTracking);
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

// --- Provider Component ---

export const SessionStatsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [stats, setStats] = useState<SessionStatsState>({
    sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    sessionStartTime: new Date(),
    metrics: cloneSessionMetrics(uiTelemetryService.getMetrics()),
    lastPromptTokenCount: 0,
    historyTokenCount: 0,
    promptCount: 0,
  });

  useEffect(() => {
    const handleUpdate = ({
      metrics,
      lastPromptTokenCount,
    }: {
      metrics: SessionMetrics;
      lastPromptTokenCount: number;
    }) => {
      setStats((prevState) => {
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
      });
    };

    uiTelemetryService.on('update', handleUpdate);
    // Set initial state
    handleUpdate({
      metrics: uiTelemetryService.getMetrics(),
      lastPromptTokenCount: uiTelemetryService.getLastPromptTokenCount(),
    });

    return () => {
      uiTelemetryService.off('update', handleUpdate);
    };
  }, []);

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
