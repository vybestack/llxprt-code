/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { PendingTurnContents } from './reviewTypes.js';
import type { PendingEdit } from './reviewWindow.js';

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
 * after `delayMs` (a reviewer rewrite is a retry with no wait); `stop` ends the
 * logical request. The optional `notice` is the user-facing text for the
 * decision. A retry that follows a reviewer rewrite carries `rewrite`: the
 * resend must be rebuilt from the rewritten history and, where the reviewer
 * edited the pending user turn, from that turn with `pendingEdits` applied.
 */
export type ResolvedRefusalDecision =
  | {
      readonly action: 'retry';
      readonly delayMs: number;
      readonly notice: string;
      readonly rewrite?: {
        readonly pendingEdits: readonly PendingEdit[];
        /** The committed history was rewritten, not just the pending turn. */
        readonly historyRewritten: boolean;
      };
    }
  | { readonly action: 'stop'; readonly notice?: string };

/**
 * A decision that is not final yet: a reviewer was chosen and is about to be
 * asked. `notice` tells the user so before the caller waits on `complete`,
 * which asks the reviewer and resolves to the final retry or stop.
 */
export interface ReviewInProgress {
  readonly action: 'review';
  readonly notice: string;
  complete(): Promise<ResolvedRefusalDecision>;
}

export type RefusalDecision = ResolvedRefusalDecision | ReviewInProgress;

/** What a decision may need from the request that was refused. */
export interface RefusalContext {
  /** The session journal, when the host keeps one. */
  readonly execution?: AgentChatRecordingExecution;
  /** The user turn the refused request carried, not yet in the history. */
  readonly pending?: PendingTurnContents;
  /** The admitted route of the refused request. */
  readonly modelParameters?: AdmittedModelParameters;
  /** Aborts a review in progress. */
  readonly signal?: AbortSignal;
}

/** The hook a recovery coordinator implements to take over refusals. */
export interface RefusalRecovery {
  /** Fixes the recovery policy for a logical request the first time it is seen. */
  admit(promptId: string): void;
  decide(
    attempt: RefusalAttempt,
    context?: RefusalContext,
  ): RefusalDecision | Promise<RefusalDecision>;
  /**
   * Called when an attempt succeeded. Returns the notice to show the first
   * time a request succeeds after a reviewer rewrote its context.
   */
  recovered(promptId: string): string | undefined;
  /** Abortable wait before a retry; rejects as soon as `signal` aborts. */
  wait(ms: number, signal?: AbortSignal): Promise<void>;
  /**
   * The next attempt index of a logical request, counted from zero over every
   * send that reuses its prompt id, so token-log and journal records of its
   * attempts never share an index.
   */
  allocateAttempt(promptId: string): number;
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
