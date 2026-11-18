/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Shared harness for the sandbox hop signal tests. Each test starts a host
 * process that runs a real launch path against stand-in launchers, signals the
 * host the way an ACP client signals the agent it started, and observes the
 * host's exit status and the files the stand-ins leave in a shared directory.
 */

/**
 * Upper bounds, not expected durations. Each case starts a cold Bun process
 * (the host, which loads the sandbox launch modules) and then the stand-in.
 * On a loaded shared machine a cold start has taken several minutes, and the
 * file's first case is always the slowest. Readiness is awaited through
 * explicit markers, so a healthy run proceeds as soon as they appear. A host
 * that exits early is reported immediately, so only a host that stays alive
 * without ever registering its handlers uses the bound.
 */
export const LAUNCH_TIMEOUT_MS = 600_000;
export const TEST_TIMEOUT_MS = 720_000;

export const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;
export type ForwardedSignal = keyof typeof SIGNAL_NUMBERS;
export const FORWARDED_SIGNALS = Object.keys(
  SIGNAL_NUMBERS,
) as ForwardedSignal[];

/** Exit status the stand-in uses when it handles a forwarded signal itself. */
export const HANDLED_EXIT_STATUS = 7;

export interface HostResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly report:
    | {
        exitCode: number;
        before: Record<string, number>;
        after: Record<string, number>;
      }
    | undefined;
}

export interface RunningHost {
  readonly host: ChildProcess;
  readonly childPid: number;
  readonly finished: Promise<HostResult>;
}

export interface HostOptions {
  /** Executables written into the stub directory, which is first on PATH. */
  readonly stubs?: Readonly<Record<string, string>>;
  /** Extra environment for the host process. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Stand-in that records the signal it receives, then exits with a status. It
 * publishes its pid only after its traps exist, so the pid file means "ready
 * to receive a signal". It is written by rename so a reader never sees a
 * partial pid. `beforeExit` is shell run after the signal is recorded and
 * before the stand-in exits, to hold the stand-in open for a while.
 */
export function handlingStub(beforeExit = ''): string {
  const trap = (name: string): string =>
    `trap 'echo ${name} > "$STUB_DIR/received"; ${beforeExit} exit ${HANDLED_EXIT_STATUS}' ${name}`;
  return [
    '#!/bin/sh',
    trap('TERM'),
    trap('INT'),
    trap('HUP'),
    'echo $$ > "$STUB_DIR/child.pid.tmp"',
    'mv "$STUB_DIR/child.pid.tmp" "$STUB_DIR/child.pid"',
    'while :; do sleep 0.05; done',
  ].join('\n');
}

/**
 * Stand-in with default signal dispositions: any forwarded signal kills it,
 * whether it arrives before or after the exec.
 */
export const DEFAULT_DISPOSITION_STUB = [
  '#!/bin/sh',
  'echo $$ > "$STUB_DIR/child.pid.tmp"',
  'mv "$STUB_DIR/child.pid.tmp" "$STUB_DIR/child.pid"',
  'exec sleep 600',
].join('\n');

/**
 * How long a process that has been signalled gets to exit after its host is
 * gone. The signal is already delivered by then, so this only covers
 * scheduling on a loaded machine.
 */
export const SIGNALLED_EXIT_TIMEOUT_MS = 60_000;

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    );
  }
}

export async function waitUntil(
  condition: () => boolean,
  description: string,
  timeoutMs = LAUNCH_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Files in the stub directory that name a process the test must reap. */
const PID_FILES = ['child.pid', 'proxy.pid'];

export class SandboxHostHarness {
  private dir = '';
  private readonly hosts: ChildProcess[] = [];

  constructor(private readonly hostScript: string) {}

  get stubDir(): string {
    return this.dir;
  }

  file(name: string): string {
    return path.join(this.dir, name);
  }

  readText(name: string): string {
    return fs.readFileSync(this.file(name), 'utf8').trim();
  }

  readPid(name: string): number {
    return Number(this.readText(name));
  }

  setUp(): void {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-signal-fwd-'));
  }

  /**
   * Reaps only processes this harness started: hosts by handle, stand-ins by
   * the pid they wrote down. A correct implementation leaves nothing to reap.
   */
  tearDown(): void {
    for (const host of this.hosts.splice(0)) {
      if (host.exitCode === null && host.signalCode === null) {
        host.kill('SIGKILL');
      }
      host.stderr?.destroy();
    }
    for (const name of PID_FILES) {
      const pid = this.pidIfWritten(name);
      if (pid !== undefined && isAlive(pid)) process.kill(pid, 'SIGKILL');
    }
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  private pidIfWritten(name: string): number | undefined {
    if (!fs.existsSync(this.file(name))) return undefined;
    const pid = this.readPid(name);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  }

  private spawnHost(options: HostOptions): {
    host: ChildProcess;
    finished: Promise<HostResult>;
  } {
    for (const [name, source] of Object.entries(options.stubs ?? {})) {
      fs.writeFileSync(this.file(name), `${source}\n`, { mode: 0o755 });
    }
    const host = spawn(process.execPath, [this.hostScript], {
      // stdin stays open and unread, as for an ACP client holding the pipe.
      stdio: ['pipe', 'ignore', 'pipe'],
      env: {
        ...process.env,
        PATH: `${this.dir}${path.delimiter}${process.env['PATH'] ?? ''}`,
        STUB_DIR: this.dir,
        ...options.env,
      },
    });
    this.hosts.push(host);
    let stderr = '';
    host.stderr.setEncoding('utf8');
    host.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    // 'exit', not 'close': an orphaned stand-in holds the host's stdio open.
    const finished = new Promise<HostResult>((resolve) => {
      host.once('exit', (exitCode, signal) => {
        const reportFile = this.file('report.json');
        resolve({
          exitCode,
          signal,
          stderr,
          report: fs.existsSync(reportFile)
            ? (JSON.parse(
                fs.readFileSync(reportFile, 'utf8'),
              ) as HostResult['report'])
            : undefined,
        });
      });
    });
    return { host, finished };
  }

  /** Runs a host that is not signalled and returns once it has exited. */
  runToExit(options: HostOptions): Promise<HostResult> {
    return this.spawnHost(options).finished;
  }

  /**
   * Starts a host and returns once it is ready to be signalled. Two
   * independent readiness facts are required: the host has registered its
   * handlers (`ready`, written by the host script), and the stand-in is
   * running with its own disposition in place (its pid file). The stand-in
   * starting alone proves nothing about the host: the host can still be
   * between spawning it and registering handlers. `alsoReady` names further
   * files a scenario needs, such as a proxy pid.
   */
  async startHost(
    options: HostOptions,
    alsoReady: readonly string[] = [],
  ): Promise<RunningHost> {
    const { host, finished } = this.spawnHost(options);
    const required = ['ready', 'child.pid', ...alsoReady];
    const allPresent = (): boolean =>
      required.every((name) => fs.existsSync(this.file(name)));
    await waitUntil(
      () => allPresent() || host.exitCode !== null || host.signalCode !== null,
      'the host to register its handlers and the sandboxed child to start',
    );
    if (!allPresent()) {
      throw new Error(
        `Host exited before it was ready to be signalled (code=${String(host.exitCode)}, signal=${String(host.signalCode)})`,
      );
    }
    return { host, childPid: this.readPid('child.pid'), finished };
  }
}
