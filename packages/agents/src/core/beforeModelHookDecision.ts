/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './chatSession.js';

/** Extract the effective reason from a hook result, else fallback. */
function effectiveReason(
  result: BeforeModelHookOutput,
  fallback: string,
): string {
  const reason: string = result.getEffectiveReason();
  return reason.length > 0 ? reason : fallback;
}

/**
 * Build a neutral blocking ModelOutput from a BeforeModel hook's
 * synthetic response or reason.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-004.1
 * @pseudocode lines 20-22
 */
function buildBlockingModelOutput(
  beforeModelResult: BeforeModelHookOutput,
): ModelOutput {
  const reason = effectiveReason(
    beforeModelResult,
    'Request blocked by BeforeModel hook',
  );
  return {
    content: {
      speaker: 'ai',
      blocks: [{ type: 'text', text: reason }],
    },
    finishReason: 'stop',
    rawStopReason: beforeModelResult.getEffectiveReason() || undefined,
  };
}

/**
 * Enforce the BeforeModel hook's stop/block decision. Throws an
 * AgentExecutionStoppedError if the hook requests execution stop, or an
 * AgentExecutionBlockedError if it returns a blocking decision (with a
 * neutral ModelOutput payload). No-ops when the hook result is absent or
 * neither stop nor block is requested.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-004.1
 */
export function enforceBeforeModelHookDecision(
  beforeModelResult: BeforeModelHookOutput | undefined,
  _hookRestrictedAllowedTools: string[] | undefined,
): void {
  if (beforeModelResult?.shouldStopExecution() === true) {
    throw new AgentExecutionStoppedError(
      effectiveReason(
        beforeModelResult,
        'Execution stopped by BeforeModel hook',
      ),
      beforeModelResult.systemMessage,
    );
  }
  if (beforeModelResult?.isBlockingDecision() !== true) return;

  const blockedOutput = buildBlockingModelOutput(beforeModelResult);
  throw new AgentExecutionBlockedError(
    effectiveReason(beforeModelResult, 'Request blocked by BeforeModel hook'),
    blockedOutput,
  );
}
