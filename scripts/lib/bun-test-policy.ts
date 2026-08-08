/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Single source of truth for how the Bun test runners schedule work
 * (issue #3139).
 *
 * Each workspace owns a `run-bun-tests.ts` that spawns one `bun test` process
 * per file. Those runners grew independently and ended up disagreeing about
 * both how many files to run at once and how long a test may take. The
 * `agents` runner was tuned against measurement in #3084 and the others were
 * not, so the workspaces still carrying the untuned policy are the ones whose
 * CI shards fail: `cli` saturated every core while keeping a 30s per-test
 * budget, and `auth` passed no `--timeout` at all and therefore ran on Bun's
 * 5s default.
 *
 * The failures that policy produces are indistinguishable from flakiness: a
 * different file times out on each run and every one of them passes in
 * isolation. The work completes; the budget simply cut it off.
 *
 * Justified per-runner differences are preserved through `maxConcurrency` and
 * explicit timeout arguments. What is centralised is the shape of the policy,
 * so a future runner cannot quietly reintroduce the divergence.
 */

import { availableParallelism } from 'node:os';

/**
 * Per-test budget.
 *
 * Measured on the worst offender: `subagentOrchestrator-loadBalancer` takes
 * ~430ms per launch in isolation but was timed at 78.6s with the pool
 * saturated, while consuming 0.8s of user CPU — it waits rather than computes.
 * Its failure rate across repeated runs was 4/24 at 30s and 0/24 at 60s.
 */
export const DEFAULT_PER_TEST_TIMEOUT_MS = 180_000;

/**
 * Whole-file budget, and the backstop that keeps a raised per-test bound from
 * turning a genuine hang into a longer hang. Sized to admit a slow but
 * progressing file rather than to bound total runtime.
 */
export const DEFAULT_PER_FILE_TIMEOUT_MS = 300_000;

/**
 * Ceiling on files run at once, regardless of core count.
 *
 * Each file is a fresh `bun test` process that re-executes the whole workspace
 * module graph, so throughput stops improving well before the core count and
 * the extra processes only steal time from the tests already running.
 */
export const MAX_TEST_CONCURRENCY = 4;

/** A pool of zero would never run anything. */
export const MIN_TEST_CONCURRENCY = 1;

export interface TestConcurrencyOptions {
  /**
   * Environment variable that overrides the computed value, e.g.
   * `LLXPRT_AGENTS_TEST_CONCURRENCY`. Must parse as a positive integer.
   */
  readonly envVar?: string;
  /**
   * Ceiling for this runner, when it is lower than {@link MAX_TEST_CONCURRENCY}
   * for a reason of its own. `core` caps at 2 because its files are unusually
   * heavy.
   */
  readonly maxConcurrency?: number;
  /** Injected for testing; defaults to the real environment. */
  readonly env?: NodeJS.ProcessEnv;
  /** Injected for testing; defaults to the real platform. */
  readonly platform?: NodeJS.Platform;
  /** Injected for testing; defaults to `availableParallelism()`. */
  readonly cores?: number;
}

/**
 * Files to run at once: half the available cores, clamped.
 *
 * Half rather than all, because a `bun test` child is not single-threaded — it
 * transpiles and collects garbage on its own threads — so one process per core
 * oversubscribes the machine. Throughput does not degrade gracefully there; it
 * collapses. The 680-file `cli` suite, measured on a 16-core machine:
 *
 * | processes per core | wall clock                     |
 * | ------------------ | ------------------------------ |
 * | 0.25               | 184s                           |
 * | 0.50               | 124s                           |
 * | 1.00               | >9min, not one file completed  |
 *
 * Half the cores is both the fastest setting measured and the one that keeps
 * the machine out of the collapse. It is also the setting under which a test
 * finishes inside its budget: at one process per core the same tests are still
 * running when the budget expires, which is why a different file failed on
 * each CI run while every one of them passed in isolation.
 *
 * macOS CI runs one file at a time: its virtual cores repeatedly starved a
 * process past the budget even at half.
 */
export function resolveTestConcurrency(
  options: TestConcurrencyOptions = {},
): number {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const ceiling = options.maxConcurrency ?? MAX_TEST_CONCURRENCY;

  if (!Number.isInteger(ceiling) || ceiling < MIN_TEST_CONCURRENCY) {
    throw new Error(
      `maxConcurrency must be an integer >= ${MIN_TEST_CONCURRENCY}, got: ${ceiling}`,
    );
  }

  if (options.envVar !== undefined) {
    const override = env[options.envVar];
    if (override !== undefined && override.trim() !== '') {
      if (!/^[1-9][0-9]*$/.test(override.trim())) {
        throw new Error(
          `${options.envVar} must be a positive integer, got: ${override}`,
        );
      }
      // Deliberately not clamped: an override exists so a human can exceed the
      // default, most often to pin a run to 1 while chasing a flake.
      return Number.parseInt(override.trim(), 10);
    }
  }

  if (platform === 'darwin' && env['CI'] === 'true') {
    return MIN_TEST_CONCURRENCY;
  }

  const cores = options.cores ?? availableParallelism();
  const half = Math.floor(cores / 2);
  return Math.min(ceiling, Math.max(MIN_TEST_CONCURRENCY, half));
}
