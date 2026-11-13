/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  INVALID_CONTENT_RETRY_OPTIONS,
  StreamEventType,
  type StreamEvent,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { RefusalSettlement } from './refusalSettlement.js';
import type { RefusalRecovery } from './refusalTypes.js';
import type { PendingTurnContents } from './reviewTypes.js';
import { applyPendingEdits, type PendingEdit } from './reviewWindow.js';

/** Counters for the attempts of one streamed turn. */
export interface AttemptCounters {
  /** Content-retry count: drives the retry temperature and its budget. */
  contentAttempt: number;
  /**
   * Index of the request being sent, allocated from the prompt-owned counter
   * so it is unique over every send that reuses the prompt id.
   */
  requestAttempt: number;
  /** Whether the next attempt must announce that it replaces a failed one. */
  announceRetry: boolean;
}

/** How one stream attempt ended, for the turn's retry loop. */
export type StreamAttemptOutcome =
  | { error: unknown; action: 'retry' | 'stop' }
  | {
      error: null;
      action: 'retry-same-request';
      delayMs: number;
      /** Set when a reviewer rewrote context: the resend is rebuilt. */
      rewrite?: { readonly pendingEdits: readonly PendingEdit[] };
    };

export function refusalNotice(message: string): StreamEvent {
  return {
    type: StreamEventType.NOTICE,
    message,
    source: 'refusal-recovery',
  };
}

/**
 * Tells the host what a refusal decision means. A resend first discards the
 * refused attempt (the same signal a content retry gives), then announces the
 * wait; a stop only carries the summary notice, when there is one.
 */
export async function* announceRefusalSettlement(
  settlement: RefusalSettlement,
): AsyncGenerator<StreamEvent, StreamAttemptOutcome> {
  if (settlement.action === 'review') {
    yield refusalNotice(settlement.notice);
    return yield* announceRefusalSettlement(await settlement.complete());
  }
  if (settlement.action === 'retry-same-request') {
    yield { type: StreamEventType.RETRY };
    yield refusalNotice(settlement.notice);
    return {
      error: null,
      action: 'retry-same-request',
      delayMs: settlement.delayMs,
      ...(settlement.rewrite !== undefined && { rewrite: settlement.rewrite }),
    };
  }
  if (settlement.notice !== undefined) {
    yield refusalNotice(settlement.notice);
  }
  return { error: null, action: 'stop' };
}

/**
 * Waits out a refusal backoff. A wait that fails (an abort, in practice) ends
 * the prompt's pending token-usage state, because no further attempt will
 * come to consume it.
 */
export async function waitOutRefusalBackoff(
  recovery: RefusalRecovery,
  usageLogger: { finalizePrompt(promptId: string): void } | null,
  delayMs: number,
  promptId: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await recovery.wait(delayMs, signal);
  } catch (error: unknown) {
    usageLogger?.finalizePrompt(promptId);
    throw error;
  }
}

export interface AttemptAdvanceDeps {
  readonly recovery: RefusalRecovery;
  readonly usageLogger: { finalizePrompt(promptId: string): void } | null;
  readonly promptId: string;
  readonly signal: AbortSignal | undefined;
}

/**
 * Applies the outcome of an attempt to the turn's counters and waits out the
 * pause before the next one. Returns false when the turn is over. A content
 * retry backs off briefly and advances both counters; a refusal retry waits the
 * recovery's backoff and advances only the request counter, so the retry
 * temperature stays as it was.
 */
export async function advanceAfterAttempt(
  outcome: StreamAttemptOutcome,
  attempt: AttemptCounters,
  deps: AttemptAdvanceDeps,
): Promise<boolean> {
  if (outcome.action === 'stop') return false;
  if (outcome.action === 'retry-same-request') {
    await waitOutRefusalBackoff(
      deps.recovery,
      deps.usageLogger,
      outcome.delayMs,
      deps.promptId,
      deps.signal,
    );
    attempt.requestAttempt = deps.recovery.allocateAttempt(deps.promptId);
    attempt.announceRetry = false;
    return true;
  }
  await delay(
    INVALID_CONTENT_RETRY_OPTIONS.initialDelayMs * (attempt.contentAttempt + 1),
    deps.signal,
  );
  attempt.contentAttempt++;
  attempt.requestAttempt = deps.recovery.allocateAttempt(deps.promptId);
  attempt.announceRetry = true;
  return true;
}

/**
 * The user turn to send with the next attempt: the same one, or, after a
 * reviewer rewrote tool results it carries, that turn with the rewritten text.
 * The turn keeps its media-admission lifecycle, so the rewritten turn is what
 * finally commits to the history.
 */
export function turnForNextAttempt<T extends PendingTurnContents>(
  turn: T,
  outcome: StreamAttemptOutcome,
): T {
  if (outcome.action !== 'retry-same-request') return turn;
  const edits = outcome.rewrite?.pendingEdits ?? [];
  if (edits.length === 0) return turn;
  return {
    ...turn,
    userContents: applyPendingEdits(turn.userContents, edits),
    userIContents: applyPendingEdits(turn.userIContents, edits),
  };
}

/** What the next attempt's request is: the one just sent, or a fresh build. */
interface KeptRequest {
  resendIdentically(): void;
  discard(): void;
}

/**
 * Decides whether the next attempt resends the request just sent. Only an
 * identical refusal retry does; a content retry or a reviewer rewrite changes
 * what should be sent, so the next attempt builds its request afresh.
 */
export function keepRequestForNextAttempt(
  request: KeptRequest,
  outcome: StreamAttemptOutcome,
): void {
  if (
    outcome.action === 'retry-same-request' &&
    outcome.rewrite === undefined
  ) {
    request.resendIdentically();
  } else {
    request.discard();
  }
}
