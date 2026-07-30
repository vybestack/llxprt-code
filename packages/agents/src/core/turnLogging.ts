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
import { nextStreamEventWithIdleTimeout } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import { safeJsonStringify } from './turnJsonUtils.js';

/**
 * Extract request text from neutral contents for logging.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-008
 */
export function getRequestTextFromContents(contents: IContent[]): string {
  return safeJsonStringify(contents);
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

export function logModelOutputResponse(
  runtimeContext: AgentRuntimeContext,
  promptId: string,
  durationMs: number,
  response: { usage?: UsageStats },
): void {
  logApiResponse(
    runtimeContext,
    runtimeContext.state,
    runtimeContext.state.model,
    promptId,
    durationMs,
    response.usage,
    safeJsonStringify(response),
  );
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

/**
 * Timing for the provider send/retry loop only.
 *
 * The `durationMs` on provider telemetry must measure provider latency, not
 * local enforcement/compression time, so the clock starts when the prepared
 * request is actually handed to the provider. Before the first send it falls
 * back to the overall start so failures during preparation still report a
 * duration.
 */
export interface ProviderSendTiming {
  measure<T>(send: () => Promise<T>): Promise<T>;
  elapsedSinceSend(): number;
}

export function createProviderSendTiming(
  overallStartTime: number,
): ProviderSendTiming {
  let sendStartTime: number | undefined;
  return {
    measure(send) {
      sendStartTime = Date.now();
      return send();
    },
    elapsedSinceSend() {
      return Date.now() - (sendStartTime ?? overallStartTime);
    },
  };
}

/**
 * Log the active provider snapshot and reject providers that cannot serve the
 * IContent send path.
 */
export function validateProviderForSend(
  provider: {
    readonly name: string;
    getDefaultModel?: () => string;
    generateChatCompletion?: unknown;
  },
  logger: { debug: (fn: () => string, data?: unknown) => void },
  configModel: string,
  resolveBaseUrl: () => string | undefined,
): void {
  logger.debug(() => '[TurnProcessor] Active provider snapshot before send', {
    providerName: provider.name,
    providerDefaultModel: provider.getDefaultModel?.(),
    configModel,
    baseUrl: resolveBaseUrl(),
  });
  if (typeof provider.generateChatCompletion !== 'function') {
    throw new Error(
      `Provider ${provider.name} does not support IContent interface`,
    );
  }
}

/**
 * Read the next provider stream event, enforcing the idle timeout.
 *
 * The timeout surfaces as `StreamIdleTimeoutError` so it stays distinguishable
 * from a user-initiated abort; `shouldRetryStreamAttempt` already declines to
 * retry it, and `turn.ts` maps it to the dedicated StreamIdleTimeout event.
 */
export function readProviderStreamResponse(
  iterator: AsyncIterator<IContent, unknown>,
  timeoutController: AbortController,
  upstreamAbortSignal: AbortSignal | undefined,
  effectiveTimeoutMs: number,
): Promise<IteratorResult<IContent, unknown>> {
  if (effectiveTimeoutMs <= 0) {
    return iterator.next();
  }
  return nextStreamEventWithIdleTimeout({
    iterator,
    timeoutMs: effectiveTimeoutMs,
    signal: timeoutController.signal,
    onTimeout: () => {
      if (upstreamAbortSignal?.aborted === true) {
        return;
      }
      timeoutController.abort();
    },
  });
}
