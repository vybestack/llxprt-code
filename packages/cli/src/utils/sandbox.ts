/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, max-lines, eslint-comments/disable-enable-pair -- Phase 5: legacy CLI boundary retained while larger decomposition continues. */

import {
  exec,
  execSync,
  execFileSync,
  spawn,
  type ChildProcess,
} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { quote, parse } from 'shell-quote';
import {
  USER_SETTINGS_DIR,
  SETTINGS_DIRECTORY_NAME,
} from '../config/settings.js';
import { promisify } from 'node:util';
import type { Config, SandboxConfig } from '@vybestack/llxprt-code-core';
import { FatalSandboxError, debugLogger } from '@vybestack/llxprt-code-core';
import { ConsolePatcher } from '../ui/utils/ConsolePatcher.js';
import {
  createAndStartProxy,
  stopProxy,
  getProxySocketPath,
} from '../auth/proxy/sandbox-proxy-lifecycle.js';

const execAsync = promisify(exec);

function getContainerPath(hostPath: string): string {
  if (os.platform() !== 'win32') {
    return hostPath;
  }

  const withForwardSlashes = hostPath.replace(/\\/g, '/');
  const match = withForwardSlashes.match(/^([A-Z]):\/(.*)/i);
  if (match) {
    return `/${match[1].toLowerCase()}/${match[2]}`;
  }
  return hostPath;
}

const LOCAL_DEV_SANDBOX_IMAGE_NAME = 'llxprt-code-sandbox';
const SANDBOX_NETWORK_NAME = 'llxprt-code-sandbox';
const SANDBOX_PROXY_NAME = 'llxprt-code-sandbox-proxy';
const BUILTIN_SEATBELT_PROFILES = [
  'permissive-open',
  'permissive-closed',
  'permissive-proxied',
  'restrictive-open',
  'restrictive-closed',
  'restrictive-proxied',
];

const PASSTHROUGH_VARIABLES = [
  'LLXPRT_CODE_IDE_SERVER_PORT',
  'LLXPRT_CODE_IDE_WORKSPACE_PATH',
  'LLXPRT_CODE_WELCOME_CONFIG_PATH',
  'TERM_PROGRAM',
] as const;

/**
 * Creates an idempotent cleanup function that kills a tunnel process.
 * Used by SSH agent and credential proxy tunnel setup functions.
 */
const createTunnelProcessCleanup = (tunnelProcess: ChildProcess) => {
  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    try {
      tunnelProcess.kill('SIGTERM');
    } catch {
      // ignore — process may already be dead
    }
  };
};

/**
 * Creates an idempotent cleanup function that closes a TCP server.
 * Used by Docker macOS setup functions that bridge TCP to Unix sockets.
 */
const createServerCleanup = (server: net.Server) => {
  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    try {
      server.close();
    } catch {
      // ignore
    }
  };
};

export function getPassthroughEnvVars(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const envVar of PASSTHROUGH_VARIABLES) {
    const value = env[envVar];
    if (typeof value === 'string' && value.length > 0) {
      result[envVar] = value;
    }
  }

  return result;
}

export function buildSandboxEnvArgs(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(getPassthroughEnvVars(env)).flatMap(([key, value]) => [
    '--env',
    `${key}=${value}`,
  ]);
}

/**
 * Mounts Git configuration files into the container read-only.
 * Follows the dual-HOME mount pattern: when the container HOME differs from
 * the host HOME, the same file is mounted at both paths so Git inside the
 * container can find its configuration regardless of which HOME it resolves.
 *
 * Security: ~/.git-credentials is intentionally excluded (R3.7).
 */
export function mountGitConfigFiles(
  args: string[],
  hostHomedir: string,
  containerHomePath: string,
): void {
  const gitConfigFiles = [
    '.gitconfig',
    path.join('.config', 'git', 'config'),
    '.gitignore_global',
    path.join('.ssh', 'known_hosts'),
  ];

  for (const relPath of gitConfigFiles) {
    const hostPath = path.join(hostHomedir, relPath);
    if (!fs.existsSync(hostPath)) {
      continue;
    }

    const containerHostPath = getContainerPath(hostPath);
    args.push('--volume', `${hostPath}:${containerHostPath}:ro`);

    // Dual-HOME: also mount at container home path if it differs
    const containerAltPath = getContainerPath(
      path.join(containerHomePath, relPath),
    );
    if (containerAltPath !== containerHostPath) {
      args.push('--volume', `${hostPath}:${containerAltPath}:ro`);
    }
  }
}

// --- SSH Agent Forwarding Helpers ---

export interface SshAgentResult {
  tunnelProcess?: ChildProcess;
  cleanup?: () => void;
  /** Shell command to prepend to the container entrypoint (e.g. socat relay). */
  entrypointPrefix?: string;
}

export interface CredentialProxyBridgeResult {
  tunnelProcess?: ChildProcess;
  cleanup?: () => void;
  /** Shell command to prepend to the container entrypoint (e.g. socat relay). */
  entrypointPrefix?: string;
  containerSocketPath: string;
}

export interface PortForwardingResult {
  tunnelProcess?: ChildProcess;
  cleanup?: () => void;
}

interface PodmanTunnelOptions {
  reserveTunnelPort?: (port: number) => void;
  excludedTunnelPorts?: ReadonlySet<number>;
}

interface PodmanReverseTunnelResult {
  tunnelPort: number;
  tunnelProcess: ChildProcess;
}

const CONTAINER_SSH_AGENT_SOCK = '/ssh-agent';
const CONTAINER_CREDENTIAL_PROXY_SOCK = '/tmp/llxprt-credential.sock';

/**
 * Routes SSH agent forwarding to the appropriate platform-specific helper.
 * Respects LLXPRT_SANDBOX_SSH_AGENT (on/off/auto) and SSH_AUTH_SOCK.
 */
export async function setupSshAgentForwarding(
  config: { command: 'docker' | 'podman' | 'sandbox-exec' },
  args: string[],
  options: {
    reserveTunnelPort?: (port: number) => void;
    excludedTunnelPorts?: ReadonlySet<number>;
  } = {},
): Promise<SshAgentResult> {
  const sshAgentSetting =
    process.env.LLXPRT_SANDBOX_SSH_AGENT ?? process.env.SANDBOX_SSH_AGENT;

  // R4.1: Off disables forwarding entirely
  if (sshAgentSetting === 'off') {
    return {};
  }

  const sshAuthSock = process.env.SSH_AUTH_SOCK;

  // R4.4: "on" means attempt even without SSH_AUTH_SOCK
  const shouldEnable =
    sshAgentSetting === 'on' || (sshAgentSetting !== 'off' && !!sshAuthSock);

  if (!shouldEnable) {
    return {};
  }

  // R4.2: Missing SSH_AUTH_SOCK warns and skips
  if (!sshAuthSock) {
    debugLogger.warn('SSH agent requested but SSH_AUTH_SOCK is not set.');
    return {};
  }

  // R4.3: Verify socket exists on disk before attempting mount
  if (!fs.existsSync(sshAuthSock)) {
    debugLogger.warn(
      `SSH_AUTH_SOCK path not found at ${sshAuthSock}. Skipping SSH agent forwarding.`,
    );
    return {};
  }

  const platform = os.platform();

  if (platform === 'linux') {
    if (config.command === 'docker') {
      return setupSshAgentDockerLinux(args, sshAuthSock);
    }
    setupSshAgentLinux(config, args, sshAuthSock);
    return {};
  }

  if (platform === 'darwin') {
    if (config.command === 'docker') {
      return setupSshAgentDockerMacOS(args, sshAuthSock);
    }

    if (config.command === 'podman') {
      return setupSshAgentPodmanMacOS(
        args,
        sshAuthSock,
        SSH_TUNNEL_POLL_TIMEOUT_MS,
        {
          reserveTunnelPort: options.reserveTunnelPort,
          excludedTunnelPorts: options.excludedTunnelPorts,
        },
      );
    }
  }

  // Unsupported platform/command combo: attempt direct mount as fallback
  args.push('--volume', `${sshAuthSock}:${CONTAINER_SSH_AGENT_SOCK}`);
  args.push('--env', `SSH_AUTH_SOCK=${CONTAINER_SSH_AGENT_SOCK}`);

  return {};
}

/**
 * Sets up SSH agent forwarding on Linux via direct socket mount.
 * Uses :z SELinux label for Podman (R5.2).
 */
export function setupSshAgentLinux(
  config: { command: 'docker' | 'podman' | 'sandbox-exec' },
  args: string[],
  sshAuthSock: string,
): void {
  let mountSpec = `${sshAuthSock}:${CONTAINER_SSH_AGENT_SOCK}`;

  // R5.2: Podman on Linux needs :z for SELinux
  if (config.command === 'podman') {
    mountSpec += ':z';
  }

  args.push('--volume', mountSpec);
  args.push('--env', `SSH_AUTH_SOCK=${CONTAINER_SSH_AGENT_SOCK}`);
}

export async function createTcpToUdsBridge(
  udsPath: string,
): Promise<{ port: number; server: net.Server }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer({ allowHalfOpen: false }, (socket) => {
      const udsClient = net.connect(udsPath);

      socket.pipe(udsClient);
      udsClient.pipe(socket);

      socket.on('error', () => {
        udsClient.destroy();
      });
      socket.on('close', () => {
        udsClient.destroy();
      });

      udsClient.on('error', () => {
        socket.destroy();
      });
      udsClient.on('close', () => {
        socket.destroy();
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      resolve({ port: address.port, server });
    });

    server.on('error', reject);
  });
}

/**
 * Sets up SSH agent forwarding for Docker on macOS via a TCP-to-UDS bridge.
 *
 * Docker Desktop's magic socket (/run/host-services/ssh-auth.sock) is mounted
 * as root:root 0660 inside the VM, which is inaccessible to the non-root
 * container user (uid 1000 'node'). Instead, we use the same TCP bridge
 * approach that works for Podman: a host-side Node.js TCP server proxies
 * connections to the host SSH_AUTH_SOCK, and socat inside the container
 * connects back via host.docker.internal.
 */
export async function setupSshAgentDockerMacOS(
  args: string[],
  sshAuthSock?: string,
): Promise<SshAgentResult> {
  if (!sshAuthSock) {
    debugLogger.warn(
      'No SSH_AUTH_SOCK available. SSH agent forwarding disabled.',
    );
    return {};
  }

  return setupSshAgentDockerBridge(args, sshAuthSock);
}

/**
 * Sets up SSH agent forwarding for Docker on Linux.
 *
 * Tries direct socket bind-mount first (works when container uid matches the
 * socket owner). Falls back to the TCP bridge when the socket permissions
 * would prevent the container user from connecting.
 */
export async function setupSshAgentDockerLinux(
  args: string[],
  sshAuthSock: string,
): Promise<SshAgentResult> {
  const willMatchHostUser = await shouldUseCurrentUserInSandbox();
  const hostUid = process.getuid?.() ?? -1;

  if (willMatchHostUser || hostUid === 1000) {
    // Container uid will match the socket owner — direct mount works
    setupSshAgentLinux({ command: 'docker' }, args, sshAuthSock);
    return {};
  }

  // Container runs as uid 1000 but host uid differs — TCP bridge fallback
  args.push('--add-host=host.docker.internal:host-gateway');
  return setupSshAgentDockerBridge(args, sshAuthSock);
}

/**
 * Shared TCP bridge setup for Docker SSH agent forwarding (macOS and Linux
 * fallback). Creates a host-side TCP server that proxies to SSH_AUTH_SOCK,
 * and injects a socat relay into the container entrypoint.
 */
async function setupSshAgentDockerBridge(
  args: string[],
  sshAuthSock: string,
): Promise<SshAgentResult> {
  const { port, server } = await createTcpToUdsBridge(sshAuthSock);

  const containerSshAgentSock = '/tmp/ssh-agent';
  const entrypointPrefix =
    `command -v socat >/dev/null 2>&1 || { echo "ERROR: socat not found — SSH agent forwarding requires socat in the sandbox image" >&2; }; ` +
    `rm -f ${containerSshAgentSock}; ` +
    `socat UNIX-LISTEN:${containerSshAgentSock},fork TCP4:host.docker.internal:${port} &`;

  args.push('--env', `SSH_AUTH_SOCK=${containerSshAgentSock}`);

  const cleanup = createServerCleanup(server);

  return {
    cleanup,
    entrypointPrefix,
  };
}

/**
 * Parses the default Podman machine connection from `podman system connection list`.
 * Returns SSH connection details needed for the reverse tunnel.
 */
export function getPodmanMachineConnection(): {
  host: string;
  port: number;
  user: string;
  identityPath: string;
} {
  let raw: string;
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
    raw = execSync('podman system connection list --format json', {
      timeout: 10000,
    }).toString();
  } catch (err) {
    throw new FatalSandboxError(
      'Failed to list Podman connections. Ensure Podman machine is running: ' +
        '`podman machine start`. ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  let connections: Array<{
    Name: string;
    URI: string;
    Identity: string;
    Default: boolean;
  }>;
  try {
    connections = JSON.parse(raw);
  } catch {
    throw new FatalSandboxError(
      'Failed to parse Podman connection list JSON. ' +
        'Ensure Podman is installed correctly: `podman machine init && podman machine start`.',
    );
  }

  if (!Array.isArray(connections) || connections.length === 0) {
    throw new FatalSandboxError(
      'No Podman machine connections found. ' +
        'Run `podman machine init && podman machine start` to create one.',
    );
  }

  // Find the default connection, or fall back to the sole connection
  let conn = connections.find((c) => c.Default);
  if (!conn) {
    if (connections.length === 1) {
      conn = connections[0];
    } else {
      throw new FatalSandboxError(
        'Multiple Podman connections found but none marked as default. ' +
          'Run `podman system connection default <name>` to set one.',
      );
    }
  }

  // Parse the URI: ssh://user@host:port/path
  // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
  const uriMatch = conn.URI.match(/^ssh:\/\/([^@]+)@([^:]+):(\d+)(\/.*)?$/);
  if (!uriMatch) {
    throw new FatalSandboxError(
      `Unable to parse Podman connection URI '${conn.URI}'. ` +
        'Run `podman system connection list` to verify your machine setup.',
    );
  }

  return {
    user: uriMatch[1],
    host: uriMatch[2],
    port: parseInt(uriMatch[3], 10),
    identityPath: conn.Identity,
  };
}

const SSH_TUNNEL_POLL_INTERVAL_MS = 200;
const SSH_TUNNEL_POLL_TIMEOUT_MS = 10000;
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
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
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
      // eslint-disable-next-line sonarjs/os-command -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
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

export async function setupCredentialProxyDockerMacOS(
  args: string[],
  hostCredentialSocketPath: string,
): Promise<CredentialProxyBridgeResult> {
  const { port, server } = await createTcpToUdsBridge(hostCredentialSocketPath);

  const entrypointPrefix =
    `command -v socat >/dev/null 2>&1 || { echo "ERROR: socat not found — credential proxy relay requires socat in the sandbox image" >&2; }; ` +
    `rm -f ${CONTAINER_CREDENTIAL_PROXY_SOCK}; ` +
    `socat UNIX-LISTEN:${CONTAINER_CREDENTIAL_PROXY_SOCK},fork TCP4:host.docker.internal:${port} &`;

  const cleanup = createServerCleanup(server);

  return {
    cleanup,
    entrypointPrefix,
    containerSocketPath: CONTAINER_CREDENTIAL_PROXY_SOCK,
  };
}

/**
 * Determines whether the sandbox container should be run with the current user's UID and GID.
 * This is often necessary on Linux systems (especially Debian/Ubuntu based) when using
 * rootful Docker without userns-remap configured, to avoid permission issues with
 * mounted volumes.
 *
 * The behavior is controlled by the `SANDBOX_SET_UID_GID` environment variable:
 * - If `SANDBOX_SET_UID_GID` is "1" or "true", this function returns `true`.
 * - If `SANDBOX_SET_UID_GID` is "0" or "false", this function returns `false`.
 * - If `SANDBOX_SET_UID_GID` is not set:
 *   - On Debian/Ubuntu Linux, it defaults to `true`.
 *   - On other OSes, or if OS detection fails, it defaults to `false`.
 *
 * For more context on running Docker containers as non-root, see:
 * https://medium.com/redbubble/running-a-docker-container-as-a-non-root-user-7d2e00f8ee15
 *
 * @returns {Promise<boolean>} A promise that resolves to true if the current user's UID/GID should be used, false otherwise.
 */
async function shouldUseCurrentUserInSandbox(): Promise<boolean> {
  const envVar = process.env.SANDBOX_SET_UID_GID?.toLowerCase().trim();

  if (envVar === '1' || envVar === 'true') {
    return true;
  }
  if (envVar === '0' || envVar === 'false') {
    return false;
  }

  // If environment variable is not explicitly set, check for Debian/Ubuntu Linux
  if (os.platform() === 'linux') {
    try {
      const osReleaseContent = await readFile('/etc/os-release', 'utf8');
      if (
        osReleaseContent.includes('ID=debian') ||
        osReleaseContent.includes('ID=ubuntu') ||
        // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
        osReleaseContent.match(/^ID_LIKE=.*debian.*/m) || // Covers derivatives
        // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
        osReleaseContent.match(/^ID_LIKE=.*ubuntu.*/m) // Covers derivatives
      ) {
        // note here and below we use debugLogger.error for informational messages on stderr
        debugLogger.error(
          'INFO: Defaulting to use current user UID/GID for Debian/Ubuntu-based Linux.',
        );
        return true;
      }
    } catch {
      // /etc/os-release not found or unreadable - use default (false)
      debugLogger.warn(
        'Warning: Could not read /etc/os-release to auto-detect Debian/Ubuntu for UID/GID default.',
      );
    }
  }
  return false; // Default to false if no other condition is met
}

// docker does not allow container names to contain ':' or '/', so we
// parse those out to shorten the name
function parseImageName(image: string): string {
  const [fullName, tag] = image.split(':');
  const name = fullName.split('/').at(-1) ?? 'unknown-image';
  return tag ? `${name}-${tag}` : name;
}

function ports(): string[] {
  return (process.env.SANDBOX_PORTS ?? '')
    .split(',')
    .filter((p) => p.trim())
    .map((p) => p.trim());
}

export function isSandboxDebugModeEnabled(debugValue?: string): boolean {
  return debugValue === 'true' || debugValue === '1';
}

export function shouldAllocateSandboxTty(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const hasExplicitParentTty =
    process.stdin.isTTY === true || process.stdout.isTTY === true;

  if (hasExplicitParentTty) {
    return true;
  }

  const isCiEnvironment =
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    env.CI === 'true' ||
    env.CI === '1' ||
    env.GITHUB_ACTIONS === 'true' ||
    env.BUILD_ID !== undefined ||
    env.BUILD_NUMBER !== undefined;

  if (isCiEnvironment) {
    return false;
  }

  const term = env.TERM;
  return typeof term === 'string' && term.length > 0 && term !== 'dumb';
}

function entrypoint(
  workdir: string,
  cliArgs: string[],
  skipPortRelays?: Set<string>,
): string[] {
  const isWindows = os.platform() === 'win32';
  const containerWorkdir = getContainerPath(workdir);
  const shellCmds = [];
  const pathSeparator = isWindows ? ';' : ':';

  let pathSuffix = '';
  if (process.env.PATH) {
    const paths = process.env.PATH.split(pathSeparator);
    for (const p of paths) {
      const containerPath = getContainerPath(p);
      if (
        containerPath.toLowerCase().startsWith(containerWorkdir.toLowerCase())
      ) {
        pathSuffix += `:${containerPath}`;
      }
    }
  }
  if (pathSuffix) {
    shellCmds.push(`export PATH="$PATH${pathSuffix}";`);
  }

  let pythonPathSuffix = '';
  if (process.env.PYTHONPATH) {
    const paths = process.env.PYTHONPATH.split(pathSeparator);
    for (const p of paths) {
      const containerPath = getContainerPath(p);
      if (
        containerPath.toLowerCase().startsWith(containerWorkdir.toLowerCase())
      ) {
        pythonPathSuffix += `:${containerPath}`;
      }
    }
  }
  if (pythonPathSuffix) {
    shellCmds.push(`export PYTHONPATH="$PYTHONPATH${pythonPathSuffix}";`);
  }

  const projectSandboxBashrc = path.join(
    SETTINGS_DIRECTORY_NAME,
    'sandbox.bashrc',
  );
  if (fs.existsSync(projectSandboxBashrc)) {
    shellCmds.push(`source ${getContainerPath(projectSandboxBashrc)};`);
  }

  for (const p of ports()) {
    // Skip socat relay for ports handled by SSH tunnels (Podman macOS)
    if (skipPortRelays?.has(p) === true) {
      continue;
    }
    shellCmds.push(
      `socat TCP4-LISTEN:${p},bind=$(hostname -i),fork,reuseaddr TCP4:127.0.0.1:${p} 2> /dev/null &`,
    );
  }

  const quotedCliArgs = cliArgs.slice(2).map((arg) => quote([arg]));
  const isDebugMode = isSandboxDebugModeEnabled(process.env.DEBUG);
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string DEBUG_PORT should fall back to default */
  const cliCmd =
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    process.env.NODE_ENV === 'development'
      ? // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        isDebugMode
        ? 'npm run debug --'
        : 'npm rebuild && npm run start --'
      : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        isDebugMode
        ? `node --inspect-brk=0.0.0.0:${process.env.DEBUG_PORT || '9229'} $(which llxprt)`
        : 'llxprt';
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  const args = [...shellCmds, cliCmd, ...quotedCliArgs];
  return ['bash', '-c', args.join(' ')];
}

function normalizeExitCode(
  code: number | null,
  signal: NodeJS.Signals | null,
): number {
  if (typeof code === 'number') {
    return code;
  }
  if (signal === 'SIGINT') {
    return 130;
  }
  if (signal === 'SIGTERM') {
    return 143;
  }
  return 1;
}

/** Runs the macOS Seatbelt (sandbox-exec) sandbox path. */
async function runSeatbeltSandbox(
  config: SandboxConfig,
  nodeArgs: string[],
  cliConfig?: Config,
  cliArgs: string[] = [],
): Promise<number> {
  // Seatbelt path does NOT use the container credential proxy lifecycle.
  // @plan:PLAN-20250214-CREDPROXY.P34 - no container credential proxy in seatbelt flow
  if (process.env['BUILD_SANDBOX']) {
    throw new FatalSandboxError(
      'Cannot BUILD_SANDBOX when using macOS Seatbelt',
    );
  }

  const profile = (process.env.SEATBELT_PROFILE ??= 'permissive-open');
  let profileFile = fileURLToPath(
    new URL(`./sandbox-macos-${profile}.sb`, import.meta.url),
  );
  if (!BUILTIN_SEATBELT_PROFILES.includes(profile)) {
    profileFile = path.join(
      SETTINGS_DIRECTORY_NAME,
      `sandbox-macos-${profile}.sb`,
    );
  }
  if (!fs.existsSync(profileFile)) {
    throw new FatalSandboxError(
      `Missing macos seatbelt profile file '${profileFile}'`,
    );
  }
  debugLogger.error(`using macos seatbelt (profile: ${profile}) ...`);
  const nodeOptions = [
    ...(isSandboxDebugModeEnabled(process.env.DEBUG) ? ['--inspect-brk'] : []),
    ...nodeArgs,
  ].join(' ');

  const args = buildSeatbeltArgs(profileFile, nodeOptions, cliConfig, cliArgs);
  const { sandboxEnv, proxyProcess, proxyCommand } = await setupSeatbeltProxy();
  const sandboxProcess = spawnSeatbeltProcess(config, args, sandboxEnv);
  wireSeatbeltProxyCloseHandler(proxyProcess, sandboxProcess, proxyCommand);

  // Restore parent stdin mode/state after the sandbox exits.
  const stdinWasPaused = process.stdin.isPaused();
  const stdinHadRawMode =
    process.stdin.isTTY &&
    typeof process.stdin.isRaw === 'boolean' &&
    process.stdin.isRaw;

  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
    try {
      process.stdin.pause();
    } catch {
      // ignore
    }
  }

  return waitForSeatbeltExit(
    sandboxProcess,
    stdinWasPaused,
    stdinHadRawMode,
    cliConfig,
  );
}
function resolveProxyUrl(): string {
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
  ];
  return candidates.find((v): v is string => !!v) ?? 'http://localhost:8877';
}

function buildSeatbeltArgs(
  profileFile: string,
  nodeOptions: string,
  cliConfig?: Config,
  cliArgs: string[] = [],
): string[] {
  const cacheDir = fs.realpathSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
    execSync('getconf DARWIN_USER_CACHE_DIR').toString().trim(),
  );
  const args = [
    '-D',
    `TARGET_DIR=${fs.realpathSync(process.cwd())}`,
    '-D',
    `TMP_DIR=${fs.realpathSync(os.tmpdir())}`,
    '-D',
    `HOME_DIR=${fs.realpathSync(os.homedir())}`,
    '-D',
    `CACHE_DIR=${cacheDir}`,
  ];

  const MAX_INCLUDE_DIRS = 5;
  const targetDir = fs.realpathSync(cliConfig?.getTargetDir() ?? '');
  const includedDirs: string[] = [];
  if (cliConfig) {
    const workspaceContext = cliConfig.getWorkspaceContext();
    for (const dir of workspaceContext.getDirectories()) {
      const realDir = fs.realpathSync(dir);
      if (realDir !== targetDir) {
        includedDirs.push(realDir);
      }
    }
  }
  for (let i = 0; i < MAX_INCLUDE_DIRS; i++) {
    const dirPath = i < includedDirs.length ? includedDirs[i] : '/dev/null';
    args.push('-D', `INCLUDE_DIR_${i}=${dirPath}`);
  }

  args.push(
    '-f',
    profileFile,
    'sh',
    '-c',
    [
      `SANDBOX=sandbox-exec`,
      `NODE_OPTIONS="${nodeOptions}"`,
      ...cliArgs.map((arg) => quote([arg])),
    ].join(' '),
  );
  return args;
}

interface SeatbeltProxySetup {
  sandboxEnv: NodeJS.ProcessEnv;
  proxyProcess?: ChildProcess;
  proxyCommand?: string;
}

async function setupSeatbeltProxy(): Promise<SeatbeltProxySetup> {
  const proxyCommand = process.env.LLXPRT_SANDBOX_PROXY_COMMAND;
  const sandboxEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...getPassthroughEnvVars(process.env),
  };

  if (!proxyCommand) {
    return { sandboxEnv };
  }

  const proxy = resolveProxyUrl();
  sandboxEnv['HTTPS_PROXY'] = proxy;
  sandboxEnv['https_proxy'] = proxy;
  sandboxEnv['HTTP_PROXY'] = proxy;
  sandboxEnv['http_proxy'] = proxy;
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
  if (noProxy) {
    sandboxEnv['NO_PROXY'] = noProxy;
    sandboxEnv['no_proxy'] = noProxy;
  }
  // eslint-disable-next-line sonarjs/os-command -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
  const proxyProcess = spawn(proxyCommand, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: true,
  });
  const stopProxyHandler = () => {
    debugLogger.log('stopping proxy ...');
    const proxyPid = proxyProcess.pid;
    if (proxyPid !== undefined && proxyPid !== 0) {
      process.kill(-proxyPid, 'SIGTERM');
    }
  };
  process.on('exit', stopProxyHandler);
  process.on('SIGINT', stopProxyHandler);
  process.on('SIGTERM', stopProxyHandler);
  proxyProcess.stderr.on('data', (data) => {
    debugLogger.error(data.toString());
  });
  debugLogger.log('waiting for proxy to start ...');
  await execAsync(
    `until timeout 0.25 curl -s http://localhost:8877; do sleep 0.25; done`,
  );
  return { sandboxEnv, proxyProcess, proxyCommand };
}

function wireSeatbeltProxyCloseHandler(
  proxyProcess: ChildProcess | undefined,
  sandboxProcess: ChildProcess,
  proxyCommand: string | undefined,
): void {
  if (!proxyProcess || !proxyCommand) {
    return;
  }
  proxyProcess.on('close', (code, signal) => {
    const sandboxPid = sandboxProcess.pid;
    if (sandboxPid !== undefined && sandboxPid !== 0) {
      process.kill(-sandboxPid, 'SIGTERM');
    }
    throw new FatalSandboxError(
      `Proxy command '${proxyCommand}' exited with code ${code}, signal ${signal}`,
    );
  });
}

function spawnSeatbeltProcess(
  config: SandboxConfig,
  args: string[],
  sandboxEnv: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(config.command, args, {
    stdio: 'inherit',
    env: sandboxEnv,
  });
}

async function waitForSeatbeltExit(
  sandboxProcess: ChildProcess,
  stdinWasPaused: boolean,
  stdinHadRawMode: boolean,
  cliConfig?: Config,
): Promise<number> {
  return new Promise<number>((resolve) => {
    sandboxProcess.on('close', (code, signal) => {
      if (!process.stdin.isTTY) {
        resolve(normalizeExitCode(code, signal));
        return;
      }
      if (!stdinWasPaused) {
        try {
          process.stdin.resume();
        } catch {
          // ignore
        }
      }
      if (stdinHadRawMode) {
        try {
          process.stdin.setRawMode(true);
        } catch (err) {
          if (cliConfig?.getDebugMode() === true) {
            debugLogger.error('[sandbox] Failed to restore raw mode:', err);
          }
        }
      }
      resolve(normalizeExitCode(code, signal));
    });
  });
}

/** Builds docker/podman run args for resource limits, flags, TTY, and volumes. */
function buildContainerRunArgs(
  config: SandboxConfig,
  image: string,
  workdir: string,
  containerWorkdir: string,
  resolvedTmpdir: string,
): string[] {
  const args = ['run', '-i', '--rm', '--init', '--workdir', containerWorkdir];

  if (process.env.SANDBOX_FLAGS) {
    const flags = parse(process.env.SANDBOX_FLAGS, process.env).filter(
      (f): f is string => typeof f === 'string',
    );
    args.push(...flags);
  }

  const resourceCpus =
    process.env.LLXPRT_SANDBOX_CPUS ?? process.env.SANDBOX_CPUS;
  if (resourceCpus) {
    args.push('--cpus', resourceCpus);
  }
  const resourceMemory =
    process.env.LLXPRT_SANDBOX_MEMORY ?? process.env.SANDBOX_MEMORY;
  if (resourceMemory) {
    args.push('--memory', resourceMemory);
  }
  const resourcePids =
    process.env.LLXPRT_SANDBOX_PIDS ?? process.env.SANDBOX_PIDS;
  if (resourcePids) {
    args.push('--pids-limit', resourcePids);
  }

  const networkMode =
    process.env.LLXPRT_SANDBOX_NETWORK ?? process.env.SANDBOX_NETWORK;
  if (networkMode === 'off') {
    args.push('--network', 'none');
  } else if (networkMode === 'proxied') {
    debugLogger.warn(
      'Sandbox network mode "proxied" is not implemented yet; falling back to default networking.',
    );
  }

  if (shouldAllocateSandboxTty()) {
    args.push('-t');
  }
  args.push('--volume', `${workdir}:${containerWorkdir}`);

  const userSettingsDirOnHost = USER_SETTINGS_DIR;
  const userSettingsDirInSandbox = getContainerPath(
    `/home/node/${SETTINGS_DIRECTORY_NAME}`,
  );
  if (!fs.existsSync(userSettingsDirOnHost)) {
    fs.mkdirSync(userSettingsDirOnHost);
  }
  args.push('--volume', `${userSettingsDirOnHost}:${userSettingsDirInSandbox}`);
  if (userSettingsDirInSandbox !== userSettingsDirOnHost) {
    args.push(
      '--volume',
      `${userSettingsDirOnHost}:${getContainerPath(userSettingsDirOnHost)}`,
    );
  }

  mountGitConfigFiles(args, os.homedir(), '/home/node');
  args.push(
    '--volume',
    `${resolvedTmpdir}:${getContainerPath(resolvedTmpdir)}`,
  );
  return args;
}

/** Adds gcloud, ADC, and custom SANDBOX_MOUNTS volume flags. */

function addCustomMounts(
  args: string[],
  mountsEnv: string,
  mountsEnvName: string,
): void {
  for (let mount of mountsEnv.split(',')) {
    if (mount.trim()) {
      let [from, to, opts] = mount.trim().split(':');
      to = to || from;
      opts = opts || 'ro';
      mount = `${from}:${to}:${opts}`;
      if (!path.isAbsolute(from)) {
        throw new FatalSandboxError(
          `Path '${from}' listed in ${mountsEnvName} must be absolute`,
        );
      }
      if (!fs.existsSync(from)) {
        throw new FatalSandboxError(
          `Missing mount path '${from}' listed in ${mountsEnvName}`,
        );
      }
      debugLogger.error(`${mountsEnvName}: ${from} -> ${to} (${opts})`);
      args.push('--volume', mount);
    }
  }
}

function addSandboxEnvVars(args: string[]): void {
  for (const raw of process.env.SANDBOX_ENV!.split(',')) {
    const env = raw.trim();
    if (env) {
      if (env.includes('=')) {
        debugLogger.error(`SANDBOX_ENV: ${env}`);
        args.push('--env', env);
      } else {
        throw new FatalSandboxError(
          'SANDBOX_ENV must be a comma-separated list of key=value pairs',
        );
      }
    }
  }
}

function addContainerVolumeMounts(args: string[]): void {
  const gcloudConfigDir = path.join(os.homedir(), '.config', 'gcloud');
  if (fs.existsSync(gcloudConfigDir)) {
    args.push(
      '--volume',
      `${gcloudConfigDir}:${getContainerPath(gcloudConfigDir)}:ro`,
    );
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const adcFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (fs.existsSync(adcFile)) {
      args.push('--volume', `${adcFile}:${getContainerPath(adcFile)}:ro`);
      args.push(
        '--env',
        `GOOGLE_APPLICATION_CREDENTIALS=${getContainerPath(adcFile)}`,
      );
    }
  }

  const mountsEnv =
    process.env.LLXPRT_SANDBOX_MOUNTS ?? process.env.SANDBOX_MOUNTS;
  const mountsEnvName = process.env.LLXPRT_SANDBOX_MOUNTS
    ? 'LLXPRT_SANDBOX_MOUNTS'
    : 'SANDBOX_MOUNTS';
  if (mountsEnv) {
    addCustomMounts(args, mountsEnv, mountsEnvName);
  }
}

/** Adds environment variable flags for API keys, term, proxy, etc. */
function addContainerEnvVars(
  args: string[],
  config: SandboxConfig,
  containerName: string,
  nodeArgs: string[],
  workdir: string,
): void {
  const envMap: Record<string, string | undefined> = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GOOGLE_GENAI_USE_VERTEXAI: process.env.GOOGLE_GENAI_USE_VERTEXAI,
    GOOGLE_GENAI_USE_GCA: process.env.GOOGLE_GENAI_USE_GCA,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    TERM: process.env.TERM,
    COLORTERM: process.env.COLORTERM,
  };
  for (const [key, val] of Object.entries(envMap)) {
    if (val) {
      args.push('--env', `${key}=${val}`);
    }
  }

  args.push(...buildSandboxEnvArgs(process.env));
  args.push('--env', 'GIT_DISCOVERY_ACROSS_FILESYSTEM=1');

  const virtualEnv = process.env.VIRTUAL_ENV;
  if (
    virtualEnv !== undefined &&
    virtualEnv.length > 0 &&
    virtualEnv.toLowerCase().startsWith(workdir.toLowerCase())
  ) {
    const sandboxVenvPath = path.resolve(
      SETTINGS_DIRECTORY_NAME,
      'sandbox.venv',
    );
    if (!fs.existsSync(sandboxVenvPath)) {
      fs.mkdirSync(sandboxVenvPath, { recursive: true });
    }
    args.push('--volume', `${sandboxVenvPath}:${getContainerPath(virtualEnv)}`);
    args.push('--env', `VIRTUAL_ENV=${getContainerPath(virtualEnv)}`);
  }

  if (process.env.SANDBOX_ENV) {
    addSandboxEnvVars(args);
  }

  const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
  const allNodeOptions = [
    ...(existingNodeOptions ? [existingNodeOptions] : []),
    ...nodeArgs,
  ].join(' ');
  if (allNodeOptions.length > 0) {
    args.push('--env', `NODE_OPTIONS="${allNodeOptions}"`);
  }
  args.push('--env', `SANDBOX=${containerName}`);

  if (config.command === 'podman') {
    const emptyAuthFilePath = path.join(os.tmpdir(), 'empty_auth.json');
    fs.writeFileSync(emptyAuthFilePath, '{}', 'utf-8');
    args.push('--authfile', emptyAuthFilePath);
  }
}

/** Sets up container networking, including proxy env and network creation. */
function setupContainerNetworking(
  args: string[],
  config: SandboxConfig,
  isPodmanMacOS: boolean,
): string | undefined {
  const proxyCommand = process.env.LLXPRT_SANDBOX_PROXY_COMMAND;
  if (proxyCommand) {
    let proxy = resolveProxyUrl();
    proxy = proxy.replace('localhost', SANDBOX_PROXY_NAME);
    if (proxy) {
      args.push('--env', `HTTPS_PROXY=${proxy}`);
      args.push('--env', `https_proxy=${proxy}`);
      args.push('--env', `HTTP_PROXY=${proxy}`);
      args.push('--env', `http_proxy=${proxy}`);
    }
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
    if (noProxy) {
      args.push('--env', `NO_PROXY=${noProxy}`);
      args.push('--env', `no_proxy=${noProxy}`);
    }
    if (proxy) {
      // eslint-disable-next-line sonarjs/os-command -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
      execSync(
        `${config.command} network inspect ${SANDBOX_NETWORK_NAME} || ${config.command} network create --internal ${SANDBOX_NETWORK_NAME}`,
      );
      args.push('--network', SANDBOX_NETWORK_NAME);
      // eslint-disable-next-line sonarjs/os-command -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
      execSync(
        `${config.command} network inspect ${SANDBOX_PROXY_NAME} || ${config.command} network create ${SANDBOX_PROXY_NAME}`,
      );
    }
  }

  if (!isPodmanMacOS) {
    for (const p of ports()) {
      args.push('--publish', `${p}:${p}`);
    }
  }
  if (isSandboxDebugModeEnabled(process.env.DEBUG) && !isPodmanMacOS) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string DEBUG_PORT should fall back to default
    const debugPort = process.env.DEBUG_PORT || '9229';
    args.push(`--publish`, `${debugPort}:${debugPort}`);
  }

  return proxyCommand;
}

/** Assigns a unique container name based on image name. */
function assignContainerName(
  args: string[],
  config: SandboxConfig,
  image: string,
): string {
  const imageName = parseImageName(image);
  let index = 0;
  // eslint-disable-next-line sonarjs/os-command -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
  const containerNameCheck = execSync(
    `${config.command} ps -a --format "{{.Names}}"`,
  )
    .toString()
    .trim();
  while (containerNameCheck.includes(`${imageName}-${index}`)) {
    index++;
  }
  const containerName = `${imageName}-${index}`;
  args.push('--name', containerName, '--hostname', containerName);
  return containerName;
}

/** Configures user/UID for the container and modifies entrypoint if needed. */
async function setupContainerUser(
  args: string[],
  finalEntrypoint: string[],
): Promise<string> {
  let userFlag = '';

  if (process.env.LLXPRT_CODE_INTEGRATION_TEST === 'true') {
    args.push('--user', 'root');
    userFlag = '--user root';
  } else if (await shouldUseCurrentUserInSandbox()) {
    args.push('--user', 'root');
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
    const uid = execSync('id -u').toString().trim();
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
    const gid = execSync('id -g').toString().trim();

    const username = 'gemini';
    const homeDir = getContainerPath(os.homedir());
    const setupUserCommands = [
      `groupadd -f -g ${gid} ${username}`,
      `id -u ${username} &>/dev/null || useradd -o -u ${uid} -g ${gid} -d ${homeDir} -s /bin/bash ${username}`,
    ].join(' && ');

    const originalCommand = finalEntrypoint[2];
    const escapedOriginalCommand = originalCommand.replace(/'/g, "'\\''");
    const suCommand = `su -p ${username} -c '${escapedOriginalCommand}'`;
    finalEntrypoint[2] = `${setupUserCommands} && ${suCommand}`;
    userFlag = `--user ${uid}:${gid}`;
    args.push('--env', `HOME=${os.homedir()}`);
  }

  return userFlag;
}

/** Starts credential proxy and sets up bridge for Podman/Docker macOS. */
async function setupCredentialProxy(
  args: string[],
  config: SandboxConfig,
  resolvedTmpdir: string,
  reservedTunnelPorts: Set<number>,
  entrypointPrefixes: string[],
): Promise<{
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  credentialProxyBridgeCleanup: (() => void) | undefined;
}> {
  let credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  let credentialProxyBridgeCleanup: (() => void) | undefined;

  // @plan:PLAN-20250214-CREDPROXY.P34 R25.1: Start credential proxy BEFORE spawning container
  // The proxy must be listening before the container starts so it can connect immediately
  let credentialProxyHandle: { stop: () => Promise<void> } | undefined;
  try {
    credentialProxyHandle = await createAndStartProxy({
      socketPath: resolvedTmpdir,
    });
    void credentialProxyHandle;
  } catch (err) {
    // @plan:PLAN-20250214-CREDPROXY.P34 R25.1a: Proxy creation failure aborts before spawning container
    throw new FatalSandboxError(
      `Failed to start credential proxy: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const socketPath = getProxySocketPath();
  if (!socketPath) {
    return { credentialProxyBridgeResult, credentialProxyBridgeCleanup };
  }

  // @plan:PLAN-20250214-CREDPROXY.P34 R3.6: Pass socket path to container via env var
  if (os.platform() === 'darwin') {
    const sandboxCommand: string = config.command;
    switch (sandboxCommand) {
      case 'podman':
        credentialProxyBridgeResult = await setupCredentialProxyPodmanMacOS(
          args,
          socketPath,
          SSH_TUNNEL_POLL_TIMEOUT_MS,
          {
            reserveTunnelPort: (port) => {
              reservedTunnelPorts.add(port);
            },
            excludedTunnelPorts: reservedTunnelPorts,
          },
        );
        break;
      case 'docker':
        credentialProxyBridgeResult = await setupCredentialProxyDockerMacOS(
          args,
          socketPath,
        );
        break;
      default:
        args.push('--env', `LLXPRT_CREDENTIAL_SOCKET=${socketPath}`);
        break;
    }

    if (credentialProxyBridgeResult) {
      credentialProxyBridgeCleanup = credentialProxyBridgeResult.cleanup;
      if (credentialProxyBridgeResult.entrypointPrefix) {
        entrypointPrefixes.push(credentialProxyBridgeResult.entrypointPrefix);
      }
      args.push(
        '--env',
        `LLXPRT_CREDENTIAL_SOCKET=${credentialProxyBridgeResult.containerSocketPath}`,
      );
    }
  } else {
    args.push('--env', `LLXPRT_CREDENTIAL_SOCKET=${socketPath}`);
  }

  return { credentialProxyBridgeResult, credentialProxyBridgeCleanup };
}

/** Spawns proxy container and waits for it to be ready. */
async function startProxyContainer(
  config: SandboxConfig,
  proxyCommand: string,
  userFlag: string,
  image: string,
  workdir: string,
): Promise<ProxyContainerHandle> {
  const proxyContainerCommand =
    `${config.command} run --rm --init ${userFlag} --name ${SANDBOX_PROXY_NAME} ` +
    `--network ${SANDBOX_PROXY_NAME} -p 8877:8877 -v ${process.cwd()}:${workdir} ` +
    `--workdir ${workdir} ${image} ${proxyCommand}`;
  // eslint-disable-next-line sonarjs/os-command -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
  const proxyProcess = spawn(proxyContainerCommand, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: true,
  });

  const stopProxy = () => {
    debugLogger.log('stopping proxy container ...');
    // eslint-disable-next-line sonarjs/os-command -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
    execSync(`${config.command} rm -f ${SANDBOX_PROXY_NAME}`);
  };
  process.on('exit', stopProxy);
  process.on('SIGINT', stopProxy);
  process.on('SIGTERM', stopProxy);

  proxyProcess.stderr.on('data', (data) => {
    debugLogger.error(data.toString().trim());
  });

  debugLogger.log('waiting for proxy to start ...');
  await execAsync(
    `until timeout 0.25 curl -s http://localhost:8877; do sleep 0.25; done`,
  );
  await execAsync(
    `${config.command} network connect ${SANDBOX_NETWORK_NAME} ${SANDBOX_PROXY_NAME}`,
  );
  return { process: proxyProcess, command: proxyContainerCommand };
}

function wireProxyContainerCloseHandler(
  proxyContainer: ProxyContainerHandle | undefined,
  sandboxProcess: ChildProcess,
): void {
  if (!proxyContainer) {
    return;
  }
  proxyContainer.process.on('close', (code, signal) => {
    const sandboxPid = sandboxProcess.pid;
    if (sandboxPid !== undefined && sandboxPid !== 0) {
      process.kill(-sandboxPid, 'SIGTERM');
    }
    throw new FatalSandboxError(
      `Proxy container command '${proxyContainer.command}' exited with code ${code}, signal ${signal}`,
    );
  });
}

/** Wires all cleanup handlers into the sandbox process lifecycle. */
function wireCleanupHandlers(
  sandboxProcess: ChildProcess,
  cliConfig: Config | undefined,
  sshResult: SshAgentResult,
  portForwardingResult: PortForwardingResult | undefined,
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined,
  setCredentialProxyBridgeCleanup: (c: (() => void) | undefined) => void,
): void {
  sandboxProcess.on('error', (err) => {
    debugLogger.error('Sandbox process error:', err);
  });

  if (sshResult.cleanup) {
    const stopTunnel = sshResult.cleanup;
    process.on('exit', stopTunnel);
    process.on('SIGINT', stopTunnel);
    process.on('SIGTERM', stopTunnel);
    sandboxProcess.on('close', stopTunnel);
  }

  if (portForwardingResult?.cleanup) {
    sandboxProcess.on('close', portForwardingResult.cleanup);
  }

  if (credentialProxyBridgeResult?.cleanup) {
    const stopCredentialBridgeTunnel = credentialProxyBridgeResult.cleanup;
    process.on('exit', stopCredentialBridgeTunnel);
    process.on('SIGINT', stopCredentialBridgeTunnel);
    process.on('SIGTERM', stopCredentialBridgeTunnel);
    sandboxProcess.on('close', () => {
      setCredentialProxyBridgeCleanup(undefined);
      stopCredentialBridgeTunnel();
    });
  }

  // @plan:PLAN-20250214-CREDPROXY.P34 R25.2, R25.3: Clean up credential proxy on sandbox exit
  const stopCredentialProxy = () => {
    void stopProxy();
  };
  process.on('exit', stopCredentialProxy);
  process.on('SIGINT', stopCredentialProxy);
  process.on('SIGTERM', stopCredentialProxy);
  sandboxProcess.on('close', stopCredentialProxy);
}

/** Handles stdin pause/raw-mode before spawning, and restores after. */
function handleStdinForSandbox(): {
  stdinWasPaused: boolean;
  stdinHadRawMode: boolean;
} {
  const stdinWasPaused = process.stdin.isPaused();
  const stdinHadRawMode =
    process.stdin.isTTY &&
    typeof process.stdin.isRaw === 'boolean' &&
    process.stdin.isRaw;

  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
    try {
      process.stdin.pause();
    } catch {
      // ignore
    }
  }
  return { stdinWasPaused, stdinHadRawMode };
}

/** Restores stdin state after sandbox exits. */
function restoreStdinAfterSandbox(
  sandboxProcess: ChildProcess,
  stdinWasPaused: boolean,
  stdinHadRawMode: boolean,
  cliConfig?: Config,
): void {
  sandboxProcess.on('close', () => {
    if (!process.stdin.isTTY) {
      return;
    }
    if (!stdinWasPaused) {
      try {
        process.stdin.resume();
      } catch {
        // ignore
      }
    }
    if (stdinHadRawMode) {
      try {
        process.stdin.setRawMode(true);
      } catch (err) {
        if (cliConfig?.getDebugMode() === true) {
          debugLogger.error('[sandbox] Failed to restore raw mode:', err);
        }
      }
    }
  });
}

interface ProxyContainerHandle {
  process: ChildProcess;
  command: string;
}

interface ContainerSandboxPrepared {
  args: string[];
  entrypointPrefixes: string[];
  finalEntrypoint: string[];
  proxyCommand: string | undefined;
  userFlag: string;
  image: string;
  workdir: string;
  portForwardingResult: PortForwardingResult | undefined;
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  credentialProxyBridgeCleanup: (() => void) | undefined;
  reservedTunnelPorts: Set<number>;
  sshResult: SshAgentResult;
}

/** Validates image and builds initial container run args. */
async function prepareContainerImageAndArgs(config: SandboxConfig): Promise<{
  image: string;
  workdir: string;
  containerWorkdir: string;
  resolvedTmpdir: string;
  args: string[];
}> {
  // @plan:PLAN-20250214-CREDPROXY.P34 R3.4: Use realpath to resolve symlinks
  debugLogger.error(`hopping into sandbox (command: ${config.command}) ...`);
  const gcPath = fs.realpathSync(process.argv[1]);
  const projectSandboxDockerfile = path.join(
    SETTINGS_DIRECTORY_NAME,
    'sandbox.Dockerfile',
  );
  const isCustomProjectSandbox = fs.existsSync(projectSandboxDockerfile);
  const image = config.image;
  const workdir = path.resolve(process.cwd());
  const containerWorkdir = getContainerPath(workdir);

  if (process.env.BUILD_SANDBOX) {
    buildSandboxImage(
      gcPath,
      isCustomProjectSandbox,
      projectSandboxDockerfile,
      image,
      config,
    );
  }

  if (!(await ensureSandboxImageIsPresent(config.command, image))) {
    const remedy =
      image === LOCAL_DEV_SANDBOX_IMAGE_NAME
        ? 'Try running `npm run build:all` or `npm run build:sandbox` under the gemini-cli repo to build it locally, or check the image name and your network connection.'
        : 'Please check the image name, your network connection, or visit https://github.com/vybestack/llxprt-code/discussions if the issue persists.';
    throw new FatalSandboxError(
      `Sandbox image '${image}' is missing or could not be pulled. ${remedy}`,
    );
  }

  const resolvedTmpdir = fs.realpathSync(os.tmpdir());
  const args = buildContainerRunArgs(
    config,
    image,
    workdir,
    containerWorkdir,
    resolvedTmpdir,
  );
  addContainerVolumeMounts(args);
  return { image, workdir, containerWorkdir, resolvedTmpdir, args };
}

/** Sets up SSH forwarding, port forwarding, networking, and env vars. */
async function prepareContainerNetworkAndEnv(
  config: SandboxConfig,
  args: string[],
  nodeArgs: string[],
  workdir: string,
  isPodmanMacOS: boolean,
  reservedTunnelPorts: Set<number>,
): Promise<{
  sshResult: SshAgentResult;
  podmanMacOSPortsForwarded: Set<string>;
  proxyCommand: string | undefined;
  portForwardingResult: PortForwardingResult | undefined;
}> {
  const sshResult = await setupSshAgentForwarding(config, args, {
    reserveTunnelPort: (port) => {
      reservedTunnelPorts.add(port);
    },
    excludedTunnelPorts: reservedTunnelPorts,
  });

  let portForwardingResult: PortForwardingResult | undefined;
  const podmanMacOSPortsForwarded = await setupPodmanMacosPortForwarding(
    isPodmanMacOS,
    reservedTunnelPorts,
    (result) => {
      portForwardingResult = result;
    },
  );

  const proxyCommand = setupContainerNetworking(args, config, isPodmanMacOS);
  return {
    sshResult,
    podmanMacOSPortsForwarded,
    proxyCommand,
    portForwardingResult,
  };
}

/** Runs the Docker/Podman sandbox path — image build, arg assembly, and proxy setup. */
async function prepareContainerSandbox(
  config: SandboxConfig,
  nodeArgs: string[],
  cliConfig: Config | undefined,
  cliArgs: string[],
): Promise<ContainerSandboxPrepared> {
  let credentialProxyBridgeCleanup: (() => void) | undefined;

  const { image, workdir, resolvedTmpdir, args } =
    await prepareContainerImageAndArgs(config);

  const reservedTunnelPorts = new Set<number>();
  const isPodmanMacOS =
    config.command === 'podman' && os.platform() === 'darwin';
  const {
    sshResult,
    podmanMacOSPortsForwarded,
    proxyCommand,
    portForwardingResult,
  } = await prepareContainerNetworkAndEnv(
    config,
    args,
    nodeArgs,
    workdir,
    isPodmanMacOS,
    reservedTunnelPorts,
  );

  const containerName = assignContainerName(args, config, image);
  addContainerEnvVars(args, config, containerName, nodeArgs, workdir);

  const finalEntrypoint = entrypoint(
    workdir,
    cliArgs,
    podmanMacOSPortsForwarded.size > 0 ? podmanMacOSPortsForwarded : undefined,
  );
  const entrypointPrefixes: string[] = [];
  if (sshResult.entrypointPrefix) {
    entrypointPrefixes.push(sshResult.entrypointPrefix);
  }

  const userFlag = await setupContainerUser(args, finalEntrypoint);

  let credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  try {
    const cpResult = await setupCredentialProxy(
      args,
      config,
      resolvedTmpdir,
      reservedTunnelPorts,
      entrypointPrefixes,
    );
    credentialProxyBridgeResult = cpResult.credentialProxyBridgeResult;
    credentialProxyBridgeCleanup = cpResult.credentialProxyBridgeCleanup;
  } catch (err) {
    credentialProxyBridgeResult?.cleanup?.();
    if (err instanceof FatalSandboxError) {
      throw err;
    }
    // @plan:PLAN-20250214-CREDPROXY.P34 R25.1a: Proxy creation failure aborts before spawning container
    throw new FatalSandboxError(
      `Failed to start credential proxy: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    args,
    entrypointPrefixes,
    finalEntrypoint,
    proxyCommand,
    userFlag,
    image,
    workdir,
    portForwardingResult,
    credentialProxyBridgeResult,
    credentialProxyBridgeCleanup,
    reservedTunnelPorts,
    sshResult,
  };
}

/** Spawns container and proxy, wires cleanup, and waits for exit. */
async function executeContainerSandbox(
  config: SandboxConfig,
  cliConfig: Config | undefined,
  prepared: Awaited<ReturnType<typeof prepareContainerSandbox>>,
): Promise<{
  exitCode: number;
  portForwardingResult: PortForwardingResult | undefined;
  credentialProxyBridgeCleanup: (() => void) | undefined;
}> {
  const {
    args,
    entrypointPrefixes,
    finalEntrypoint,
    proxyCommand,
    userFlag,
    image,
    workdir,
    portForwardingResult,
    credentialProxyBridgeResult,
    sshResult,
  } = prepared;
  let credentialProxyBridgeCleanup = prepared.credentialProxyBridgeCleanup;

  if (entrypointPrefixes.length > 0) {
    finalEntrypoint[2] = `${entrypointPrefixes.join(' ')} ${finalEntrypoint[2]}`;
  }
  args.push(image);
  args.push(...finalEntrypoint);

  const proxyContainerProcess = proxyCommand
    ? await startProxyContainer(config, proxyCommand, userFlag, image, workdir)
    : undefined;

  const { stdinWasPaused, stdinHadRawMode } = handleStdinForSandbox();
  const sandboxProcess = spawn(config.command, args, { stdio: 'inherit' });
  wireProxyContainerCloseHandler(proxyContainerProcess, sandboxProcess);
  restoreStdinAfterSandbox(
    sandboxProcess,
    stdinWasPaused,
    stdinHadRawMode,
    cliConfig,
  );

  wireCleanupHandlers(
    sandboxProcess,
    cliConfig,
    sshResult,
    portForwardingResult,
    credentialProxyBridgeResult,
    (c) => {
      credentialProxyBridgeCleanup = c;
    },
  );

  const exitCode = await new Promise<number>((resolve) => {
    sandboxProcess.on('close', (code, signal) => {
      const ec = normalizeExitCode(code, signal);
      if (ec !== 0) {
        debugLogger.log(
          `Sandbox process exited with code: ${code}, signal: ${signal}`,
        );
      }
      resolve(ec);
    });
  });

  return { exitCode, portForwardingResult, credentialProxyBridgeCleanup };
}

/** Runs the Docker/Podman sandbox path. */
async function runContainerSandbox(
  config: SandboxConfig,
  nodeArgs: string[],
  cliConfig?: Config,
  cliArgs: string[] = [],
): Promise<{
  exitCode: number;
  portForwardingResult: PortForwardingResult | undefined;
  credentialProxyBridgeCleanup: (() => void) | undefined;
}> {
  const prepared = await prepareContainerSandbox(
    config,
    nodeArgs,
    cliConfig,
    cliArgs,
  );
  return executeContainerSandbox(config, cliConfig, prepared);
}

function buildSandboxImage(
  gcPath: string,
  isCustomProjectSandbox: boolean,
  projectSandboxDockerfile: string,
  image: string,
  config: SandboxConfig,
): void {
  if (!gcPath.includes('gemini-cli/packages/')) {
    throw new FatalSandboxError(
      'Cannot build sandbox using installed gemini binary; ' +
        'run `npm link ./packages/cli` under gemini-cli repo to switch to linked binary.',
    );
  }
  debugLogger.error('building sandbox ...');
  const gcRoot = gcPath.split('/packages/')[0];
  if (isCustomProjectSandbox) {
    debugLogger.error(`using ${projectSandboxDockerfile} for sandbox`);
  }
  const buildArgsArray = ['-s'];
  if (isCustomProjectSandbox) {
    buildArgsArray.push(
      '-f',
      path.resolve(projectSandboxDockerfile),
      '-i',
      image,
    );
  }
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- Project intentionally invokes platform tooling at this trusted boundary; arguments remain explicit and behavior is preserved.
  execFileSync('node', ['scripts/build_sandbox.js', ...buildArgsArray], {
    cwd: gcRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      LLXPRT_SANDBOX: config.command,
    },
  });
}

async function setupPodmanMacosPortForwarding(
  isPodmanMacOS: boolean,
  reservedTunnelPorts: Set<number>,
  onResult: (result: PortForwardingResult) => void,
): Promise<Set<string>> {
  const podmanMacOSPortsForwarded = new Set<string>();
  if (!isPodmanMacOS) {
    return podmanMacOSPortsForwarded;
  }

  const portsToForwardSet = new Set<string>(ports());
  if (isSandboxDebugModeEnabled(process.env.DEBUG)) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing
    portsToForwardSet.add(process.env.DEBUG_PORT || '9229');
  }
  const portsToForward: string[] = [...portsToForwardSet];

  if (portsToForward.length > 0) {
    debugLogger.log(
      `Setting up SSH port forwarding for: ${portsToForward.join(', ')}`,
    );
    const result = await setupPortForwardingPodmanMacOS(
      portsToForward,
      SSH_TUNNEL_POLL_TIMEOUT_MS,
    );
    onResult(result);
    if (result.cleanup) {
      process.on('exit', result.cleanup);
      process.on('SIGINT', result.cleanup);
      process.on('SIGTERM', result.cleanup);
    }
    for (const p of portsToForward) {
      podmanMacOSPortsForwarded.add(p);
    }
  }

  return podmanMacOSPortsForwarded;
}

function createSandboxConsolePatcher(cliConfig?: Config): ConsolePatcher {
  return new ConsolePatcher({
    debugMode: cliConfig?.getDebugMode() ?? !!process.env.DEBUG,
    stderr: true,
  });
}

async function handleSandboxStartError(error: unknown): Promise<never> {
  // @plan:PLAN-20250214-CREDPROXY.P34 - Clean up credential proxy on error
  await stopProxy();
  debugLogger.error('Sandbox error:', error);
  throw error;
}

function cleanupSandboxStart(
  patcher: ConsolePatcher,
  portForwardingResult: PortForwardingResult | undefined,
  credentialProxyBridgeCleanup: (() => void) | undefined,
): void {
  portForwardingResult?.cleanup?.();
  credentialProxyBridgeCleanup?.();
  patcher.cleanup();
}

export async function start_sandbox(
  config: SandboxConfig,
  nodeArgs: string[] = [],
  cliConfig?: Config,
  cliArgs: string[] = [],
): Promise<number> {
  let credentialProxyBridgeCleanup: (() => void) | undefined;
  let portForwardingResult: PortForwardingResult | undefined;

  const patcher = createSandboxConsolePatcher(cliConfig);
  patcher.patch();

  try {
    if (config.command === 'sandbox-exec') {
      const exitCode = await runSeatbeltSandbox(
        config,
        nodeArgs,
        cliConfig,
        cliArgs,
      );
      return exitCode;
    }

    const result = await runContainerSandbox(
      config,
      nodeArgs,
      cliConfig,
      cliArgs,
    );
    portForwardingResult = result.portForwardingResult;
    credentialProxyBridgeCleanup = result.credentialProxyBridgeCleanup;
    return result.exitCode;
  } catch (error) {
    return await handleSandboxStartError(error);
  } finally {
    cleanupSandboxStart(
      patcher,
      portForwardingResult,
      credentialProxyBridgeCleanup,
    );
  }
}

// Helper functions to ensure sandbox image is present

async function imageExists(sandbox: string, image: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ['images', '-q', image];
    const checkProcess = spawn(sandbox, args);

    let stdoutData = '';
    checkProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    checkProcess.on('error', (err) => {
      debugLogger.warn(
        `Failed to start '${sandbox}' command for image check: ${err.message}`,
      );
      resolve(false);
    });

    checkProcess.on('close', (code) => {
      // Non-zero code might indicate docker daemon not running, etc.
      // The primary success indicator is non-empty stdoutData.
      if (code !== 0) {
        // debugLogger.warn(`'${sandbox} images -q ${image}' exited with code ${code}.`);
      }
      resolve(stdoutData.trim() !== '');
    });
  });
}

async function pullImage(sandbox: string, image: string): Promise<boolean> {
  debugLogger.log(`Attempting to pull image ${image} using ${sandbox}...`);
  return new Promise((resolve) => {
    const args = ['pull', image];
    const pullProcess = spawn(sandbox, args, { stdio: 'pipe' });

    let stderrData = '';

    const onStdoutData = (data: Buffer) => {
      debugLogger.log(data.toString().trim()); // Show pull progress
    };

    const onStderrData = (data: Buffer) => {
      stderrData += data.toString();
      debugLogger.error(data.toString().trim()); // Show pull errors/info from the command itself
    };

    const onError = (err: Error) => {
      debugLogger.warn(
        `Failed to start '${sandbox} pull ${image}' command: ${err.message}`,
      );
      cleanup();
      resolve(false);
    };

    const onClose = (code: number | null) => {
      if (code === 0) {
        debugLogger.log(`Successfully pulled image ${image}.`);
        cleanup();
        resolve(true);
      } else {
        debugLogger.warn(
          `Failed to pull image ${image}. '${sandbox} pull ${image}' exited with code ${code}.`,
        );
        if (stderrData.trim()) {
          // Details already printed by the stderr listener above
        }
        cleanup();
        resolve(false);
      }
    };

    const cleanup = () => {
      pullProcess.stdout.removeListener('data', onStdoutData);
      pullProcess.stderr.removeListener('data', onStderrData);
      pullProcess.removeListener('error', onError);
      pullProcess.removeListener('close', onClose);
      if (pullProcess.connected) {
        pullProcess.disconnect();
      }
    };

    pullProcess.stdout.on('data', onStdoutData);
    pullProcess.stderr.on('data', onStderrData);
    pullProcess.on('error', onError);
    pullProcess.on('close', onClose);
  });
}

async function ensureSandboxImageIsPresent(
  sandbox: string,
  image: string,
): Promise<boolean> {
  debugLogger.log(`Checking for sandbox image: ${image}`);
  if (await imageExists(sandbox, image)) {
    debugLogger.log(`Sandbox image ${image} found locally.`);
    return true;
  }

  debugLogger.log(`Sandbox image ${image} not found locally.`);
  if (image === LOCAL_DEV_SANDBOX_IMAGE_NAME) {
    // user needs to build the image themselves
    return false;
  }

  if (await pullImage(sandbox, image)) {
    // After attempting to pull, check again to be certain
    if (await imageExists(sandbox, image)) {
      debugLogger.log(`Sandbox image ${image} is now available after pulling.`);
      return true;
    }
    debugLogger.warn(
      `Sandbox image ${image} still not found after a pull attempt. This might indicate an issue with the image name or registry, or the pull command reported success but failed to make the image available.`,
    );
    return false;
  }

  debugLogger.error(
    `Failed to obtain sandbox image ${image} after check and pull attempt.`,
  );
  return false; // Pull command failed or image still not present
}
