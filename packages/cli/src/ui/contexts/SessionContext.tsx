/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  useMemo,
  useEffect,
} from 'react';

import {
  uiTelemetryService,
  SessionMetrics,
  ModelMetrics,
} from '@vybestack/llxprt-code-core';

// --- Interface Definitions ---

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
    metrics: uiTelemetryService.getMetrics(),
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
      setStats((prevState) => ({
        ...prevState,
        metrics,
        lastPromptTokenCount,
      }));
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
