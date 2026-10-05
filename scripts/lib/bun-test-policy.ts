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
import { resolve } from 'node:path';
import { throwWorkerFailures } from './bespoke-runner-isolation.js';

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
 *
 * A runner enforcing this must not report the file's result from inside the
 * timeout callback. Killing a process — or a process tree — only signals it;
 * resolving straight away frees the worker slot while the child is still
 * winding down, so the pool exceeds its concurrency cap exactly when the
 * machine is already struggling, and a timeout on one file becomes timeouts on
 * others. Wait for the child to be reaped first, either by settling from the
 * `exit` handler (see the agents, cli and auth runners) or by awaiting the kill
 * (see the core runner).
 */
export const DEFAULT_PER_FILE_TIMEOUT_MS = 300_000;

interface AcceptanceTestPolicy {
  readonly perTestTimeoutMs: number;
  readonly perFileTimeoutMs: number;
}

/** Only these measured suites need a budget beyond the ordinary hang guard. */
export function acceptancePolicyForFile(
  workspaceRoot: string,
  file: string,
): AcceptanceTestPolicy | undefined {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, file.replaceAll('\\', '/'));
  const agentsRoot = resolve(import.meta.dir, '../../packages/agents');
  const cliRoot = resolve(import.meta.dir, '../../packages/cli');
  if (
    root === agentsRoot &&
    absolute ===
      resolve(agentsRoot, 'src/core/__tests__/childaccept-memory.test.ts')
  ) {
    return { perTestTimeoutMs: 7_200_000, perFileTimeoutMs: 7_260_000 };
  }
  if (
    root === cliRoot &&
    absolute === resolve(cliRoot, 'src/services/wholememory.test.ts')
  ) {
    return { perTestTimeoutMs: 14_400_000, perFileTimeoutMs: 14_460_000 };
  }
  return undefined;
}

/** Drain ordinary workers before running memory measurements one at a time. */
export async function scheduleTestFiles<T>(
  workspaceRoot: string,
  files: readonly string[],
  concurrency: number,
  runFile: (file: string) => Promise<T>,
): Promise<T[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('Test concurrency must be a positive integer');
  }
  const ordinary: string[] = [];
  const acceptance: string[] = [];
  for (const file of files) {
    (acceptancePolicyForFile(workspaceRoot, file) === undefined
      ? ordinary
      : acceptance
    ).push(file);
  }
  const results: T[] = [];
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < ordinary.length) {
      results.push(await runFile(ordinary[nextIndex++]));
    }
  };
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, ordinary.length) }, worker),
  );
  throwWorkerFailures(workers);
  for (const file of acceptance) {
    results.push(await runFile(file));
  }
  return results;
}

// This override gives behavioral runner tests a short budget; it is not a CI tuning knob.
export function envPerFileTimeoutMs(
  env: NodeJS.ProcessEnv,
  varName: string,
): number | undefined {
  const raw = env[varName];
  if (raw === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${varName} must be a positive integer, got: ${raw}`);
  }
  return parsed;
}

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
      const parsed = Number.parseInt(override.trim(), 10);
      // The digit-shape check alone would accept an arbitrarily long run of
      // digits, which parseInt rounds to an imprecise Number or to Infinity;
      // that would silently become the size of the worker pool.
      if (
        !/^[1-9][0-9]*$/.test(override.trim()) ||
        !Number.isSafeInteger(parsed)
      ) {
        throw new Error(
          `${options.envVar} must be a positive integer, got: ${override}`,
        );
      }
      // Deliberately not clamped: an override exists so a human can exceed the
      // default, most often to pin a run to 1 while chasing a flake.
      return parsed;
    }
  }

  if (platform === 'darwin' && env['CI'] === 'true') {
    return MIN_TEST_CONCURRENCY;
  }

  // availableParallelism() reports the machine's cores, not this process's
  // share of them. On a CI runner — which is dedicated — those are the same
  // thing. On a development machine running several checkouts at once they are
  // not, and half of the cores is still more than the runner actually has; the
  // env override above is the escape hatch for that case.
  const cores = options.cores ?? availableParallelism();
  const half = Math.floor(cores / 2);
  return Math.min(ceiling, Math.max(MIN_TEST_CONCURRENCY, half));
}
