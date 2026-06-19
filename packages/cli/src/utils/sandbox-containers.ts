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
import { FatalSandboxError, debugLogger } from '@vybestack/llxprt-code-core';
import type {
  PortForwardingResult,
  CredentialProxyBridgeResult,
  SshAgentResult,
} from './sandbox-ssh.js';
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
} from '@vybestack/llxprt-code-providers/auth.js';

const execAsync = promisify(exec);

export interface ProxyContainerHandle {
  process: ChildProcess;
  command: string;
}

export interface ContainerSandboxPrepared {
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

const LOCAL_DEV_SANDBOX_IMAGE_NAME = 'llxprt-code-sandbox';
const SANDBOX_NETWORK_NAME = 'llxprt-code-sandbox';
const SANDBOX_PROXY_NAME = 'llxprt-code-sandbox-proxy';

export { LOCAL_DEV_SANDBOX_IMAGE_NAME };

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

/** Builds docker/podman run args for resource limits, flags, TTY, and volumes. */
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
  if (isNonEmptyEnvValue(resourceCpus)) {
    args.push('--cpus', resourceCpus);
  }
  const resourceMemory =
    process.env.LLXPRT_SANDBOX_MEMORY ?? process.env.SANDBOX_MEMORY;
  if (isNonEmptyEnvValue(resourceMemory)) {
    args.push('--memory', resourceMemory);
  }
  const resourcePids =
    process.env.LLXPRT_SANDBOX_PIDS ?? process.env.SANDBOX_PIDS;
  if (isNonEmptyEnvValue(resourcePids)) {
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
    let proxy = resolveProxyUrl();
    proxy = proxy.replace('localhost', SANDBOX_PROXY_NAME);
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
  if (socketPath === undefined) {
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
            reserveTunnelPort: (port: number) => {
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

    if (credentialProxyBridgeResult !== undefined) {
      credentialProxyBridgeCleanup = credentialProxyBridgeResult.cleanup;
      if (credentialProxyBridgeResult.entrypointPrefix !== undefined) {
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
export async function startProxyContainer(
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
  const proxyProcess = spawn(proxyContainerCommand, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: true,
  });

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
  await execAsync(
    `until timeout 0.25 curl -s http://localhost:8877; do sleep 0.25; done`,
  );
  await execAsync(
    `${config.command} network connect ${SANDBOX_NETWORK_NAME} ${SANDBOX_PROXY_NAME}`,
  );
  return { process: proxyProcess, command: proxyContainerCommand };
}

export function wireProxyContainerCloseHandler(
  proxyContainer: ProxyContainerHandle | undefined,
  sandboxProcess: ChildProcess,
): void {
  if (proxyContainer === undefined) {
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
export function wireCleanupHandlers(
  sandboxProcess: ChildProcess,
  _cliConfig: Config | undefined,
  sshResult: SshAgentResult,
  portForwardingResult: PortForwardingResult | undefined,
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined,
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

  if (credentialProxyBridgeResult?.cleanup !== undefined) {
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
