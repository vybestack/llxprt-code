/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, it, expect } from 'bun:test';
import {
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
    expect(statSync(sessionRoot!).isDirectory()).toBe(true);
    for (const options of calls) {
      expect(options.env).not.toBe(environment);
      expect(options.env['LLXPRT_TEST_SESSION_ROOT']).toBe(sessionRoot);
      expect(options.env['HOME']).toBe(join(sessionRoot!, 'home', 'user'));
      expect(options.env['TMPDIR']).toBe(join(sessionRoot!, 'tmp'));
      expect(options.env['XDG_CONFIG_HOME']).toBe(
        join(sessionRoot!, 'home', 'user', '.config'),
      );
      expect(statSync(options.env['HOME']!).isDirectory()).toBe(true);
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
