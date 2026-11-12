/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { ReviewStopReason } from './refusalNotices.js';
import type { RefusalAttempt } from './refusalTypes.js';
import type { ReviewEntryKind, ReviewEntryRole } from './reviewWindow.js';

/** Who reviewed: the saved profile (if one chose it) and what it resolved to. */
export interface ReviewerIdentity {
  readonly profile?: string;
  readonly provider: string;
  readonly model: string;
}

/** One entry a reviewer changed, with both texts. */
export interface ChangedEntry {
  readonly id: string;
  readonly role: ReviewEntryRole;
  readonly kind: ReviewEntryKind;
  readonly originalText: string;
  readonly newText: string;
}

/** What the coordinator hands the reviewer for one refused attempt. */
export interface ReviewRequest {
  readonly attempt: RefusalAttempt;
  /** `refusal.review-profile` as captured when the request was admitted. */
  readonly reviewProfile: string | undefined;
  readonly retriesTried: number;
  readonly execution: AgentChatRecordingExecution | undefined;
  /** The refused request's admitted route, for the session-model fallback. */
  readonly modelParameters: AdmittedModelParameters | undefined;
  readonly signal: AbortSignal | undefined;
}

export type ReviewOutcome =
  | {
      readonly kind: 'rewritten';
      readonly reviewer: ReviewerIdentity;
      readonly operationId: string;
      readonly explanation: string;
      readonly changes: readonly ChangedEntry[];
    }
  | {
      readonly kind: 'disallowed';
      readonly reviewer: ReviewerIdentity;
      readonly explanation: string;
    }
  | {
      readonly kind: 'stopped';
      readonly reason: ReviewStopReason;
      readonly reviewer: ReviewerIdentity | undefined;
      readonly detail: string;
    };

/** Reviews the context of a refused request and may rewrite it. */
export interface RefusalReviewer {
  review(request: ReviewRequest): Promise<ReviewOutcome>;
}
