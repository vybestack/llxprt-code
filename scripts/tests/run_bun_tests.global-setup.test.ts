/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Global setup/teardown lifecycle for the Bun-native test runner.
 *
 * Split from `run_bun_tests.test.ts` to keep each file within the repository
 * max-lines budget.
 */

import { describe, it, expect } from 'vitest';
import {
  reconcileSuites,
  resolveTsconfigOverride,
  runBunTests,
  type BunTestRunnerDependencies,
  type FileTestResult,
} from '../run_bun_tests.js';
import type { JUnitTestSuite } from '../bun-junit-to-json-report.js';

describe('runBunTests global setup lifecycle', () => {
  it('runs global setup before any child and teardown after the last one', async () => {
    const order: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        {
          cwd: '/repo/e2e',
          file: '/repo/e2e/a.test.ts',
          preloads: [],
          globalSetup: '/repo/e2e/globalSetup.ts',
        },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => {
        order.push('spawn');
        return { exitCode: 0, signalCode: null };
      },
      loadGlobalSetup: async () => ({
        setup: () => {
          order.push('setup');
        },
        teardown: () => {
          order.push('teardown');
        },
      }),
      stdout: () => {},
      stderr: () => {},
    };

    await runBunTests([], dependencies);

    expect(order).toEqual(['setup', 'spawn', 'teardown']);
  });

  it('tears down already-started setups when a later setup throws', async () => {
    const order: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        {
          cwd: '/repo/e2e',
          file: '/repo/e2e/a.test.ts',
          preloads: [],
          globalSetup: '/repo/e2e/s1.ts',
        },
        {
          cwd: '/repo/evals',
          file: '/repo/evals/b.eval.ts',
          preloads: [],
          globalSetup: '/repo/evals/s2.ts',
        },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => {
        order.push('spawn');
        return { exitCode: 0, signalCode: null };
      },
      loadGlobalSetup: async (path) =>
        path === '/repo/e2e/s1.ts'
          ? {
              setup: () => {
                order.push('setup1');
              },
              teardown: () => {
                order.push('teardown1');
              },
            }
          : {
              setup: () => {
                order.push('setup2');
                throw new Error('setup boom');
              },
            },
      stdout: () => {},
      stderr: () => {},
    };

    await expect(runBunTests([], dependencies)).rejects.toThrow('setup boom');
    // No file may run once setup failed, and the setup that did succeed must
    // still be torn down or its resources leak.
    expect(order).toEqual(['setup1', 'setup2', 'teardown1']);
  });

  it('runs global teardown even when a test file fails', async () => {
    const order: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        {
          cwd: '/repo/e2e',
          file: '/repo/e2e/a.test.ts',
          preloads: [],
          globalSetup: '/repo/e2e/globalSetup.ts',
        },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => ({ exitCode: 1, signalCode: null }),
      loadGlobalSetup: async () => ({
        setup: () => {
          order.push('setup');
        },
        teardown: () => {
          order.push('teardown');
        },
      }),
      stdout: () => {},
      stderr: () => {},
    };

    const status = await runBunTests([], dependencies);

    expect(status).toBe(1);
    expect(order).toEqual(['setup', 'teardown']);
  });

  it('fails the run when a global teardown throws even though every file passed', async () => {
    const stderr: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        {
          cwd: '/repo/e2e',
          file: '/repo/e2e/a.test.ts',
          preloads: [],
          globalSetup: '/repo/e2e/globalSetup.ts',
        },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => ({ exitCode: 0, signalCode: null }),
      loadGlobalSetup: async () => ({
        teardown: () => {
          throw new Error('temp storage survived');
        },
      }),
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    };

    const status = await runBunTests([], dependencies);

    expect(status).toBe(1);
    expect(stderr.some((line) => line.includes('temp storage survived'))).toBe(
      true,
    );
  });

  it('runs every remaining teardown after an earlier one throws', async () => {
    const torndown: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        {
          cwd: '/repo/a',
          file: '/repo/a/a.test.ts',
          preloads: [],
          globalSetup: '/repo/a/globalSetup.ts',
        },
        {
          cwd: '/repo/b',
          file: '/repo/b/b.test.ts',
          preloads: [],
          globalSetup: '/repo/b/globalSetup.ts',
        },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => ({ exitCode: 0, signalCode: null }),
      loadGlobalSetup: async (path) => ({
        teardown: () => {
          torndown.push(path);
          // The most recently started root is torn down first; make it throw so
          // the earlier root's cleanup is proven to still run.
          if (path === '/repo/b/globalSetup.ts') {
            throw new Error('b cleanup failed');
          }
        },
      }),
      stdout: () => {},
      stderr: () => {},
    };

    const status = await runBunTests([], dependencies);

    expect(status).toBe(1);
    expect(torndown).toEqual([
      '/repo/b/globalSetup.ts',
      '/repo/a/globalSetup.ts',
    ]);
  });
});

describe('reconcileSuites', () => {
  const suite = (name: string): JUnitTestSuite => ({
    name,
    tests: 1,
    failures: 0,
    errors: 0,
    skipped: 0,
    testCases: [],
  });

  const result = (
    name: string,
    passed: boolean,
    junitOutfile?: string,
  ): FileTestResult => ({ name, passed, stdout: '', junitOutfile });

  it('keeps the parsed suites for files that produced output', () => {
    const merged = reconcileSuites(
      [result('a.test.ts', true, '/tmp/0.xml')],
      (_path, into) => {
        into.push(suite('some describe block'));
        return 1;
      },
    );

    expect(merged.map((s) => s.name)).toEqual(['some describe block']);
  });

  it('represents a failed file that produced no output', () => {
    const merged = reconcileSuites(
      [result('crashed.test.ts', false, '/tmp/0.xml')],
      () => 0,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('crashed.test.ts');
    expect(merged[0].failures).toBe(1);
    expect(merged[0].testCases[0].failureMessage).toContain(
      'no usable JUnit output',
    );
  });

  it('does not synthesize for a failed file whose suites were parsed', () => {
    const merged = reconcileSuites(
      [result('failing.test.ts', false, '/tmp/0.xml')],
      (_path, into) => {
        // Bun names suites after describe blocks, never after the file, so a
        // name-based check would wrongly add a synthetic entry here.
        into.push(suite('a describe block'));
        return 1;
      },
    );

    expect(merged.map((s) => s.name)).toEqual(['a describe block']);
  });

  it('does not synthesize for a passing file that produced no output', () => {
    expect(
      reconcileSuites([result('empty.test.ts', true, '/tmp/0.xml')], () => 0),
    ).toEqual([]);
  });
});
