/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RefusalPayload } from '@vybestack/llxprt-code-core';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { RefusalAttempt } from './refusalTypes.js';

const logger = new DebugLogger('llxprt:refusal');

export function toRefusalPayload(
  attempt: RefusalAttempt,
  action: RefusalPayload['action'],
  delayMs?: number,
  now: Date = new Date(),
): RefusalPayload {
  const { usage } = attempt;
  return {
    time: now.toISOString(),
    provider: attempt.provider,
    model: attempt.model,
    promptId: attempt.promptId,
    turnId: attempt.turnId,
    attemptIndex: attempt.attemptIndex,
    finishReason: attempt.finishReason,
    ...(attempt.rawStopReason !== undefined && {
      rawStopReason: attempt.rawStopReason,
    }),
    ...(usage !== undefined && {
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    }),
    action,
    ...(delayMs !== undefined && { delayMs }),
  };
}

/**
 * Appends the audit record to the session journal. Fail-open: the journal is
 * an audit trail, so a write failure must not turn a refusal into a crash.
 */
export async function recordRefusalInJournal(
  execution: AgentChatRecordingExecution | undefined,
  attempt: RefusalAttempt,
  action: RefusalPayload['action'],
  delayMs?: number,
): Promise<void> {
  if (execution?.recordRefusal === undefined) return;
  try {
    await execution.recordRefusal(toRefusalPayload(attempt, action, delayMs));
  } catch (error: unknown) {
    logger.error(
      `Failed to record refusal for prompt ${attempt.promptId}`,
      error,
    );
  }
}
