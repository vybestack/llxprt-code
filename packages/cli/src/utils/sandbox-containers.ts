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
import {
  USER_SETTINGS_DIR,
  SETTINGS_DIRECTORY_NAME,
} from '../config/settings.js';
import {
  getContainerPath,
  mountGitConfigFiles,
  buildSandboxEnvArgs,
  isSandboxDebugModeEnabled,
  shouldAllocateSandboxTty,
  shouldUseCurrentUserInSandbox,
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
  credentialProxyBridgeCleanup: (() => void) | undefined;
  reservedTunnelPorts: Set<number>;
  sshResult: SshAgentResult;
}

const LOCAL_DEV_SANDBOX_IMAGE_NAME = 'llxprt-code-sandbox';
const SANDBOX_NETWORK_NAME = 'llxprt-code-sandbox';
const SANDBOX_PROXY_NAME = 'llxprt-code-sandbox-proxy';

export { LOCAL_DEV_SANDBOX_IMAGE_NAME };

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

/** Adds custom SANDBOX_MOUNTS volume flags. */
function addCustomMounts(
  args: string[],
  mountsEnv: string,
  mountsEnvName: string,
): void {
  for (let mount of mountsEnv.split(',')) {
    const trimmed = mount.trim();
    if (trimmed !== '') {
      const parts = trimmed.split(':');
      const from = parts.at(0) ?? '';
      const target = parts.at(1);
      const options = parts.at(2);
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

function addSandboxEnvVars(args: string[]): void {
  for (const raw of process.env.SANDBOX_ENV!.split(',')) {
    const env = raw.trim();
    if (env !== '') {
      if (env.includes('=')) {
        const eqIdx = env.indexOf('=');
        const envName = env.substring(0, eqIdx);
        debugLogger.log(`SANDBOX_ENV: ${envName}=<redacted>`);
        args.push('--env', env);
      } else {
        throw new FatalSandboxError(
          'SANDBOX_ENV must be a comma-separated list of key=value pairs',
        );
      }
    }
  }
}

/** Adds gcloud, ADC, and custom SANDBOX_MOUNTS volume flags. */
export function addContainerVolumeMounts(args: string[]): void {
  const gcloudConfigDir = path.join(os.homedir(), '.config', 'gcloud');
  if (fs.existsSync(gcloudConfigDir)) {
    args.push(
      '--volume',
      `${gcloudConfigDir}:${getContainerPath(gcloudConfigDir)}:ro`,
    );
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS !== undefined) {
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
  const mountsEnvName =
    process.env.LLXPRT_SANDBOX_MOUNTS !== undefined
      ? 'LLXPRT_SANDBOX_MOUNTS'
      : 'SANDBOX_MOUNTS';
  if (mountsEnv !== undefined) {
    addCustomMounts(args, mountsEnv, mountsEnvName);
  }
}

/** Adds environment variable flags for API keys, term, proxy, etc. */
export function addContainerEnvVars(
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
  return containerName;
}

/** Configures user/UID for the container and modifies entrypoint if needed. */
export async function setupContainerUser(
  args: string[],
  finalEntrypoint: string[],
): Promise<string> {
  let userFlag = '';

  if (process.env.LLXPRT_CODE_INTEGRATION_TEST === 'true') {
    args.push('--user', 'root');
    userFlag = '--user root';
  } else if (await shouldUseCurrentUserInSandbox()) {
    args.push('--user', 'root');
    const uid = execSync('id -u').toString().trim();
    const gid = execSync('id -g').toString().trim();

    const username = 'gemini';
    const homeDir = getContainerPath(os.homedir());
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
    args.push('--env', `HOME=${os.homedir()}`);
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

export async function setupCredentialProxy(
  args: string[],
  config: SandboxConfig,
  resolvedTmpdir: string,
  reservedTunnelPorts: Set<number>,
  entrypointPrefixes: string[],
): Promise<{
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  credentialProxyBridgeCleanup: (() => void) | undefined;
}> {
  assertSupportedCredentialNetwork(config);

  let credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  let credentialProxyBridgeCleanup: (() => void) | undefined;
  let envFileCleanup: (() => void) | undefined;

  // @plan:PLAN-20250214-CREDPROXY.P34 R25.1: Start credential proxy BEFORE spawning container
  try {
    await createAndStartProxy({ socketPath: resolvedTmpdir });
  } catch (err) {
    throw new FatalSandboxError(
      `Failed to start credential proxy: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const socketPath = getProxySocketPath();
  if (socketPath === undefined) {
    throw await failOnMissingSocketPath();
  }

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
    }
  } catch (err) {
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

  // Compose env-file cleanup with bridge cleanup.
  return {
    credentialProxyBridgeResult,
    credentialProxyBridgeCleanup: composeCleanups(
      credentialProxyBridgeCleanup,
      envFileCleanup,
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
  credentialProxyBridgeCleanup: (() => void) | undefined,
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
