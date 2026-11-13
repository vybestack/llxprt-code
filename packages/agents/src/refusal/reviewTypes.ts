/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ReviewStopReason } from './refusalNotices.js';
import type { RefusalAttempt } from './refusalTypes.js';
import type {
  PendingEdit,
  ReviewEntryKind,
  ReviewEntryRole,
} from './reviewWindow.js';

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
  /**
   * The user turn the refused request carried (a prompt, or tool results),
   * which is committed to the history only after the model answers.
   */
  readonly pending: PendingTurnContents | undefined;
  /** The refused request's admitted route, for the session-model fallback. */
  readonly modelParameters: AdmittedModelParameters | undefined;
  readonly signal: AbortSignal | undefined;
}

/** The history-bound and provider-bound views of a pending user turn. */
export interface PendingTurnContents {
  readonly userContents: readonly IContent[];
  readonly userIContents: readonly IContent[];
}

export type ReviewOutcome =
  | {
      readonly kind: 'rewritten';
      readonly reviewer: ReviewerIdentity;
      readonly operationId: string;
      readonly explanation: string;
      readonly changes: readonly ChangedEntry[];
      /** The part of the rewrite that edits the pending user turn. */
      readonly pendingEdits: readonly PendingEdit[];
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

/**
 * A review whose reviewer is known and whose call has not started: the caller
 * can tell the user who is being asked before it waits for the answer.
 * `reviewer` is undefined when no reviewer could be resolved, in which case
 * `run` only reports why.
 */
export interface StartedReview {
  readonly reviewer: ReviewerIdentity | undefined;
  run(): Promise<ReviewOutcome>;
}

/** Reviews the context of a refused request and may rewrite it. */
export interface RefusalReviewer {
  /** Resolves who reviews; the call itself starts with `run`. */
  begin(request: ReviewRequest): Promise<StartedReview>;
}
