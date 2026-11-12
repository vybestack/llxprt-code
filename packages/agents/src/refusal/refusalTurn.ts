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

/** Counters for the attempts of one streamed turn. */
export interface AttemptCounters {
  /** Content-retry count: drives the retry temperature and its budget. */
  contentAttempt: number;
  /** Requests sent so far for this turn, whatever caused each resend. */
  requestAttempt: number;
  /** Whether the next attempt must announce that it replaces a failed one. */
  announceRetry: boolean;
}

/** How one stream attempt ended, for the turn's retry loop. */
export type StreamAttemptOutcome =
  | { error: unknown; action: 'retry' | 'stop' }
  | { error: null; action: 'retry-same-request'; delayMs: number };

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
  if (settlement.action === 'retry-same-request') {
    yield { type: StreamEventType.RETRY };
    yield refusalNotice(settlement.notice);
    return {
      error: null,
      action: 'retry-same-request',
      delayMs: settlement.delayMs,
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
    attempt.requestAttempt++;
    attempt.announceRetry = false;
    return true;
  }
  await delay(
    INVALID_CONTENT_RETRY_OPTIONS.initialDelayMs * (attempt.contentAttempt + 1),
    deps.signal,
  );
  attempt.contentAttempt++;
  attempt.requestAttempt++;
  attempt.announceRetry = true;
  return true;
}
