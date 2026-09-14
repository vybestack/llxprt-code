/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, it, expect } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveTsconfigOverride,
  runBunTests,
  type BunGlobalSetupModule,
  type BunTestRunnerDependencies,
  type BunTestSpawnOptions,
} from '../run_bun_tests.js';
import { RealHomeSentinelGuard } from '../lib/real-home-sentinel.js';

/** Global setup loader stub for runs whose entries declare none. */
const noGlobalSetup = async (): Promise<BunGlobalSetupModule> => ({});

describe('runBunTests session isolation and sentinel guard', () => {
  const entries = [
    { cwd: '/repo/ws', file: '/repo/ws/one.test.ts', preloads: [] },
    { cwd: '/repo/ws', file: '/repo/ws/two.test.ts', preloads: [] },
  ];

  it('spawns every file with a session env on disk and never mutates the runner environment', async () => {
    const environment: NodeJS.ProcessEnv = {
      RUNNER_TEST: '1',
      LLXPRT_CONFIG_HOME: '/isolated/config',
    };
    const calls: BunTestSpawnOptions[] = [];
    const dependencies: BunTestRunnerDependencies = {
      repoRoot: '/repo',
      invocationDirectory: '/invoke',
      executable: '/bin/bun',
      environment,
      resolveFiles: () => entries,
      resolveTsconfig: resolveTsconfigOverride,
      spawn: (_command, options) => {
        const session = options.env.LLXPRT_TEST_SESSION_ROOT;
        if (session !== undefined) sessions.add(session);
        expect(statSync(options.env.HOME!).isDirectory()).toBe(true);
        calls.push(options);
        return { exitCode: 0, signalCode: null };
      },
      loadGlobalSetup: noGlobalSetup,
      createSentinelGuard: () =>
        new RealHomeSentinelGuard({
          targets: [{ path: watched, description: 'temporary real home' }],
        }),
      stdout: () => {},
      stderr: () => {},
    };

    const status = await runBunTests([], dependencies);

    expect(status).toBe(0);
    expect(calls).toHaveLength(2);
    const sessionRoot = calls[0]!.env['LLXPRT_TEST_SESSION_ROOT'];
    expect(sessionRoot).toBeDefined();
    expect(existsSync(sessionRoot!)).toBe(false);
    for (const options of calls) {
      expect(options.env).not.toBe(environment);
      expect(options.env['LLXPRT_TEST_SESSION_ROOT']).toBe(sessionRoot);
      expect(options.env['HOME']).toBe(join(sessionRoot!, 'home', 'user'));
      expect(options.env['TMPDIR']).toBe(join(sessionRoot!, 'tmp'));
      expect(options.env['XDG_CONFIG_HOME']).toBe(
        join(sessionRoot!, 'home', 'user', '.config'),
      );
      expect(options.env['RUNNER_TEST']).toBe('1');
      // Pre-existing LLXPRT_* isolation keeps precedence over the session.
      expect(options.env['LLXPRT_CONFIG_HOME']).toBe('/isolated/config');
    }
    expect(environment).toEqual({
      RUNNER_TEST: '1',
      LLXPRT_CONFIG_HOME: '/isolated/config',
    });
    expect(environment['HOME']).toBeUndefined();
    expect(environment['LLXPRT_TEST_SESSION_ROOT']).toBeUndefined();
    rmSync(sessionRoot!, { recursive: true, force: true });
  });

  let root: string;
  let watched: string;
  let stderr: string[];
  let sessions: Set<string>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'shared-isolation-'));
    watched = join(root, 'watched');
    mkdirSync(watched);
    stderr = [];
    sessions = new Set();
  });
  afterEach(() => {
    for (const session of sessions)
      rmSync(session, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  function realDependencies(
    setup: BunGlobalSetupModule = {},
  ): BunTestRunnerDependencies {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      WATCHED: watched,
      OUTPUT: root,
    };
    const files = ['one', 'two'].map((name) => ({
      cwd: root,
      file: join(root, `${name}.test.ts`),
      preloads: [],
      globalSetup: join(root, 'globalSetup.ts'),
    }));
    return {
      repoRoot: root,
      invocationDirectory: root,
      executable: process.execPath,
      environment,
      resolveFiles: () => files,
      resolveTsconfig: resolveTsconfigOverride,
      spawn: (command, options) => {
        const session = options.env.LLXPRT_TEST_SESSION_ROOT;
        if (session !== undefined) sessions.add(session);
        const child = Bun.spawnSync([...command], {
          cwd: options.cwd,
          env: options.env,
          stdout: 'pipe',
          stderr: 'pipe',
        });
        return {
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          stdout: child.stdout.toString(),
          stderr: child.stderr.toString(),
        };
      },
      loadGlobalSetup: async () => setup,
      createSentinelGuard: () =>
        new RealHomeSentinelGuard({
          targets: [{ path: watched, description: 'temporary real home' }],
          sessionId: 'behavior',
        }),
      stdout: () => {},
      stderr: (line) => stderr.push(line),
    };
  }

  function writePayload(name: string, body: string): void {
    writeFileSync(
      join(root, `${name}.test.ts`),
      `import { test, expect } from 'bun:test';
import { writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
test('${name}', () => { ${body} });`,
    );
  }

  it.each(['baseline', 'setup', 'report', 'signal', 'success'])(
    'removes temporary JUnit artifacts after %s',
    async (stage) => {
      let signalCleanup: (() => void | Promise<void>) | undefined;
      let signalArtifacts: string[] | undefined;
      const report = join(root, 'report.json');
      const dependencies: BunTestRunnerDependencies = {
        ...realDependencies({
          setup: () => {
            if (stage === 'setup') throw new Error('setup failed');
          },
        }),
        registerSignalCleanup: (cleanup) => {
          signalCleanup = cleanup;
          return () => {};
        },
        createSentinelGuard: () => ({
          captureBaseline: () => {
            if (stage === 'baseline') throw new Error('baseline failed');
          },
          assertUnchanged: () => {},
          cleanup: () => {},
        }),
        spawn: async (command) => {
          const outfile = command.find((arg) =>
            arg.startsWith('--reporter-outfile='),
          );
          if (outfile === undefined)
            throw new Error('Missing JUnit output path');
          writeFileSync(
            outfile.slice('--reporter-outfile='.length),
            '<testsuites><testsuite name="example" tests="1"><testcase name="passes" classname="example" time="0" /></testsuite></testsuites>',
          );
          if (stage === 'signal') {
            await signalCleanup?.();
            signalArtifacts = readdirSync(root).filter((name) =>
              name.startsWith('bun-junit-'),
            );
            throw new Error('interrupted');
          }
          return { exitCode: 0 };
        },
      };
      if (stage === 'report') mkdirSync(report);
      if (stage === 'baseline' || stage === 'setup' || stage === 'report') {
        await expect(
          runBunTests(['--json-report', report], dependencies),
        ).rejects.toThrow();
      } else if (stage === 'signal') {
        // Real signal handlers exit after cleanup rather than returning to the run.
        await runBunTests(['--json-report', report], dependencies).catch(
          () => {},
        );
        expect(signalArtifacts).toEqual([]);
      } else {
        expect(await runBunTests(['--json-report', report], dependencies)).toBe(
          0,
        );
        expect(readFileSync(report, 'utf8')).toContain('passes');
      }
      expect(
        readdirSync(root).filter((name) => name.startsWith('bun-junit-')),
      ).toEqual([]);
    },
  );

  it('reports cleanup failure without losing successful file results', async () => {
    const report = join(root, 'cleanup-junit.xml');
    const diagnostics: string[] = [];
    const status = await runBunTests(['--junit', report], {
      ...realDependencies(),
      resolveFiles: () => entries,
      spawn: () => ({ exitCode: 0, signalCode: null }),
      createSentinelGuard: () => ({
        captureBaseline: () => {},
        assertUnchanged: () => {},
        cleanup: () => {
          throw new Error('cleanup failed');
        },
      }),
      stderr: (message) => diagnostics.push(message),
    });
    expect(status).toBe(1);
    expect(diagnostics.join()).toContain('cleanup failed');
    expect(readFileSync(report, 'utf8')).toContain('tests="2"');
  });

  it('does not report removed sentinels when a file settles after signal cleanup', () => {
    const runnerUrl = new URL('../run_bun_tests.ts', import.meta.url).href;
    const isolationUrl = new URL(
      '../lib/bespoke-runner-isolation.ts',
      import.meta.url,
    ).href;
    const guardUrl = new URL('../lib/real-home-sentinel.ts', import.meta.url)
      .href;
    const child = Bun.spawnSync(
      [
        process.execPath,
        '--eval',
        `
        import { runBunTests, resolveTsconfigOverride } from ${JSON.stringify(runnerUrl)};
        import { installRunnerSignalHandlers } from ${JSON.stringify(isolationUrl)};
        import { RealHomeSentinelGuard } from ${JSON.stringify(guardUrl)};
        const settled = Promise.withResolvers();
        const finished = Promise.withResolvers();
        const status = await runBunTests([], {
          repoRoot: ${JSON.stringify(root)},
          invocationDirectory: ${JSON.stringify(root)},
          executable: process.execPath,
          environment: process.env,
          resolveFiles: () => [{ cwd: ${JSON.stringify(root)}, file: 'one.test.ts', preloads: [] }],
          resolveTsconfig: resolveTsconfigOverride,
          loadGlobalSetup: async () => ({}),
          createSentinelGuard: () => new RealHomeSentinelGuard({
            targets: [{ path: ${JSON.stringify(watched)}, description: 'temporary real home' }],
          }),
          registerSignalCleanup: (cleanup) => installRunnerSignalHandlers(async () => {
            await cleanup();
            settled.resolve({ exitCode: 0 });
            await finished.promise;
          }),
          spawn: () => {
            process.emit('SIGTERM');
            return settled.promise;
          },
          stdout: () => {},
          stderr: (message) => console.error(message),
        });
        console.log(JSON.stringify({ status }));
        finished.resolve();
        `,
      ],
      { stdout: 'pipe', stderr: 'pipe', timeout: 5000 },
    );

    expect(child.exitCode).toBe(143);
    expect(child.stderr.toString()).toBe('');
    expect(JSON.parse(child.stdout.toString())).toEqual({ status: 0 });
    expect(readdirSync(watched)).toEqual([]);
  });

  it('reports unexpected guard errors without losing later results or reports', async () => {
    const diagnostics: string[] = [];
    const output: string[] = [];
    let completed = 0;
    let cleaned = false;
    const report = join(root, 'guard-junit.xml');
    const status = await runBunTests(['--junit', report], {
      ...realDependencies(),
      resolveFiles: () => entries,
      spawn: () => {
        completed++;
        return { exitCode: 0, signalCode: null };
      },
      createSentinelGuard: () => ({
        captureBaseline: () => {},
        assertUnchanged: (label) => {
          throw new Error(`guard unavailable: ${label}`);
        },
        cleanup: () => {
          cleaned = true;
        },
      }),
      stderr: (line) => diagnostics.push(line),
      stdout: (line) => output.push(line),
    });
    expect(status).toBe(1);
    expect(completed).toBe(2);
    expect(cleaned).toBe(true);
    expect(
      diagnostics.filter((line) => line.includes('guard unavailable')),
    ).toHaveLength(3);
    expect(output.some((line) => line.includes('Passed 2/2'))).toBe(true);
    expect(readFileSync(report, 'utf8')).toContain('tests="2"');
  });

  it('arms sentinels before setup, propagates setup env to both children, and removes sentinels', async () => {
    for (const name of ['one', 'two'])
      writePayload(
        name,
        `
      expect(readdirSync(process.env.WATCHED)).toContain('.llxprt-sentinel-behavior');
      expect(process.env.INTEGRATION_TEST_FILE_DIR).toBe(join(process.env.OUTPUT, 'run-output'));
      expect(process.env.LLXPRT_CONFIG_HOME).toBe(join(process.env.OUTPUT, 'setup-config'));
      writeFileSync(join(process.env.OUTPUT, '${name}-passed'), 'passed');
    `,
      );
    const dependencies = realDependencies({
      setup: () => {
        // This reads the real baseline before any child can create it.
        writeFileSync(
          join(root, 'setup-baseline'),
          readFileSync(join(watched, '.llxprt-sentinel-behavior')),
        );
        dependencies.environment.INTEGRATION_TEST_FILE_DIR = join(
          root,
          'run-output',
        );
        dependencies.environment.LLXPRT_CONFIG_HOME = join(
          root,
          'setup-config',
        );
      },
    });
    expect(await runBunTests([], dependencies)).toBe(0);
    expect(readFileSync(join(root, 'setup-baseline')).length).toBeGreaterThan(
      0,
    );
    for (const name of ['one', 'two'])
      expect(readFileSync(join(root, `${name}-passed`), 'utf8')).toBe('passed');
    expect(readdirSync(watched)).toEqual([]);
    expect(
      stderr.filter((line) => line.includes('sentinel violation')),
    ).toEqual([]);
  });

  it('fails for a real child leak, names the file, continues to the next child, and removes sentinels', async () => {
    writePayload(
      'one',
      `writeFileSync(join(process.env.WATCHED, 'settings.json'), 'leak');`,
    );
    writePayload(
      'two',
      `writeFileSync(join(process.env.OUTPUT, 'later-child-output'), 'completed');`,
    );
    expect(await runBunTests([], realDependencies())).toBe(1);
    expect(stderr.join()).toContain('one.test.ts');
    expect(stderr.join()).toContain('settings.json');
    expect(stderr.join()).toContain('non-sentinel entry added');
    expect(readFileSync(join(root, 'later-child-output'), 'utf8')).toBe(
      'completed',
    );
    expect(readdirSync(watched)).toEqual(['settings.json']);
  });

  it('fails for a sentinel modified during global teardown and removes it', async () => {
    for (const name of ['one', 'two'])
      writePayload(
        name,
        "expect(readdirSync(process.env.WATCHED)).toContain('.llxprt-sentinel-behavior');",
      );
    const dependencies = realDependencies({
      teardown: () => {
        writeFileSync(join(watched, '.llxprt-sentinel-behavior'), 'corrupted');
      },
    });
    expect(await runBunTests([], dependencies)).toBe(1);
    expect(stderr.join()).toContain('run teardown');
    expect(stderr.join()).toContain('sentinel modified');
    expect(readdirSync(watched)).toEqual([]);
  });
});
