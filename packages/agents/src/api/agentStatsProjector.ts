/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P20 stats/compression projection helpers extracted from agentImpl.ts to keep
 * that module under the project's max-lines limit. These are pure projection
 * functions over the uiTelemetryService singleton and a HistoryService; they
 * hold no state.
 *
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 * @requirement:REQ-011
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import type { SessionStats } from './agent.js';

/**
 * Projects the in-process uiTelemetryService singleton canonical snapshot +
 * HistoryService into the public SessionStats shape. Token fields, API
 * counts, tool counts, and timing all come from the single canonical
 * SessionMetricsAggregator snapshot — no split fallback to
 * tokenTracking.sessionTokenUsage.
 *
 * Token definitions (see SessionMetricsSnapshot):
 * - promptTokens   = totalInputTokens   (raw prompt/input tokens)
 * - candidateTokens = totalOutputTokens (completion/output tokens)
 * - totalTokens    = input + output, preserving the public prompt/candidate
 *                    token contract. Thought and tool categories remain
 *                    available in the canonical session snapshot.
 * - cachedTokens   = totalCachedTokens (subset of input served from cache)
 */
export function projectSessionStats(
  historyService: HistoryService | null,
): SessionStats {
  const snap = uiTelemetryService.getSessionSnapshot();
  return {
    promptTokens: snap.totalInputTokens,
    candidateTokens: snap.totalOutputTokens,
    totalTokens: snap.totalInputTokens + snap.totalOutputTokens,
    cachedTokens: snap.totalCachedTokens,
    contextWindowSize: 0,
    contextWindowUsed: uiTelemetryService.getLastPromptTokenCount(),
    turnCount: readTurnCount(historyService),
    apiRequests: snap.totalApiRequests,
    apiErrors: snap.totalApiErrors,
    toolCalls: snap.totalToolCalls,
    toolSuccesses: snap.totalToolSuccesses,
    toolFailures: snap.totalToolFailures,
    toolCancellations: snap.totalToolCancellations,
    totalApiLatencyMs: snap.accumulatedApiTimeMs,
    totalToolDurationMs: snap.totalToolTimeMs,
    completeTokensPerMinute: snap.completeTokensPerMinute,
    agentActiveTimeMs: snap.agentActiveTimeMs,
    sessionWallMs: snap.sessionWallMs,
  };
}

/**
 * Reads a defensive token count from the HistoryService for compression
 * before/after snapshots. Returns 0 when the HistoryService is unavailable.
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-011
 */
export function readCompressionTokenCount(
  historyService: HistoryService | null,
): number {
  if (historyService === null) {
    return 0;
  }
  try {
    return historyService.getTotalTokens();
  } catch {
    return 0;
  }
}

/**
 * Reads the conversation turn/message count from the HistoryService. Returns 0
 * when the HistoryService is unavailable.
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */
export function readTurnCount(historyService: HistoryService | null): number {
  if (historyService === null) {
    return 0;
  }
  try {
    return historyService.getStatistics().totalMessages;
  } catch {
    return 0;
  }
}
