/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuxiliaryProfilePurpose } from '../core/CompressionProfileResolver.js';

/** The settings a refusal reviewer's profile can come from, in priority order. */
export type ReviewProfileSetting =
  | 'refusal.review-profile'
  | 'compression.profile';

/** The profile that selects the reviewer could not be used. */
export class RefusalReviewProfileError extends Error {
  constructor(
    readonly profileName: string,
    readonly setting: ReviewProfileSetting,
    cause?: string,
  ) {
    super(
      `Refusal review profile '${profileName}' could not be used${cause ? `: ${cause}` : ''}. ` +
        `Available profiles can be listed with 'profile list'. ` +
        `Check your ${setting} setting or create the profile.`,
    );
    this.name = 'RefusalReviewProfileError';
  }
}

/**
 * How the shared auxiliary profile resolver labels a refusal reviewer: its own
 * isolated runtime id, so the profile never touches the foreground session.
 * `setting` names where the profile name came from, for the error text.
 */
export function refusalReviewPurpose(
  setting: ReviewProfileSetting,
): AuxiliaryProfilePurpose {
  return {
    setting,
    runtimeSegment: 'refusal-review-profile',
    source: 'ChatSession.resolveRefusalReviewProvider',
    profileKey: 'refusalReviewProfile',
    providerKey: 'refusalReviewProvider',
    notFound: (profileName, cause) =>
      new RefusalReviewProfileError(profileName, setting, cause),
  };
}

export const REFUSAL_REVIEW_PROFILE_PURPOSE = refusalReviewPurpose(
  'refusal.review-profile',
);
