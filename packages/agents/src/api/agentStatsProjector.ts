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
 * Projects the in-process uiTelemetryService singleton metrics + HistoryService
 * into the public SessionStats shape. Token fields are summed across per-model
 * metrics, falling back to tokenTracking.sessionTokenUsage when the per-model
 * sums are zero; contextWindowUsed reads uiTelemetryService.getLastPromptTokenCount();
 * turnCount is derived from the HistoryService message count when reachable.
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */
export function projectSessionStats(
  historyService: HistoryService | null,
): SessionStats {
  const metrics = uiTelemetryService.getMetrics();
  let promptTokens = 0;
  let candidateTokens = 0;
  let totalTokens = 0;
  let cachedTokens = 0;
  for (const modelName of Object.keys(metrics.models)) {
    const t = metrics.models[modelName].tokens;
    promptTokens += t.prompt;
    candidateTokens += t.candidates;
    totalTokens += t.total;
    cachedTokens += t.cached;
  }
  const sessionUsage = metrics.tokenTracking.sessionTokenUsage;
  const promptTokensFinal =
    promptTokens > 0 ? promptTokens : sessionUsage.input;
  const candidateTokensFinal =
    candidateTokens > 0 ? candidateTokens : sessionUsage.output;
  const totalTokensFinal = totalTokens > 0 ? totalTokens : sessionUsage.total;
  const cachedTokensFinal =
    cachedTokens > 0 ? cachedTokens : sessionUsage.cache;
  return {
    promptTokens: promptTokensFinal,
    candidateTokens: candidateTokensFinal,
    totalTokens: totalTokensFinal,
    cachedTokens: cachedTokensFinal,
    contextWindowSize: 0,
    contextWindowUsed: uiTelemetryService.getLastPromptTokenCount(),
    turnCount: readTurnCount(historyService),
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
