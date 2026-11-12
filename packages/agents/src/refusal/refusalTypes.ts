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
 * What to do with a refused attempt. `retry` resends the same prepared request
 * after `delayMs`; `stop` ends the logical request. A later phase adds
 * `review`. The optional `notice` is the user-facing text for the decision.
 */
export type RefusalDecision =
  | {
      readonly action: 'retry';
      readonly delayMs: number;
      readonly notice: string;
    }
  | { readonly action: 'stop'; readonly notice?: string };

/** The hook a recovery coordinator implements to take over refusals. */
export interface RefusalRecovery {
  /** Fixes the recovery policy for a logical request the first time it is seen. */
  admit(promptId: string): void;
  decide(attempt: RefusalAttempt): RefusalDecision | Promise<RefusalDecision>;
  /** Abortable wait before a retry; rejects as soon as `signal` aborts. */
  wait(ms: number, signal?: AbortSignal): Promise<void>;
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
