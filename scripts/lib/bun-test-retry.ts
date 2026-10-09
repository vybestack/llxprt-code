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

import {
  DEFAULT_PER_FILE_TIMEOUT_MS,
  DEFAULT_PER_TEST_TIMEOUT_MS,
  envPerFileTimeoutMs,
} from './bun-test-policy.js';

/** Minimal child-exit shape shared by every runner in this repo. */
export interface ChildExitLike {
  readonly exitCode: number | null;
  readonly signalCode?: string | null;
}

const DEFAULT_TIMEOUT_RETRIES = 1;
const INTEGRATION_PER_TEST_TIMEOUT_MS = DEFAULT_PER_TEST_TIMEOUT_MS * 2;
const INTEGRATION_PER_FILE_TIMEOUT_MS = 900_000;
const SHARED_DEFAULT_PROCESS_TIMEOUT_MS = 120_000;

export type RunnerTimeoutInput =
  | {
      readonly runner: 'cli';
      readonly integration: boolean;
      readonly env: NodeJS.ProcessEnv;
    }
  | { readonly runner: 'agents'; readonly env: NodeJS.ProcessEnv }
  | { readonly runner: 'core'; readonly timeoutMs?: number }
  | { readonly runner: 'auth' }
  | { readonly runner: 'shared'; readonly testTimeoutMs: number };
export interface AttemptTimeouts {
  readonly perTestMs: number;
  readonly perFileMs: number;
}
export function resolveRunnerTimeouts(
  input: RunnerTimeoutInput,
): AttemptTimeouts {
  switch (input.runner) {
    case 'cli': {
      const override = envPerFileTimeoutMs(
        input.env,
        'LLXPRT_TEST_FILE_TIMEOUT_MS',
      );
      return input.integration
        ? {
            perTestMs: INTEGRATION_PER_TEST_TIMEOUT_MS,
            perFileMs: INTEGRATION_PER_FILE_TIMEOUT_MS,
          }
        : {
            perTestMs: DEFAULT_PER_TEST_TIMEOUT_MS,
            perFileMs: override ?? DEFAULT_PER_FILE_TIMEOUT_MS,
          };
    }
    case 'agents':
      return {
        perTestMs: DEFAULT_PER_TEST_TIMEOUT_MS,
        perFileMs:
          envPerFileTimeoutMs(input.env, 'LLXPRT_TEST_FILE_TIMEOUT_MS') ??
          DEFAULT_PER_FILE_TIMEOUT_MS,
      };
    case 'core':
      return {
        perTestMs: DEFAULT_PER_TEST_TIMEOUT_MS,
        perFileMs: input.timeoutMs ?? DEFAULT_PER_FILE_TIMEOUT_MS,
      };
    case 'auth':
      return {
        perTestMs: DEFAULT_PER_TEST_TIMEOUT_MS,
        perFileMs: DEFAULT_PER_FILE_TIMEOUT_MS,
      };
    case 'shared':
      return {
        perTestMs: input.testTimeoutMs,
        perFileMs: Math.max(
          SHARED_DEFAULT_PROCESS_TIMEOUT_MS,
          input.testTimeoutMs * 2,
        ),
      };
  }
  const unreachable: never = input;
  throw new Error(`Unreachable runner timeout variant: ${unreachable}`);
}
export type AttemptClassificationInput =
  | {
      readonly runner: 'cli' | 'agents' | 'auth';
      readonly killedByTimer: boolean;
      readonly exitCode: number | null;
    }
  | {
      readonly runner: 'core';
      readonly spawnFailed: boolean;
      readonly killedByTimer: boolean;
      readonly exitCode: number | null;
      readonly fileTimeoutMs: number;
      readonly perTestTimeout: boolean;
    }
  | {
      readonly runner: 'shared';
      readonly exitCode: number | null;
      readonly signalCode?: string | null;
      readonly stdout?: string;
      readonly stderr?: string;
    };
export interface AttemptClassification {
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly timeoutMs: number | null;
}
export function classifyAttempt(
  input: AttemptClassificationInput,
): AttemptClassification {
  if (input.runner === 'shared') {
    const output = `${input.stdout ?? ''}\n${input.stderr ?? ''}`;
    const passed =
      input.exitCode === 0 ||
      (wasKilledByTimeoutSignal(input) &&
        /\b0 fail\b/.test(output) &&
        /\bRan \d+ tests?\b/.test(output));
    return {
      passed,
      timedOut: !passed && wasKilledByTimeoutSignal(input),
      timeoutMs: null,
    };
  }
  if (input.runner === 'core') {
    const timedOut =
      !input.spawnFailed && (input.killedByTimer || input.perTestTimeout);
    return {
      passed: !input.spawnFailed && input.exitCode === 0 && !timedOut,
      timedOut,
      timeoutMs: input.perTestTimeout ? null : input.fileTimeoutMs,
    };
  }
  const timedOut = input.killedByTimer;
  return {
    passed: !timedOut && input.exitCode === 0,
    timedOut,
    timeoutMs: null,
  };
}
export async function runTimeoutRetry<T extends { readonly timedOut: boolean }>(
  file: string,
  runAttempt: () => Promise<T>,
  logRetry: (message: string) => void,
): Promise<T> {
  const first = await runAttempt();
  if (!first.timedOut) return first;
  logRetry(`RETRY (2/2): ${file} after per-file timeout`);
  return runAttempt();
}
export interface CoreRetryOutcome {
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly timeoutMs: number | null;
  readonly reapFailed: boolean;
  readonly reapError?: string | null;
}
export async function runCoreTimeoutRetry<T extends CoreRetryOutcome>(
  file: string,
  runAttempt: () => Promise<T>,
  logRetry: (message: string) => void,
): Promise<T> {
  const first = await runAttempt();
  if (!first.timedOut) return first;
  logRetry(
    `RETRY (2/2): ${file} after ${first.timeoutMs === null ? 'per-test' : 'per-file'} timeout`,
  );
  const second = await runAttempt();
  if (first.reapFailed && !second.reapFailed)
    return {
      ...second,
      passed: false,
      timedOut: true,
      reapFailed: false,
      reapError: first.reapError ?? null,
    };
  return second;
}
export interface EntryRetryOutcome {
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly diagnostic: string;
}
export async function runEntryRetries<T extends EntryRetryOutcome>(
  file: string,
  failureRetries: number,
  runAttempt: () => Promise<T>,
  logRetry: (message: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const failureAttempts = failureRetries + 1;
  let timeoutRetriesLeft = resolveTimeoutRetryBudget(env);
  let attempt = 1;
  let outcome = await runAttempt();
  while (true) {
    const plan = planNextAttempt(
      outcome,
      { attempt, failureAttempts, timeoutRetriesLeft },
      file,
    );
    if (plan === null) return outcome;
    logRetry(plan.message);
    if (plan.kind === 'timeout') timeoutRetriesLeft--;
    attempt++;
    outcome = await runAttempt();
  }
}

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

export {
  cleanupAttemptDirectory,
  observeChildClose,
  killChildTreeAndWait,
  killTimedOutChild,
  reapStaleBunTestProcesses,
} from './bun-test-reaper.js';
export {
  buildCliJUnitCases,
  buildCoreJUnitCases,
  buildAuthJUnitCases,
  renderJUnitReport,
  formatAuthFailureReason,
  formatAgentsFailureReason,
  escapeCliXml,
  stripAnsi,
  parseCaseCounts,
  failureExcerpt,
  junitReportContainsPerTestTimeout,
  JUNIT_SCAN_CHUNK_BYTES,
  writeJUnitReport,
  createJunitTempDirectory,
} from './junit-report-writer.js';
