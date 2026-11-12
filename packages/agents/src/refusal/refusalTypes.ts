/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * What the shared attempt boundary observed when a provider attempt ended
 * with the canonical finish reason `refusal` (issue #4036). Carried by
 * {@link ModelRefusalSignal} from the stream finalizer to the turn loop.
 */
export interface RefusalEvidence {
  readonly finishReason: 'refusal';
  readonly rawStopReason?: string;
  readonly usage?: UsageStats;
  /** Canonical turn id of the refused request. */
  readonly turnId: string;
}

/** A refused attempt, identified within its logical request. */
export interface RefusalAttempt extends RefusalEvidence {
  readonly promptId: string;
  /** Index of the attempt within the logical request, from zero. */
  readonly attemptIndex: number;
  readonly provider: string;
  readonly model: string;
}

/**
 * What to do with a refused attempt. Phase 1 can only stop; later phases add
 * `retry` (resend the same prepared request) and `review`.
 */
export type RefusalDecision = { readonly action: 'stop' };

/** The hook a recovery coordinator implements to take over refusals. */
export interface RefusalRecovery {
  decide(attempt: RefusalAttempt): RefusalDecision | Promise<RefusalDecision>;
}

/**
 * Thrown from the stream finalizer, in place of the history commit, when an
 * attempt ended with a refusal. It is a typed outcome rather than a failure:
 * the turn loop catches it before any generic retry classification, so a
 * refusal never reaches the content-retry path that changes the temperature
 * or the "System: Please continue." continuation.
 */
export class ModelRefusalSignal extends Error {
  constructor(readonly evidence: RefusalEvidence) {
    super('Model ended the attempt with a refusal.');
    this.name = 'ModelRefusalSignal';
  }
}
