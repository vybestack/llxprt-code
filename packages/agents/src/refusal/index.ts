/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  ModelRefusalSignal,
  type RefusalAttempt,
  type RefusalContext,
  type RefusalDecision,
  type RefusalEvidence,
  type RefusalRecovery,
} from './refusalTypes.js';
export {
  isRefusalFinishEvent,
  isRefusalFinishReason,
  throwIfRefused,
  toRefusalAttempt,
} from './refusalDetection.js';
export {
  RefusalRecoveryCoordinator,
  type RefusalRecoveryDeps,
} from './refusalRecovery.js';
export type { RefusalWait } from './refusalWait.js';
export { type RefusalPolicySource } from './refusalPolicy.js';
export { recordRefusalInJournal, toRefusalPayload } from './refusalJournal.js';
export { settleRefusal, type RefusalSettlement } from './refusalSettlement.js';
export {
  HistoryRefusalReviewer,
  type RefusalReviewerDeps,
} from './refusalReviewer.js';
export { refusalReviewPurpose } from './reviewProfile.js';
export type { RefusalReviewer } from './reviewTypes.js';
export { finishWithRefusal } from './refusalPostTurn.js';
export {
  advanceAfterAttempt,
  announceRefusalSettlement,
  keepRequestForNextAttempt,
  refusalNotice,
  turnForNextAttempt,
  type AttemptCounters,
  type StreamAttemptOutcome,
} from './refusalTurn.js';

import { RefusalRecoveryCoordinator } from './refusalRecovery.js';
import type { RefusalReviewer } from './reviewTypes.js';
import type { RefusalPolicySource } from './refusalPolicy.js';
import type { RefusalRecovery } from './refusalTypes.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';

/**
 * The recovery a chat session uses: live settings, the abortable timer and,
 * when the session can review, the reviewer.
 */
export function createRefusalRecovery(
  settings: RefusalPolicySource,
  reviewer?: RefusalReviewer,
): RefusalRecovery {
  return new RefusalRecoveryCoordinator({
    settings,
    wait: delay,
    reviewer,
  });
}
