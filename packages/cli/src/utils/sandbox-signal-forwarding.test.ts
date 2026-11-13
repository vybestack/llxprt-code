/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * An ACP client stops an agent by signalling the process it started. With
 * --sandbox that process is the host half of the sandbox hop, and the agent
 * is its child. These tests run the real launch path in a host process
 * against a stand-in sandbox launcher and signal the host, so they observe
 * what a client observes: the host's exit status and whether the sandboxed
 * child is still running afterwards.
 */

const HOST_SCRIPT = fileURLToPath(
  new URL('./__tests__/sandbox-signal-forwarding-host.ts', import.meta.url),
);

/**
 * Upper bounds, not expected durations. Each case starts a cold Bun process
 * (the host, which loads the sandbox launch modules) and then the stand-in.
 * On a loaded shared machine a cold start has taken several minutes, and the
 * file's first case is always the slowest. Readiness is awaited through
 * explicit markers, so a healthy run proceeds as soon as they appear. A host
 * that exits early is reported immediately, so only a host that stays alive
 * without ever registering its handlers uses the bound.
 */
const LAUNCH_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 720_000;

const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as const;
type ForwardedSignal = keyof typeof SIGNAL_NUMBERS;
const FORWARDED_SIGNALS = Object.keys(SIGNAL_NUMBERS) as ForwardedSignal[];

/** Exit status the stand-in uses when it handles a forwarded signal itself. */
const HANDLED_EXIT_STATUS = 7;

interface HostResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly report:
    | {
        exitCode: number;
        before: Record<string, number>;
        after: Record<string, number>;
      }
    | undefined;
}

interface RunningHost {
  readonly host: ChildProcess;
  readonly childPid: number;
  readonly finished: Promise<HostResult>;
}

/**
 * Stand-in that records the signal it receives, then exits with a status. It
 * publishes its pid only after its traps exist, so the pid file means "ready
 * to receive a signal". It is written by rename so a reader never sees a
 * partial pid.
 */
const HANDLING_STUB = [
  '#!/bin/sh',
  `trap 'echo TERM > "$STUB_DIR/received"; exit ${HANDLED_EXIT_STATUS}' TERM`,
  `trap 'echo INT > "$STUB_DIR/received"; exit ${HANDLED_EXIT_STATUS}' INT`,
  `trap 'echo HUP > "$STUB_DIR/received"; exit ${HANDLED_EXIT_STATUS}' HUP`,
  'echo $$ > "$STUB_DIR/child.pid.tmp"',
  'mv "$STUB_DIR/child.pid.tmp" "$STUB_DIR/child.pid"',
  'while :; do sleep 0.05; done',
].join('\n');

/**
 * Stand-in with default signal dispositions: any forwarded signal kills it,
 * whether it arrives before or after the exec.
 */
const DEFAULT_DISPOSITION_STUB = [
  '#!/bin/sh',
  'echo $$ > "$STUB_DIR/child.pid.tmp"',
  'mv "$STUB_DIR/child.pid.tmp" "$STUB_DIR/child.pid"',
  'exec sleep 600',
].join('\n');

function isAlive(pid: number): boolean {
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

async function waitUntil(
  condition: () => boolean,
  description: string,
): Promise<void> {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('sandbox hop signal forwarding', () => {
  let stubDir: string;
  const startedHosts: ChildProcess[] = [];
  const startedChildPids: number[] = [];

  beforeEach(() => {
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-signal-fwd-'));
  }, TEST_TIMEOUT_MS);

  afterEach(() => {
    // Only processes this test started: the host by handle, the stand-in by
    // the pid it wrote down. A fixed implementation leaves nothing to reap.
    for (const host of startedHosts.splice(0)) {
      if (host.exitCode === null && host.signalCode === null) {
        host.kill('SIGKILL');
      }
    }
    for (const pid of startedChildPids.splice(0)) {
      if (isAlive(pid)) process.kill(pid, 'SIGKILL');
    }
    fs.rmSync(stubDir, { recursive: true, force: true });
  }, TEST_TIMEOUT_MS);

  async function startHost(stubSource: string): Promise<RunningHost> {
    const stubPath = path.join(stubDir, 'sandbox-exec');
    fs.writeFileSync(stubPath, `${stubSource}\n`, { mode: 0o755 });
    const host = spawn(process.execPath, [HOST_SCRIPT], {
      // stdin stays open and unread, as for an ACP client holding the pipe.
      stdio: ['pipe', 'ignore', 'ignore'],
      env: {
        ...process.env,
        PATH: `${stubDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
        STUB_DIR: stubDir,
      },
    });
    startedHosts.push(host);
    // 'exit', not 'close': an orphaned stand-in holds the host's stdio open.
    const finished = new Promise<HostResult>((resolve) => {
      host.once('exit', (exitCode, signal) => {
        const reportFile = path.join(stubDir, 'report.json');
        resolve({
          exitCode,
          signal,
          report: fs.existsSync(reportFile)
            ? (JSON.parse(
                fs.readFileSync(reportFile, 'utf8'),
              ) as HostResult['report'])
            : undefined,
        });
      });
    });
    // Two independent readiness facts, both required before signalling: the
    // host has registered its handlers (`ready`, written by the host script),
    // and the stand-in is running with its own disposition in place (its pid
    // file). The stand-in starting alone proves nothing about the host: the
    // host can still be between spawning it and registering handlers.
    const readyFile = path.join(stubDir, 'ready');
    const pidFile = path.join(stubDir, 'child.pid');
    await waitUntil(
      () =>
        (fs.existsSync(readyFile) && fs.existsSync(pidFile)) ||
        host.exitCode !== null ||
        host.signalCode !== null,
      'the host to register its handlers and the sandboxed child to start',
    );
    if (!fs.existsSync(readyFile) || !fs.existsSync(pidFile)) {
      throw new Error(
        `Host exited before it was ready to be signalled (code=${String(host.exitCode)}, signal=${String(host.signalCode)})`,
      );
    }
    const childPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    startedChildPids.push(childPid);
    return { host, childPid, finished };
  }

  for (const signal of FORWARDED_SIGNALS) {
    it(
      `forwards ${signal} to the sandboxed child and exits with the child's status`,
      async () => {
        const { host, childPid, finished } = await startHost(HANDLING_STUB);

        host.kill(signal);
        const result = await finished;

        const received = fs.readFileSync(
          path.join(stubDir, 'received'),
          'utf8',
        );
        expect(received.trim()).toBe(signal.slice('SIG'.length));
        expect(result.signal).toBeNull();
        expect(result.exitCode).toBe(HANDLED_EXIT_STATUS);
        expect(isAlive(childPid)).toBe(false);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      `exits 128+signal and leaves no child when ${signal} kills the sandboxed child`,
      async () => {
        const { host, childPid, finished } = await startHost(
          DEFAULT_DISPOSITION_STUB,
        );

        host.kill(signal);
        const result = await finished;

        expect(result.signal).toBeNull();
        expect(result.exitCode).toBe(128 + SIGNAL_NUMBERS[signal]);
        expect(isAlive(childPid)).toBe(false);
      },
      TEST_TIMEOUT_MS,
    );
  }

  it(
    'removes its signal handlers once the sandboxed child has exited',
    async () => {
      const { host, finished } = await startHost(HANDLING_STUB);

      host.kill('SIGTERM');
      const { report } = await finished;

      expect(report).toBeDefined();
      expect(report?.after).toStrictEqual(report?.before ?? {});
    },
    TEST_TIMEOUT_MS,
  );
});
