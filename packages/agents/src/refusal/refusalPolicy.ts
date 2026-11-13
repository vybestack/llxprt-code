/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Longest wait between two refusal retries, whatever the base. */
export const REFUSAL_BACKOFF_CAP_MS = 180_000;

/**
 * The refusal recovery settings in force for one logical request. Captured
 * once when the request is admitted, so a `/set` during recovery changes the
 * next request and never the one in flight.
 */
export interface RefusalPolicy {
  /** Identical retries before review. */
  readonly retries: number;
  /** Base wait before the first retry, in milliseconds. */
  readonly backoffMs: number;
  /** Whether review and rewrite may run once retries are exhausted. */
  readonly rewrite: boolean;
  readonly reviewProfile: string | undefined;
  /** Review rounds allowed per logical request. */
  readonly maxRewrites: number;
}

/** Live accessors the policy is captured from. */
export interface RefusalPolicySource {
  retries(): number;
  backoffMs(): number;
  rewrite(): boolean;
  reviewProfile(): string | undefined;
  maxRewrites(): number;
}

export function captureRefusalPolicy(
  source: RefusalPolicySource,
): RefusalPolicy {
  return {
    retries: source.retries(),
    backoffMs: source.backoffMs(),
    rewrite: source.rewrite(),
    reviewProfile: source.reviewProfile(),
    maxRewrites: source.maxRewrites(),
  };
}

/** What a logical request has already spent from its policy. */
export interface RefusalProgress {
  /** Identical retries used in the current round. */
  readonly retriesUsed: number;
  /** Review rounds used. */
  readonly rewritesUsed: number;
}

export type RefusalVerdict =
  | {
      readonly action: 'retry';
      /** 1-based number of the retry being granted. */
      readonly retryNumber: number;
      readonly delayMs: number;
    }
  | { readonly action: 'review' }
  | { readonly action: 'stop' };

/** Wait before retry `retryNumber` (1-based): min(base * 4^(n-1), 180 s). */
export function refusalBackoffMs(baseMs: number, retryNumber: number): number {
  return Math.min(baseMs * 4 ** (retryNumber - 1), REFUSAL_BACKOFF_CAP_MS);
}

/**
 * Decides what follows a refused attempt. Pure: it spends nothing, so the
 * caller applies the verdict to its own bookkeeping.
 */
export function decideRefusal(
  policy: RefusalPolicy,
  progress: RefusalProgress,
): RefusalVerdict {
  if (progress.retriesUsed < policy.retries) {
    const retryNumber = progress.retriesUsed + 1;
    return {
      action: 'retry',
      retryNumber,
      delayMs: refusalBackoffMs(policy.backoffMs, retryNumber),
    };
  }
  if (policy.rewrite && progress.rewritesUsed < policy.maxRewrites) {
    return { action: 'review' };
  }
  return { action: 'stop' };
}
