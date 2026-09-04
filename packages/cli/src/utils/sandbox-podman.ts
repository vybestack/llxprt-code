/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type {
  SshAgentResult,
  CredentialProxyBridgeResult,
  PortForwardingResult,
} from './sandbox-ssh.js';
import {
  getPodmanMachineConnection,
  createTunnelProcessCleanup,
  SSH_TUNNEL_POLL_TIMEOUT_MS,
} from './sandbox-ssh.js';

export { getPodmanMachineConnection };

interface PodmanTunnelOptions {
  reserveTunnelPort?: (port: number) => void;
  excludedTunnelPorts?: ReadonlySet<number>;
}

interface PodmanReverseTunnelResult {
  tunnelPort: number;
  tunnelProcess: ChildProcess;
}

const CONTAINER_CREDENTIAL_PROXY_SOCK = '/tmp/llxprt-credential.sock';
const SSH_TUNNEL_POLL_INTERVAL_MS = 200;
const TUNNEL_PORT_MIN = 49152;
const TUNNEL_PORT_SPAN = 16383;
const DARWIN_UNIX_SOCKET_PATH_MAX_BYTES = 103;
const SSH_STARTUP_OUTPUT_MAX_BYTES = 4096;
const SSH_TERMINATE_TIMEOUT_MS = 1000;

interface TunnelStartupMonitor {
  readonly process: ChildProcess;
  readonly failure: Promise<never>;
  readonly isRunning: () => boolean;
  readonly markReady: () => void;
  readonly terminateAndReap: () => Promise<void>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function sampleTunnelPort(
  exclude: ReadonlySet<number> = new Set<number>(),
): number {
  let tunnelPort =
    TUNNEL_PORT_MIN + Math.floor(Math.random() * TUNNEL_PORT_SPAN);
  while (exclude.has(tunnelPort)) {
    tunnelPort = TUNNEL_PORT_MIN + Math.floor(Math.random() * TUNNEL_PORT_SPAN);
  }
  return tunnelPort;
}

/** Builds common SSH args for Podman macOS tunnels (reverse or local). */
function buildPodmanSshBaseArgs(
  conn: ReturnType<typeof getPodmanMachineConnection>,
): string[] {
  return [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'LogLevel=ERROR',
    '-o',
    'ExitOnForwardFailure=yes',
    '-i',
    conn.identityPath,
    '-p',
    String(conn.port),
  ];
}

function appendBoundedOutput(current: Buffer, chunk: Buffer | string): Buffer {
  const remaining = SSH_STARTUP_OUTPUT_MAX_BYTES - current.byteLength;
  if (remaining <= 0) return current;
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  return Buffer.concat([current, bytes.subarray(0, remaining)]);
}

function boundedUtf8Text(output: Buffer): string {
  const chars: string[] = [];
  let encodedBytes = 0;
  for (const char of output.toString('utf8').trim()) {
    const charBytes = Buffer.byteLength(char);
    if (encodedBytes + charBytes > SSH_STARTUP_OUTPUT_MAX_BYTES) break;
    chars.push(char);
    encodedBytes += charBytes;
  }
  return chars.join('');
}

function startupFailureDetail(stderr: Buffer, stdout: Buffer): string {
  const diagnostic = boundedUtf8Text(stderr) || boundedUtf8Text(stdout);
  return diagnostic === '' ? '' : ` SSH diagnostic: ${diagnostic}`;
}

function waitForClose(
  closePromise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    void closePromise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function terminateAndReapTunnel(
  tunnelProcess: ChildProcess,
  isClosed: () => boolean,
  closePromise: Promise<void>,
): Promise<void> {
  const errors: unknown[] = [];
  if (
    !isClosed() &&
    tunnelProcess.exitCode === null &&
    tunnelProcess.signalCode === null
  ) {
    try {
      tunnelProcess.kill('SIGTERM');
    } catch (error) {
      errors.push(error);
    }
  }
  if (
    !isClosed() &&
    !(await waitForClose(closePromise, SSH_TERMINATE_TIMEOUT_MS))
  ) {
    try {
      tunnelProcess.kill('SIGKILL');
    } catch (error) {
      errors.push(error);
    }
    if (!(await waitForClose(closePromise, SSH_TERMINATE_TIMEOUT_MS))) {
      errors.push(
        new Error('OpenSSH tunnel process did not close after SIGKILL'),
      );
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'OpenSSH tunnel cleanup failed');
  }
}

function monitorTunnelProcess(
  tunnelProcess: ChildProcess,
  failureMessage: string,
): TunnelStartupMonitor {
  let stdout: Buffer = Buffer.alloc(0);
  let stderr: Buffer = Buffer.alloc(0);
  let ready = false;
  let closed = false;
  let exitDescription = '';
  let rejectFailure: ((error: Error) => void) | undefined;
  let resolveClose: (() => void) | undefined;

  const closePromise = new Promise<void>((resolve) => {
    resolveClose = resolve;
  });
  const failure = new Promise<never>((_resolve, reject) => {
    rejectFailure = reject;
  });
  const onStdout = (chunk: Buffer | string): void => {
    stdout = appendBoundedOutput(stdout, chunk);
  };
  const onStderr = (chunk: Buffer | string): void => {
    stderr = appendBoundedOutput(stderr, chunk);
  };
  const buildFailure = (): FatalSandboxError =>
    new FatalSandboxError(
      failureMessage + exitDescription + startupFailureDetail(stderr, stdout),
    );

  tunnelProcess.stdout?.on('data', onStdout);
  tunnelProcess.stderr?.on('data', onStderr);
  tunnelProcess.once('error', (error) => {
    if (!ready) {
      exitDescription = ` OpenSSH process error: ${error.message}.`;
      rejectFailure?.(buildFailure());
    }
  });
  tunnelProcess.once('exit', (code, signal) => {
    if (!ready) {
      exitDescription =
        code === null
          ? ` OpenSSH exited from signal ${signal ?? 'unknown'}.`
          : ` OpenSSH exited with code ${String(code)}.`;
    }
  });
  tunnelProcess.once('close', () => {
    closed = true;
    tunnelProcess.stdout?.removeListener('data', onStdout);
    tunnelProcess.stderr?.removeListener('data', onStderr);
    resolveClose?.();
    if (!ready && exitDescription !== '') {
      rejectFailure?.(buildFailure());
    }
  });

  return {
    process: tunnelProcess,
    failure,
    isRunning: () =>
      !closed &&
      tunnelProcess.exitCode === null &&
      tunnelProcess.signalCode === null,
    markReady: () => {
      ready = true;
    },
    terminateAndReap: () =>
      terminateAndReapTunnel(tunnelProcess, () => closed, closePromise),
  };
}

async function terminateAfterFailure(
  monitor: TunnelStartupMonitor,
  failure: unknown,
): Promise<never> {
  try {
    await monitor.terminateAndReap();
  } catch (cleanupError) {
    throw new AggregateError(
      [failure, cleanupError],
      'OpenSSH tunnel startup and cleanup failed',
    );
  }
  throw failure;
}

async function waitForTunnelReadiness(
  monitor: TunnelStartupMonitor,
  readiness: (signal: AbortSignal) => Promise<void>,
): Promise<ChildProcess> {
  const abortController = new AbortController();
  try {
    await Promise.race([readiness(abortController.signal), monitor.failure]);
    if (!monitor.isRunning()) {
      await monitor.failure;
    }
    monitor.markReady();
    return monitor.process;
  } catch (error) {
    abortController.abort();
    return await terminateAfterFailure(monitor, error);
  } finally {
    abortController.abort();
  }
}

/** Spawns an SSH process and waits up to 500ms for it to stabilize. */
async function spawnAndWaitForTunnel(
  sshArgs: string[],
  failureMessage: string,
): Promise<TunnelStartupMonitor> {
  const tunnelProcess = spawn('ssh', sshArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const monitor = monitorTunnelProcess(tunnelProcess, failureMessage);
  try {
    await Promise.race([delay(500), monitor.failure]);
    if (!monitor.isRunning()) {
      await monitor.failure;
    }
  } catch (error) {
    return terminateAfterFailure(monitor, error);
  }
  return monitor;
}

/** Polls Podman VM for a TCP port to become listen-ready. */
async function pollPodmanVmPortReady(
  tunnelPort: number,
  pollTimeoutMs: number,
  timeoutMessage: string,
  signal: AbortSignal,
): Promise<void> {
  const pollStart = Date.now();
  while (!signal.aborted && Date.now() - pollStart < pollTimeoutMs) {
    try {
      const result = execSync(
        `podman machine ssh -- ss -tln | grep -q ':${tunnelPort} ' && echo ok`,
        { timeout: 2000 },
      )
        .toString()
        .trim();
      if (result === 'ok') {
        return;
      }
    } catch {
      // Port not ready yet
    }
    await delay(SSH_TUNNEL_POLL_INTERVAL_MS);
  }
  if (!signal.aborted) throw new FatalSandboxError(timeoutMessage);
}

function reservePodmanTunnelPort(options: PodmanTunnelOptions): number {
  const tunnelPort = sampleTunnelPort(options.excludedTunnelPorts);
  options.reserveTunnelPort?.(tunnelPort);
  return tunnelPort;
}

function buildPodmanReverseTunnelArgs(
  conn: ReturnType<typeof getPodmanMachineConnection>,
  tunnelPort: number,
  hostSocketPath: string,
): string[] {
  return [
    ...buildPodmanSshBaseArgs(conn),
    '-R',
    `127.0.0.1:${tunnelPort}:${hostSocketPath}`,
    '-N',
    `${conn.user}@${conn.host}`,
  ];
}

async function startPodmanReverseTunnel(
  hostSocketPath: string,
  startupFailureMessage: string,
  timeoutMessage: string,
  pollTimeoutMs: number,
  options: PodmanTunnelOptions,
): Promise<PodmanReverseTunnelResult> {
  const socketPathBytes = Buffer.byteLength(hostSocketPath);
  if (socketPathBytes > DARWIN_UNIX_SOCKET_PATH_MAX_BYTES) {
    throw new FatalSandboxError(
      `Podman macOS reverse tunnel socket path '${hostSocketPath}' is ${socketPathBytes} bytes, exceeding Darwin's ${DARWIN_UNIX_SOCKET_PATH_MAX_BYTES}-byte pathname limit.`,
    );
  }
  const conn = getPodmanMachineConnection();
  const tunnelPort = reservePodmanTunnelPort(options);
  const sshArgs = buildPodmanReverseTunnelArgs(
    conn,
    tunnelPort,
    hostSocketPath,
  );
  const monitor = await spawnAndWaitForTunnel(sshArgs, startupFailureMessage);
  const tunnelProcess = await waitForTunnelReadiness(monitor, (signal) =>
    pollPodmanVmPortReady(tunnelPort, pollTimeoutMs, timeoutMessage, signal),
  );
  return { tunnelPort, tunnelProcess };
}

function hasPodmanSshAgentNetworkConflict(args: string[]): boolean {
  const existingNetIdx = args.indexOf('--network');
  if (existingNetIdx === -1 || args[existingNetIdx + 1] === 'host') {
    return false;
  }

  const existingNet = args[existingNetIdx + 1];
  debugLogger.warn(
    `Podman macOS SSH agent forwarding requires --network=host but ` +
      `--network=${existingNet} is already set. Skipping SSH agent setup.`,
  );
  return true;
}

function addPodmanHostNetwork(args: string[]): void {
  if (!args.includes('--network')) {
    args.push('--network', 'host');
  }
}

function buildPodmanSshAgentBridgeResult(
  args: string[],
  tunnelProcess: ChildProcess,
  tunnelPort: number,
): SshAgentResult {
  const socatSocketPath = '/tmp/ssh-agent';
  args.push('--env', `SSH_AUTH_SOCK=${socatSocketPath}`);
  const entrypointPrefix =
    `command -v socat >/dev/null 2>&1 || { echo "ERROR: socat not found — SSH agent relay requires socat in the sandbox image" >&2; }; ` +
    `socat UNIX-LISTEN:${socatSocketPath},fork TCP4:127.0.0.1:${tunnelPort} &`;

  const cleanup = createTunnelProcessCleanup(tunnelProcess);
  return { tunnelProcess, cleanup, entrypointPrefix };
}

function ensurePodmanHostNetworkForCredentialProxy(
  args: string[],
  tunnelProcess: ChildProcess,
): void {
  const existingNetIdx = args.indexOf('--network');
  if (existingNetIdx === -1) {
    args.push('--network', 'host');
    return;
  }

  const existingNet = args[existingNetIdx + 1];
  if (existingNet !== 'host') {
    tunnelProcess.kill('SIGTERM');
    throw new FatalSandboxError(
      `Podman macOS credential proxy bridge requires --network=host but --network=${existingNet} is already set.`,
    );
  }
}

function buildPodmanCredentialProxyBridgeResult(
  tunnelProcess: ChildProcess,
  tunnelPort: number,
): CredentialProxyBridgeResult {
  const entrypointPrefix =
    `command -v socat >/dev/null 2>&1 || { echo "ERROR: socat not found — credential proxy relay requires socat in the sandbox image" >&2; }; ` +
    `rm -f ${CONTAINER_CREDENTIAL_PROXY_SOCK}; ` +
    `socat UNIX-LISTEN:${CONTAINER_CREDENTIAL_PROXY_SOCK},fork TCP4:127.0.0.1:${tunnelPort} &`;

  const cleanup = createTunnelProcessCleanup(tunnelProcess);
  return {
    tunnelProcess,
    cleanup,
    entrypointPrefix,
    containerSocketPath: CONTAINER_CREDENTIAL_PROXY_SOCK,
  };
}

function buildPodmanLocalTunnelArgs(
  conn: ReturnType<typeof getPodmanMachineConnection>,
  portsToForward: string[],
): string[] {
  const sshArgs = [...buildPodmanSshBaseArgs(conn)];
  for (const port of portsToForward) {
    sshArgs.push('-L', `127.0.0.1:${port}:127.0.0.1:${port}`);
  }
  sshArgs.push('-N', `${conn.user}@${conn.host}`);
  return sshArgs;
}

/**
 * Sets up SSH agent forwarding for Podman on macOS via an SSH reverse tunnel
 * into the Podman VM. This is necessary because virtiofs (the macOS hypervisor
 * filesystem) cannot share Unix sockets across the hypervisor boundary
 * (Podman issue #23245/#23785).
 *
 * Strategy: SSH reverse-forward the host agent to a TCP port on the VM's
 * loopback, then run the container with --network=host so it can reach
 * that port.  A socat relay inside the entrypoint converts TCP back to the
 * Unix socket expected by SSH_AUTH_SOCK.
 */
export async function setupSshAgentPodmanMacOS(
  args: string[],
  sshAuthSock: string,
  pollTimeoutMs: number = SSH_TUNNEL_POLL_TIMEOUT_MS,
  options: PodmanTunnelOptions = {},
): Promise<SshAgentResult> {
  if (hasPodmanSshAgentNetworkConflict(args)) {
    return {};
  }

  const { tunnelPort, tunnelProcess } = await startPodmanReverseTunnel(
    sshAuthSock,
    'SSH tunnel process failed to start for Podman macOS SSH agent forwarding. Ensure Podman machine is running: `podman machine start`. Check SSH connectivity: `podman machine ssh`.',
    'SSH agent forwarding timed out waiting for TCP tunnel in Podman VM. Ensure your SSH agent is running and SSH_AUTH_SOCK is valid. Check Podman machine: `podman machine ssh`.',
    pollTimeoutMs,
    options,
  );

  addPodmanHostNetwork(args);
  return buildPodmanSshAgentBridgeResult(args, tunnelProcess, tunnelPort);
}

/**
 * Sets up credential proxy forwarding for Podman on macOS via an SSH reverse
 * tunnel into the Podman VM. This mirrors the SSH-agent Podman workaround,
 * but relays credential proxy socket traffic used by /key and /auth flows.
 */

export async function setupCredentialProxyPodmanMacOS(
  args: string[],
  hostCredentialSocketPath: string,
  pollTimeoutMs: number = SSH_TUNNEL_POLL_TIMEOUT_MS,
  options: PodmanTunnelOptions = {},
): Promise<CredentialProxyBridgeResult> {
  const { tunnelPort, tunnelProcess } = await startPodmanReverseTunnel(
    hostCredentialSocketPath,
    'Credential proxy bridge tunnel failed to start for Podman macOS. Ensure Podman machine is running: `podman machine start`. Check SSH connectivity: `podman machine ssh`.',
    'Credential proxy bridge timed out waiting for TCP tunnel in Podman VM. Ensure the credential proxy socket is valid and Podman machine is reachable.',
    pollTimeoutMs,
    options,
  );

  ensurePodmanHostNetworkForCredentialProxy(args, tunnelProcess);
  return buildPodmanCredentialProxyBridgeResult(tunnelProcess, tunnelPort);
}

/**
 * Sets up port forwarding SSH local tunnels (-L) from macOS host to the Podman VM.
 * This enables the host to reach ports inside the container when --network=host is active,
 * since --publish flags don't work with the Podman VM network model on macOS.
 *
 * Follows the same architectural pattern as setupSshAgentPodmanMacOS and
 * setupCredentialProxyPodmanMacOS for consistency.
 */
export async function setupPortForwardingPodmanMacOS(
  portsToForward: string[],
  pollTimeoutMs: number = SSH_TUNNEL_POLL_TIMEOUT_MS,
): Promise<PortForwardingResult> {
  const conn = getPodmanMachineConnection();
  const sshArgs = buildPodmanLocalTunnelArgs(conn, portsToForward);
  const monitor = await spawnAndWaitForTunnel(
    sshArgs,
    'Port forwarding SSH tunnel failed to start for Podman macOS. Ensure Podman machine is running: `podman machine start`. Check SSH connectivity: `podman machine ssh`.',
  );
  const tunnelProcess = await waitForTunnelReadiness(monitor, (signal) =>
    pollLocalPortsReady(portsToForward, pollTimeoutMs, signal),
  );

  const cleanup = createTunnelProcessCleanup(tunnelProcess);
  return { tunnelProcess, cleanup };
}

/** Polls local TCP ports for readiness using net.createConnection. */
async function pollLocalPortsReady(
  portsToForward: string[],
  pollTimeoutMs: number,
  signal: AbortSignal,
): Promise<void> {
  const pollPromises = portsToForward.map(
    (port) =>
      new Promise<void>((resolve, reject) => {
        const pollStart = Date.now();
        let settled = false;
        let currentSocket: net.Socket | undefined;
        let retryTimer: NodeJS.Timeout | undefined;

        const settle = (result?: Error): void => {
          if (settled) return;
          settled = true;
          currentSocket?.destroy();
          if (retryTimer !== undefined) clearTimeout(retryTimer);
          signal.removeEventListener('abort', abort);
          if (result === undefined) resolve();
          else reject(result);
        };
        const abort = (): void => settle();
        signal.addEventListener('abort', abort, { once: true });

        const tryConnect = (): void => {
          if (signal.aborted) {
            settle();
            return;
          }
          if (Date.now() - pollStart > pollTimeoutMs) {
            settle(
              new FatalSandboxError(
                `Port forwarding timed out waiting for port ${port} to be ready.`,
              ),
            );
            return;
          }

          currentSocket = net.createConnection({
            host: '127.0.0.1',
            port: parseInt(port, 10),
          });
          const socket = currentSocket;
          socket.on('connect', () => settle());
          socket.on('error', () => {
            if (!settled) {
              retryTimer = setTimeout(tryConnect, SSH_TUNNEL_POLL_INTERVAL_MS);
            }
          });
        };

        tryConnect();
      }),
  );

  await Promise.all(pollPromises);
}
