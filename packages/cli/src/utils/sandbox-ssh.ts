/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { shouldUseCurrentUserInSandbox } from './sandbox-env.js';
import { setupSshAgentPodmanMacOS } from './sandbox-podman.js';

export interface SshAgentResult {
  tunnelProcess?: ChildProcess;
  cleanup?: () => void;
  entrypointPrefix?: string;
}

export interface CredentialProxyBridgeResult {
  tunnelProcess?: ChildProcess;
  cleanup?: () => void;
  entrypointPrefix?: string;
  containerSocketPath: string;
}

export interface PortForwardingResult {
  tunnelProcess?: ChildProcess;
  cleanup?: () => void;
}

const CONTAINER_SSH_AGENT_SOCK = '/ssh-agent';
const CONTAINER_CREDENTIAL_PROXY_SOCK = '/tmp/llxprt-credential.sock';
const SSH_TUNNEL_POLL_TIMEOUT_MS = 10000;
const SSH_AGENT_PROBE_TIMEOUT_MS = 5000;
const SSH_AGENT_ENV_PREFIX = 'SSH_AUTH_SOCK=';
const SSH_AGENT_NO_IDENTITIES_PATTERN = /agent has no identities/i;
const SSH_AGENT_EMPTY_WARNING =
  [
    'SSH agent socket is present, but no identities are loaded (ssh-add -l reported empty).',
    'SSH forwarding is enabled, but git SSH auth will fail until a key is loaded.',
    'Try: ssh-add ~/.ssh/id_ed25519',
  ].join('\n') + '\n';

export { SSH_TUNNEL_POLL_TIMEOUT_MS };
export const createTunnelProcessCleanup = (tunnelProcess: ChildProcess) => {
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
export const createServerCleanup = (server: net.Server) => {
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

interface SshAgentProbe {
  status: number | null;
  output: string;
  spawnError?: Error;
}

/**
 * Lists the identities held by the agent behind `sshAuthSock`. Resolves for
 * every outcome — a failed probe is a diagnostic dead end, not an error worth
 * propagating into sandbox startup.
 */
function listSshAgentIdentities(sshAuthSock: string): Promise<SshAgentProbe> {
  return new Promise((resolve) => {
    const probe = spawn('ssh-add', ['-l'], {
      env: { ...process.env, SSH_AUTH_SOCK: sshAuthSock },
      timeout: SSH_AGENT_PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    let output = '';
    const collect = (chunk: string) => {
      output += chunk;
    };
    probe.stdout.setEncoding('utf8');
    probe.stderr.setEncoding('utf8');
    probe.stdout.on('data', collect);
    probe.stderr.on('data', collect);

    probe.on('error', (spawnError) => {
      resolve({ status: null, output, spawnError });
    });
    probe.on('close', (status) => {
      resolve({ status, output });
    });
  });
}

/**
 * Warns when the agent being forwarded is reachable but holds no identities —
 * the cause of "Permission denied (publickey)" inside a sandbox whose
 * forwarding is otherwise wired up correctly.
 *
 * `ssh-add -l` exits 1 for any identity-listing failure, including a
 * communication error with the agent, so the empty case is confirmed from the
 * reported output rather than from the exit status alone. Every other outcome
 * is debug-only: an inconclusive probe must not push guesswork at the user.
 */
async function warnIfSshAgentHasNoIdentities(
  sshAuthSock: string,
): Promise<void> {
  const probe = await listSshAgentIdentities(sshAuthSock);

  if (probe.spawnError) {
    debugLogger.warn(
      `Could not run ssh-add to check for loaded SSH agent identities: ${probe.spawnError.message}`,
    );
    return;
  }

  if (probe.status === 0) {
    return;
  }

  if (
    probe.status === 1 &&
    SSH_AGENT_NO_IDENTITIES_PATTERN.test(probe.output)
  ) {
    process.stderr.write(SSH_AGENT_EMPTY_WARNING);
    return;
  }

  debugLogger.warn(
    `Could not determine whether the SSH agent has identities loaded; ssh-add -l exited with status ${probe.status}.`,
  );
}

/**
 * True once a helper has configured the container to use the forwarded agent.
 * A helper can decline (Podman refuses to override a non-host `--network`), and
 * the empty-agent warning must not claim forwarding is enabled in that case.
 */
function containerWillReceiveSshAgent(args: readonly string[]): boolean {
  return args.some((arg) => arg.startsWith(SSH_AGENT_ENV_PREFIX));
}

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

  const result = await dispatchSshAgentForwarding(
    config,
    args,
    sshAuthSock,
    options,
  );

  if (containerWillReceiveSshAgent(args)) {
    await warnIfSshAgentHasNoIdentities(sshAuthSock);
  }

  return result;
}

/** Hands forwarding to the helper that matches the host platform and engine. */
async function dispatchSshAgentForwarding(
  config: { command: 'docker' | 'podman' | 'sandbox-exec' },
  args: string[],
  sshAuthSock: string,
  options: {
    reserveTunnelPort?: (port: number) => void;
    excludedTunnelPorts?: ReadonlySet<number>;
  },
): Promise<SshAgentResult> {
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

/** Parses an ssh:// URI into its components. */
interface ParsedSshUri {
  user: string;
  host: string;
  port: number;
}

function parseSshUri(uri: string): ParsedSshUri | undefined {
  // ssh://user@host:port/path
  const parts = uri.replace(/^ssh:\/\//, '').split('/');
  const authority = parts[0] ?? '';
  const atIndex = authority.indexOf('@');
  if (atIndex === -1) {
    return undefined;
  }
  const user = authority.slice(0, atIndex);
  const hostPort = authority.slice(atIndex + 1);
  const colonIndex = hostPort.lastIndexOf(':');
  if (colonIndex === -1) {
    return undefined;
  }
  const host = hostPort.slice(0, colonIndex);
  const portStr = hostPort.slice(colonIndex + 1);
  const port = parseInt(portStr, 10);
  if (Number.isNaN(port)) {
    return undefined;
  }
  return { user, host, port };
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

  const parsed = parseSshUri(conn.URI);
  if (!parsed) {
    throw new FatalSandboxError(
      `Unable to parse Podman connection URI '${conn.URI}'. ` +
        'Run `podman system connection list` to verify your machine setup.',
    );
  }

  return {
    user: parsed.user,
    host: parsed.host,
    port: parsed.port,
    identityPath: conn.Identity,
  };
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
