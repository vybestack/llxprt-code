/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Blocking check-watch for pr.checks.
 *
 * The host owns the polling loop, so the agent issues one call that returns
 * when CI concludes. This replaces the pattern where the model polls itself
 * and fights tool timeouts.
 *
 * @plan PLAN-20260731-GHBROKER.P13
 * @requirement REQ-007, REQ-010
 * @pseudocode 003-github-broker.md lines 96-100, 105-109
 */

import type { GhRunner } from './github-broker-types.js';

/**
 * Poll cadence. Lint and format checks typically fail inside the first
 * minute, so the early phase is fast to surface those quickly; steady state
 * then backs off. At 30s a watch costs about 120 requests/hour against a
 * 5000/hour REST budget (~2.4%), with 30s worst-case staleness.
 *
 * @plan PLAN-20260731-GHBROKER.P13
 * @requirement REQ-010
 */
export const EARLY_POLL_MS = 10_000;
export const STEADY_POLL_MS = 30_000;
export const EARLY_PHASE_MS = 30_000;

/**
 * How long to wait for checks to appear before concluding a pull request has
 * none. Long enough for a workflow to register after a push, short enough
 * that a PR with no CI does not block for the full maximum duration.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-010
 */
export const NO_CHECKS_GRACE_MS = 120_000;

/**
 * Consecutive failed polls tolerated before a watch gives up. Transient API
 * or network errors should not end a wait whose checks are still running;
 * a persistent fault should not be retried forever.
 *
 * @plan PLAN-20260731-GHBROKER.P19
 * @requirement REQ-010
 */
export const MAX_CONSECUTIVE_POLL_FAILURES = 3;

/**
 * Returns the poll interval for a given elapsed time.
 *
 * @plan PLAN-20260731-GHBROKER.P13
 * @requirement REQ-010
 */
export function pollIntervalFor(elapsedMs: number): number {
  return elapsedMs < EARLY_PHASE_MS ? EARLY_POLL_MS : STEADY_POLL_MS;
}

/** A single check row as gh reports it. */
export interface CheckRow {
  readonly name: string;
  readonly bucket: string;
  readonly state: string;
  readonly link: string;
}

/**
 * True when no check is still pending.
 *
 * gh already classifies each check into a bucket of pass, fail, pending or
 * skipping, so the terminal condition reads directly off that rather than
 * re-deriving it from the state string.
 *
 * @plan PLAN-20260731-GHBROKER.P13
 * @requirement REQ-010
 * @pseudocode 003-github-broker.md lines 105-109
 */
export function checksConcluded(checks: readonly CheckRow[]): boolean {
  if (checks.length === 0) return false;
  return !checks.some((c) => c.bucket === 'pending');
}

/**
 * Counts checks by bucket.
 *
 * @plan PLAN-20260731-GHBROKER.P13
 * @requirement REQ-013
 */
export function summarise(checks: readonly CheckRow[]): Record<string, number> {
  const summary: Record<string, number> = {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
  };
  for (const c of checks) {
    summary[c.bucket] = (summary[c.bucket] ?? 0) + 1;
  }
  return summary;
}

/** Normalises raw gh JSON into check rows. */
export function toCheckRows(raw: unknown): CheckRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>;
    return {
      name: typeof o.name === 'string' ? o.name : '',
      bucket: typeof o.bucket === 'string' ? o.bucket : '',
      state: typeof o.state === 'string' ? o.state : '',
      link: typeof o.link === 'string' ? o.link : '',
    };
  });
}

/**
 * Sleeps for `ms`, resolving early if the signal aborts.
 *
 * Aborting must not wait out the remaining interval, otherwise Ctrl+C would
 * appear to hang for up to the poll period.
 *
 * @plan PLAN-20260731-GHBROKER.P13
 * @requirement REQ-007
 */
export function interruptibleSleep(
  ms: number,
  signal: AbortSignal,
  timer: (fn: () => void, delay: number) => unknown = setTimeout,
  clear: (handle: unknown) => void = (h) =>
    clearTimeout(h as ReturnType<typeof setTimeout>),
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const handle = timer(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clear(handle);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** The shaped result of a watch. */
export interface WatchResult {
  readonly checks: readonly CheckRow[];
  readonly summary: Record<string, number>;
  readonly concluded: boolean;
  readonly cancelled: boolean;
  readonly elapsedMs: number;
  readonly polls: number;
}

/**
 * Polls `gh pr checks` until every check leaves the pending bucket, the
 * caller cancels, or the deadline passes.
 *
 * @plan PLAN-20260731-GHBROKER.P13
 * @requirement REQ-007, REQ-010
 */
export async function watchChecks(
  argv: readonly string[],
  run: GhRunner,
  signal: AbortSignal,
  options: {
    now?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    maxDurationMs?: number;
  } = {},
): Promise<WatchResult> {
  // Monotonic by default. Date.now() moves backwards across an NTP step or
  // manual clock change, which would let elapsed time shrink and slip past
  // both the grace period and the maximum duration — turning a bounded
  // watch into an unbounded one. Tests inject their own clock.
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? interruptibleSleep;
  const maxDurationMs = options.maxDurationMs ?? 3_600_000;
  const started = now();

  let checks: CheckRow[] = [];
  let polls = 0;
  let consecutiveFailures = 0;

  const stop = (concluded: boolean, cancelled: boolean): WatchResult => ({
    checks,
    summary: summarise(checks),
    concluded,
    cancelled,
    elapsedMs: now() - started,
    polls,
  });

  for (;;) {
    // Checked at the top so a cancellation delivered during the sleep is
    // noticed before another request is spent.
    if (signal.aborted) return stop(false, true);

    // gh exits non-zero while checks are failing or pending, so a non-zero
    // exit here is expected rather than an error.
    //
    // A throw is different: a dropped network, a transient API error. Over
    // a watch that can run for an hour, letting one bad poll end the whole
    // wait would be worse than useless, because the checks it was waiting
    // on carry on running. Tolerate a short run of consecutive failures and
    // retry on the next tick; give up only when they persist, and surface
    // the last cause rather than a bare timeout.
    try {
      checks = toCheckRows(await run(argv, { tolerateNonZeroExit: true }));
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures > MAX_CONSECUTIVE_POLL_FAILURES) throw err;
      // No abort check here: `continue` re-enters at the top of the loop,
      // which tests it before spending another request.
      await sleep(pollIntervalFor(now() - started), signal);
      continue;
    }
    polls += 1;

    if (checksConcluded(checks)) return stop(true, false);

    // A pull request with no checks configured never concludes, because an
    // empty list is deliberately not a terminal state — checks that have not
    // registered yet are not checks that finished. Give them a bounded grace
    // period to appear, then stop rather than blocking for the full hour.
    if (checks.length === 0 && now() - started >= NO_CHECKS_GRACE_MS) {
      return stop(false, false);
    }

    const elapsed = now() - started;
    if (elapsed >= maxDurationMs) return stop(false, false);

    await sleep(pollIntervalFor(elapsed), signal);
  }
}
