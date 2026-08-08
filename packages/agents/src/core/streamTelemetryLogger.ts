/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extracted from StreamProcessor to keep it under the eslint `max-lines`
 * budget (issue #3130 slice 3). Handles telemetry logging + actual token
 * usage recording after a stream attempt completes successfully.
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { TokenUsageLogger } from './TokenUsageLogger.js';
import { logApiResponse } from './turnLogging.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { safeJsonStringify } from './turnJsonUtils.js';
import {
  recordActualTokenUsage,
  usageStatsToActualInput,
} from './tokenUsageActualLogger.js';

/**
 * Log the API response telemetry and record actual token usage for a
 * completed stream attempt.
 *
 * `attemptIndex` stamps the 0-based attempt number (AC-4). A successful
 * stream completion always carries `attempt_outcome: 'success'`.
 */
export async function logStreamTelemetry(
  runtimeContext: AgentRuntimeContext,
  telemetry:
    | {
        promptId: string;
        startTime: number;
        attemptIndex?: number;
      }
    | undefined,
  lastIContent: IContent | undefined,
  tokenUsageLogger: TokenUsageLogger | null | undefined,
): Promise<void> {
  if (telemetry === undefined || lastIContent === undefined) return;
  try {
    await emitStreamTelemetry(
      runtimeContext,
      telemetry,
      lastIContent,
      tokenUsageLogger,
    );
  } catch (error) {
    // Fail-open boundary: this runs on the completion path of a real turn, so
    // a telemetry adapter that throws must not surface as a failed request.
    new DebugLogger('llxprt:stream-telemetry').error(
      `Failed to log stream telemetry for prompt ${telemetry.promptId}`,
      error,
    );
  }
}

async function emitStreamTelemetry(
  runtimeContext: AgentRuntimeContext,
  telemetry: { promptId: string; startTime: number; attemptIndex?: number },
  lastIContent: IContent,
  tokenUsageLogger: TokenUsageLogger | null | undefined,
): Promise<void> {
  const durationMs = Date.now() - telemetry.startTime;
  const usage = lastIContent.metadata?.usage;
  logApiResponse(
    runtimeContext,
    runtimeContext.state,
    runtimeContext.state.model,
    telemetry.promptId,
    durationMs,
    usage ? { ...usage } : undefined,
    safeJsonStringify(lastIContent),
  );
  await recordActualTokenUsage(
    tokenUsageLogger,
    telemetry.promptId,
    usage
      ? usageStatsToActualInput(usage, {
          attemptIndex: telemetry.attemptIndex ?? 0,
          attemptOutcome: 'success',
        })
      : undefined,
  );
}
