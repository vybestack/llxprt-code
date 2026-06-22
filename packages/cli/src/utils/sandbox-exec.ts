/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Config, SandboxConfig } from '@vybestack/llxprt-code-core';
import { FatalSandboxError, debugLogger } from '@vybestack/llxprt-code-core';
import type {
  PortForwardingResult,
  CredentialProxyBridgeResult,
  SshAgentResult,
} from './sandbox-ssh.js';
import type { ContainerSandboxPrepared } from './sandbox-containers.js';
import {
  buildContainerRunArgs,
  addContainerVolumeMounts,
  addContainerEnvVars,
  setupContainerNetworking,
  assignContainerName,
  setupContainerUser,
  setupCredentialProxy,
  startProxyContainer,
  wireProxyContainerCloseHandler,
  wireCleanupHandlers,
  handleStdinForSandbox,
  restoreStdinAfterSandbox,
  LOCAL_DEV_SANDBOX_IMAGE_NAME,
} from './sandbox-containers.js';
import { entrypoint } from './sandbox-entrypoint.js';
import { ensureSandboxImageIsPresent } from './sandbox-image.js';
import {
  setupSshAgentForwarding,
  SSH_TUNNEL_POLL_TIMEOUT_MS,
} from './sandbox-ssh.js';
import { setupPortForwardingPodmanMacOS } from './sandbox-podman.js';
import { normalizeExitCode } from './sandbox-seatbelt.js';
import {
  getContainerPath,
  isSandboxDebugModeEnabled,
  resolveDebugPort,
  sandboxPorts,
} from './sandbox-env.js';
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';

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

  if (process.env.BUILD_SANDBOX !== undefined) {
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
  if (sshResult.entrypointPrefix !== undefined) {
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

  const proxyContainerProcess =
    proxyCommand !== undefined
      ? await startProxyContainer(
          config,
          proxyCommand,
          userFlag,
          image,
          workdir,
        )
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
export async function runContainerSandbox(
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
  const normalizedGcPath = gcPath.split(/[\\/]/).join('/');
  if (!normalizedGcPath.includes('gemini-cli/packages/')) {
    throw new FatalSandboxError(
      'Cannot build sandbox using installed gemini binary; ' +
        'run `npm link ./packages/cli` under gemini-cli repo to switch to linked binary.',
    );
  }
  debugLogger.error('building sandbox ...');
  const gcRoot = normalizedGcPath.split('/packages/')[0];
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

  const portsToForwardSet = new Set<string>(sandboxPorts());
  if (isSandboxDebugModeEnabled(process.env.DEBUG)) {
    portsToForwardSet.add(resolveDebugPort());
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
    if (result.cleanup !== undefined) {
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
