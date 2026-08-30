/**
 * Retry policy for per-file timeout kills in the Bun test runners
 * (issue #3439).
 *
 * A child killed by the per-file timeout gets one fresh attempt: the sporadic
 * bun-on-Windows freeze kills one attempt and behaves normally on the next,
 * while a genuine assertion failure never times out and is never retried by
 * this budget. The pre-existing `entry.retries` budget (any failure, opt-in
 * used by the e2e configs) stays independent and unchanged.
 */

/** Minimal child-exit shape shared by every runner in this repo. */
export interface ChildExitLike {
  readonly exitCode: number | null;
  readonly signalCode?: string | null;
}

const DEFAULT_TIMEOUT_RETRIES = 1;
const TIMEOUT_RETRIES_ENV_VAR = 'LLXPRT_BUN_TEST_TIMEOUT_RETRIES';

/** Timeout-only retry budget per file; 0 disables (issue #3439). */
export function resolveTimeoutRetryBudget(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[TIMEOUT_RETRIES_ENV_VAR];
  if (raw === undefined || raw === '') {
    return DEFAULT_TIMEOUT_RETRIES;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${TIMEOUT_RETRIES_ENV_VAR} value: ${raw} (expected a non-negative integer)`,
    );
  }
  return parsed;
}

/**
 * True when the child was terminated by the kill signal the per-file timeout
 * (or a manual kill) uses. Shared by the pass/fail classification and the
 * retry loop so the two can never disagree about what counts as a timeout.
 */
export function wasKilledByTimeoutSignal(child: ChildExitLike): boolean {
  return child.signalCode === 'SIGTERM' || child.signalCode === 'SIGKILL';
}

/** The retry a failed attempt earns, or null when the file is done. */
export type RetryPlan =
  | { readonly kind: 'timeout'; readonly message: string }
  | { readonly kind: 'failure'; readonly message: string };

/**
 * Decides whether a failed attempt is retried. Timeout kills draw from the
 * timeout budget first; every other failure falls through to the pre-existing
 * failure budget. Pure so the exact messages stay unit-testable.
 */
export function planNextAttempt(
  outcome: {
    readonly passed: boolean;
    readonly timedOut: boolean;
    readonly diagnostic: string;
  },
  state: {
    readonly attempt: number;
    readonly failureAttempts: number;
    readonly timeoutRetriesLeft: number;
  },
  file: string,
): RetryPlan | null {
  if (outcome.passed) {
    return null;
  }
  if (outcome.timedOut && state.timeoutRetriesLeft > 0) {
    return {
      kind: 'timeout',
      message: `Native Bun test timed out (attempt ${state.attempt}), retrying: ${file}${outcome.diagnostic}`,
    };
  }
  if (state.attempt < state.failureAttempts) {
    return {
      kind: 'failure',
      message: `Native Bun test failed (attempt ${state.attempt}/${state.failureAttempts}), retrying: ${file}${outcome.diagnostic}`,
    };
  }
  return null;
}
