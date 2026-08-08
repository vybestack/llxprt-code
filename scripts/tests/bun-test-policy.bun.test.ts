/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the shared Bun test scheduling policy (issue #3139).
 *
 * The policy exists because four runners disagreeing about concurrency and
 * timeouts made CI green on only 45% of first attempts. These tests pin the
 * behaviour that fixes that, and the last suite pins the invariant that let
 * the divergence happen in the first place: a runner may not spawn `bun test`
 * without an explicit `--timeout`.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_PER_FILE_TIMEOUT_MS,
  DEFAULT_PER_TEST_TIMEOUT_MS,
  MAX_TEST_CONCURRENCY,
  MIN_TEST_CONCURRENCY,
  resolveTestConcurrency,
} from '../lib/bun-test-policy.js';

const REPO_ROOT = join(import.meta.dir, '..', '..');

/**
 * Every runner that spawns `bun test` children — the workspace runners and the
 * shard runner CI invokes alongside them. Both paths run in CI, and it was the
 * disagreement between them that gave the same test two different budgets.
 */
const RUNNERS: string[] = [
  'packages/agents/run-bun-tests.ts',
  'packages/cli/run-bun-tests.ts',
  'packages/core/run-bun-tests.ts',
  'packages/auth/run-bun-tests.ts',
  'scripts/run_bun_tests.ts',
];

function readRunner(runner: string): string {
  return readFileSync(join(REPO_ROOT, runner), 'utf8');
}

describe('resolveTestConcurrency (issue #3139)', () => {
  const linux: NodeJS.Platform = 'linux';

  it('uses half the cores so a bun child is not fighting another for a core', () => {
    expect(resolveTestConcurrency({ cores: 8, platform: linux, env: {} })).toBe(
      4,
    );
    expect(resolveTestConcurrency({ cores: 4, platform: linux, env: {} })).toBe(
      2,
    );
  });

  it('clamps to the shared ceiling on a large machine', () => {
    expect(
      resolveTestConcurrency({ cores: 64, platform: linux, env: {} }),
    ).toBe(MAX_TEST_CONCURRENCY);
  });

  it('never returns zero on a single-core machine', () => {
    expect(resolveTestConcurrency({ cores: 1, platform: linux, env: {} })).toBe(
      MIN_TEST_CONCURRENCY,
    );
  });

  it('honours a lower per-runner ceiling', () => {
    expect(
      resolveTestConcurrency({
        cores: 16,
        platform: linux,
        env: {},
        maxConcurrency: 2,
      }),
    ).toBe(2);
  });

  it('runs one file at a time on macOS CI', () => {
    expect(
      resolveTestConcurrency({
        cores: 12,
        platform: 'darwin',
        env: { CI: 'true' },
      }),
    ).toBe(MIN_TEST_CONCURRENCY);
  });

  it('does not serialize macOS outside CI', () => {
    expect(
      resolveTestConcurrency({ cores: 12, platform: 'darwin', env: {} }),
    ).toBe(MAX_TEST_CONCURRENCY);
  });

  it('lets an env override exceed the default, for pinning a run while chasing a flake', () => {
    expect(
      resolveTestConcurrency({
        cores: 4,
        platform: linux,
        env: { LLXPRT_TEST_CONCURRENCY: '9' },
        envVar: 'LLXPRT_TEST_CONCURRENCY',
      }),
    ).toBe(9);
  });

  it('lets an env override pin a run to one file', () => {
    expect(
      resolveTestConcurrency({
        cores: 16,
        platform: linux,
        env: { LLXPRT_TEST_CONCURRENCY: '1' },
        envVar: 'LLXPRT_TEST_CONCURRENCY',
      }),
    ).toBe(1);
  });

  it('ignores an unset or blank override rather than treating it as zero', () => {
    expect(
      resolveTestConcurrency({
        cores: 8,
        platform: linux,
        env: { LLXPRT_TEST_CONCURRENCY: '   ' },
        envVar: 'LLXPRT_TEST_CONCURRENCY',
      }),
    ).toBe(4);
  });

  it('rejects a non-numeric override instead of silently falling back', () => {
    expect(() =>
      resolveTestConcurrency({
        cores: 8,
        platform: linux,
        env: { LLXPRT_TEST_CONCURRENCY: 'lots' },
        envVar: 'LLXPRT_TEST_CONCURRENCY',
      }),
    ).toThrow('must be a positive integer');
  });

  it('rejects a zero override, which would run nothing', () => {
    expect(() =>
      resolveTestConcurrency({
        cores: 8,
        platform: linux,
        env: { LLXPRT_TEST_CONCURRENCY: '0' },
        envVar: 'LLXPRT_TEST_CONCURRENCY',
      }),
    ).toThrow('must be a positive integer');
  });

  it('rejects a nonsensical per-runner ceiling', () => {
    expect(() =>
      resolveTestConcurrency({
        cores: 8,
        platform: linux,
        env: {},
        maxConcurrency: 0,
      }),
    ).toThrow('maxConcurrency');
  });
});

describe('shared timeout budgets (issue #3139)', () => {
  it('gives a test more than the 30s bound that was measured to cut work off', () => {
    expect(DEFAULT_PER_TEST_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  it('keeps the whole-file backstop above the per-test budget so a hang is still caught', () => {
    expect(DEFAULT_PER_FILE_TIMEOUT_MS).toBeGreaterThan(
      DEFAULT_PER_TEST_TIMEOUT_MS,
    );
  });
});

describe('runner invariants (issue #3139)', () => {
  it('every runner passes an explicit --timeout to bun test', () => {
    // Bun 1.3.14 ignores a `[test] timeout` key in bunfig.toml and falls back
    // to 5s, so the flag is the only thing that actually sets the budget. The
    // auth runner shipped without it and therefore ran on 5s.
    const missing = RUNNERS.filter(
      (runner) => !readRunner(runner).includes("'--timeout'"),
    );
    expect(missing).toStrictEqual([]);
  });

  it('every runner derives its policy from the shared module', () => {
    const missing = RUNNERS.filter(
      (runner) => !readRunner(runner).includes('bun-test-policy.js'),
    );
    expect(missing).toStrictEqual([]);
  });

  it('no runner recomputes concurrency from availableParallelism itself', () => {
    const offenders = RUNNERS.filter((runner) =>
      readRunner(runner).includes('availableParallelism()'),
    );
    expect(offenders).toStrictEqual([]);
  });
});
