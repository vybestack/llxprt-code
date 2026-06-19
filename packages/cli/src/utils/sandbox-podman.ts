/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { FatalSandboxError, debugLogger } from '@vybestack/llxprt-code-core';
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

/** Spawns an SSH process and waits up to 500ms for it to stabilize. */
async function spawnAndWaitForTunnel(
  sshArgs: string[],
  failureMessage: string,
): Promise<ChildProcess> {
  const tunnelProcess = spawn('ssh', sshArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const started = await new Promise<boolean>((resolve) => {
    const handler = () => resolve(false);
    tunnelProcess.on('error', handler);
    setTimeout(() => {
      tunnelProcess.removeListener('error', handler);
      resolve(tunnelProcess.exitCode === null);
    }, 500);
  });
  if (!started) {
    throw new FatalSandboxError(failureMessage);
  }
  return tunnelProcess;
}

/** Polls Podman VM for a TCP port to become listen-ready. */
async function pollPodmanVmPortReady(
  tunnelPort: number,
  pollTimeoutMs: number,
  timeoutMessage: string,
  tunnelProcess?: ChildProcess,
): Promise<void> {
  const pollStart = Date.now();
  let portReady = false;
  while (Date.now() - pollStart < pollTimeoutMs) {
    try {
      const result = execSync(
        `podman machine ssh -- ss -tln | grep -q ':${tunnelPort} ' && echo ok`,
        { timeout: 2000 },
      )
        .toString()
        .trim();
      if (result === 'ok') {
        portReady = true;
        break;
      }
    } catch {
      // Port not ready yet
    }
    await new Promise((r) => setTimeout(r, SSH_TUNNEL_POLL_INTERVAL_MS));
  }
  if (!portReady) {
    if (tunnelProcess) {
      try {
        tunnelProcess.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    throw new FatalSandboxError(timeoutMessage);
  }
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
  const conn = getPodmanMachineConnection();
  const tunnelPort = reservePodmanTunnelPort(options);
  const sshArgs = buildPodmanReverseTunnelArgs(
    conn,
    tunnelPort,
    hostSocketPath,
  );
  const tunnelProcess = await spawnAndWaitForTunnel(
    sshArgs,
    startupFailureMessage,
  );
  await pollPodmanVmPortReady(
    tunnelPort,
    pollTimeoutMs,
    timeoutMessage,
    tunnelProcess,
  );
  return { tunnelPort, tunnelProcess };
}

function ensurePodmanHostNetworkForSshAgent(
  args: string[],
  tunnelProcess: ChildProcess,
): boolean {
  const existingNetIdx = args.indexOf('--network');
  if (existingNetIdx === -1) {
    args.push('--network', 'host');
    return true;
  }

  const existingNet = args[existingNetIdx + 1];
  debugLogger.warn(
    `Podman macOS SSH agent forwarding requires --network=host but ` +
      `--network=${existingNet} is already set. Skipping SSH agent setup.`,
  );
  tunnelProcess.kill('SIGTERM');
  return false;
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
  const { tunnelPort, tunnelProcess } = await startPodmanReverseTunnel(
    sshAuthSock,
    'SSH tunnel process failed to start for Podman macOS SSH agent forwarding. Ensure Podman machine is running: `podman machine start`. Check SSH connectivity: `podman machine ssh`.',
    'SSH agent forwarding timed out waiting for TCP tunnel in Podman VM. Ensure your SSH agent is running and SSH_AUTH_SOCK is valid. Check Podman machine: `podman machine ssh`.',
    pollTimeoutMs,
    options,
  );

  if (!ensurePodmanHostNetworkForSshAgent(args, tunnelProcess)) {
    return {};
  }

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
  const tunnelProcess = await spawnAndWaitForTunnel(
    sshArgs,
    'Port forwarding SSH tunnel failed to start for Podman macOS. Ensure Podman machine is running: `podman machine start`. Check SSH connectivity: `podman machine ssh`.',
  );

  try {
    await pollLocalPortsReady(portsToForward, pollTimeoutMs);
  } catch (error) {
    try {
      tunnelProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    throw error;
  }

  const cleanup = createTunnelProcessCleanup(tunnelProcess);
  return { tunnelProcess, cleanup };
}

/** Polls local TCP ports for readiness using net.createConnection. */
async function pollLocalPortsReady(
  portsToForward: string[],
  pollTimeoutMs: number,
): Promise<void> {
  const pollPromises = portsToForward.map(
    (port) =>
      new Promise<void>((resolve, reject) => {
        const pollStart = Date.now();
        let timedOut = false;
        let currentSocket: net.Socket | undefined;

        const tryConnect = () => {
          if (Date.now() - pollStart > pollTimeoutMs) {
            timedOut = true;
            currentSocket?.destroy();
            reject(
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
          socket.on('connect', () => {
            socket.destroy();
            if (!timedOut) {
              resolve();
            }
          });
          socket.on('error', () => {
            if (!timedOut) {
              setTimeout(tryConnect, SSH_TUNNEL_POLL_INTERVAL_MS);
            }
          });
        };

        tryConnect();
      }),
  );

  await Promise.all(pollPromises);
}
