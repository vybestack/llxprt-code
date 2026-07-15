/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { spawn as spawnType } from 'node:child_process';

const loadCommonJsModule = createRequire(import.meta.url);
const credentialSocketEnv = 'LLXPRT_CREDENTIAL_SOCKET';

interface RunCliBinOptions {
  exit?: ExitFn;
  spawn?: typeof spawnType;
  resolveBun?: () => string | null;
  resolveEntry?: () => string | null;
  getPpid?: () => number;
  selfExitDelayMs?: number;
  orphanCheckIntervalMs?: number;
}

type ExitFn = (code?: number) => never;
type RunCliBin = (options?: RunCliBinOptions) => Promise<void>;

interface CliBinModule {
  runCliBin: RunCliBin;
}

interface TestChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
}

function recordingExit(sink: number[]): ExitFn {
  const exit: ExitFn = (code?: number) => {
    sink.push(code ?? 0);
    return undefined as never;
  };
  return exit;
}

function isCliBinModule(module: unknown): module is CliBinModule {
  if (typeof module !== 'object' || module === null) {
    return false;
  }
  const { runCliBin } = module as { runCliBin?: unknown };
  return typeof runCliBin === 'function';
}

function loadCliBin(): CliBinModule {
  const module = loadCommonJsModule('../../bin/llxprt.cjs');
  if (!isCliBinModule(module)) {
    throw new Error('cli bin module did not expose expected test seams');
  }
  return module;
}

function createChildProcess({
  autoClose = true,
}: { autoClose?: boolean } = {}): TestChildProcess {
  const child = new EventEmitter() as TestChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.kill = vi.fn((signal?: NodeJS.Signals | 'SIGKILL') => {
    child.killed = true;
    if (autoClose) {
      process.nextTick(() => child.emit('close', null, signal ?? null));
    }
    return true;
  });
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

describe('cli bin (packages/cli/bin/llxprt.cjs)', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalArgv: string[];
  let runCliBin: RunCliBin;

  beforeEach(() => {
    originalEnv = process.env;
    originalArgv = process.argv;
    process.env = { ...process.env };
    process.argv = ['/node', '/llxprt.cjs'];
    const bin = loadCliBin();
    runCliBin = bin.runCliBin;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  async function runLauncher(
    overrides: RunCliBinOptions & { autoClose?: boolean } = {},
  ) {
    const { autoClose = true, ...cliBinOptions } = overrides;
    const exitCalls: number[] = [];
    const child = createChildProcess({ autoClose });
    const spawnFn = vi.fn(() => child);

    await runCliBin({
      exit: recordingExit(exitCalls),
      spawn: spawnFn as unknown as typeof spawnType,
      resolveBun: () => '/path/to/bun',
      resolveEntry: () => '/entry.ts',
      ...cliBinOptions,
    });

    return { child, exitCalls, spawnFn };
  }

  it('spawns Bun with the entry + forwarded args and relaunch guard env', async () => {
    delete process.env[credentialSocketEnv];
    process.argv = ['/node', '/llxprt.cjs', '--profile-load', 'dev'];
    const { child, exitCalls, spawnFn } = await runLauncher();

    expect(spawnFn).toHaveBeenCalledWith(
      '/path/to/bun',
      ['/entry.ts', '--profile-load', 'dev'],
      expect.objectContaining({
        stdio: 'inherit',
        env: expect.objectContaining({
          LLXPRT_BUN_RELAUNCHED: 'true',
        }),
      }),
    );
    child.emit('close', 0, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
  });

  it('does not start a proxy or set a credential socket when none is present', async () => {
    delete process.env[credentialSocketEnv];
    const { spawnFn } = await runLauncher();

    const spawnEnv = spawnFn.mock.calls[0][2]?.env as
      | NodeJS.ProcessEnv
      | undefined;
    expect(spawnEnv).toBeDefined();
    expect(spawnEnv![credentialSocketEnv]).toBeUndefined();
  });

  it('passes through an existing credential socket unchanged (sandbox passthrough)', async () => {
    process.env[credentialSocketEnv] = '/tmp/existing-sandbox.sock';
    const { spawnFn } = await runLauncher();

    const spawnEnv = spawnFn.mock.calls[0][2]?.env as
      | NodeJS.ProcessEnv
      | undefined;
    expect(spawnEnv).toBeDefined();
    expect(spawnEnv![credentialSocketEnv]).toBe('/tmp/existing-sandbox.sock');
  });

  it('forwards --profile-load style args unchanged', async () => {
    process.argv = ['/node', '/llxprt.cjs', '--profile-load', 'ollamakimi'];
    const { spawnFn } = await runLauncher();

    expect(spawnFn.mock.calls[0][1]).toStrictEqual([
      '/entry.ts',
      '--profile-load',
      'ollamakimi',
    ]);
  });

  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
    ['SIGBREAK', 149],
  ] satisfies Array<[NodeJS.Signals, number]>)(
    'forwards %s to the Bun child until close',
    async (signal, exitCode) => {
      delete process.env[credentialSocketEnv];
      const { child, exitCalls } = await runLauncher();

      process.emit(signal, signal);
      child.emit('close', null, signal);
      await vi.waitFor(() => expect(exitCalls).toStrictEqual([exitCode]));

      expect(child.kill).toHaveBeenCalledWith(signal);
    },
  );

  it.each([
    [0, 0],
    [7, 7],
  ] satisfies Array<[number, number]>)(
    'propagates child close code %i as exit %i',
    async (closeCode, expectedExit) => {
      const { child, exitCalls } = await runLauncher();

      child.emit('close', closeCode, null);
      await vi.waitFor(() => expect(exitCalls).toStrictEqual([expectedExit]));
    },
  );

  it('exits with code 1 when the child closes without code or signal', async () => {
    const { child, exitCalls } = await runLauncher();

    child.emit('close', null, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([1]));
  });

  it('exits with 43 and does not spawn when Bun cannot be resolved', async () => {
    const { exitCalls, spawnFn } = await runLauncher({
      resolveBun: () => null,
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(exitCalls).toStrictEqual([43]);
  });

  it('exits with 43 and does not spawn when the entry cannot be resolved', async () => {
    const { exitCalls, spawnFn } = await runLauncher({
      resolveEntry: () => null,
    });

    expect(spawnFn).not.toHaveBeenCalled();
    expect(exitCalls).toStrictEqual([43]);
  });

  it('exits with 43 when spawn throws synchronously', async () => {
    const { exitCalls } = await runLauncher({
      spawn: vi.fn(() => {
        throw new Error('sync spawn failed');
      }) as unknown as typeof spawnType,
    });

    expect(exitCalls).toStrictEqual([43]);
  });

  it('exits with 43 and best-effort kills the child on an async spawn error', async () => {
    const { child, exitCalls } = await runLauncher();

    child.emit('error', new Error('spawn failed'));

    await vi.waitFor(() => {
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(exitCalls).toStrictEqual([43]);
    });
  });

  it('exposes runCliBin as a function without executing the launcher on import', () => {
    const bin = loadCliBin();
    expect(typeof bin.runCliBin).toBe('function');
  });

  it('schedules a self-exit on SIGHUP when the child does not close', async () => {
    const { child, exitCalls } = await runLauncher({
      autoClose: false,
      selfExitDelayMs: 50,
    });

    process.emit('SIGHUP', 'SIGHUP');
    expect(child.kill).toHaveBeenCalledWith('SIGHUP');

    await vi.waitFor(() => expect(exitCalls).toStrictEqual([129]));
  });

  it('cancels the SIGHUP self-exit when the child closes before the grace period', async () => {
    const { child, exitCalls } = await runLauncher({
      autoClose: false,
      selfExitDelayMs: 50,
    });

    process.emit('SIGHUP', 'SIGHUP');
    child.emit('close', 0, null);

    await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(exitCalls).toStrictEqual([0]);
  });

  it('exits when orphaned (ppid=1) after child exit', async () => {
    const { child, exitCalls } = await runLauncher({
      autoClose: false,
      getPpid: () => 1,
      orphanCheckIntervalMs: 50,
    });

    child.emit('exit', null, 'SIGTERM');

    await vi.waitFor(() => expect(exitCalls).toStrictEqual([143]));
  });

  it('does not exit from orphan check when the child is still alive', async () => {
    const { child, exitCalls } = await runLauncher({
      autoClose: false,
      getPpid: () => 1,
      orphanCheckIntervalMs: 50,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(exitCalls).toStrictEqual([]);

    child.emit('close', 0, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
  });

  it('does not exit from orphan check when not orphaned (ppid!=1)', async () => {
    const { child, exitCalls } = await runLauncher({
      autoClose: false,
      getPpid: () => 12345,
      orphanCheckIntervalMs: 50,
    });

    child.emit('exit', 0, null);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(exitCalls).toStrictEqual([]);

    child.emit('close', 0, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
  });

  it('exits via beforeExit guard when the child has exited but close never fires', async () => {
    const { child, exitCalls } = await runLauncher({
      autoClose: false,
      getPpid: () => 12345,
    });

    child.emit('exit', 0, null);
    expect(exitCalls).toStrictEqual([]);

    process.emit('beforeExit', 0);
    expect(exitCalls).toStrictEqual([0]);
  });

  it('does not exit via beforeExit when the child is still alive', async () => {
    const { child, exitCalls } = await runLauncher({
      autoClose: false,
    });

    process.emit('beforeExit', 0);
    expect(exitCalls).toStrictEqual([]);

    child.emit('close', 0, null);
    await vi.waitFor(() => expect(exitCalls).toStrictEqual([0]));
  });
});
