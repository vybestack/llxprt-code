/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isChildSuccess,
  formatFailureDiagnostic,
  isMainModule,
  resolveTsconfigOverride,
  runBunTests,
  reapStaleBunTestProcesses,
  processTimeoutFor,
  collectGlobalSetups,
  type BunGlobalSetupModule,
  type BunTestRunnerDependencies,
  type BunTestSpawnOptions,
  type ChildExitInfo,
} from '../run_bun_tests.js';

describe('isChildSuccess', () => {
  it('returns true for exit code 0 with null signal', () => {
    const child: ChildExitInfo = { exitCode: 0, signalCode: null };
    expect(isChildSuccess(child)).toBe(true);
  });

  it('returns true for exit code 0 with undefined signal', () => {
    const child: ChildExitInfo = { exitCode: 0, signalCode: undefined };
    expect(isChildSuccess(child)).toBe(true);
  });

  it('returns false for a nonzero exit code', () => {
    const child: ChildExitInfo = { exitCode: 1, signalCode: null };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns true when signalCode is SIGTERM but exitCode is 0', () => {
    const child: ChildExitInfo = { exitCode: 0, signalCode: 'SIGTERM' };
    expect(isChildSuccess(child)).toBe(true);
  });

  it('returns false when exitCode is null (killed by signal, no output)', () => {
    const child: ChildExitInfo = { exitCode: null, signalCode: 'SIGTERM' };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns true when killed by SIGTERM after a complete zero-failure run', () => {
    const child: ChildExitInfo = {
      exitCode: null,
      signalCode: 'SIGTERM',
      stdout: '5 pass\n0 fail\nRan 5 tests across 1 file.',
    };
    expect(isChildSuccess(child)).toBe(true);
  });

  it('returns false when killed by SIGTERM with only a zero-failure count', () => {
    const child: ChildExitInfo = {
      exitCode: null,
      signalCode: 'SIGTERM',
      stdout: '5 pass\n0 fail',
    };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns false when killed by SIGTERM with only a Ran N tests summary', () => {
    const child: ChildExitInfo = {
      exitCode: null,
      signalCode: 'SIGTERM',
      stdout: 'Ran 5 tests across 1 file.',
    };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns false when a signaled completed run reports failures', () => {
    const child: ChildExitInfo = {
      exitCode: null,
      signalCode: 'SIGTERM',
      stdout: '2 pass\n3 fail\nRan 5 tests across 1 file.',
    };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns false when killed by SIGTERM with (pass) output but no completion summary (partial execution)', () => {
    const child: ChildExitInfo = {
      exitCode: null,
      signalCode: 'SIGTERM',
      stderr: '(pass) test name ',
    };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns false when killed by SIGKILL with multiple (pass) lines but no summary (partial execution)', () => {
    const child: ChildExitInfo = {
      exitCode: null,
      signalCode: 'SIGKILL',
      stderr: '(pass) test one\n(pass) test two\n(pass) test three',
    };
    expect(isChildSuccess(child)).toBe(false);
  });

  it('returns false when exitCode is null and signalCode is null', () => {
    const child: ChildExitInfo = { exitCode: null, signalCode: null };
    expect(isChildSuccess(child)).toBe(false);
  });
});

describe('formatFailureDiagnostic', () => {
  it('reports the signal name when a signal is present', () => {
    const child: ChildExitInfo = {
      exitCode: 0,
      signalCode: 'SIGTERM',
    };
    expect(formatFailureDiagnostic(child)).toBe(' (signal: SIGTERM)');
  });

  it('reports the numeric exit code for an ordinary nonzero exit', () => {
    const child: ChildExitInfo = { exitCode: 1, signalCode: null };
    expect(formatFailureDiagnostic(child)).toBe(' (exit code: 1)');
  });

  it('reports the numeric exit code when signalCode is undefined', () => {
    const child: ChildExitInfo = { exitCode: 42, signalCode: undefined };
    expect(formatFailureDiagnostic(child)).toBe(' (exit code: 42)');
  });

  it('reports the signal name even when exitCode is null', () => {
    const child: ChildExitInfo = { exitCode: null, signalCode: 'SIGKILL' };
    expect(formatFailureDiagnostic(child)).toBe(' (signal: SIGKILL)');
  });

  it('reports null exit code diagnostic when killed by signal with no signalCode', () => {
    const child: ChildExitInfo = { exitCode: null, signalCode: null };
    expect(formatFailureDiagnostic(child)).toBe(' (exit code: null)');
  });

  it('returns an empty string for a successful child', () => {
    const child: ChildExitInfo = { exitCode: 0, signalCode: null };
    expect(formatFailureDiagnostic(child)).toBe('');
  });
});

describe('isMainModule', () => {
  it('returns true when argv1 resolves to the module URL', () => {
    const modulePath = '/some/path/script.ts';
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isMainModule(modulePath, moduleUrl)).toBe(true);
  });

  it('returns true when the path contains spaces', () => {
    const modulePath = '/some path/with spaces/script.ts';
    const moduleUrl = pathToFileURL(modulePath).href;
    expect(isMainModule(modulePath, moduleUrl)).toBe(true);
  });

  it('returns false when argv1 is a different path', () => {
    const moduleUrl = pathToFileURL('/some/path/script.ts').href;
    expect(isMainModule('/other/path.ts', moduleUrl)).toBe(false);
  });

  it('returns false when argv1 is undefined', () => {
    const moduleUrl = pathToFileURL('/some/path/script.ts').href;
    expect(isMainModule(undefined, moduleUrl)).toBe(false);
  });
});

describe('reapStaleBunTestProcesses', () => {
  it('kills orphaned bun test processes with PPID=1 using SIGTERM', () => {
    const killedPids: number[] = [];
    const receivedSignals: string[] = [];
    const psOutput = [
      '  100  1  bun test src/foo.test.ts',
      '  200  1  node src/bar.spec.ts',
      '  300  500  bun test src/baz.test.ts',
      `  ${process.pid}  ${process.ppid}  bun scripts/run_bun_tests.ts`,
    ].join('\n');

    const result = reapStaleBunTestProcesses(
      () => ({ stdout: psOutput }),
      (pid, signal) => {
        killedPids.push(pid);
        receivedSignals.push(signal);
      },
      process.pid,
    );

    expect(result).toBe(2);
    expect(killedPids).toContain(100);
    expect(killedPids).toContain(200);
    expect(killedPids).not.toContain(300);
    expect(receivedSignals).toEqual(['SIGTERM', 'SIGTERM']);
  });

  it('does not kill the current process', () => {
    const killedPids: number[] = [];
    const ownPid = 12345;
    const psOutput = `  ${ownPid}  1  bun test src/foo.test.ts`;

    reapStaleBunTestProcesses(
      () => ({ stdout: psOutput }),
      (pid) => killedPids.push(pid),
      ownPid,
    );

    expect(killedPids).not.toContain(ownPid);
  });

  it('does not kill non-test bun/node processes', () => {
    const killedPids: number[] = [];
    const psOutput = [
      '  100  1  bun run build',
      '  200  1  node server.js',
      '  300  1  bun test src/real.test.ts',
    ].join('\n');

    const result = reapStaleBunTestProcesses(
      () => ({ stdout: psOutput }),
      (pid) => killedPids.push(pid),
      99999,
    );

    expect(result).toBe(1);
    expect(killedPids).toEqual([300]);
  });

  it('returns 0 when ps fails', () => {
    const result = reapStaleBunTestProcesses(
      () => {
        throw new Error('ps not found');
      },
      () => {},
      99999,
    );

    expect(result).toBe(0);
  });

  it('logs a warning when processes are reaped', () => {
    const stderrMessages: string[] = [];
    const psOutput = '  100  1  bun test src/foo.test.ts';

    reapStaleBunTestProcesses(
      () => ({ stdout: psOutput }),
      () => {},
      99999,
      (msg) => stderrMessages.push(msg),
    );

    expect(stderrMessages).toHaveLength(1);
    expect(stderrMessages[0]).toContain('Reaped 1 stale orphaned');
  });
});

describe('resolveTsconfigOverride', () => {
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'bun-runner-tsconfig-'));
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('returns an absolute path resolved from the invocation directory', () => {
    const relativePath = 'configs/tsconfig.bun.json';
    mkdirSync(join(fixtureDir, 'configs'));
    writeFileSync(join(fixtureDir, relativePath), '{}\n');

    expect(resolveTsconfigOverride(relativePath, fixtureDir)).toBe(
      join(fixtureDir, relativePath),
    );
  });

  it('rejects a missing override before child processes are started', () => {
    expect(() =>
      resolveTsconfigOverride('missing-tsconfig.json', fixtureDir),
    ).toThrow('Tsconfig override is not a file');
  });

  it('rejects a directory passed as an override', () => {
    expect(() => resolveTsconfigOverride('.', fixtureDir)).toThrow(
      'Tsconfig override is not a file',
    );
  });
});

/** Global setup loader stub for runs whose entries declare none. */
const noGlobalSetup = async (): Promise<BunGlobalSetupModule> => ({});

describe('runBunTests', () => {
  it('executes every entry with exact argv, cwd, and env and reports all failure modes', async () => {
    const environment = { RUNNER_TEST: '1' };
    const entries = [
      {
        cwd: '/repo/packages/one',
        file: '/repo/packages/one/one.test.ts',
        preloads: [],
      },
      {
        cwd: '/repo/packages/two',
        file: '/repo/packages/two/two.test.ts',
        preloads: [],
      },
      {
        cwd: '/repo/packages/three',
        file: '/repo/packages/three/three.test.ts',
        preloads: [],
      },
    ];
    const results: ChildExitInfo[] = [
      { exitCode: 0, signalCode: null },
      { exitCode: 7, signalCode: null },
      { exitCode: null, signalCode: 'SIGTERM' },
    ];
    const calls: Array<{
      command: readonly string[];
      options: BunTestSpawnOptions;
    }> = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    let resolvedWorkspace: string | undefined;
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment,
      resolveFiles: (_root, workspace) => {
        resolvedWorkspace = workspace;
        return entries;
      },
      resolveTsconfig: () => '/invoke/config/tsconfig.json',
      spawn: (command, options) => {
        calls.push({ command, options });
        const result = results[calls.length - 1];
        if (!result) {
          throw new Error('Unexpected spawn');
        }
        return result;
      },
      loadGlobalSetup: noGlobalSetup,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    };

    const status = await runBunTests(
      [
        '--workspace',
        'selected',
        '--tsconfig',
        'config/tsconfig.json',
        '--timeout',
        '1234',
      ],
      dependencies,
    );

    expect(resolvedWorkspace).toBe('selected');
    expect(calls).toEqual(
      entries.map((entry) => ({
        command: [
          '/bin/bun',
          'test',
          '--tsconfig-override',
          '/invoke/config/tsconfig.json',
          '--max-concurrency',
          '1',
          '--timeout',
          '1234',
          entry.file,
        ],
        options: {
          cwd: entry.cwd,
          env: environment,
          stdin: 'inherit',
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 120_000,
        },
      })),
    );
    expect(stderr).toEqual([
      'Native Bun test failed: /repo/packages/two/two.test.ts (exit code: 7)',
      'Native Bun test failed: /repo/packages/three/three.test.ts (signal: SIGTERM)',
    ]);
    expect(stdout.at(-1)).toBe(
      'Passed 1/3 isolated native Bun test files (2 failed)',
    );
    expect(status).toBe(1);
  });

  it('reports a spawn exception for its file and continues with later entries', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let spawnCount = 0;
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        { cwd: '/repo/one', file: '/repo/one/throws.test.ts', preloads: [] },
        { cwd: '/repo/two', file: '/repo/two/passes.test.ts', preloads: [] },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => {
        spawnCount++;
        if (spawnCount === 1) {
          const error = new Error('spawn EACCES');
          error.name = 'SpawnError';
          throw error;
        }
        return { exitCode: 0, signalCode: null };
      },
      loadGlobalSetup: noGlobalSetup,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    };

    const status = await runBunTests([], dependencies);

    expect(spawnCount).toBe(2);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain(
      'Native Bun test failed: /repo/one/throws.test.ts',
    );
    expect(stderr[0]).toContain('SpawnError: spawn EACCES');
    expect(stdout.at(-1)).toBe(
      'Passed 1/2 isolated native Bun test files (1 failed)',
    );
    expect(status).toBe(1);
  });

  it('returns success and reports the complete passing summary', async () => {
    const stdout: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        { cwd: '/repo/core', file: '/repo/core/test.ts', preloads: [] },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => ({ exitCode: 0, signalCode: null }),
      loadGlobalSetup: noGlobalSetup,
      stdout: (line) => stdout.push(line),
      stderr: () => {},
    };

    const status = await runBunTests([], dependencies);

    expect(stdout.at(-1)).toBe('Passed 1/1 isolated native Bun test files');
    expect(status).toBe(0);
  });

  it('rejects a fractional --timeout value before any child is spawned', async () => {
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        { cwd: '/repo/core', file: '/repo/core/test.ts', preloads: [] },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => ({ exitCode: 0, signalCode: null }),
      loadGlobalSetup: noGlobalSetup,
      stdout: () => {},
      stderr: () => {},
    };

    await expect(
      runBunTests(['--timeout', '1.5'], dependencies),
    ).rejects.toThrow('Invalid --timeout value: 1.5');
  });

  it('passes every declared preload and the entry tsconfig to the child', async () => {
    const calls: Array<readonly string[]> = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        {
          cwd: '/repo/ws',
          file: '/repo/ws/a.test.ts',
          preloads: ['/repo/shared/augment.ts', '/repo/ws/setup.ts'],
          tsconfig: '/repo/ws/tsconfig.bun-test.json',
          timeout: 300_000,
        },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: (command) => {
        calls.push(command);
        return { exitCode: 0, signalCode: null };
      },
      loadGlobalSetup: noGlobalSetup,
      stdout: () => {},
      stderr: () => {},
    };

    await runBunTests([], dependencies);

    expect(calls[0]).toEqual([
      '/bin/bun',
      'test',
      '--tsconfig-override',
      '/repo/ws/tsconfig.bun-test.json',
      '--max-concurrency',
      '1',
      '--timeout',
      '300000',
      '--preload',
      '/repo/shared/augment.ts',
      '--preload',
      '/repo/ws/setup.ts',
      '/repo/ws/a.test.ts',
    ]);
  });

  it('retries a failing file up to its retry budget and passes on a later attempt', async () => {
    let attempts = 0;
    const stdout: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        {
          cwd: '/repo/e2e',
          file: '/repo/e2e/flaky.test.ts',
          preloads: [],
          retries: 2,
        },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => {
        attempts++;
        return attempts < 3
          ? { exitCode: 1, signalCode: null }
          : { exitCode: 0, signalCode: null };
      },
      loadGlobalSetup: noGlobalSetup,
      stdout: (line) => stdout.push(line),
      stderr: () => {},
    };

    const status = await runBunTests([], dependencies);

    expect(attempts).toBe(3);
    expect(status).toBe(0);
    expect(stdout.at(-1)).toBe('Passed 1/1 isolated native Bun test files');
  });

  it('stops retrying once the budget is exhausted and reports the failure', async () => {
    let attempts = 0;
    const stderr: string[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment: {},
      resolveFiles: () => [
        {
          cwd: '/repo/e2e',
          file: '/repo/e2e/broken.test.ts',
          preloads: [],
          retries: 1,
        },
      ],
      resolveTsconfig: resolveTsconfigOverride,
      spawn: () => {
        attempts++;
        return { exitCode: 1, signalCode: null };
      },
      loadGlobalSetup: noGlobalSetup,
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    };

    const status = await runBunTests([], dependencies);

    expect(attempts).toBe(2);
    expect(status).toBe(1);
    expect(stderr.at(-1)).toBe(
      'Native Bun test failed: /repo/e2e/broken.test.ts (exit code: 1)',
    );
  });

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
});

describe('processTimeoutFor', () => {
  it('keeps the default process budget for ordinary per-test timeouts', () => {
    expect(processTimeoutFor(30_000)).toBe(120_000);
  });

  it('scales past the default when a root declares a long per-test timeout', () => {
    expect(processTimeoutFor(300_000)).toBe(600_000);
  });
});

describe('collectGlobalSetups', () => {
  it('returns each distinct setup module once, in first-seen order', () => {
    expect(
      collectGlobalSetups([
        {
          cwd: '/a',
          file: '/a/1.test.ts',
          preloads: [],
          globalSetup: '/a/s.ts',
        },
        {
          cwd: '/a',
          file: '/a/2.test.ts',
          preloads: [],
          globalSetup: '/a/s.ts',
        },
        { cwd: '/b', file: '/b/1.test.ts', preloads: [] },
        {
          cwd: '/c',
          file: '/c/1.test.ts',
          preloads: [],
          globalSetup: '/c/s.ts',
        },
      ]),
    ).toEqual(['/a/s.ts', '/c/s.ts']);
  });
});
