/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FinishReason, GenerateContentResponse } from '@google/genai';
import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './chatSession.js';
import { attachHookRestrictedAllowedTools } from './hookToolRestrictions.js';
import { isMissingFinishReason } from './streamResponseHelpers.js';

/** Callback to patch a missing finish reason on a synthetic response. */
export type PatchFinishReasonFn = (
  response: GenerateContentResponse,
  candidate: NonNullable<GenerateContentResponse['candidates']>[0],
) => GenerateContentResponse;

/** Extract the effective reason from a hook result, else fallback. */
function effectiveReason(
  result: BeforeModelHookOutput,
  fallback: string,
): string {
  const reason: string = result.getEffectiveReason();
  return reason.length > 0 ? reason : fallback;
}

/**
 * Enforce the BeforeModel hook's stop/block decision. Throws an
 * AgentExecutionStoppedError if the hook requests execution stop, or an
 * AgentExecutionBlockedError if it returns a blocking decision (with an
 * optional synthetic response). No-ops when the hook result is absent or
 * neither stop nor block is requested.
 */
export function enforceBeforeModelHookDecision(
  beforeModelResult: BeforeModelHookOutput | undefined,
  hookRestrictedAllowedTools: string[] | undefined,
  patchFinishReason: PatchFinishReasonFn,
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

  let syntheticResponse = beforeModelResult.getSyntheticResponse();
  if (syntheticResponse) {
    const candidate = syntheticResponse.candidates?.[0];
    const candidateFinishReason = candidate?.finishReason as
      | FinishReason
      | ''
      | null
      | undefined;
    if (candidate && isMissingFinishReason(candidateFinishReason)) {
      syntheticResponse = patchFinishReason(syntheticResponse, candidate);
    }
  }
  throw new AgentExecutionBlockedError(
    effectiveReason(beforeModelResult, 'Request blocked by BeforeModel hook'),
    syntheticResponse === undefined
      ? undefined
      : attachHookRestrictedAllowedTools(
          syntheticResponse,
          hookRestrictedAllowedTools,
        ),
  );
}
