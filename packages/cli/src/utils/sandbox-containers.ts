/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn, exec, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { parse } from 'shell-quote';
import type { Config, SandboxConfig } from '@vybestack/llxprt-code-core';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type {
  PortForwardingResult,
  CredentialProxyBridgeResult,
  SshAgentResult,
} from './sandbox-ssh.js';
import {
  createHostOnlyCapabilityEnvFile,
  runCapabilityCleanupStep,
} from './sandbox-capability.js';
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';
import {
  getContainerPath,
  mountGitConfigFiles,
  buildSandboxEnvArgs,
  isSandboxDebugModeEnabled,
  shouldAllocateSandboxTty,
  shouldUseCurrentUserInSandbox,
  resolveSandboxContainerHome,
  parseImageName,
  sandboxPorts,
  resolveDebugPort,
} from './sandbox-env.js';
import {
  setupCredentialProxyDockerMacOS,
  SSH_TUNNEL_POLL_TIMEOUT_MS,
} from './sandbox-ssh.js';
import { setupCredentialProxyPodmanMacOS } from './sandbox-podman.js';
import {
  createAndStartProxy,
  stopProxy,
  getProxySocketPath,
  getProxyCapabilityToken,
} from '@vybestack/llxprt-code-providers/auth.js';
import { Storage } from '@vybestack/llxprt-code-storage';

const execAsync = promisify(exec);

export interface ProxyContainerHandle {
  process: ChildProcess;
  command: string;
}

export interface ContainerSandboxPrepared {
  args: string[];
  finalEntrypoint: string[];
  proxyCommand: string | undefined;
  userFlag: string;
  image: string;
  workdir: string;
  portForwardingResult: PortForwardingResult | undefined;
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  credentialProxyBridgeCleanup: CredentialProxyBridgeCleanup | undefined;
  reservedTunnelPorts: Set<number>;
  sshResult: SshAgentResult;
}

const LOCAL_DEV_SANDBOX_IMAGE_NAME = 'llxprt-code-sandbox';
const SANDBOX_NETWORK_NAME = 'llxprt-code-sandbox';
const SANDBOX_PROXY_NAME = 'llxprt-code-sandbox-proxy';

export { LOCAL_DEV_SANDBOX_IMAGE_NAME };

/**
 * Privilege-hardening flags applied to EVERY Docker/Podman sandbox container
 * run, including the proxy sidecar: drop every Linux capability and forbid
 * privilege escalation. Centralized here so no `run` argv can omit it. User
 * SANDBOX_FLAGS are still applied afterward (in buildContainerRunArgs), so a
 * user can add a specific capability back. See
 * project-plans/issue-2902-sandbox-privilege-hardening.md.
 */
const BASE_CONTAINER_HARDENING_FLAGS = [
  '--cap-drop=ALL',
  '--security-opt',
  'no-new-privileges',
] as const;

/** Composes cleanup callbacks and surfaces failures after attempting both. */
function composeCleanups(
  a: (() => void) | undefined,
  b: (() => void) | undefined,
): (() => void) | undefined {
  if (a === undefined && b === undefined) return undefined;
  return () => {
    const errors: unknown[] = [];
    runCapabilityCleanupStep(() => a?.(), errors);
    runCapabilityCleanupStep(() => b?.(), errors);
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Credential proxy cleanup failed');
    }
  };
}

/** Rewrites the loopback hostname of a proxy URL to the sandbox proxy name. */
function rewriteProxyHostname(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]'
    ) {
      parsed.hostname = SANDBOX_PROXY_NAME;
      return parsed.toString();
    }
    return proxyUrl;
  } catch {
    return proxyUrl;
  }
}

function resolveProxyUrl(): string {
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
  ];
  return (
    candidates.find((v): v is string => v !== undefined && v !== '') ??
    'http://localhost:8877'
  );
}

function isNonEmptyEnvValue(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/** Builds docker/podman run args. */
export function buildContainerRunArgs(
  config: SandboxConfig,
  image: string,
  workdir: string,
  containerWorkdir: string,
  resolvedTmpdir: string,
): string[] {
  const args = ['run', '-i', '--rm', '--init', '--workdir', containerWorkdir];
  // Privilege hardening defaults: applied before SANDBOX_FLAGS so a user can
  // still add specific capabilities back via SANDBOX_FLAGS. See
  // project-plans/issue-2902-sandbox-privilege-hardening.md.
  args.push(...BASE_CONTAINER_HARDENING_FLAGS);
  if (process.env.SANDBOX_FLAGS) {
    const flags = parse(process.env.SANDBOX_FLAGS, process.env).filter(
      (f): f is string => typeof f === 'string',
    );
    args.push(...flags);
  }
  const resourceCpus =
    process.env.LLXPRT_SANDBOX_CPUS ?? process.env.SANDBOX_CPUS;
  if (isNonEmptyEnvValue(resourceCpus)) args.push('--cpus', resourceCpus);
  const resourceMemory =
    process.env.LLXPRT_SANDBOX_MEMORY ?? process.env.SANDBOX_MEMORY;
  if (isNonEmptyEnvValue(resourceMemory)) args.push('--memory', resourceMemory);
  const resourcePids =
    process.env.LLXPRT_SANDBOX_PIDS ?? process.env.SANDBOX_PIDS;
  if (isNonEmptyEnvValue(resourcePids)) args.push('--pids-limit', resourcePids);
  const networkMode =
    process.env.LLXPRT_SANDBOX_NETWORK ?? process.env.SANDBOX_NETWORK;
  if (networkMode === 'off') {
    args.push('--network', 'none');
  } else if (
    networkMode === 'proxied' &&
    !process.env.LLXPRT_SANDBOX_PROXY_COMMAND?.trim()
  ) {
    throw new FatalSandboxError(
      'Sandbox network mode "proxied" requires a non-empty LLXPRT_SANDBOX_PROXY_COMMAND.',
    );
  }
  if (shouldAllocateSandboxTty()) args.push('-t');
  args.push('--volume', `${workdir}:${containerWorkdir}`);
  // Issue #3081: mount the host config directory at path parity and pin
  // LLXPRT_CONFIG_HOME to the mount destination. The legacy dot-llxprt
  // destination under the container home was dropped: the in-container CLI
  // resolves its config through Storage, so nothing was mounted where it
  // looks and every sandboxed launch saw an empty config. Pinning
  // LLXPRT_CONFIG_HOME also short-circuits the in-container startup
  // migration. The host dir is resolved dynamically through Storage (not the
  // module-load-time constant) so the legacy-fallback path in cli.tsx that
  // sets LLXPRT_CONFIG_HOME at runtime is honoured by the mount too. The
  // startup lifecycle (cli.tsx) creates this directory long before any
  // sandbox launch, so no defensive mkdir is needed here. Data/cache/log
  // stay container-local (ephemeral); only the config directory crosses the
  // boundary — mounting the data directory would push raw OAuth/provider
  // credentials across the sandbox boundary (#2946). Their roots are pinned
  // from the real container HOME inside the entrypoint (sandbox-entrypoint.ts)
  // so they follow the image's default user home; they cannot be left unset
  // because resolveGlobalDataDir/CacheDir/LogDir fall back to
  // LLXPRT_CONFIG_HOME. The config mount needs the :z SELinux shared label
  // under podman (matching the SSH-agent socket mount in setupSshAgentLinux)
  // so a labelled container process can read/write it on SELinux hosts.
  const hostConfigDir = Storage.getGlobalConfigDir();
  const containerConfigDir = getContainerPath(hostConfigDir);
  const configMountLabel = config.command === 'podman' ? ':z' : '';
  args.push(
    '--volume',
    `${hostConfigDir}:${containerConfigDir}${configMountLabel}`,
  );
  args.push('--env', `LLXPRT_CONFIG_HOME=${containerConfigDir}`);
  const containerHome = resolveSandboxContainerHome();
  mountGitConfigFiles(args, os.homedir(), containerHome);
  args.push(
    '--volume',
    `${resolvedTmpdir}:${getContainerPath(resolvedTmpdir)}`,
  );
  return args;
}

export function parseCustomMount(
  spec: string,
): readonly [string, string?, string?] {
  const fromStart = /^[A-Za-z]:[\\/]/.test(spec) ? 2 : 0;
  const fromEnd = spec.indexOf(':', fromStart);
  if (fromEnd === -1) return [spec];

  const from = spec.slice(0, fromEnd);
  const remainder = spec.slice(fromEnd + 1);
  const mode = /:(ro|rw)$/.exec(remainder);
  if (mode !== null) {
    return [from, remainder.slice(0, -mode[0].length), mode[1]];
  }

  const targetStart = /^[A-Za-z]:[\\/]/.test(remainder) ? 2 : 0;
  const unsupportedMode = remainder.indexOf(':', targetStart);
  if (unsupportedMode !== -1) {
    throw new FatalSandboxError(
      `Unsupported mount mode '${remainder.slice(unsupportedMode + 1)}' in '${spec}'; expected 'ro' or 'rw'`,
    );
  }
  return [from, remainder];
}

/** Adds custom SANDBOX_MOUNTS volume flags. */
function addCustomMounts(
  args: string[],
  mountsEnv: string,
  mountsEnvName: string,
): void {
  for (let mount of mountsEnv.split(',')) {
    const trimmed = mount.trim();
    if (trimmed !== '') {
      const [from, target, options] = parseCustomMount(trimmed);
      const to = target !== undefined && target !== '' ? target : from;
      const opts = options !== undefined && options !== '' ? options : 'ro';
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

/**
 * Env var names that SANDBOX_ENV may not override because the sandbox
 * infrastructure pins them authoritatively. `LLXPRT_CONFIG_HOME` is pinned by
 * `buildContainerRunArgs` to point at the config bind mount; a SANDBOX_ENV
 * value would come later in the argv and win under docker/podman last-wins
 * semantics, silently detaching the in-container CLI from its mounted config.
 * The data/cache/log roots are exported unconditionally from the container
 * `$HOME` inside the entrypoint (#3081) so they follow the image's real home;
 * reserving them here ensures a SANDBOX_ENV entry cannot also emit a host-side
 * `--env` that would shadow the entrypoint export under last-wins semantics.
 */
const RESERVED_SANDBOX_ENV_KEYS = new Set([
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
]);

function parseSandboxEnvVars(): string[] {
  const entries: string[] = [];
  for (const raw of process.env.SANDBOX_ENV?.split(',') ?? []) {
    const env = raw.trim();
    if (env === '') {
      continue;
    }
    if (!env.includes('=')) {
      throw new FatalSandboxError(
        'SANDBOX_ENV must be a comma-separated list of key=value pairs',
      );
    }
    const envName = env.substring(0, env.indexOf('='));
    if (RESERVED_SANDBOX_ENV_KEYS.has(envName)) {
      throw new FatalSandboxError(
        `SANDBOX_ENV may not override reserved key '${envName}' (pinned by sandbox infrastructure)`,
      );
    }
    entries.push(env);
  }
  return entries;
}

/** Validates SANDBOX_ENV before sandbox image, network, or bridge side effects. */
export function validateContainerSandboxEnv(): void {
  parseSandboxEnvVars();
}

function addSandboxEnvVars(args: string[]): void {
  const entries = parseSandboxEnvVars();
  for (const env of entries) {
    const envName = env.substring(0, env.indexOf('='));
    debugLogger.log(`SANDBOX_ENV: ${envName}=<redacted>`);
    args.push('--env', env);
  }
}

/** Adds custom SANDBOX_MOUNTS volume flags. */
export function addContainerVolumeMounts(args: string[]): void {
  const mountsEnv =
    process.env.LLXPRT_SANDBOX_MOUNTS ?? process.env.SANDBOX_MOUNTS;
  const mountsEnvName =
    process.env.LLXPRT_SANDBOX_MOUNTS !== undefined
      ? 'LLXPRT_SANDBOX_MOUNTS'
      : 'SANDBOX_MOUNTS';
  if (mountsEnv !== undefined) {
    addCustomMounts(args, mountsEnv, mountsEnvName);
  }
}

/** Adds environment variable flags for non-secret config, term, proxy, etc. */
export function addContainerEnvVars(
  args: string[],
  config: SandboxConfig,
  containerName: string,
  nodeArgs: string[],
  workdir: string,
): void {
  const envMap: Record<string, string | undefined> = {
    GOOGLE_GENAI_USE_VERTEXAI: process.env.GOOGLE_GENAI_USE_VERTEXAI,
    GOOGLE_GENAI_USE_GCA: process.env.GOOGLE_GENAI_USE_GCA,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    TERM: process.env.TERM,
    COLORTERM: process.env.COLORTERM,
  };
  for (const [key, val] of Object.entries(envMap)) {
    if (val !== undefined) {
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

  if (process.env.SANDBOX_ENV !== undefined) {
    addSandboxEnvVars(args);
  }

  const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
  const allNodeOptions = [
    ...(existingNodeOptions !== '' ? [existingNodeOptions] : []),
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
export function setupContainerNetworking(
  args: string[],
  config: SandboxConfig,
  isPodmanMacOS: boolean,
): string | undefined {
  const proxyCommand = process.env.LLXPRT_SANDBOX_PROXY_COMMAND;
  if (isNonEmptyEnvValue(proxyCommand)) {
    const proxy = rewriteProxyHostname(resolveProxyUrl());
    args.push('--env', `HTTPS_PROXY=${proxy}`);
    args.push('--env', `https_proxy=${proxy}`);
    args.push('--env', `HTTP_PROXY=${proxy}`);
    args.push('--env', `http_proxy=${proxy}`);

    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
    if (noProxy !== undefined) {
      args.push('--env', `NO_PROXY=${noProxy}`);
      args.push('--env', `no_proxy=${noProxy}`);
    }
    execSync(
      `${config.command} network inspect ${SANDBOX_NETWORK_NAME} || ${config.command} network create --internal ${SANDBOX_NETWORK_NAME}`,
    );
    args.push('--network', SANDBOX_NETWORK_NAME);
    execSync(
      `${config.command} network inspect ${SANDBOX_PROXY_NAME} || ${config.command} network create ${SANDBOX_PROXY_NAME}`,
    );
  }

  if (!isPodmanMacOS) {
    for (const p of sandboxPorts()) {
      args.push('--publish', `${p}:${p}`);
    }
  }
  if (isSandboxDebugModeEnabled(process.env.DEBUG) && !isPodmanMacOS) {
    const debugPort = resolveDebugPort();
    args.push(`--publish`, `${debugPort}:${debugPort}`);
  }

  return proxyCommand;
}

/** Assigns a unique container name based on image name. */
export function assignContainerName(
  args: string[],
  config: SandboxConfig,
  image: string,
): string {
  const imageName = parseImageName(image);
  const containerNameCheck = execSync(
    `${config.command} ps -a --format "{{.Names}}"`,
  )
    .toString()
    .trim();
  // Concurrent sandbox launches (e.g. several agents started at once) all
  // observe the same `ps -a` snapshot and would race to the same indexed
  // name; the loser aborts with "name already in use by <container id>".
  // The PID discriminator makes each concurrent launch claim a distinct
  // name, while the suffix loop still skips names held by stale containers
  // left over from a previous process that reused the PID.
  let containerName = `${imageName}-${process.pid}`;
  let suffix = 0;
  // Exact-match lookup: a substring check would treat the existing
  // `sandbox-0.11.0-111` as occupying `sandbox-0.11.0-11` too.
  const containerNames = containerNameCheck.split('\n').filter(Boolean);
  const existingNames = new Set(containerNames);
  while (existingNames.has(containerName)) {
    containerName = `${imageName}-${process.pid}-${++suffix}`;
  }
  args.push('--name', containerName, '--hostname', containerName);
  return containerName;
}

/**
 * Minimum capabilities required on the current-user path, proven by
 * leave-one-out testing against the sandbox image: groupadd/useradd need CHOWN
 * to write /etc/gshadow and /etc/shadow, and SETUID/SETGID create the matching
 * UID/GID and let su drop to them. DAC_OVERRIDE and FOWNER are NOT required.
 * Removing any one of these three breaks groupadd/useradd or su. See
 * project-plans/issue-2902-sandbox-privilege-hardening.md. Do not add more.
 */
const CURRENT_USER_CAPABILITIES = ['CHOWN', 'SETUID', 'SETGID'] as const;

/** Configures user/UID for the container and modifies entrypoint if needed. */
export async function setupContainerUser(
  args: string[],
  finalEntrypoint: string[],
): Promise<string> {
  let userFlag = '';

  if (shouldUseCurrentUserInSandbox()) {
    // Root is required here: this branch runs groupadd/useradd to create the
    // host user inside the container, then su to drop to that user's uid/gid.
    // Creating the user and writing /etc/shadow needs the capabilities below;
    // su is then invoked as root (already uid 0), so no-new-privileges does
    // not block it.
    args.push('--user', 'root');
    for (const cap of CURRENT_USER_CAPABILITIES) {
      args.push(`--cap-add=${cap}`);
    }
    const uid = execSync('id -u').toString().trim();
    const gid = execSync('id -g').toString().trim();

    const username = 'gemini';
    // Use the shared container-home resolution so the HOME pinned here and the
    // LLXPRT_*_HOME roots set by buildContainerRunArgs agree (#3081).
    const homeDir = resolveSandboxContainerHome();
    const setupUserCommands = [
      `groupadd -f -g ${gid} ${username}`,
      `id -u ${username} &>/dev/null || useradd -o -u ${uid} -g ${gid} -d ${homeDir} -s /bin/bash ${username}`,
    ].join(' && ');

    // Current-user path (AC3): root captures token, opens fd 3, runs setup
    // with fd 3 closed, then su forwards fd 3 through a clean env.
    const scriptIdx = finalEntrypoint.length - 1;
    const escapedInnerScript = finalEntrypoint[scriptIdx].replace(
      /'/g,
      "'\\''",
    );
    finalEntrypoint[scriptIdx] = [
      '__llxprt_cap="${LLXPRT_CAPABILITY_TOKEN-}"',
      'unset LLXPRT_CAPABILITY_TOKEN',
      `{ ${setupUserCommands}; } 3<&-`,
      'if [ -n "${__llxprt_cap}" ]; then',
      '  exec 3<<<"${__llxprt_cap}"',
      '  unset __llxprt_cap',
      '  export LLXPRT_CAPABILITY_FD=3',
      `  exec su -p ${username} -c '${escapedInnerScript}'`,
      'else',
      '  unset __llxprt_cap LLXPRT_CAPABILITY_FD',
      `  exec su -p ${username} -c '${escapedInnerScript}'`,
      'fi',
    ].join('\n');
    userFlag = `--user ${uid}:${gid}`;
    args.push('--env', `HOME=${homeDir}`);
  }

  return userFlag;
}

/** Sets up the macOS credential proxy bridge based on container command. */
async function setupMacOSCredProxyBridge(
  args: string[],
  config: SandboxConfig,
  socketPath: string,
  reservedTunnelPorts: Set<number>,
): Promise<CredentialProxyBridgeResult | undefined> {
  switch (config.command) {
    case 'podman':
      return setupCredentialProxyPodmanMacOS(
        args,
        socketPath,
        SSH_TUNNEL_POLL_TIMEOUT_MS,
        {
          reserveTunnelPort: (port: number) => {
            reservedTunnelPorts.add(port);
          },
          excludedTunnelPorts: reservedTunnelPorts,
        },
      );
    case 'docker':
      return setupCredentialProxyDockerMacOS(args, socketPath);
    case 'sandbox-exec':
    default:
      return undefined;
  }
}

/** Starts credential proxy and sets up bridge for Podman/Docker macOS. */
async function failOnMissingSocketPath(): Promise<Error> {
  const invariantError = new FatalSandboxError(
    'Credential proxy started but did not produce a socket path',
  );
  const errors: unknown[] = [invariantError];
  try {
    await stopProxy();
  } catch (stopErr) {
    errors.push(stopErr);
  }
  return errors.length === 1
    ? invariantError
    : new AggregateError(errors, 'Credential proxy setup failed');
}

function assertSupportedCredentialNetwork(config: SandboxConfig): void {
  const networkMode =
    process.env.LLXPRT_SANDBOX_NETWORK ?? process.env.SANDBOX_NETWORK;
  if (
    os.platform() === 'darwin' &&
    (config.command === 'docker' || config.command === 'podman') &&
    networkMode === 'off'
  ) {
    throw new FatalSandboxError(
      'macOS credential bridge requires container networking; enable networking or use Linux for network-off sandboxing.',
    );
  }
}

/**
 * Milliseconds after the sandbox process spawns that the capability env
 * file is deleted even when no sandbox handshake ever arrives (#3524). A
 * sandbox that never requests credentials never handshakes; without this
 * bound its env file would live until session exit — exactly the path that
 * does not run under SIGKILL, `tmux kill-session`, an OOM kill or a crash.
 * The bound errs long on purpose: deleting late only widens the window in
 * which the token is exposed, while deleting early breaks the launch,
 * because a remote or VM-backed runtime may not have read --env-file yet.
 * Ten minutes is ~20x the proxy-sidecar readiness budget and still bounds
 * exposure far below a session's lifetime.
 */
const CAPABILITY_ENV_FILE_FALLBACK_MS = 10 * 60 * 1000;

/**
 * #3524: the credential proxy, its socket, and its capability token are
 * process-wide, so a sandbox handshake carries no launch identity. At most
 * one launch may hold a live capability env file: a second launch's
 * handshake would be attributed to the first launch's release holder and
 * could delete the wrong launch's env file mid-launch.
 */
let capabilityEnvFileLaunchActive = false;

/**
 * Claims the single active capability env-file launch slot or throws. The
 * claim is a synchronous check-and-set, so of two concurrent callers only
 * one can hold it; the other fails before creating a bridge or env file
 * whose handshake could be attributed to the wrong launch.
 */
function claimCapabilityEnvFileLaunch(): void {
  if (capabilityEnvFileLaunchActive) {
    throw new FatalSandboxError(
      'Concurrent sandbox launches in one process are not supported by the capability transport: the credential proxy, its socket, and its capability token are process-wide, so a sandbox handshake cannot be attributed to a specific launch and could delete the env file of the wrong launch. Run the active launch cleanup before starting another sandbox.',
    );
  }
  capabilityEnvFileLaunchActive = true;
}

/**
 * Bridge cleanup returned by setupCredentialProxy. When a capability env
 * file exists the cleanup also carries armCapabilityEnvFileFallback so the
 * post-spawn wiring (wireCleanupHandlers) can start the no-handshake
 * release countdown without widening every launch-path signature (#3524).
 */
export interface CredentialProxyBridgeCleanup {
  /** Runs the composed bridge and env-file cleanup (idempotent). */
  (): void;
  /** Starts the bounded no-handshake env-file release countdown. */
  armCapabilityEnvFileFallback?(): void;
}

/**
 * Mutable holder for the capability env-file cleanup (#3524). The proxy
 * handshake callback is registered before the env file exists, so it reads
 * the holder at fire time rather than capturing the cleanup eagerly.
 * Handshake, fallback expiry, and the composed exit cleanup all go through
 * release(), so every deletion path clears the holder and cancels the
 * fallback timer. Handshake delivery is at-least-once: the first release
 * runs the cleanup and clears the holder; every later one is a no-op.
 */
interface CapabilityEnvFileRelease {
  release: () => void;
  adopt: (cleanup: () => void) => void;
  armFallback: () => void;
}

function createCapabilityEnvFileRelease(): CapabilityEnvFileRelease {
  let held: (() => void) | undefined;
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  const release = (): void => {
    const cleanup = held;
    if (cleanup === undefined) return;
    held = undefined;
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer);
      fallbackTimer = undefined;
    }
    cleanup();
  };
  return {
    release,
    adopt: (cleanup: () => void): void => {
      held = cleanup;
    },
    armFallback: (): void => {
      if (held === undefined || fallbackTimer !== undefined) return;
      fallbackTimer = setTimeout(release, CAPABILITY_ENV_FILE_FALLBACK_MS);
      // Unref so the fallback can never hold the process open.
      fallbackTimer.unref();
    },
  };
}

/**
 * Composes the bridge cleanup and the env-file release and, when an env
 * file exists, exposes armCapabilityEnvFileFallback on the result so
 * wireCleanupHandlers can start the no-handshake release countdown once the
 * sandbox process has spawned (#3524). The exit-time cleanup stays
 * registered as the backstop; early deletion only makes it a no-op. The
 * env-file leg is release() itself — the same path the handshake and the
 * fallback take — so running the composed cleanup also cancels the armed
 * fallback timer and ends the single-active-launch claim.
 */
function composeArmableBridgeCleanup(
  bridgeCleanup: (() => void) | undefined,
  envFileRelease: CapabilityEnvFileRelease,
): CredentialProxyBridgeCleanup {
  const launchTeardown = (): void => {
    capabilityEnvFileLaunchActive = false;
    // release is always a function, so the composed cleanup always exists;
    // the optional call only satisfies composeCleanups' union return type.
    composeCleanups(bridgeCleanup, envFileRelease.release)?.();
  };
  return Object.assign(launchTeardown, {
    armCapabilityEnvFileFallback: envFileRelease.armFallback,
  });
}

export async function setupCredentialProxy(
  args: string[],
  config: SandboxConfig,
  resolvedTmpdir: string,
  reservedTunnelPorts: Set<number>,
  entrypointPrefixes: string[],
): Promise<{
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  credentialProxyBridgeCleanup: CredentialProxyBridgeCleanup | undefined;
}> {
  assertSupportedCredentialNetwork(config);

  let credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  let credentialProxyBridgeCleanup: (() => void) | undefined;
  let envFileCleanup: (() => void) | undefined;
  const envFileRelease = createCapabilityEnvFileRelease();

  // @plan:PLAN-20250214-CREDPROXY.P34 R25.1: Start credential proxy BEFORE spawning container
  try {
    await createAndStartProxy({
      socketPath: resolvedTmpdir,
      onSandboxHandshake: envFileRelease.release,
    });
  } catch (err) {
    throw new FatalSandboxError(
      `Failed to start credential proxy: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const socketPath = getProxySocketPath();
  if (socketPath === undefined) {
    throw await failOnMissingSocketPath();
  }

  // #3524: claim the single-launch slot before any bridge or env-file side
  // effects. Placed after the proxy-start failure paths above (which must
  // not release a claim they never took) and outside the setup try below,
  // so a losing concurrent launch aborts without tearing down the winning
  // launch's shared proxy through that catch's stopProxy().
  claimCapabilityEnvFileLaunch();

  // @plan:PLAN-20250214-CREDPROXY.P34 R3.6: Pass socket path to container via env var
  const isDarwin = os.platform() === 'darwin';
  try {
    if (isDarwin) {
      credentialProxyBridgeResult = await setupMacOSCredProxyBridge(
        args,
        config,
        socketPath,
        reservedTunnelPorts,
      );
    }
    const effectiveSocketPath =
      credentialProxyBridgeResult?.containerSocketPath ?? socketPath;
    args.push('--env', `LLXPRT_CREDENTIAL_SOCKET=${effectiveSocketPath}`);

    if (credentialProxyBridgeResult !== undefined && isDarwin) {
      credentialProxyBridgeCleanup = credentialProxyBridgeResult.cleanup;
      const prefix = credentialProxyBridgeResult.entrypointPrefix;
      if (prefix !== undefined) entrypointPrefixes.push(prefix);
    }
    // @plan project-plans/issue-1954-sandbox-hardening.md (AC1): host-only env file.
    const envFileResult = createHostOnlyCapabilityEnvFile(
      getProxyCapabilityToken(),
    );
    if (envFileResult !== undefined) {
      args.push(...envFileResult.args);
      envFileCleanup = envFileResult.cleanup;
      envFileRelease.adopt(envFileCleanup);
    }
  } catch (err) {
    capabilityEnvFileLaunchActive = false;
    const errors: unknown[] = [err];
    runCapabilityCleanupStep(() => envFileCleanup?.(), errors);
    runCapabilityCleanupStep(() => credentialProxyBridgeCleanup?.(), errors);
    try {
      await stopProxy();
    } catch (stopErr) {
      errors.push(stopErr);
    }
    throw errors.length === 1
      ? err
      : new AggregateError(errors, 'Credential proxy setup failed');
  }

  return {
    credentialProxyBridgeResult,
    credentialProxyBridgeCleanup: composeArmableBridgeCleanup(
      credentialProxyBridgeCleanup,
      envFileRelease,
    ),
  };
}

/** Spawns proxy container and waits for it to be ready. */
export async function startProxyContainer(
  config: SandboxConfig,
  proxyCommand: string,
  userFlag: string,
  image: string,
  workdir: string,
): Promise<ProxyContainerHandle> {
  const proxyContainerArgs = [
    'run',
    '--rm',
    '--init',
    ...BASE_CONTAINER_HARDENING_FLAGS,
    ...userFlag.split(' ').filter((f) => f.length > 0),
    '--name',
    SANDBOX_PROXY_NAME,
    '--network',
    SANDBOX_PROXY_NAME,
    '-p',
    '8877:8877',
    '-v',
    `${process.cwd()}:${workdir}`,
    '--workdir',
    workdir,
    image,
    'sh',
    '-lc',
    proxyCommand,
  ];
  const proxyProcess = spawn(config.command, proxyContainerArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const proxyContainerCommand = `${config.command} ${proxyContainerArgs.join(' ')}`;
  const stopProxyContainer = () => {
    debugLogger.log('stopping proxy container ...');
    execSync(`${config.command} rm -f ${SANDBOX_PROXY_NAME}`);
  };
  process.on('exit', stopProxyContainer);
  process.on('SIGINT', stopProxyContainer);
  process.on('SIGTERM', stopProxyContainer);
  proxyProcess.stderr.on('data', (data) => {
    debugLogger.error(data.toString().trim());
  });
  debugLogger.log('waiting for proxy to start ...');
  const PROXY_READY_TIMEOUT_MS = 30000;
  try {
    await execAsync(
      `timeout ${Math.floor(PROXY_READY_TIMEOUT_MS / 1000)} bash -c 'until curl -s http://localhost:8877; do sleep 0.25; done'`,
      { timeout: PROXY_READY_TIMEOUT_MS + 5000 },
    );
  } catch (err) {
    stopProxyContainer();
    throw new FatalSandboxError(
      `Proxy container failed to become ready within ${PROXY_READY_TIMEOUT_MS}ms: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  await execAsync(
    `${config.command} network connect ${SANDBOX_NETWORK_NAME} ${SANDBOX_PROXY_NAME}`,
  );
  return { process: proxyProcess, command: proxyContainerCommand };
}

export function wireProxyContainerCloseHandler(
  proxyContainer: ProxyContainerHandle | undefined,
  sandboxProcess: ChildProcess,
): void {
  if (proxyContainer === undefined) return;
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
export function wireCleanupHandlers(
  sandboxProcess: ChildProcess,
  _cliConfig: Config | undefined,
  sshResult: SshAgentResult,
  portForwardingResult: PortForwardingResult | undefined,
  credentialProxyBridgeCleanup: CredentialProxyBridgeCleanup | undefined,
  setCredentialProxyBridgeCleanup: (c: (() => void) | undefined) => void,
): void {
  sandboxProcess.on('error', (err) => {
    debugLogger.error('Sandbox process error:', err);
  });

  if (sshResult.cleanup !== undefined) {
    const stopTunnel = sshResult.cleanup;
    process.on('exit', stopTunnel);
    process.on('SIGINT', stopTunnel);
    process.on('SIGTERM', stopTunnel);
    sandboxProcess.on('close', stopTunnel);
  }

  if (portForwardingResult?.cleanup !== undefined) {
    sandboxProcess.on('close', portForwardingResult.cleanup);
  }

  if (credentialProxyBridgeCleanup !== undefined) {
    // #3524: wireCleanupHandlers runs immediately after the sandbox process
    // has spawned, so this is where the no-handshake fallback countdown
    // starts — before the spawn the runtime cannot have read --env-file.
    credentialProxyBridgeCleanup.armCapabilityEnvFileFallback?.();
    let bridgeCleanedUp = false;
    const runBridgeCleanup = (): void => {
      if (bridgeCleanedUp) return;
      // AC10: always set idempotency, detach listeners, and clear stored
      // cleanup in finally so no path can skip bookkeeping even when the
      // callback throws. The cleanup error re-throws after bookkeeping.
      try {
        credentialProxyBridgeCleanup();
      } finally {
        bridgeCleanedUp = true;
        process.off('exit', runBridgeCleanup);
        process.off('SIGINT', runBridgeCleanup);
        process.off('SIGTERM', runBridgeCleanup);
        sandboxProcess.off('close', runBridgeCleanup);
        setCredentialProxyBridgeCleanup(undefined);
      }
    };
    process.on('exit', runBridgeCleanup);
    process.on('SIGINT', runBridgeCleanup);
    process.on('SIGTERM', runBridgeCleanup);
    sandboxProcess.on('close', runBridgeCleanup);
  }

  // @plan:PLAN-20250214-CREDPROXY.P34 R25.2, R25.3: Clean up credential proxy on sandbox exit
  let proxyStopped = false;
  const stopCredentialProxy = (): void => {
    if (proxyStopped) return;
    proxyStopped = true;
    process.off('exit', stopCredentialProxy);
    process.off('SIGINT', stopCredentialProxy);
    process.off('SIGTERM', stopCredentialProxy);
    sandboxProcess.off('close', stopCredentialProxy);
    void stopProxy().catch((err) => {
      debugLogger.error('Credential proxy stop() failed during cleanup:', err);
    });
  };
  process.on('exit', stopCredentialProxy);
  process.on('SIGINT', stopCredentialProxy);
  process.on('SIGTERM', stopCredentialProxy);
  sandboxProcess.on('close', stopCredentialProxy);
}

/** Handles stdin pause/raw-mode before spawning, and restores after. */
export function handleStdinForSandbox(): {
  stdinWasPaused: boolean;
  stdinHadRawMode: boolean;
} {
  const stdinWasPaused = process.stdin.isPaused();
  const stdinHadRawMode =
    process.stdin.isTTY === true &&
    typeof process.stdin.isRaw === 'boolean' &&
    process.stdin.isRaw;
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    try {
      process.stdin.pause();
    } catch {
      /* ignore */
    }
  }
  return { stdinWasPaused, stdinHadRawMode };
}

/** Restores stdin state after sandbox exits. */
export function restoreStdinAfterSandbox(
  sandboxProcess: ChildProcess,
  stdinWasPaused: boolean,
  stdinHadRawMode: boolean,
  cliConfig?: Config,
): void {
  sandboxProcess.on('close', () => {
    if (process.stdin.isTTY === false) {
      return;
    }
    if (!stdinWasPaused) {
      try {
        process.stdin.resume();
      } catch {
        /* ignore */
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
