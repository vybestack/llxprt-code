/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ShellJobManager, type Config } from '@vybestack/llxprt-code-core';
import {
  MAX_COMMAND_LENGTH,
  MAX_LISTED_JOBS,
  registerShellJobShutdownNotice,
  type ExitListenerTarget,
} from './shellJobShutdownNotice.js';

/**
 * A stand-in for `process` that keeps listeners on a private emitter instead
 * of the real process. Signals are never raised against it: `kill` throws so
 * a test that unexpectedly re-raises fails loudly instead of killing the
 * test runner.
 */
function captureExitListeners(): {
  target: ExitListenerTarget;
  fireExit: () => void;
} {
  const emitter = new EventEmitter();
  const target: ExitListenerTarget = Object.assign(emitter, {
    pid: 0,
    kill: (): boolean => {
      throw new Error('captured target must never be signalled');
    },
  });
  return {
    target,
    fireExit: () => {
      emitter.emit('exit', 0);
    },
  };
}

/**
 * Minimal runtime shape of a `Bun.spawn` subprocess, restricted to the
 * members these tests read. Defined locally because the CLI TypeScript
 * config loads `bun-types/test` (the `bun:test` module) but NOT the global
 * `Bun` namespace, so the bare global `Bun.spawn` symbol is unavailable to
 * the type-checker. We reach the real, runtime `Bun.spawn` through
 * `globalThis` — the same approach used by
 * `cli/src/observation/jspBootstrapStartup.test.ts`. This also sidesteps
 * `node:child_process`, whose module mocking in the combined test run
 * (see `relaunch.test.ts`) would replace `spawn` for late importers.
 */
interface BunSubprocessLike {
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  readonly signalCode: string | null;
  kill(signal: NodeJS.Signals): void;
}

type BunSpawnFn = (
  cmds: string[],
  options: {
    stdin?: 'ignore' | 'pipe' | 'inherit';
    stdout?: 'ignore' | 'pipe' | 'inherit';
    stderr?: 'ignore' | 'pipe' | 'inherit';
    env?: Record<string, string | undefined>;
  },
) => BunSubprocessLike;

function getBunSpawn(): BunSpawnFn {
  const bun = (globalThis as { Bun?: { spawn?: unknown } }).Bun;
  if (bun === undefined || typeof bun.spawn !== 'function') {
    throw new Error(
      'Bun.spawn is unavailable; shellJobShutdownNotice tests must run under bun:test',
    );
  }
  return bun.spawn as unknown as BunSpawnFn;
}

const bunSpawn = getBunSpawn();

/**
 * Managed jobs are detached process-group leaders that outlive the process
 * that launched them, so a fixture that leaves one running must have its
 * group reaped explicitly. The fixture records the leader pid in `job.pid`;
 * a missing or unparseable file yields NaN and is skipped.
 */
function reapJobGroup(fixtureDir: string): void {
  const pidPath = path.join(fixtureDir, 'job.pid');
  const pid = fs.existsSync(pidPath)
    ? Number.parseInt(fs.readFileSync(pidPath, 'utf8'), 10)
    : Number.NaN;
  if (Number.isFinite(pid) && pid > 1) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // The job may already have exited (ESRCH); nothing to reap.
    }
  }
}

type FixtureJobs = 'missing' | 'empty' | 'completed' | 'running';
type FixtureHandler = 'none' | 'interactive' | 'noninteractive';

interface SignalScenario {
  /** `missing`: no manager at all; the others describe the manager's jobs. */
  jobs: FixtureJobs;
  /** Which existing production shutdown handler the child also installs. */
  handler: FixtureHandler;
  /** Whether that handler is registered before or after the notice. */
  order: 'before' | 'after';
  /** How many times the child registers the notice; defaults to once. */
  registrations?: number;
}

interface SignalledChildResult {
  stderr: string;
  exitCode: number;
  signalCode: string | null;
  cleanupCompleted: boolean;
}

/**
 * Source of a child that wires the real notice, a real `ShellJobManager`,
 * patched stdio, and optionally the real production shutdown handlers
 * (the interactive SIGTERM/SIGINT handlers behind a test-supplied TTY, or
 * the non-interactive SIGINT handler), then writes `READY` to fd 1 and
 * idles until the parent signals it. A registered async cleanup takes
 * 150ms and leaves `cleanup.done` behind so the parent can tell whether a
 * handler's cleanup ran to completion before the process ended.
 */
function buildSignalFixture(): string {
  const coreSrc = path.resolve(import.meta.dirname, '../../../core/src');
  const cliSrc = path.resolve(import.meta.dirname, '..');
  const mod = (...segments: string[]): string =>
    JSON.stringify(path.join(...segments));
  return `
const { writeFileSync, writeSync } = await import('node:fs');
const { patchStdio } = await import(${mod(coreSrc, 'utils', 'stdio.ts')});
const { ShellJobManager } = await import(${mod(coreSrc, 'services', 'shellJobManager.ts')});
const { registerShellJobShutdownNotice } = await import(${mod(cliSrc, 'utils', 'shellJobShutdownNotice.ts')});
const baseDir = process.env.NOTICE_FIXTURE_BASE_DIR;
const jobs = process.env.NOTICE_FIXTURE_JOBS;
const handler = process.env.NOTICE_FIXTURE_HANDLER;
const order = process.env.NOTICE_FIXTURE_ORDER;
const registrations = Number(process.env.NOTICE_FIXTURE_REGISTRATIONS);
patchStdio();
let manager;
if (jobs !== 'missing') {
  manager = new ShellJobManager({ baseDir });
}
if (jobs === 'completed') {
  const done = manager.launch({ command: 'true', cwd: baseDir });
  while (manager.get(done.id)?.state === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
if (jobs === 'running') {
  const job = manager.launch({ command: 'sleep 60', cwd: baseDir });
  writeFileSync(baseDir + '/job.pid', String(job.pid));
}
const host = { peekShellJobManager: () => manager, isInteractive: () => true };
async function installHandler() {
  if (handler === 'none') return;
  const { registerCleanup } = await import(${mod(cliSrc, 'utils', 'cleanup.ts')});
  registerCleanup(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    writeFileSync(baseDir + '/cleanup.done', 'done');
  });
  if (handler === 'interactive') {
    const { enableInteractiveRawModeIfNeeded } = await import(${mod(cliSrc, 'cliTerminalSession.ts')});
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    await enableInteractiveRawModeIfNeeded(host, { enable() {}, disable() {} }, false);
  } else {
    const { installNonInteractiveSigintHandler } = await import(${mod(cliSrc, 'session', 'signalHandlers.ts')});
    installNonInteractiveSigintHandler();
  }
}
if (order === 'before') await installHandler();
for (let i = 0; i < registrations; i++) registerShellJobShutdownNotice(host);
if (order === 'after') await installHandler();
setInterval(() => {}, 1000);
writeSync(1, 'READY');
`;
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves once the child has written its `READY` line to stdout. */
async function waitForReady(stdout: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let seen = '';
  try {
    while (!seen.includes('READY')) {
      const { done, value } = await reader.read();
      if (done) {
        throw new Error(`child exited before readiness; stdout: ${seen}`);
      }
      seen += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Spawns the fixture with no TTY on any stream, waits for its readiness
 * line, delivers a real OS signal, and reports how the child ended. Every
 * wait is bounded, and the child and its job group are always reaped.
 */
async function runSignalledChild(
  fixtureDir: string,
  scenario: SignalScenario,
  signal: 'SIGTERM' | 'SIGINT',
): Promise<SignalledChildResult> {
  const fixturePath = path.join(fixtureDir, 'signal-fixture.ts');
  fs.writeFileSync(fixturePath, buildSignalFixture());
  const proc = bunSpawn([process.execPath, fixturePath], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      NOTICE_FIXTURE_BASE_DIR: fixtureDir,
      NOTICE_FIXTURE_JOBS: scenario.jobs,
      NOTICE_FIXTURE_HANDLER: scenario.handler,
      NOTICE_FIXTURE_ORDER: scenario.order,
      NOTICE_FIXTURE_REGISTRATIONS: String(scenario.registrations ?? 1),
    },
  });
  if (proc.stdout === null || proc.stderr === null) {
    throw new Error('child stdout and stderr were not piped');
  }
  const stderrText = new Response(proc.stderr).text();
  try {
    await withTimeout(waitForReady(proc.stdout), 30_000, 'child readiness');
    proc.kill(signal);
    const exitCode = await withTimeout(proc.exited, 30_000, 'child exit');
    return {
      stderr: await withTimeout(stderrText, 10_000, 'child stderr drain'),
      exitCode,
      signalCode: proc.signalCode,
      cleanupCompleted: fs.existsSync(path.join(fixtureDir, 'cleanup.done')),
    };
  } finally {
    proc.kill('SIGKILL');
    reapJobGroup(fixtureDir);
  }
}

function countNotices(stderr: string): number {
  return stderr.split('Shutting down with').length - 1;
}

describe('registerShellJobShutdownNotice', () => {
  let managers: ShellJobManager[] = [];
  let baseDirs: string[] = [];
  let stderrChunks: string[] = [];
  let stderrWriteCalls = 0;
  const realWriteSync = fs.writeSync;

  afterEach(async () => {
    // Every cleanup step runs regardless of individual failures: an abort
    // at the first throwing dispose would leave later managers undisposed,
    // their temp directories on disk, and background jobs running into the
    // next test. Collected failures surface only after the arrays are
    // reset, so teardown state is consistent either way.
    const failures: unknown[] = [];
    try {
      vi.restoreAllMocks();
    } catch (error) {
      failures.push(error);
    }
    for (const manager of managers) {
      try {
        await manager.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    managers = [];
    for (const dir of baseDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        failures.push(error);
      }
    }
    baseDirs = [];
    stderrChunks = [];
    stderrWriteCalls = 0;
    if (failures.length === 1) {
      throw failures[0];
    }
    if (failures.length > 1) {
      throw new Error(
        `afterEach cleanup had ${failures.length} failures: ${failures
          .map((failure) =>
            failure instanceof Error ? failure.message : String(failure),
          )
          .join('; ')}`,
      );
    }
  });

  /**
   * `maxBackgroundJobs` overrides the default budget of 10 for tests that
   * need more concurrent jobs than that.
   */
  function makeManager(maxBackgroundJobs?: number): ShellJobManager {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-notice-'));
    baseDirs.push(baseDir);
    const manager = new ShellJobManager({ baseDir, maxBackgroundJobs });
    managers.push(manager);
    return manager;
  }

  /**
   * Captures the handler's synchronous fd-2 writes instead of letting them
   * reach the test runner's stderr. Writes to other descriptors pass through
   * untouched. `behaviour` models the hostile fd-2 conditions the notice
   * must survive: a synchronous throw, and a short write that accepts only
   * part of the requested bytes on the first call.
   */
  function spyStderrFd2(
    behaviour: {
      /** Makes the first fd-2 write throw instead of writing. */
      throwOnFirstWrite?: Error;
      /** Bytes the first fd-2 write accepts; later writes take the rest. */
      firstWriteAccepts?: number;
    } = {},
  ): void {
    stderrChunks = [];
    stderrWriteCalls = 0;
    vi.spyOn(fs, 'writeSync').mockImplementation(
      (
        fd: number,
        data: string | ArrayBufferView,
        ...rest: unknown[]
      ): number => {
        if (fd !== 2) {
          return Reflect.apply(realWriteSync, undefined, [
            fd,
            data,
            ...rest,
          ]) as number;
        }
        stderrWriteCalls++;
        if (stderrWriteCalls === 1 && behaviour.throwOnFirstWrite) {
          throw behaviour.throwOnFirstWrite;
        }
        const acceptedCount = (requested: number): number =>
          stderrWriteCalls === 1 && behaviour.firstWriteAccepts !== undefined
            ? Math.min(behaviour.firstWriteAccepts, requested)
            : requested;
        if (typeof data === 'string') {
          const accepted = acceptedCount(data.length);
          stderrChunks.push(data.slice(0, accepted));
          return accepted;
        }
        if (!(data instanceof Uint8Array)) {
          throw new Error('fd-2 spy expects a string or Uint8Array write');
        }
        // The handler writes fd 2 with the buffer overload
        // (fd, buffer, offset, length). Mirror the syscall by recording the
        // slice [offset, offset + accepted) and reporting the accepted count.
        const offset = (rest[0] as number | undefined) ?? 0;
        const accepted = acceptedCount(
          (rest[1] as number | undefined) ?? data.byteLength,
        );
        stderrChunks.push(
          new TextDecoder().decode(data.subarray(offset, offset + accepted)),
        );
        return accepted;
      },
    );
  }

  async function waitForTerminalState(
    manager: ShellJobManager,
    id: string,
  ): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (manager.get(id)?.state === 'running') {
      if (Date.now() > deadline) {
        throw new Error(`Job ${id} did not leave the running state in time`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('announces a running managed background job on process exit', () => {
    const manager = makeManager();
    const job = manager.launch({ command: 'sleep 30', cwd: os.tmpdir() });
    const { target, fireExit } = captureExitListeners();
    spyStderrFd2();
    const host: Pick<Config, 'peekShellJobManager'> = {
      peekShellJobManager: () => manager,
    };

    registerShellJobShutdownNotice(host, target);
    fireExit();

    const output = stderrChunks.join('');
    expect(output).toContain(
      'Shutting down with 1 managed background job(s) still running',
    );
    expect(output).toContain(`${job.id}: sleep 30`);
  });

  it('truncates an over-long job command and keeps the written payload bounded', () => {
    const manager = makeManager();
    const longCommand = `echo ${'x'.repeat(MAX_COMMAND_LENGTH * 50)}`;
    const job = manager.launch({ command: longCommand, cwd: os.tmpdir() });
    const { target, fireExit } = captureExitListeners();
    spyStderrFd2();
    const host: Pick<Config, 'peekShellJobManager'> = {
      peekShellJobManager: () => manager,
    };

    registerShellJobShutdownNotice(host, target);
    fireExit();

    const output = stderrChunks.join('');
    // The first MAX_COMMAND_LENGTH characters survive verbatim and the
    // marker says the command was cut; nothing beyond the limit is written.
    expect(output).toContain(
      `${job.id}: ${longCommand.slice(0, MAX_COMMAND_LENGTH)}`,
    );
    expect(output).toContain('[truncated]');
    // One job: the header (~62 chars) plus a single line of id, a
    // 200-char command, and the marker. The untruncated command alone is
    // over 10,000 characters, so a small bound proves the payload cannot
    // grow with the command text.
    expect(output.length).toBeLessThan(400);
  });

  it('caps the listing and reports the true total and the omitted job count', () => {
    const total = MAX_LISTED_JOBS + 5;
    const manager = makeManager(total);
    for (let i = 0; i < total; i++) {
      manager.launch({ command: 'sleep 30', cwd: os.tmpdir() });
    }
    const { target, fireExit } = captureExitListeners();
    spyStderrFd2();
    const host: Pick<Config, 'peekShellJobManager'> = {
      peekShellJobManager: () => manager,
    };

    registerShellJobShutdownNotice(host, target);
    fireExit();

    const output = stderrChunks.join('');
    // The header must carry the true total, not the capped listing size,
    // so the operator still learns how many jobs were discarded.
    expect(output).toContain(
      `Shutting down with ${total} managed background job(s) still running:`,
    );
    const jobLines = output
      .split('\n')
      .filter((line) => line.startsWith('  shell_'));
    expect(jobLines).toHaveLength(MAX_LISTED_JOBS);
    expect(output).toContain(
      `  ...and ${total - MAX_LISTED_JOBS} more job(s) not listed`,
    );
  }, 30_000);

  it('registers the notice at most once per target', () => {
    const manager = makeManager();
    manager.launch({ command: 'sleep 30', cwd: os.tmpdir() });
    const { target, fireExit } = captureExitListeners();
    spyStderrFd2();
    const host: Pick<Config, 'peekShellJobManager'> = {
      peekShellJobManager: () => manager,
    };

    registerShellJobShutdownNotice(host, target);
    registerShellJobShutdownNotice(host, target);
    fireExit();

    // A second registration must not append another exit listener, or
    // one exit would print the notice twice.
    const noticeCount =
      stderrChunks.join('').split('Shutting down with').length - 1;
    expect(noticeCount).toBe(1);
  });

  it('a throwing fd-2 write does not escape the exit listener and a later exit listener still runs', () => {
    const manager = makeManager();
    manager.launch({ command: 'sleep 30', cwd: os.tmpdir() });
    const { target, fireExit } = captureExitListeners();
    spyStderrFd2({
      throwOnFirstWrite: Object.assign(new Error('write EPIPE'), {
        code: 'EPIPE',
      }),
    });
    const host: Pick<Config, 'peekShellJobManager'> = {
      peekShellJobManager: () => manager,
    };

    registerShellJobShutdownNotice(host, target);
    let laterListenerRan = false;
    target.on('exit', () => {
      laterListenerRan = true;
    });

    // If the write error escaped the listener, fireExit would throw here
    // and the later listener would never run, exactly as on the real
    // process exit path.
    fireExit();

    expect(laterListenerRan).toBe(true);
    expect(stderrChunks).toStrictEqual([]);
  });

  it('a throwing manager read does not escape the exit listener and a later exit listener still runs', () => {
    const { target, fireExit } = captureExitListeners();
    spyStderrFd2();
    const host: Pick<Config, 'peekShellJobManager'> = {
      peekShellJobManager: () => {
        throw new Error('manager read failed during exit');
      },
    };

    registerShellJobShutdownNotice(host, target);
    let laterListenerRan = false;
    target.on('exit', () => {
      laterListenerRan = true;
    });

    // If the manager-read error escaped the listener, fireExit would
    // throw here and the later listener would never run, exactly as on
    // the real process exit path.
    fireExit();

    expect(laterListenerRan).toBe(true);
    expect(stderrChunks).toStrictEqual([]);
  });

  it('resumes a short fd-2 write until the whole notice is out', () => {
    const manager = makeManager();
    const job = manager.launch({ command: 'sleep 30', cwd: os.tmpdir() });
    const { target, fireExit } = captureExitListeners();
    // First write accepts only 10 bytes; the notice must resume from byte
    // 10 rather than restart, drop, or duplicate anything.
    spyStderrFd2({ firstWriteAccepts: 10 });
    const host: Pick<Config, 'peekShellJobManager'> = {
      peekShellJobManager: () => manager,
    };

    registerShellJobShutdownNotice(host, target);
    fireExit();

    expect(stderrWriteCalls).toBeGreaterThanOrEqual(2);
    expect(stderrChunks.join('')).toBe(
      `Shutting down with 1 managed background job(s) still running:
  ${job.id}: sleep 30
`,
    );
  });

  it('writes nothing on process exit when no managed background job is running', async () => {
    const manager = makeManager();
    const finished = manager.launch({ command: 'true', cwd: os.tmpdir() });
    await waitForTerminalState(manager, finished.id);
    const { target, fireExit } = captureExitListeners();
    spyStderrFd2();
    const host: Pick<Config, 'peekShellJobManager'> = {
      peekShellJobManager: () => manager,
    };

    registerShellJobShutdownNotice(host, target);
    fireExit();

    expect(stderrChunks).toStrictEqual([]);
  });

  it('a job-free exit writes nothing and constructs no manager or filesystem state', () => {
    const { target, fireExit } = captureExitListeners();
    spyStderrFd2();
    const mkdtemp = vi.spyOn(fs, 'mkdtempSync');
    let creatingGetterCalls = 0;
    // The exit path must read state without constructing anything. If it
    // used the creating getter, this host would build a real manager — and
    // mkdtemp its log directory — during exit on a session that never
    // backgrounded a job.
    const host = {
      peekShellJobManager: (): undefined => undefined,
      getShellJobManager: (): ShellJobManager => {
        creatingGetterCalls++;
        return makeManager();
      },
    };

    registerShellJobShutdownNotice(host, target);
    fireExit();

    expect(creatingGetterCalls).toBe(0);
    expect(mkdtemp).not.toHaveBeenCalled();
    expect(stderrChunks).toStrictEqual([]);
  });

  it('reaches the physical stderr of a process whose stdio is patched when it exits via the quit path', async () => {
    // The quit path calls process.exit(0) without restoring stdio, so the
    // notice must bypass the patched process.stderr.write and land on the
    // physical descriptor 2. A subprocess pins this end to end: the child
    // patches stdio, launches a job, registers the notice, and exits; the
    // parent asserts the notice text on the child's piped stderr.
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-exit-'));
    baseDirs.push(fixtureDir);
    const coreSrc = path.resolve(import.meta.dirname, '../../../core/src');
    const fixturePath = path.join(fixtureDir, 'quit-path-fixture.ts');
    const fixture = [
      'const { patchStdio } = await import(',
      JSON.stringify(path.join(coreSrc, 'utils', 'stdio.ts')),
      ');',
      'const { ShellJobManager } = await import(',
      JSON.stringify(path.join(coreSrc, 'services', 'shellJobManager.ts')),
      ');',
      'const { registerShellJobShutdownNotice } = await import(',
      JSON.stringify(
        path.join(import.meta.dirname, 'shellJobShutdownNotice.ts'),
      ),
      ');',
      'const { writeFileSync } = await import(',
      JSON.stringify('node:fs'),
      ');',
      'patchStdio();',
      'const baseDir = process.env.NOTICE_FIXTURE_BASE_DIR;',
      'const manager = new ShellJobManager({ baseDir });',
      'const job = manager.launch({ command: "sleep 30", cwd: baseDir });',
      'writeFileSync(baseDir + "/job.pid", String(job.pid));',
      'registerShellJobShutdownNotice({ peekShellJobManager: () => manager });',
      'process.exit(0);',
      '',
    ].join('\n');
    fs.writeFileSync(fixturePath, fixture);

    const proc = bunSpawn([process.execPath, fixturePath], {
      stdout: 'ignore',
      stderr: 'pipe',
      env: { ...process.env, NOTICE_FIXTURE_BASE_DIR: fixtureDir },
    });
    if (proc.stderr === null) {
      throw new Error('child stderr was not piped');
    }
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    try {
      expect(exitCode).toBe(0);
      expect(stderr).toContain(
        'Shutting down with 1 managed background job(s) still running',
      );
      expect(stderr).toContain('sleep 30');
    } finally {
      // The child's manager is not owned by this test's afterEach, so the
      // job it leaked must be reaped explicitly.
      reapJobGroup(fixtureDir);
    }
  }, 30_000);

  describe.skipIf(process.platform === 'win32')(
    'when a real no-TTY child process is sent a signal',
    () => {
      const signals = [
        { signal: 'SIGTERM', status: 143 },
        { signal: 'SIGINT', status: 130 },
      ] as const;

      function makeFixtureDir(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-signal-'));
        baseDirs.push(dir);
        return dir;
      }

      for (const { signal, status } of signals) {
        it(`reports a running job once and still dies from ${signal} with status ${status}`, async () => {
          const result = await runSignalledChild(
            makeFixtureDir(),
            { jobs: 'running', handler: 'none', order: 'after' },
            signal,
          );

          expect(result.signalCode).toBe(signal);
          expect(result.exitCode).toBe(status);
          expect(countNotices(result.stderr)).toBe(1);
          expect(result.stderr).toContain('sleep 60');
        }, 90_000);

        for (const jobs of ['missing', 'empty', 'completed'] as const) {
          it(`stays quiet on ${signal} when the manager is ${jobs} and still dies from the signal`, async () => {
            const result = await runSignalledChild(
              makeFixtureDir(),
              { jobs, handler: 'none', order: 'after' },
              signal,
            );

            expect(result.signalCode).toBe(signal);
            expect(result.exitCode).toBe(status);
            expect(result.stderr).toBe('');
          }, 90_000);
        }
      }

      for (const { signal, status } of signals) {
        it(`reports a running job once and still dies from ${signal} with status ${status} when the notice is registered twice`, async () => {
          const result = await runSignalledChild(
            makeFixtureDir(),
            {
              jobs: 'running',
              handler: 'none',
              order: 'after',
              registrations: 2,
            },
            signal,
          );

          // A duplicate registration must change nothing observable: one
          // physical notice, and the process still ends from the signal
          // itself rather than hanging on listeners that defer to each other.
          expect(result.signalCode).toBe(signal);
          expect(result.exitCode).toBe(status);
          expect(countNotices(result.stderr)).toBe(1);
          expect(result.stderr).toContain('sleep 60');
        }, 90_000);
      }

      const handlerCases = [
        // The interactive handlers exit normally after async cleanup: 0 on
        // SIGTERM, 130 on SIGINT. The non-interactive handler covers SIGINT
        // only and also exits 130.
        { handler: 'interactive', signal: 'SIGTERM', status: 0 },
        { handler: 'interactive', signal: 'SIGINT', status: 130 },
        { handler: 'noninteractive', signal: 'SIGINT', status: 130 },
      ] as const;

      for (const { handler, signal, status } of handlerCases) {
        for (const order of ['before', 'after'] as const) {
          it(`reports a running job once with the ${handler} ${signal} handler registered ${order} the notice`, async () => {
            const result = await runSignalledChild(
              makeFixtureDir(),
              { jobs: 'running', handler, order },
              signal,
            );

            // The handler owns the exit: its async cleanup finishes, it
            // exits with its own status, and the process is not killed by
            // the signal.
            expect(result.signalCode).toBeNull();
            expect(result.exitCode).toBe(status);
            expect(result.cleanupCompleted).toBe(true);
            expect(countNotices(result.stderr)).toBe(1);
          }, 90_000);
        }

        it(`stays quiet when the ${handler} ${signal} handler runs with no manager`, async () => {
          const result = await runSignalledChild(
            makeFixtureDir(),
            { jobs: 'missing', handler, order: 'after' },
            signal,
          );

          expect(result.signalCode).toBeNull();
          expect(result.exitCode).toBe(status);
          expect(result.cleanupCompleted).toBe(true);
          expect(result.stderr).toBe('');
        }, 90_000);
      }
    },
  );
});
