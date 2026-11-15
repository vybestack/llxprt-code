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
  buildPartialOutputSnapshot,
  unavailableContextFingerprint,
  type RefusalContextFingerprint,
} from './refusalAudit.js';
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
  accumulated: ModelOutput,
  turnId: string,
  contextFingerprint?: RefusalContextFingerprint,
): void {
  if (!isRefusalFinishReason(accumulated.finishReason)) return;
  throw new ModelRefusalSignal({
    finishReason: 'refusal',
    ...(accumulated.rawStopReason !== undefined && {
      rawStopReason: accumulated.rawStopReason,
    }),
    ...(accumulated.stopDetails !== undefined && {
      stopDetails: accumulated.stopDetails,
    }),
    ...(accumulated.requestId !== undefined && {
      requestId: accumulated.requestId,
    }),
    ...(accumulated.dumpBaseId !== undefined && {
      dumpBaseId: accumulated.dumpBaseId,
    }),
    ...(accumulated.usage !== undefined && { usage: accumulated.usage }),
    partialOutput: buildPartialOutputSnapshot(accumulated),
    ...(accumulated.usage !== undefined && {
      outputTokens: accumulated.usage.completionTokens,
    }),
    firstByteToRefusalMs: accumulated.firstByteToRefusalMs ?? null,
    contextFingerprint: {
      ...(contextFingerprint ??
        unavailableContextFingerprint(accumulated.usage)),
      prompt_tokens: accumulated.usage?.promptTokens ?? null,
      cache_read_tokens:
        accumulated.usage?.cache_read_input_tokens ??
        accumulated.usage?.cachedTokens ??
        null,
    },
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
