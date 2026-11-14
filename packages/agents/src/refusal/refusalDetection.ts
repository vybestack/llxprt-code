/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AgentEventType,
  type ServerAgentStreamEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  ModelRefusalSignal,
  type RefusalAttempt,
  type RefusalEvidence,
} from './refusalTypes.js';

/**
 * A refusal is a provider attempt whose terminal canonical finish reason is
 * `refusal`. Zero output tokens alone is not a refusal, and `safety` is a
 * separate category that stays outside this feature.
 */
export function isRefusalFinishReason(
  finishReason: string | undefined,
): boolean {
  return finishReason === 'refusal';
}

/**
 * Raises the typed refusal outcome for an accumulated attempt that ended in a
 * refusal. Called by the stream finalizer before response validation, history
 * commit and success accounting, so none of them see the refused output.
 */
export function throwIfRefused(
  accumulated: Pick<ModelOutput, 'finishReason' | 'rawStopReason' | 'usage'>,
  turnId: string,
): void {
  if (!isRefusalFinishReason(accumulated.finishReason)) return;
  throw new ModelRefusalSignal({
    finishReason: 'refusal',
    ...(accumulated.rawStopReason !== undefined && {
      rawStopReason: accumulated.rawStopReason,
    }),
    ...(accumulated.usage !== undefined && { usage: accumulated.usage }),
    turnId,
  });
}

/** Places refused-attempt evidence within its logical request. */
export function toRefusalAttempt(
  evidence: RefusalEvidence,
  context: Pick<
    RefusalAttempt,
    'promptId' | 'attemptIndex' | 'provider' | 'model'
  >,
): RefusalAttempt {
  return { ...evidence, ...context };
}

/** True for a stream event announcing that the attempt finished with a refusal. */
export function isRefusalFinishEvent(event: ServerAgentStreamEvent): boolean {
  return (
    event.type === AgentEventType.Finished &&
    isRefusalFinishReason(event.value.reason)
  );
}
