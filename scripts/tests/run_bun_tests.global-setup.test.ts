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
  resolveTsconfigOverride,
  runBunTests,
  type BunTestRunnerDependencies,
} from '../run_bun_tests.js';

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
