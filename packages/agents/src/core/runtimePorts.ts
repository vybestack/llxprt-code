/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

/** The runtime member the media-admission port projects. */
export interface MediaAdmissionSource {
  readonly mediaAdmission?: {
    releaseAdmissions(
      admissions: readonly MediaAdmissionRelease[],
    ): Promise<unknown>;
  };
}

/** The runtime member the reasoning-inclusion port projects. */
export interface ReasoningSettingsSource {
  readonly ephemerals: { readonly reasoning: ReasoningInclusionPolicy };
}

export function mediaAdmissionPort(
  source: MediaAdmissionSource,
): MediaAdmissionPort | undefined {
  const mediaAdmission = source.mediaAdmission;
  if (mediaAdmission === undefined) return undefined;
  return {
    releaseAdmissions: async (admissions) => {
      await mediaAdmission.releaseAdmissions(admissions);
    },
  };
}

export function reasoningInclusionPolicy(
  source: ReasoningSettingsSource,
): ReasoningInclusionPolicy {
  return {
    includeInContext: () => source.ephemerals.reasoning.includeInContext(),
  };
}
