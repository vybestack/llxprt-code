/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { allocateEphemeralPort } from '../../test-utils/ephemeral-port.js';
import { runSeatbeltSandbox } from './sandbox-seatbelt.js';

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
  proxyPort: number,
): Promise<void> {
  try {
    if (proxyPid !== undefined) {
      signalFixtureProcess(proxyPid, '-TERM');
      await waitForFixtureProcessExit(proxyPid);
    }
    await assertSeatbeltProxyPortAvailable(proxyPort);
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

/**
 * Asserts the harness really released the port its proxy fixture owned.
 * Each harness allocates that port for itself (#3501); a shared fixed port
 * made this bind fail with EADDRINUSE whenever a concurrent test process
 * happened to hold it, failing tests whose own assertions had passed.
 */
export async function assertSeatbeltProxyPortAvailable(
  port: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        server.removeListener('error', onError);
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

export interface SeatbeltHarness {
  readonly cwd: string;
  readonly argsFile: string;
  readonly envFile: string;
  readonly sandboxMarker: string;
  readonly proxyMarker: string;
  readonly proxyCommand: string;
  /** Loopback port this harness owns; its proxy fixture binds exactly it. */
  readonly proxyPort: number;
  /** Proxy endpoint the harness configures the production resolver with. */
  readonly proxyUrl: string;
  /** Every argv the readiness probe passed to the stubbed `curl`. */
  readonly readinessProbeArgsFile: string;
  readonly cleanup: () => Promise<void>;
}

/** Paths the fixture's stubs write to and the assertions read back. */
interface SeatbeltFixtureFiles {
  readonly argsFile: string;
  readonly envFile: string;
  readonly sandboxMarker: string;
  readonly sandboxExitMarker: string;
  readonly proxyMarker: string;
  readonly proxyPidFile: string;
  readonly proxyServer: string;
  readonly readinessProbeArgsFile: string;
}

function seatbeltFixtureFiles(fixtureDir: string): SeatbeltFixtureFiles {
  return {
    argsFile: path.join(fixtureDir, 'args'),
    envFile: path.join(fixtureDir, 'env'),
    sandboxMarker: path.join(fixtureDir, 'sandbox-spawned'),
    sandboxExitMarker: path.join(fixtureDir, 'sandbox-exit'),
    proxyMarker: path.join(fixtureDir, 'proxy-listening'),
    proxyPidFile: path.join(fixtureDir, 'proxy-pid'),
    proxyServer: path.join(fixtureDir, 'proxy.cjs'),
    readinessProbeArgsFile: path.join(fixtureDir, 'readiness-probe'),
  };
}

function writeExecutable(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, { mode: 0o755 });
}

/**
 * A real HTTP proxy the launch starts through
 * LLXPRT_SANDBOX_PROXY_COMMAND. It binds the port the harness owns, which is
 * the port the configured proxy endpoint names, and exits once the sandbox
 * stub has run.
 */
function writeProxyServerFixture(
  files: SeatbeltFixtureFiles,
  proxyPort: number,
): void {
  fs.writeFileSync(
    files.proxyServer,
    [
      "const fs = require('node:fs');",
      "const http = require('node:http');",
      `const server = http.createServer((_request, response) => response.end('ok'));`,
      `server.listen(${proxyPort}, '127.0.0.1', () => {`,
      `  fs.writeFileSync(${JSON.stringify(files.proxyPidFile)}, String(process.pid));`,
      `  fs.writeFileSync(${JSON.stringify(files.proxyMarker)}, 'listening');`,
      `  const interval = setInterval(() => {`,
      `    if (fs.existsSync(${JSON.stringify(files.sandboxMarker)})) {`,
      `      clearInterval(interval);`,
      `      fs.writeFileSync(${JSON.stringify(files.sandboxExitMarker)}, 'exit');`,
      `      server.close(() => process.exit(0));`,
      `    }`,
      `  }, 10);`,
      '});',
      "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
    ].join('\n'),
  );
}

/**
 * PATH stubs the launch resolves instead of the real binaries: the sandbox
 * itself, the `timeout` macOS does not ship, and a `curl` that records every
 * readiness argv it was given before reporting the proxy up.
 */
function writeSeatbeltPathStubs(
  fixtureDir: string,
  files: SeatbeltFixtureFiles,
): void {
  writeExecutable(
    path.join(fixtureDir, 'sandbox-exec'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${files.argsFile}"\nenv > "${files.envFile}"\ntouch "${files.sandboxMarker}"\nif [ -n "${'$'}{LLXPRT_SANDBOX_PROXY_COMMAND-}" ]; then attempts=0; while [ ! -f "${files.sandboxExitMarker}" ]; do attempts=$((attempts + 1)); [ "$attempts" -ge 1000 ] && exit 124; sleep 0.01; done; fi\n`,
  );
  writeExecutable(
    path.join(fixtureDir, 'timeout'),
    ['#!/bin/sh', 'shift', 'exec "$@"'].join('\n'),
  );
  writeExecutable(
    path.join(fixtureDir, 'curl'),
    `#!/bin/sh\nprintf '%s\\n' "$@" >> "${files.readinessProbeArgsFile}"\ncase "${'$'}{LLXPRT_SANDBOX_PROXY_COMMAND-}" in *proxy.cjs*) attempts=0; while [ ! -f "${files.proxyMarker}" ]; do attempts=$((attempts + 1)); [ "$attempts" -ge 1000 ] && exit 124; sleep 0.01; done;; esac\nexit 0\n`,
  );
}

/**
 * The launch signals process groups and can exit the runner outright; both
 * are neutralized for the duration of the fixture and restored by the
 * captured process state.
 */
function stubProcessTermination(): void {
  Object.defineProperty(process, 'kill', {
    configurable: true,
    value: () => {
      const error = new Error('kill ESRCH');
      Object.assign(error, { code: 'ESRCH' });
      throw error;
    },
    writable: true,
  });
  Object.defineProperty(process, 'exit', {
    configurable: true,
    value: () => undefined,
    writable: true,
  });
}

/**
 * Installs the seatbelt launch fixture and returns the handles a test needs
 * to observe it. The harness owns a loopback port of its own (#3501): its
 * proxy fixture binds exactly that port and the caller configures production
 * with the matching endpoint, so two test processes never contend for one.
 */
export async function createSeatbeltHarness(
  cwd: string = process.cwd(),
): Promise<SeatbeltHarness> {
  // Allocated before anything is installed: a harness that cannot own a port
  // has nothing to restore.
  const proxyPort = await allocateEphemeralPort();
  const restoreHarnessState = captureSeatbeltHarnessProcessState();
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seatbelt-1456-'));

  try {
    const files = seatbeltFixtureFiles(fixtureDir);
    writeProxyServerFixture(files, proxyPort);
    writeSeatbeltPathStubs(fixtureDir, files);
    process.env.PATH = `${fixtureDir}:${process.env.PATH ?? ''}`;
    stubProcessTermination();

    return {
      cwd,
      argsFile: files.argsFile,
      envFile: files.envFile,
      sandboxMarker: files.sandboxMarker,
      proxyMarker: files.proxyMarker,
      proxyCommand: `${JSON.stringify(process.execPath)} ${JSON.stringify(files.proxyServer)}`,
      proxyPort,
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      readinessProbeArgsFile: files.readinessProbeArgsFile,
      cleanup: async (): Promise<void> => {
        const proxyPid = fs.existsSync(files.proxyPidFile)
          ? Number(fs.readFileSync(files.proxyPidFile, 'utf8').trim())
          : undefined;
        await cleanupSeatbeltHarnessFixture(
          fixtureDir,
          restoreHarnessState,
          proxyPid,
          proxyPort,
        );
      },
    };
  } catch (error) {
    restoreSeatbeltHarnessFixture(fixtureDir, restoreHarnessState);
    throw error;
  }
}

/**
 * Deadline for a case that drives this harness.
 *
 * Every such case orchestrates real processes: a shell-spawned `sandbox-exec`
 * stub, and for proxied modes a Node HTTP proxy plus the `timeout`/`bash`/
 * `curl` readiness probe, each of which must then be proven gone at the OS
 * level. That costs roughly 0.3-0.9s on an idle machine but 4.2-5.0s with four
 * suites running at once (#3501), so the slowest case reached Bun's 5s default
 * deadline before any assertion could fail. Once a case overruns, its orphaned
 * continuation resolves `sandbox-exec` through the *next* case's PATH fixture
 * and reads a directory that teardown already removed, which is how a single
 * overrun turned into an `ENOENT` in an unrelated case. The deadline is
 * therefore stated for the work these cases really do rather than inherited.
 */
export const SEATBELT_HARNESS_TIMEOUT_MS = 30_000;

/**
 * Process environment the harness owns for the duration of a case. `PATH`
 * carries the fixture's stub directory, and the proxy endpoint variables are
 * the production-facing configuration path for the proxy port, so the harness
 * sets them itself instead of inheriting whatever the developer's shell
 * exports (#3501).
 */
export const SEATBELT_HARNESS_ENV_KEYS = [
  'SEATBELT_PROFILE',
  'LLXPRT_SANDBOX_NETWORK',
  'SANDBOX_NETWORK',
  'LLXPRT_SANDBOX_PROXY_COMMAND',
  'LLXPRT_CAPABILITY_TOKEN',
  'LLXPRT_CAPABILITY_FD',
  'LLXPRT_CREDENTIAL_SOCKET',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'PATH',
] as const;

export type SeatbeltHarnessEnvironment = Partial<
  Record<(typeof SEATBELT_HARNESS_ENV_KEYS)[number], string>
>;

export type SeatbeltHarnessEnvironmentSnapshot = Readonly<
  Record<string, string | undefined>
>;

export function snapshotSeatbeltHarnessEnvironment(): SeatbeltHarnessEnvironmentSnapshot {
  return Object.fromEntries(
    SEATBELT_HARNESS_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
}

export function restoreSeatbeltHarnessEnvironment(
  snapshot: SeatbeltHarnessEnvironmentSnapshot,
): void {
  for (const key of SEATBELT_HARNESS_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function applyHarnessEnvironment(
  environment: SeatbeltHarnessEnvironment,
): void {
  for (const key of SEATBELT_HARNESS_ENV_KEYS) {
    if (key !== 'PATH') delete process.env[key];
  }
  Object.assign(
    process.env,
    Object.fromEntries(
      SEATBELT_HARNESS_ENV_KEYS.flatMap((key) => {
        const value = environment[key];
        return value === undefined ? [] : [[key, value]];
      }),
    ),
  );
}

/** Runs a real seatbelt launch against the harness's fixture. */
export async function executeSeatbeltHarness(
  harness: SeatbeltHarness,
  environment: SeatbeltHarnessEnvironment,
): Promise<number> {
  // The harness configures its own proxy endpoint through the same variables
  // a user would set, so production resolves the port this harness owns.
  applyHarnessEnvironment({ HTTPS_PROXY: harness.proxyUrl, ...environment });
  process.chdir(harness.cwd);
  return runSeatbeltSandbox(
    { command: 'sandbox-exec', image: 'test' },
    [],
    undefined,
    [],
  );
}
