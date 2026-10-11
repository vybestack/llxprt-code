/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  SessionMetrics,
  SessionMetricsSnapshot,
} from '@vybestack/llxprt-code-telemetry';

export interface AgentMetrics {
  getMetrics(): SessionMetrics;
  getSessionSnapshot(): SessionMetricsSnapshot;
  getLastPromptTokenCount(): number;
  subscribe(
    listener: (update: {
      metrics: SessionMetrics;
      lastPromptTokenCount: number;
    }) => void,
  ): () => void;
  reset(): void;
  setLastPromptTokenCount(count: number): void;
  setTokenTrackingMetrics(metrics: SessionMetrics['tokenTracking']): void;
}

import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';

export function createAgentMetrics(): AgentMetrics {
  return {
    getMetrics: () => uiTelemetryService.getMetrics(),
    getSessionSnapshot: () => uiTelemetryService.getSessionSnapshot(),
    getLastPromptTokenCount: () => uiTelemetryService.getLastPromptTokenCount(),
    subscribe: (listener) => uiTelemetryService.subscribe(listener),
    reset: () => uiTelemetryService.reset(),
    setLastPromptTokenCount: (count) =>
      uiTelemetryService.setLastPromptTokenCount(count),
    setTokenTrackingMetrics: (metrics) =>
      uiTelemetryService.setTokenTrackingMetrics(metrics),
  };
}

export interface SessionStats {
  readonly promptTokens: number;
  readonly candidateTokens: number;
  readonly totalTokens: number;
  readonly cachedTokens: number;
  readonly contextWindowSize: number;
  readonly contextWindowUsed: number;
  readonly turnCount: number;
  readonly apiRequests: number;
  readonly apiErrors: number;
  readonly toolCalls: number;
  readonly toolSuccesses: number;
  readonly toolFailures: number;
  readonly toolCancellations: number;
  readonly totalApiLatencyMs: number;
  readonly totalToolDurationMs: number;
  readonly completeTokensPerMinute: number;
  readonly agentActiveTimeMs: number;
  readonly sessionWallMs: number;
}
