/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { quote, parse } from 'shell-quote';
import {
  USER_SETTINGS_DIR,
  SETTINGS_DIRECTORY_NAME,
} from '../config/settings.js';
import { promisify } from 'node:util';
import type { Config, SandboxConfig } from '@vybestack/llxprt-code-core';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { ConsolePatcher } from '../ui/utils/ConsolePatcher.js';

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

const CONTAINER_SSH_AGENT_SOCK = '/ssh-agent';

/**
 * Routes SSH agent forwarding to the appropriate platform-specific helper.
 * Respects LLXPRT_SANDBOX_SSH_AGENT (on/off/auto) and SSH_AUTH_SOCK.
 */
export async function setupSshAgentForwarding(
  config: { command: 'docker' | 'podman' | 'sandbox-exec' },
  args: string[],
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
    console.warn('SSH agent requested but SSH_AUTH_SOCK is not set.');
    return {};
  }

  // R4.3: Verify socket exists on disk before attempting mount
  if (!fs.existsSync(sshAuthSock)) {
    console.warn(
      `SSH_AUTH_SOCK path not found at ${sshAuthSock}. Skipping SSH agent forwarding.`,
    );
    return {};
  }

  const platform = os.platform();

  if (platform === 'linux') {
    setupSshAgentLinux(config, args, sshAuthSock);
    return {};
  }

  if (platform === 'darwin') {
    if (config.command === 'docker') {
      setupSshAgentDockerMacOS(args);
      return {};
    }

    if (config.command === 'podman') {
      return setupSshAgentPodmanMacOS(args, sshAuthSock);
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

/**
 * Sets up SSH agent forwarding for Docker on macOS using the Docker Desktop
 * magic socket (/run/host-services/ssh-auth.sock).
 *
 * Falls back gracefully if Docker Desktop is not detected (R6.2).
 */
export function setupSshAgentDockerMacOS(args: string[]): void {
  try {
    // Detect Docker Desktop by checking for the osType context
    const info = execSync('docker info --format "{{.OperatingSystem}}"', {
      timeout: 5000,
    })
      .toString()
      .trim();
    const isDesktop = /docker desktop/i.test(info);

    if (!isDesktop) {
      console.warn(
        'Docker Desktop not detected on macOS. SSH agent forwarding may not work. ' +
          'Consider using Docker Desktop or set LLXPRT_SANDBOX_SSH_AGENT=off.',
      );
      return;
    }

    // R6.1: Use the Docker Desktop magic socket
    const magicSocket = '/run/host-services/ssh-auth.sock';
    args.push('--volume', `${magicSocket}:${CONTAINER_SSH_AGENT_SOCK}`);
    args.push('--env', `SSH_AUTH_SOCK=${CONTAINER_SSH_AGENT_SOCK}`);
  } catch {
    console.warn(
      'Failed to detect Docker Desktop. SSH agent forwarding disabled. ' +
        'Set LLXPRT_SANDBOX_SSH_AGENT=off to suppress this warning.',
    );
  }
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

  // Parse the URI: ssh://user@host:port/path
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
): Promise<SshAgentResult> {
  const conn = getPodmanMachineConnection();

  // Pick a random ephemeral port for the TCP tunnel
  const tunnelPort = 49152 + Math.floor(Math.random() * 16383);

  // R7.1: Spawn SSH reverse tunnel (TCP port, not Unix socket)
  const tunnelProcess = spawn(
    'ssh',
    [
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
      '-R',
      `127.0.0.1:${tunnelPort}:${sshAuthSock}`,
      '-N',
      `${conn.user}@${conn.host}`,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  // R7.7: Handle tunnel spawn failure
  const tunnelStarted = await new Promise<boolean>((resolve) => {
    const errorHandler = () => resolve(false);
    tunnelProcess.on('error', errorHandler);
    // Give the process a moment to fail or stabilize
    setTimeout(() => {
      tunnelProcess.removeListener('error', errorHandler);
      if (tunnelProcess.exitCode !== null) {
        resolve(false);
      } else {
        resolve(true);
      }
    }, 500);
  });

  if (!tunnelStarted) {
    throw new FatalSandboxError(
      'SSH tunnel process failed to start for Podman macOS SSH agent forwarding. ' +
        'Ensure Podman machine is running: `podman machine start`. ' +
        'Check SSH connectivity: `podman machine ssh`.',
    );
  }

  // R7.4: Poll for TCP port readiness with timeout
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

  // R7.8: Timeout kills tunnel and throws
  if (!portReady) {
    try {
      tunnelProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    throw new FatalSandboxError(
      'SSH agent forwarding timed out waiting for TCP tunnel in Podman VM. ' +
        'Ensure your SSH agent is running and SSH_AUTH_SOCK is valid. ' +
        'Check Podman machine: `podman machine ssh`.',
    );
  }

  // R7.5: Use --network=host so the container can reach the VM's loopback.
  // This is safe because the Podman VM itself provides the security boundary.
  // Guard: if a --network flag is already present (e.g., 'none' from SANDBOX_NETWORK=off),
  // SSH agent forwarding cannot work — warn and bail out gracefully.
  const existingNetIdx = args.indexOf('--network');
  if (existingNetIdx !== -1) {
    const existingNet = args[existingNetIdx + 1];
    console.warn(
      `Podman macOS SSH agent forwarding requires --network=host but ` +
        `--network=${existingNet} is already set. Skipping SSH agent setup.`,
    );
    try {
      tunnelProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    return {};
  }
  args.push('--network', 'host');

  // socat creates the socket at runtime (no volume mount), so it must be in a
  // world-writable directory — the container runs as the `node` user, not root.
  const socatSocketPath = '/tmp/ssh-agent';
  args.push('--env', `SSH_AUTH_SOCK=${socatSocketPath}`);

  // The socat relay runs inside the container entrypoint to convert
  // TCP back to the Unix socket that SSH clients expect.
  // Guard: if socat is not available, print a clear error instead of failing silently.
  const entrypointPrefix =
    `command -v socat >/dev/null 2>&1 || { echo "ERROR: socat not found — SSH agent relay requires socat in the sandbox image" >&2; }; ` +
    `socat UNIX-LISTEN:${socatSocketPath},fork TCP4:127.0.0.1:${tunnelPort} &`;

  // R7.9, R7.10, R7.11: Create idempotent cleanup function
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    // R7.9: Kill tunnel process
    try {
      tunnelProcess.kill('SIGTERM');
    } catch {
      // ignore — process may already be dead
    }
  };

  return { tunnelProcess, cleanup, entrypointPrefix };
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
        osReleaseContent.match(/^ID_LIKE=.*debian.*/m) || // Covers derivatives
        osReleaseContent.match(/^ID_LIKE=.*ubuntu.*/m) // Covers derivatives
      ) {
        // note here and below we use console.error for informational messages on stderr
        console.error(
          'INFO: Defaulting to use current user UID/GID for Debian/Ubuntu-based Linux.',
        );
        return true;
      }
    } catch (_err) {
      // Silently ignore if /etc/os-release is not found or unreadable.
      // The default (false) will be applied in this case.
      console.warn(
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

function entrypoint(workdir: string, cliArgs: string[]): string[] {
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

  ports().forEach((p) =>
    shellCmds.push(
      `socat TCP4-LISTEN:${p},bind=$(hostname -i),fork,reuseaddr TCP4:127.0.0.1:${p} 2> /dev/null &`,
    ),
  );

  const quotedCliArgs = cliArgs.slice(2).map((arg) => quote([arg]));
  const cliCmd =
    process.env.NODE_ENV === 'development'
      ? process.env.DEBUG
        ? 'npm run debug --'
        : 'npm rebuild && npm run start --'
      : process.env.DEBUG
        ? `node --inspect-brk=0.0.0.0:${process.env.DEBUG_PORT || '9229'} $(which llxprt)`
        : 'llxprt';

  const args = [...shellCmds, cliCmd, ...quotedCliArgs];
  return ['bash', '-c', args.join(' ')];
}

export async function start_sandbox(
  config: SandboxConfig,
  nodeArgs: string[] = [],
  cliConfig?: Config,
  cliArgs: string[] = [],
): Promise<number> {
  const normalizeExitCode = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): number => {
    if (typeof code === 'number') {
      return code;
    }

    // Best-effort conventional mappings for common termination signals.
    // Node restricts exit codes to 0-255.
    if (signal === 'SIGINT') {
      return 130;
    }
    if (signal === 'SIGTERM') {
      return 143;
    }

    return 1;
  };

  const patcher = new ConsolePatcher({
    debugMode: cliConfig?.getDebugMode() || !!process.env.DEBUG,
    stderr: true,
  });
  patcher.patch();

  try {
    if (config.command === 'sandbox-exec') {
      // disallow BUILD_SANDBOX
      if (process.env['BUILD_SANDBOX']) {
        throw new FatalSandboxError(
          'Cannot BUILD_SANDBOX when using macOS Seatbelt',
        );
      }

      const profile = (process.env.SEATBELT_PROFILE ??= 'permissive-open');
      let profileFile = fileURLToPath(
        new URL(`./sandbox-macos-${profile}.sb`, import.meta.url),
      );
      // if profile name is not recognized, then look for file under project settings directory
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
      // Log on STDERR so it doesn't clutter the output on STDOUT
      console.error(`using macos seatbelt (profile: ${profile}) ...`);
      // if DEBUG is set, convert to --inspect-brk in NODE_OPTIONS
      const nodeOptions = [
        ...(process.env.DEBUG ? ['--inspect-brk'] : []),
        ...nodeArgs,
      ].join(' ');

      const args = [
        '-D',
        `TARGET_DIR=${fs.realpathSync(process.cwd())}`,
        '-D',
        `TMP_DIR=${fs.realpathSync(os.tmpdir())}`,
        '-D',
        `HOME_DIR=${fs.realpathSync(os.homedir())}`,
        '-D',
        `CACHE_DIR=${fs.realpathSync(execSync(`getconf DARWIN_USER_CACHE_DIR`).toString().trim())}`,
      ];

      // Add included directories from the workspace context
      // Always add 5 INCLUDE_DIR parameters to ensure .sb files can reference them
      const MAX_INCLUDE_DIRS = 5;
      const targetDir = fs.realpathSync(cliConfig?.getTargetDir() || '');
      const includedDirs: string[] = [];

      if (cliConfig) {
        const workspaceContext = cliConfig.getWorkspaceContext();
        const directories = workspaceContext.getDirectories();

        // Filter out TARGET_DIR
        for (const dir of directories) {
          const realDir = fs.realpathSync(dir);
          if (realDir !== targetDir) {
            includedDirs.push(realDir);
          }
        }
      }

      for (let i = 0; i < MAX_INCLUDE_DIRS; i++) {
        let dirPath = '/dev/null'; // Default to a safe path that won't cause issues

        if (i < includedDirs.length) {
          dirPath = includedDirs[i];
        }

        args.push('-D', `INCLUDE_DIR_${i}=${dirPath}`);
      }

      const finalArgv = cliArgs;

      args.push(
        '-f',
        profileFile,
        'sh',
        '-c',
        [
          `SANDBOX=sandbox-exec`,
          `NODE_OPTIONS="${nodeOptions}"`,
          ...finalArgv.map((arg) => quote([arg])),
        ].join(' '),
      );
      // start and set up proxy if LLXPRT_SANDBOX_PROXY_COMMAND is set
      const proxyCommand = process.env.LLXPRT_SANDBOX_PROXY_COMMAND;
      let proxyProcess: ChildProcess | undefined = undefined;
      let sandboxProcess: ChildProcess | undefined = undefined;
      const sandboxEnv = {
        ...process.env,
      };
      Object.assign(sandboxEnv, getPassthroughEnvVars(process.env));

      if (proxyCommand) {
        const proxy =
          process.env.HTTPS_PROXY ||
          process.env.https_proxy ||
          process.env.HTTP_PROXY ||
          process.env.http_proxy ||
          'http://localhost:8877';
        sandboxEnv['HTTPS_PROXY'] = proxy;
        sandboxEnv['https_proxy'] = proxy; // lower-case can be required, e.g. for curl
        sandboxEnv['HTTP_PROXY'] = proxy;
        sandboxEnv['http_proxy'] = proxy;
        const noProxy = process.env.NO_PROXY || process.env.no_proxy;
        if (noProxy) {
          sandboxEnv['NO_PROXY'] = noProxy;
          sandboxEnv['no_proxy'] = noProxy;
        }
        proxyProcess = spawn(proxyCommand, {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
          detached: true,
        });
        // install handlers to stop proxy on exit/signal
        const stopProxy = () => {
          console.log('stopping proxy ...');
          if (proxyProcess?.pid) {
            process.kill(-proxyProcess.pid, 'SIGTERM');
          }
        };
        process.on('exit', stopProxy);
        process.on('SIGINT', stopProxy);
        process.on('SIGTERM', stopProxy);

        // commented out as it disrupts ink rendering
        // proxyProcess.stdout?.on('data', (data) => {
        //   console.info(data.toString());
        // });
        proxyProcess.stderr?.on('data', (data) => {
          console.error(data.toString());
        });
        proxyProcess.on('close', (code, signal) => {
          if (sandboxProcess?.pid) {
            process.kill(-sandboxProcess.pid, 'SIGTERM');
          }
          throw new FatalSandboxError(
            `Proxy command '${proxyCommand}' exited with code ${code}, signal ${signal}`,
          );
        });
        console.log('waiting for proxy to start ...');
        await execAsync(
          `until timeout 0.25 curl -s http://localhost:8877; do sleep 0.25; done`,
        );
      }
      // Before attaching to an interactive sandbox, ensure the parent process is not
      // also consuming raw stdin. When running Ink locally and then hopping into the
      // sandbox, competing readers on the same TTY can manifest as dropped/duplicated
      // keypresses (e.g. "every other keypress").
      const stdinWasPaused = process.stdin.isPaused();
      const stdinHadRawMode =
        process.stdin.isTTY &&
        typeof process.stdin.isRaw === 'boolean' &&
        process.stdin.isRaw;

      if (process.stdin.isTTY) {
        try {
          // Issue #1020: Wrap setRawMode with error handling to prevent EIO crashes
          // Best-effort: restore cooked mode before handing the terminal to the sandbox.
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

      // spawn child and let it inherit stdio
      sandboxProcess = spawn(config.command, args, {
        stdio: 'inherit',
        env: sandboxEnv,
      });

      // Restore parent stdin mode/state after the sandbox exits.
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

        // Issue #1020: Wrap setRawMode with error handling to prevent EIO crashes
        // Do not force raw mode on if it was off when we entered.
        if (stdinHadRawMode) {
          try {
            process.stdin.setRawMode(true);
          } catch (err) {
            // Issue #1020: Log I/O errors but don't crash
            // This can happen after long-running sessions on macOS
            if (cliConfig?.getDebugMode()) {
              console.error('[sandbox] Failed to restore raw mode:', err);
            }
          }
        }
      });

      return await new Promise<number>((resolve) => {
        sandboxProcess?.on('close', (code, signal) => {
          resolve(normalizeExitCode(code, signal));
        });
      });
    }

    console.error(`hopping into sandbox (command: ${config.command}) ...`);

    // determine full path for gemini-cli to distinguish linked vs installed setting
    const gcPath = fs.realpathSync(process.argv[1]);

    const projectSandboxDockerfile = path.join(
      SETTINGS_DIRECTORY_NAME,
      'sandbox.Dockerfile',
    );
    const isCustomProjectSandbox = fs.existsSync(projectSandboxDockerfile);

    const image = config.image;
    const workdir = path.resolve(process.cwd());
    const containerWorkdir = getContainerPath(workdir);

    // if BUILD_SANDBOX is set, then call scripts/build_sandbox.js under gemini-cli repo
    //
    // note this can only be done with binary linked from gemini-cli repo
    if (process.env.BUILD_SANDBOX) {
      if (!gcPath.includes('gemini-cli/packages/')) {
        throw new FatalSandboxError(
          'Cannot build sandbox using installed gemini binary; ' +
            'run `npm link ./packages/cli` under gemini-cli repo to switch to linked binary.',
        );
      } else {
        console.error('building sandbox ...');
        const gcRoot = gcPath.split('/packages/')[0];
        const projectSandboxDockerfile = path.join(
          SETTINGS_DIRECTORY_NAME,
          'sandbox.Dockerfile',
        );
        if (isCustomProjectSandbox) {
          console.error(`using ${projectSandboxDockerfile} for sandbox`);
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
        execFileSync('node', ['scripts/build_sandbox.js', ...buildArgsArray], {
          cwd: gcRoot, // Safe: cwd option, not shell command
          stdio: 'inherit',
          env: {
            ...process.env,
            LLXPRT_SANDBOX: config.command, // in case sandbox is enabled via flags (see config.ts under cli package)
          },
        });
      }
    }

    // stop if image is missing
    if (!(await ensureSandboxImageIsPresent(config.command, image))) {
      const remedy =
        image === LOCAL_DEV_SANDBOX_IMAGE_NAME
          ? 'Try running `npm run build:all` or `npm run build:sandbox` under the gemini-cli repo to build it locally, or check the image name and your network connection.'
          : 'Please check the image name, your network connection, or visit https://github.com/vybestack/llxprt-code/discussions if the issue persists.';
      throw new FatalSandboxError(
        `Sandbox image '${image}' is missing or could not be pulled. ${remedy}`,
      );
    }

    // use interactive mode and auto-remove container on exit
    // run init binary inside container to forward signals & reap zombies
    const args = ['run', '-i', '--rm', '--init', '--workdir', containerWorkdir];

    // add custom flags from SANDBOX_FLAGS
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
      console.warn(
        'Sandbox network mode "proxied" is not implemented yet; falling back to default networking.',
      );
    }

    // Add a TTY if the parent process is interacting with a terminal.
    //
    // IMPORTANT: On macOS, process.stdin.isTTY/process.stdout.isTTY can be undefined when the
    // parent process is still effectively running in a terminal (depending on the PTY/wrapper
    // setup). Running podman/docker with -i but without -t can degrade interactive input
    // handling (e.g. dropped keypresses in Ink UIs).
    //
    // Heuristics (in order):
    // - If stdin/stdout explicitly report TTY => add -t.
    // - Else if TERM is set (typical interactive shells) => add -t.
    // - Else => do not force -t.
    const hasParentTty =
      process.stdin.isTTY === true || process.stdout.isTTY === true;

    // In CI we typically do not have a TTY. Passing `-t` causes docker to emit
    // "the input device is not a TTY" and fail the sandbox. Keep `-t` for real
    // interactive terminals only.
    if (hasParentTty) {
      args.push('-t');
    }

    // mount current directory as working directory in sandbox (set via --workdir)
    args.push('--volume', `${workdir}:${containerWorkdir}`);

    // mount user settings directory inside container, after creating if missing
    // note user/home changes inside sandbox and we mount at BOTH paths for consistency
    const userSettingsDirOnHost = USER_SETTINGS_DIR;
    const userSettingsDirInSandbox = getContainerPath(
      `/home/node/${SETTINGS_DIRECTORY_NAME}`,
    );
    if (!fs.existsSync(userSettingsDirOnHost)) {
      fs.mkdirSync(userSettingsDirOnHost);
    }
    args.push(
      '--volume',
      `${userSettingsDirOnHost}:${userSettingsDirInSandbox}`,
    );
    if (userSettingsDirInSandbox !== userSettingsDirOnHost) {
      args.push(
        '--volume',
        `${userSettingsDirOnHost}:${getContainerPath(userSettingsDirOnHost)}`,
      );
    }

    // Mount Git config files into container (read-only, dual-HOME pattern)
    mountGitConfigFiles(args, os.homedir(), '/home/node');

    // mount os.tmpdir() as os.tmpdir() inside container
    args.push('--volume', `${os.tmpdir()}:${getContainerPath(os.tmpdir())}`);

    // mount gcloud config directory if it exists
    const gcloudConfigDir = path.join(os.homedir(), '.config', 'gcloud');
    if (fs.existsSync(gcloudConfigDir)) {
      args.push(
        '--volume',
        `${gcloudConfigDir}:${getContainerPath(gcloudConfigDir)}:ro`,
      );
    }

    // mount ADC file if GOOGLE_APPLICATION_CREDENTIALS is set
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

    // mount paths listed in SANDBOX_MOUNTS / LLXPRT_SANDBOX_MOUNTS
    const mountsEnv =
      process.env.LLXPRT_SANDBOX_MOUNTS ?? process.env.SANDBOX_MOUNTS;
    const mountsEnvName = process.env.LLXPRT_SANDBOX_MOUNTS
      ? 'LLXPRT_SANDBOX_MOUNTS'
      : 'SANDBOX_MOUNTS';

    if (mountsEnv) {
      for (let mount of mountsEnv.split(',')) {
        if (mount.trim()) {
          // parse mount as from:to:opts
          let [from, to, opts] = mount.trim().split(':');
          to = to || from; // default to mount at same path inside container
          opts = opts || 'ro'; // default to read-only
          mount = `${from}:${to}:${opts}`;
          // check that from path is absolute
          if (!path.isAbsolute(from)) {
            throw new FatalSandboxError(
              `Path '${from}' listed in ${mountsEnvName} must be absolute`,
            );
          }
          // check that from path exists on host
          if (!fs.existsSync(from)) {
            throw new FatalSandboxError(
              `Missing mount path '${from}' listed in ${mountsEnvName}`,
            );
          }
          console.error(`${mountsEnvName}: ${from} -> ${to} (${opts})`);
          args.push('--volume', mount);
        }
      }
    }

    // Platform-aware SSH agent forwarding
    const sshResult = await setupSshAgentForwarding(config, args);

    // expose env-specified ports on the sandbox
    ports().forEach((p) => args.push('--publish', `${p}:${p}`));

    // if DEBUG is set, expose debugging port
    if (process.env.DEBUG) {
      const debugPort = process.env.DEBUG_PORT || '9229';
      args.push(`--publish`, `${debugPort}:${debugPort}`);
    }

    // copy proxy environment variables, replacing localhost with SANDBOX_PROXY_NAME
    // copy as both upper-case and lower-case as is required by some utilities
    // LLXPRT_SANDBOX_PROXY_COMMAND implies HTTPS_PROXY unless HTTP_PROXY is set
    const proxyCommand = process.env.LLXPRT_SANDBOX_PROXY_COMMAND;
    if (proxyCommand) {
      let proxy =
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        'http://localhost:8877';
      proxy = proxy.replace('localhost', SANDBOX_PROXY_NAME);
      if (proxy) {
        args.push('--env', `HTTPS_PROXY=${proxy}`);
        args.push('--env', `https_proxy=${proxy}`); // lower-case can be required, e.g. for curl
        args.push('--env', `HTTP_PROXY=${proxy}`);
        args.push('--env', `http_proxy=${proxy}`);
      }
      const noProxy = process.env.NO_PROXY || process.env.no_proxy;
      if (noProxy) {
        args.push('--env', `NO_PROXY=${noProxy}`);
        args.push('--env', `no_proxy=${noProxy}`);
      }

      // if using proxy, switch to internal networking through proxy
      if (proxy) {
        execSync(
          `${config.command} network inspect ${SANDBOX_NETWORK_NAME} || ${config.command} network create --internal ${SANDBOX_NETWORK_NAME}`,
        );
        args.push('--network', SANDBOX_NETWORK_NAME);
        // if proxy command is set, create a separate network w/ host access (i.e. non-internal)
        // we will run proxy in its own container connected to both host network and internal network
        // this allows proxy to work even on rootless podman on macos with host<->vm<->container isolation
        if (proxyCommand) {
          execSync(
            `${config.command} network inspect ${SANDBOX_PROXY_NAME} || ${config.command} network create ${SANDBOX_PROXY_NAME}`,
          );
        }
      }
    }

    // name container after image, plus numeric suffix to avoid conflicts
    const imageName = parseImageName(image);
    let index = 0;
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

    // copy GEMINI_API_KEY(s)
    if (process.env.GEMINI_API_KEY) {
      args.push('--env', `GEMINI_API_KEY=${process.env.GEMINI_API_KEY}`);
    }
    if (process.env.GOOGLE_API_KEY) {
      args.push('--env', `GOOGLE_API_KEY=${process.env.GOOGLE_API_KEY}`);
    }

    // copy GOOGLE_GENAI_USE_VERTEXAI
    if (process.env.GOOGLE_GENAI_USE_VERTEXAI) {
      args.push(
        '--env',
        `GOOGLE_GENAI_USE_VERTEXAI=${process.env.GOOGLE_GENAI_USE_VERTEXAI}`,
      );
    }

    // copy GOOGLE_GENAI_USE_GCA
    if (process.env.GOOGLE_GENAI_USE_GCA) {
      args.push(
        '--env',
        `GOOGLE_GENAI_USE_GCA=${process.env.GOOGLE_GENAI_USE_GCA}`,
      );
    }

    // copy GOOGLE_CLOUD_PROJECT
    if (process.env.GOOGLE_CLOUD_PROJECT) {
      args.push(
        '--env',
        `GOOGLE_CLOUD_PROJECT=${process.env.GOOGLE_CLOUD_PROJECT}`,
      );
    }

    // copy GOOGLE_CLOUD_LOCATION
    if (process.env.GOOGLE_CLOUD_LOCATION) {
      args.push(
        '--env',
        `GOOGLE_CLOUD_LOCATION=${process.env.GOOGLE_CLOUD_LOCATION}`,
      );
    }

    // copy GEMINI_MODEL
    if (process.env.GEMINI_MODEL) {
      args.push('--env', `GEMINI_MODEL=${process.env.GEMINI_MODEL}`);
    }

    // copy TERM and COLORTERM to try to maintain terminal setup
    if (process.env.TERM) {
      args.push('--env', `TERM=${process.env.TERM}`);
    }
    if (process.env.COLORTERM) {
      args.push('--env', `COLORTERM=${process.env.COLORTERM}`);
    }

    // Pass through curated CLI environment variables.
    args.push(...buildSandboxEnvArgs(process.env));

    // Enable Git to discover repositories across container filesystem boundaries
    args.push('--env', 'GIT_DISCOVERY_ACROSS_FILESYSTEM=1');

    // copy VIRTUAL_ENV if under working directory
    // also mount-replace VIRTUAL_ENV directory with <project_settings>/sandbox.venv
    // sandbox can then set up this new VIRTUAL_ENV directory using sandbox.bashrc (see below)
    // directory will be empty if not set up, which is still preferable to having host binaries
    if (
      process.env.VIRTUAL_ENV?.toLowerCase().startsWith(workdir.toLowerCase())
    ) {
      const sandboxVenvPath = path.resolve(
        SETTINGS_DIRECTORY_NAME,
        'sandbox.venv',
      );
      if (!fs.existsSync(sandboxVenvPath)) {
        fs.mkdirSync(sandboxVenvPath, { recursive: true });
      }
      args.push(
        '--volume',
        `${sandboxVenvPath}:${getContainerPath(process.env.VIRTUAL_ENV)}`,
      );
      args.push(
        '--env',
        `VIRTUAL_ENV=${getContainerPath(process.env.VIRTUAL_ENV)}`,
      );
    }

    // copy additional environment variables from SANDBOX_ENV
    if (process.env.SANDBOX_ENV) {
      for (let env of process.env.SANDBOX_ENV.split(',')) {
        if ((env = env.trim())) {
          if (env.includes('=')) {
            console.error(`SANDBOX_ENV: ${env}`);
            args.push('--env', env);
          } else {
            throw new FatalSandboxError(
              'SANDBOX_ENV must be a comma-separated list of key=value pairs',
            );
          }
        }
      }
    }

    // copy NODE_OPTIONS
    const existingNodeOptions = process.env.NODE_OPTIONS || '';
    const allNodeOptions = [
      ...(existingNodeOptions ? [existingNodeOptions] : []),
      ...nodeArgs,
    ].join(' ');

    if (allNodeOptions.length > 0) {
      args.push('--env', `NODE_OPTIONS="${allNodeOptions}"`);
    }

    // set SANDBOX as container name
    args.push('--env', `SANDBOX=${containerName}`);

    // for podman only, use empty --authfile to skip unnecessary auth refresh overhead
    if (config.command === 'podman') {
      const emptyAuthFilePath = path.join(os.tmpdir(), 'empty_auth.json');
      fs.writeFileSync(emptyAuthFilePath, '{}', 'utf-8');
      args.push('--authfile', emptyAuthFilePath);
    }

    // Determine if the current user's UID/GID should be passed to the sandbox.
    // See shouldUseCurrentUserInSandbox for more details.
    let userFlag = '';
    const finalEntrypoint = entrypoint(workdir, cliArgs);

    // If SSH agent forwarding provided an entrypoint prefix (e.g. socat relay
    // for Podman macOS TCP tunnel), prepend it to the shell command.
    if (sshResult.entrypointPrefix) {
      finalEntrypoint[2] =
        sshResult.entrypointPrefix + ' ' + finalEntrypoint[2];
    }

    if (process.env.LLXPRT_CODE_INTEGRATION_TEST === 'true') {
      args.push('--user', 'root');
      userFlag = '--user root';
    } else if (await shouldUseCurrentUserInSandbox()) {
      // For the user-creation logic to work, the container must start as root.
      // The entrypoint script then handles dropping privileges to the correct user.
      args.push('--user', 'root');

      const uid = execSync('id -u').toString().trim();
      const gid = execSync('id -g').toString().trim();

      // Instead of passing --user to the main sandbox container, we let it
      // start as root, then create a user with the host's UID/GID, and
      // finally switch to that user to run the gemini process. This is
      // necessary on Linux to ensure the user exists within the
      // container's /etc/passwd file, which is required by os.userInfo().
      const username = 'gemini';
      const homeDir = getContainerPath(os.homedir());

      const setupUserCommands = [
        // Use -f with groupadd to avoid errors if the group already exists.
        `groupadd -f -g ${gid} ${username}`,
        // Create user only if it doesn't exist. Use -o for non-unique UID.
        `id -u ${username} &>/dev/null || useradd -o -u ${uid} -g ${gid} -d ${homeDir} -s /bin/bash ${username}`,
      ].join(' && ');

      const originalCommand = finalEntrypoint[2];
      const escapedOriginalCommand = originalCommand.replace(/'/g, "'\\''");

      // Use `su -p` to preserve the environment.
      const suCommand = `su -p ${username} -c '${escapedOriginalCommand}'`;

      // The entrypoint is always `['bash', '-c', '<command>']`, so we modify the command part.
      finalEntrypoint[2] = `${setupUserCommands} && ${suCommand}`;

      // We still need userFlag for the simpler proxy container, which does not have this issue.
      userFlag = `--user ${uid}:${gid}`;
      // When forcing a UID in the sandbox, $HOME can be reset to '/', so we copy $HOME as well.
      args.push('--env', `HOME=${os.homedir()}`);
    }

    // push container image name
    args.push(image);

    // push container entrypoint (including args)
    args.push(...finalEntrypoint);

    // start and set up proxy if LLXPRT_SANDBOX_PROXY_COMMAND is set
    let proxyProcess: ChildProcess | undefined = undefined;
    let sandboxProcess: ChildProcess | undefined = undefined;

    if (proxyCommand) {
      // run proxyCommand in its own container
      const proxyContainerCommand = `${config.command} run --rm --init ${userFlag} --name ${SANDBOX_PROXY_NAME} --network ${SANDBOX_PROXY_NAME} -p 8877:8877 -v ${process.cwd()}:${workdir} --workdir ${workdir} ${image} ${proxyCommand}`;
      proxyProcess = spawn(proxyContainerCommand, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        detached: true,
      });
      // install handlers to stop proxy on exit/signal
      const stopProxy = () => {
        console.log('stopping proxy container ...');
        execSync(`${config.command} rm -f ${SANDBOX_PROXY_NAME}`);
      };
      process.on('exit', stopProxy);
      process.on('SIGINT', stopProxy);
      process.on('SIGTERM', stopProxy);

      // commented out as it disrupts ink rendering
      // proxyProcess.stdout?.on('data', (data) => {
      //   console.info(data.toString());
      // });
      proxyProcess.stderr?.on('data', (data) => {
        console.error(data.toString().trim());
      });
      proxyProcess.on('close', (code, signal) => {
        if (sandboxProcess?.pid) {
          process.kill(-sandboxProcess.pid, 'SIGTERM');
        }
        throw new FatalSandboxError(
          `Proxy container command '${proxyContainerCommand}' exited with code ${code}, signal ${signal}`,
        );
      });
      console.log('waiting for proxy to start ...');
      await execAsync(
        `until timeout 0.25 curl -s http://localhost:8877; do sleep 0.25; done`,
      );
      // connect proxy container to sandbox network
      // (workaround for older versions of docker that don't support multiple --network args)
      await execAsync(
        `${config.command} network connect ${SANDBOX_NETWORK_NAME} ${SANDBOX_PROXY_NAME}`,
      );
    }

    // Before attaching to an interactive sandbox, ensure the parent process is not
    // also consuming raw stdin. When running Ink locally and then hopping into the
    // sandbox, competing readers on the same TTY can manifest as dropped/duplicated
    // keypresses (e.g. "every other keypress").
    const stdinWasPaused = process.stdin.isPaused();
    const stdinHadRawMode =
      process.stdin.isTTY &&
      typeof process.stdin.isRaw === 'boolean' &&
      process.stdin.isRaw;

    if (process.stdin.isTTY) {
      try {
        // Issue #1020: Wrap setRawMode with error handling to prevent EIO crashes
        // Best-effort: restore cooked mode before handing the terminal to the sandbox.
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

    // spawn child and let it inherit stdio
    sandboxProcess = spawn(config.command, args, {
      stdio: 'inherit',
    });

    // Restore parent stdin mode/state after the sandbox exits.
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

      // Issue #1020: Wrap setRawMode with error handling to prevent EIO crashes
      // Do not force raw mode on if it was off when we entered.
      if (stdinHadRawMode) {
        try {
          process.stdin.setRawMode(true);
        } catch (err) {
          // Issue #1020: Log I/O errors but don't crash
          // This can happen after long-running sessions on macOS
          if (cliConfig?.getDebugMode()) {
            console.error('[sandbox] Failed to restore raw mode:', err);
          }
        }
      }
    });

    sandboxProcess.on('error', (err) => {
      console.error('Sandbox process error:', err);
    });

    // Wire SSH tunnel cleanup into sandbox lifecycle (R7.9, R7.10)
    if (sshResult.cleanup) {
      const stopTunnel = sshResult.cleanup;
      process.on('exit', stopTunnel);
      process.on('SIGINT', stopTunnel);
      process.on('SIGTERM', stopTunnel);
      sandboxProcess.on('close', stopTunnel);
    }

    return await new Promise<number>((resolve) => {
      sandboxProcess?.on('close', (code, signal) => {
        const exitCode = normalizeExitCode(code, signal);
        if (exitCode !== 0) {
          console.log(
            `Sandbox process exited with code: ${code}, signal: ${signal}`,
          );
        }
        resolve(exitCode);
      });
    });
  } catch (error) {
    console.error('Sandbox error:', error);
    throw error;
  } finally {
    patcher.cleanup();
  }
}

// Helper functions to ensure sandbox image is present
async function imageExists(sandbox: string, image: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ['images', '-q', image];
    const checkProcess = spawn(sandbox, args);

    let stdoutData = '';
    if (checkProcess.stdout) {
      checkProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });
    }

    checkProcess.on('error', (err) => {
      console.warn(
        `Failed to start '${sandbox}' command for image check: ${err.message}`,
      );
      resolve(false);
    });

    checkProcess.on('close', (code) => {
      // Non-zero code might indicate docker daemon not running, etc.
      // The primary success indicator is non-empty stdoutData.
      if (code !== 0) {
        // console.warn(`'${sandbox} images -q ${image}' exited with code ${code}.`);
      }
      resolve(stdoutData.trim() !== '');
    });
  });
}

async function pullImage(sandbox: string, image: string): Promise<boolean> {
  console.info(`Attempting to pull image ${image} using ${sandbox}...`);
  return new Promise((resolve) => {
    const args = ['pull', image];
    const pullProcess = spawn(sandbox, args, { stdio: 'pipe' });

    let stderrData = '';

    const onStdoutData = (data: Buffer) => {
      console.info(data.toString().trim()); // Show pull progress
    };

    const onStderrData = (data: Buffer) => {
      stderrData += data.toString();
      console.error(data.toString().trim()); // Show pull errors/info from the command itself
    };

    const onError = (err: Error) => {
      console.warn(
        `Failed to start '${sandbox} pull ${image}' command: ${err.message}`,
      );
      cleanup();
      resolve(false);
    };

    const onClose = (code: number | null) => {
      if (code === 0) {
        console.info(`Successfully pulled image ${image}.`);
        cleanup();
        resolve(true);
      } else {
        console.warn(
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
      if (pullProcess.stdout) {
        pullProcess.stdout.removeListener('data', onStdoutData);
      }
      if (pullProcess.stderr) {
        pullProcess.stderr.removeListener('data', onStderrData);
      }
      pullProcess.removeListener('error', onError);
      pullProcess.removeListener('close', onClose);
      if (pullProcess.connected) {
        pullProcess.disconnect();
      }
    };

    if (pullProcess.stdout) {
      pullProcess.stdout.on('data', onStdoutData);
    }
    if (pullProcess.stderr) {
      pullProcess.stderr.on('data', onStderrData);
    }
    pullProcess.on('error', onError);
    pullProcess.on('close', onClose);
  });
}

async function ensureSandboxImageIsPresent(
  sandbox: string,
  image: string,
): Promise<boolean> {
  console.info(`Checking for sandbox image: ${image}`);
  if (await imageExists(sandbox, image)) {
    console.info(`Sandbox image ${image} found locally.`);
    return true;
  }

  console.info(`Sandbox image ${image} not found locally.`);
  if (image === LOCAL_DEV_SANDBOX_IMAGE_NAME) {
    // user needs to build the image themselves
    return false;
  }

  if (await pullImage(sandbox, image)) {
    // After attempting to pull, check again to be certain
    if (await imageExists(sandbox, image)) {
      console.info(`Sandbox image ${image} is now available after pulling.`);
      return true;
    } else {
      console.warn(
        `Sandbox image ${image} still not found after a pull attempt. This might indicate an issue with the image name or registry, or the pull command reported success but failed to make the image available.`,
      );
      return false;
    }
  }

  console.error(
    `Failed to obtain sandbox image ${image} after check and pull attempt.`,
  );
  return false; // Pull command failed or image still not present
}
