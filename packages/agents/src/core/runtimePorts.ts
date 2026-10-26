/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { MediaAdmissionRelease } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';

/**
 * The single media-admission operation the turn-commit and stream-finalizer
 * paths use: release the admissions the turn reserved.
 */
export interface MediaAdmissionPort {
  releaseAdmissions(
    admissions: readonly MediaAdmissionRelease[],
  ): Promise<unknown>;
}

/**
 * Whether thinking blocks are kept in the history the provider sees.
 */
export interface ReasoningInclusionPolicy {
  includeInContext(): boolean;
}

export function mediaAdmissionPort(
  context: AgentRuntimeContext,
): MediaAdmissionPort | undefined {
  const mediaAdmission = context.mediaAdmission;
  if (mediaAdmission === undefined) return undefined;
  return {
    releaseAdmissions: async (admissions) => {
      await mediaAdmission.releaseAdmissions(admissions);
    },
  };
}

export function reasoningInclusionPolicy(
  context: AgentRuntimeContext,
): ReasoningInclusionPolicy {
  return {
    includeInContext: () => context.ephemerals.reasoning.includeInContext(),
  };
}
