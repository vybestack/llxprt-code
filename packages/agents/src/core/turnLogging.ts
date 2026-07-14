/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure logging and configuration utilities for turn execution.
 * Extracted from chatSession.ts Phase 05.
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Extract request text from neutral contents for logging.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-008
 */
export function getRequestTextFromContents(contents: IContent[]): string {
  return JSON.stringify(contents);
}

/**
 * Log API request to telemetry.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-008
 */
export function logApiRequest(
  runtimeContext: AgentRuntimeContext,
  runtimeState: AgentRuntimeState,
  contents: IContent[],
  model: string,
  promptId: string,
): void {
  const requestText = getRequestTextFromContents(contents);
  runtimeContext.telemetry.logApiRequest({
    model,
    promptId,
    requestText,
    sessionId: runtimeState.sessionId,
    runtimeId: runtimeState.runtimeId,
    provider: runtimeState.provider,
    timestamp: Date.now(),
  });
}

/**
 * Log API response to telemetry.
 *
 * Passes neutral UsageStats via the `usage` field (neutral keys:
 * inputTokens, outputTokens, totalTokens). The telemetry adapter in core
 * maps this to the Gemini-named legacy event at the boundary, so NO
 * Gemini-named keys appear in the agents core loop (OQ-3t).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @plan:PLAN-20260707-AGENTNEUTRAL.P19
 * @requirement:REQ-007
 * @requirement:REQ-008
 * @requirement:REQ-010.1
 */
export function logApiResponse(
  runtimeContext: AgentRuntimeContext,
  runtimeState: AgentRuntimeState,
  model: string,
  promptId: string,
  durationMs: number,
  usage?: UsageStats,
  responseText?: string,
): void {
  runtimeContext.telemetry.logApiResponse({
    model,
    promptId,
    durationMs,
    sessionId: runtimeState.sessionId,
    runtimeId: runtimeState.runtimeId,
    provider: runtimeState.provider,
    usage:
      usage === undefined
        ? undefined
        : {
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          },
    responseText,
  });
}

/**
 * Log API error to telemetry
 */
export function logApiError(
  runtimeContext: AgentRuntimeContext,
  runtimeState: AgentRuntimeState,
  model: string,
  promptId: string,
  durationMs: number,
  error: unknown,
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorType = error instanceof Error ? error.name : 'unknown';

  runtimeContext.telemetry.logApiError({
    model,
    promptId,
    durationMs,
    error: errorMessage,
    errorType,
    sessionId: runtimeState.sessionId,
    runtimeId: runtimeState.runtimeId,
    provider: runtimeState.provider,
  });
}
