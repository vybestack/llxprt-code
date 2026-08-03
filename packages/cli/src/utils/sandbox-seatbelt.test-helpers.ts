/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';

const PROCESS_LISTENER_EVENTS = ['exit', 'SIGINT', 'SIGTERM'] as const;
const CHILD_CLOSE_DRAIN_TURNS = 5;
const CHILD_CLOSE_DRAIN_INTERVAL_MS = 10;

type FixtureSignal = '-TERM' | '-KILL';
type ProcessListenerEvent = (typeof PROCESS_LISTENER_EVENTS)[number];
type ProcessListener = (...args: unknown[]) => void;

function isProcessListener(listener: unknown): listener is ProcessListener {
  return typeof listener === 'function';
}

function processListeners(event: ProcessListenerEvent): ProcessListener[] {
  return process.rawListeners(event).filter(isProcessListener);
}

export function captureSeatbeltHarnessProcessState(): () => void {
  const initialListeners = new Map(
    PROCESS_LISTENER_EVENTS.map((event) => [
      event,
      new Set(processListeners(event)),
    ]),
  );
  const originalProcessKill = Object.getOwnPropertyDescriptor(process, 'kill');
  const originalProcessExit = Object.getOwnPropertyDescriptor(process, 'exit');
  if (originalProcessKill === undefined || originalProcessExit === undefined) {
    throw new Error('Expected process kill and exit descriptors');
  }
  const originalPath = process.env.PATH;

  return (): void => {
    for (const event of PROCESS_LISTENER_EVENTS) {
      const original = initialListeners.get(event) ?? new Set();
      for (const listener of processListeners(event)) {
        if (!original.has(listener)) process.off(event, listener);
      }
    }
    Object.defineProperty(process, 'kill', originalProcessKill);
    Object.defineProperty(process, 'exit', originalProcessExit);
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  };
}

function runKill(arguments_: string[]): number {
  const result = spawnSync('kill', arguments_);
  if (result.error) throw result.error;
  if (result.status === null) {
    throw new Error(`kill ${arguments_.join(' ')} did not return a status`);
  }
  return result.status;
}

export function signalFixtureProcess(pid: number, signal: FixtureSignal): void {
  runKill([signal, String(pid)]);
}

export async function waitForFixtureProcessExit(pid: number): Promise<void> {
  if (await waitUntilStopped(pid)) return;
  signalFixtureProcess(pid, '-KILL');
  if (await waitUntilStopped(pid)) return;
  throw new Error(`Proxy fixture process ${pid} did not exit`);
}

export function restoreSeatbeltHarnessFixture(
  fixtureDir: string,
  restoreState: () => void,
): void {
  try {
    restoreState();
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
}

/**
 * `waitForFixtureProcessExit` observes the OS-level exit, but Node delivers the
 * matching `close` event only once the child's stdio pipes reach EOF, which
 * happens on a later loop turn. The seatbelt proxy close handler calls
 * `process.exit(1)`, so the harness stub must stay installed until those
 * pending events have been delivered — restoring first lets a late `close`
 * terminate the whole test run.
 */
async function drainPendingChildCloseEvents(): Promise<void> {
  for (let turn = 0; turn < CHILD_CLOSE_DRAIN_TURNS; turn++) {
    await new Promise((resolve) =>
      setTimeout(resolve, CHILD_CLOSE_DRAIN_INTERVAL_MS),
    );
  }
}

export async function cleanupSeatbeltHarnessFixture(
  fixtureDir: string,
  restoreState: () => void,
  proxyPid: number | undefined,
): Promise<void> {
  try {
    if (proxyPid !== undefined) {
      signalFixtureProcess(proxyPid, '-TERM');
      await waitForFixtureProcessExit(proxyPid);
    }
    await assertSeatbeltProxyPortAvailable();
  } finally {
    await drainPendingChildCloseEvents();
    restoreSeatbeltHarnessFixture(fixtureDir, restoreState);
  }
}

async function waitUntilStopped(pid: number): Promise<boolean> {
  const deadline = Date.now() + 2000;
  let status = runKill(['-0', String(pid)]);
  while (status === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    status = runKill(['-0', String(pid)]);
  }
  return status !== 0;
}

export async function assertSeatbeltProxyPortAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(8877, '127.0.0.1', () => {
      server.close((error) => {
        server.removeListener('error', onError);
        if (error) reject(error);
        else resolve();
      });
    });
  });
}
