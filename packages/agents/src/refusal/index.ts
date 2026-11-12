/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  ModelRefusalSignal,
  type RefusalAttempt,
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
export { waitBeforeRefusalRetry, type RefusalWait } from './refusalWait.js';
export { type RefusalPolicySource } from './refusalPolicy.js';
export { recordRefusalInJournal, toRefusalPayload } from './refusalJournal.js';
export { settleRefusal, type RefusalSettlement } from './refusalSettlement.js';
export { finishWithRefusal } from './refusalPostTurn.js';
export {
  advanceAfterAttempt,
  announceRefusalSettlement,
  type AttemptCounters,
  type StreamAttemptOutcome,
} from './refusalTurn.js';

import { RefusalRecoveryCoordinator } from './refusalRecovery.js';
import type { RefusalPolicySource } from './refusalPolicy.js';
import type { RefusalRecovery } from './refusalTypes.js';
import { waitBeforeRefusalRetry } from './refusalWait.js';

/** The recovery a chat session uses: live settings and the abortable timer. */
export function createRefusalRecovery(
  settings: RefusalPolicySource,
): RefusalRecovery {
  return new RefusalRecoveryCoordinator({
    settings,
    wait: waitBeforeRefusalRetry,
  });
}
