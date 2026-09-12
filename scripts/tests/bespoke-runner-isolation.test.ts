/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the bespoke-runner isolation wiring (issue #3622):
 * the session env every spawned test process gets, and the pool-aware
 * sentinel-guard bookkeeping the four workspace runners share.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { ChildProcess } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  stopRunnerChildren,
  throwWorkerFailures,
  type BespokeRunnerIsolation,
} from '../lib/bespoke-runner-isolation.js';
import {
  RealHomeSentinelGuard,
  type SentinelGuard,
} from '../lib/real-home-sentinel.js';
import { SESSION_ENV_KEYS } from '../lib/test-session-isolation.js';

let createBespokeRunnerIsolation: typeof import('../lib/bespoke-runner-isolation.js').createBespokeRunnerIsolation;
let moduleId = 0;
beforeEach(async () => {
  ({ createBespokeRunnerIsolation } = await import(
    `../lib/bespoke-runner-isolation.ts?test=${moduleId++}`
  ));
});

describe('createBespokeRunnerIsolation', () => {
  let root: string;
  let target: string;
  let absent: string;
  let logs: string[];
  let isolation: BespokeRunnerIsolation | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bespoke-isolation-'));
    target = join(root, 'legacy');
    absent = join(root, 'skills');
    mkdirSync(target);
    logs = [];
  });
  afterEach(() => {
    isolation?.finalize();
    const session = isolation?.sessionEnv.LLXPRT_TEST_SESSION_ROOT;
    if (session !== undefined)
      rmSync(session, { recursive: true, force: true });
    isolation = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function start(env: NodeJS.ProcessEnv = {}): BespokeRunnerIsolation {
    isolation = createBespokeRunnerIsolation(
      env,
      () =>
        new RealHomeSentinelGuard({
          targets: [target, absent].map((path) => ({
            path,
            description: path,
          })),
          sessionId: 'behavior',
        }),
      (message) => logs.push(message),
    );
    return isolation;
  }

  it('rejects a second instance even after finalization', () => {
    start().finalize();
    expect(() => start()).toThrow(
      'bespoke runner isolation is single-instance per process',
    );
  });

  it('creates a sentinel baseline before any file runs', () => {
    start();
    expect(readdirSync(target)).toEqual(['.llxprt-sentinel-behavior']);
    expect(
      readFileSync(join(target, '.llxprt-sentinel-behavior')).length,
    ).toBeGreaterThan(0);
  });

  it('exposes a session env owned by the session keys and passes the rest through', () => {
    const runner = start({
      PATH: '/usr/bin',
      LLXPRT_TEST_STORAGE_ISOLATED: '1',
    });
    expect(runner.sessionEnv.PATH).toBe('/usr/bin');
    expect(runner.sessionEnv).not.toHaveProperty(
      'LLXPRT_TEST_STORAGE_ISOLATED',
    );
    for (const key of SESSION_ENV_KEYS) {
      if (key === 'LLXPRT_TEST_STORAGE_ISOLATED') continue;
      expect(runner.sessionEnv[key]).toBeDefined();
    }
    expect(runner.sessionEnv.HOME).toContain('llxprt-tests');
  });

  it('runs a file without an object receiver', async () => {
    const { runFile } = start();
    expect(await runFile('unbound.test.ts', async () => 42)).toBe(42);
  });

  it('does not mutate the runner env it was given', () => {
    const env: NodeJS.ProcessEnv = { HOME: root };
    start(env);
    expect(env).toEqual({ HOME: root });
  });

  it('keeps the session root under the OS temp dir', () => {
    expect(start().sessionEnv.HOME?.startsWith(tmpdir())).toBe(true);
  });

  it('returns zero violations and removes sentinels when no file trips the guard', () => {
    const runner = start();
    runner.noteFileSettled('src/a.test.ts');
    runner.noteFileSettled('src/b.test.ts');
    expect(runner.finalize()).toBe(0);
    expect(logs).toEqual([]);
    expect(readdirSync(target)).toEqual([]);
  });

  it('records a removed sentinel, names the settled file, and keeps the run going', async () => {
    const runner = start();
    runner.noteFileSettled('src/clean.test.ts');
    rmSync(join(target, '.llxprt-sentinel-behavior'));
    runner.noteFileSettled('src/leaky.test.ts');
    await runner.runFile('src/also-clean.test.ts', async () => {
      writeFileSync(join(root, 'later-worker-output'), 'completed');
    });
    expect(readFileSync(join(root, 'later-worker-output'), 'utf8')).toBe(
      'completed',
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('src/leaky.test.ts');
    expect(logs[0]).toContain('sentinel removed');
    expect(logs[0]).toContain(target);
    expect(runner.finalize()).toBe(1);
    expect(readdirSync(target)).toEqual([]);
  });

  it('counts a directory appearing at run teardown and always removes sentinels', () => {
    const runner = start();
    runner.noteFileSettled('src/a.test.ts');
    mkdirSync(absent);
    expect(runner.finalize()).toBe(1);
    expect(logs.join()).toContain('run teardown');
    expect(logs.join()).toContain('dir appeared');
    expect(logs.join()).toContain(absent);
    expect(readdirSync(target)).toEqual([]);
  });

  it('rethrows non-sentinel errors instead of swallowing them and still removes sentinels', () => {
    const realGuard = new RealHomeSentinelGuard({
      targets: [{ path: target, description: target }],
      sessionId: 'unexpected-error',
    });
    // A deterministic unexpected guard failure avoids permission tests whose
    // behavior depends on the OS and whether the test process runs as root.
    const guard: SentinelGuard = {
      captureBaseline: () => realGuard.captureBaseline(),
      assertUnchanged: () => {
        throw new Error('stat failed: permission denied');
      },
      cleanup: () => realGuard.cleanup(),
    };
    const runner = createBespokeRunnerIsolation(
      {},
      () => guard,
      (message) => logs.push(message),
    );
    isolation = runner;
    expect(readdirSync(target)).toEqual(['.llxprt-sentinel-unexpected-error']);
    expect(() => runner.noteFileSettled('src/a.test.ts')).toThrow(
      'stat failed',
    );
    expect(() => runner.finalize()).toThrow('stat failed');
    expect(readdirSync(target)).toEqual([]);
    expect(logs).toEqual([]);
  });
});

describe('bespoke isolation with real sentinel targets', () => {
  it('cleans a partial baseline when the factory fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'bespoke-partial-'));
    const first = join(root, 'first');
    const second = join(root, 'second');
    mkdirSync(first);
    mkdirSync(second);
    mkdirSync(join(second, '.llxprt-sentinel-partial'));
    try {
      expect(() =>
        createBespokeRunnerIsolation(
          {},
          () =>
            new RealHomeSentinelGuard({
              targets: [first, second].map((path) => ({
                path,
                description: path,
              })),
              sessionId: 'partial',
            }),
        ),
      ).toThrow();
      expect(readdirSync(first)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('checks each settled file while naming peers and cleans up after a rejected worker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bespoke-pool-'));
    const logs: string[] = [];
    const isolation = createBespokeRunnerIsolation(
      {},
      () =>
        new RealHomeSentinelGuard({
          targets: [{ path: root, description: 'pool target' }],
        }),
      (message) => logs.push(message),
    );
    const peer = Promise.withResolvers<void>();
    try {
      const pending = isolation.runFile('peer.test.ts', () => peer.promise);
      await expect(
        isolation.runFile('settled.test.ts', async () => {
          writeFileSync(join(root, 'leak'), 'leak');
          throw new Error('worker failed');
        }),
      ).rejects.toThrow('worker failed');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('settled.test.ts');
      expect(logs[0]).toContain('in-flight: peer.test.ts');
      peer.resolve();
      await pending;
      expect(logs).toHaveLength(1);
      expect(isolation.finalize()).toBe(1);
      expect(logs).toHaveLength(1);
      expect(readdirSync(root)).toEqual(['leak']);
    } finally {
      peer.resolve();
      isolation.finalize();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('runner child shutdown', () => {
  it('bounds the wait when a killed child never closes its pipes', async () => {
    const child = new ChildProcess();
    Object.defineProperty(child, 'pid', { value: 12345 });
    const kill = spyOn(process, 'kill').mockImplementation(() => true);
    const childKill = spyOn(child, 'kill').mockImplementation(() => true);
    try {
      await stopRunnerChildren([child], () => {}, 20);
      expect(child.listenerCount('close')).toBe(0);
    } finally {
      kill.mockRestore();
      childKill.mockRestore();
    }
  }, 1000);

  it.skipIf(process.platform === 'win32')(
    'continues killing later children after a kill fails',
    async () => {
      const first = new ChildProcess();
      const second = new ChildProcess();
      Object.defineProperty(first, 'pid', { value: 12345 });
      Object.defineProperty(second, 'pid', { value: 12346 });
      const killed: number[] = [];
      const messages: string[] = [];
      const kill = spyOn(process, 'kill').mockImplementation((pid) => {
        if (pid === -12345) throw new Error('EPERM');
        killed.push(pid);
        queueMicrotask(() => second.emit('close', null, 'SIGKILL'));
        return true;
      });
      try {
        await stopRunnerChildren(
          [first, second],
          (message) => messages.push(message),
          20,
        );
        expect(killed).toEqual([-12346]);
        expect(messages.join()).toContain('EPERM');
      } finally {
        kill.mockRestore();
      }
    },
  );
});
it('returns fulfilled worker values in order, including an empty batch', () => {
  expect(
    throwWorkerFailures([
      { status: 'fulfilled', value: 3 },
      { status: 'fulfilled', value: 7 },
    ]),
  ).toEqual([3, 7]);
  expect(throwWorkerFailures([])).toEqual([]);
});

it('logs every worker rejection and throws the first rejection', () => {
  const first = new Error('first worker failed');
  const second = new Error('second worker failed');
  const diagnostics: unknown[] = [];
  const log = spyOn(console, 'error').mockImplementation((message: unknown) => {
    diagnostics.push(message);
  });
  try {
    expect(() =>
      throwWorkerFailures([
        { status: 'rejected', reason: first },
        { status: 'fulfilled', value: 'passed' },
        { status: 'rejected', reason: second },
      ]),
    ).toThrow(first);
    expect(diagnostics).toEqual([first, second]);
  } finally {
    log.mockRestore();
  }
});
