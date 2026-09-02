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
import {
  FatalSandboxError,
  getErrorMessage,
  isNodeError,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type { PortForwardingResult, SshAgentResult } from './sandbox-ssh.js';
import type { ContainerSandboxPrepared } from './sandbox-containers.js';
import { SandboxLaunchLifecycle } from './sandbox-lifecycle.js';
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
  validateContainerSandboxEnv,
  LOCAL_DEV_SANDBOX_IMAGE_NAME,
} from './sandbox-containers.js';
import { stopProxy } from '@vybestack/llxprt-code-providers/auth.js';
import { entrypoint } from './sandbox-entrypoint.js';
import { canonicalizeExistingPath } from './sandbox-path-canonicalization.js';
import {
  addPrivateDependencyMounts,
  planPrivateDependencyMounts,
  type DependencyMountPlan,
  type DependencyVolumeLifecycle,
} from './sandbox-node-modules.js';
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
import {
  addContainerWorkspaceMounts,
  planContainerWorkspaces,
  type ContainerWorkspacePlan,
} from './sandbox-workspaces.js';
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';
import { reapOrphanedSandboxResources } from './sandbox-orphan-recovery.js';

function removeSessionTmpdir(sessionTmpdir: string): void {
  fs.rmSync(sessionTmpdir, { recursive: true, force: true });
}

/** Validates image and builds initial container run args. */
async function prepareContainerImageAndArgs(
  config: SandboxConfig,
  workspacePlan: ContainerWorkspacePlan,
  dependencyMountPlan: DependencyMountPlan,
  lifecycle: SandboxLaunchLifecycle,
): Promise<{
  image: string;
  workdir: string;
  containerWorkdir: string;
  sessionTmpdir: string;
  args: string[];
  dependencyVolumeLifecycle: DependencyVolumeLifecycle;
}> {
  // @plan:PLAN-20250214-CREDPROXY.P34 R3.4: Use realpath to resolve symlinks
  debugLogger.error(`hopping into sandbox (command: ${config.command}) ...`);
  const workdir = workspacePlan.primaryRoot;
  const gcPath = canonicalizeExistingPath(
    process.argv[1],
    'resolve the sandbox executable',
  );
  const projectSandboxDockerfile = path.join(
    SETTINGS_DIRECTORY_NAME,
    'sandbox.Dockerfile',
  );
  const isCustomProjectSandbox = fs.existsSync(projectSandboxDockerfile);
  const image = config.image;
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

  const resolvedTmpdir = canonicalizeExistingPath(
    os.tmpdir(),
    'resolve the sandbox temporary directory',
  );
  const sessionTmpdir = fs.mkdtempSync(
    path.join(resolvedTmpdir, 'llxprt-sandbox-'),
  );
  // #3469: from creation on, the per-session tmpdir is owned by the launch
  // lifecycle and released on every later failure.
  lifecycle.own('session-tmpdir', 'session tmpdir', () =>
    removeSessionTmpdir(sessionTmpdir),
  );
  const args = buildContainerRunArgs(
    config,
    image,
    workdir,
    containerWorkdir,
    sessionTmpdir,
  );
  addContainerWorkspaceMounts(args, workspacePlan);
  addContainerVolumeMounts(args);
  // #3450/#3463: append fresh engine-owned dependency volumes after every
  // shared workspace bind so the nested mounts win. Host preflight and
  // destination planning already completed before any engine operation.
  const dependencyVolumeLifecycle = addPrivateDependencyMounts(
    config,
    args,
    workspacePlan.roots,
    dependencyMountPlan,
  );
  lifecycle.own('dependency-volume', 'private dependency volumes', () =>
    dependencyVolumeLifecycle.release(),
  );
  return {
    image,
    workdir,
    containerWorkdir,
    sessionTmpdir,
    args,
    dependencyVolumeLifecycle,
  };
}

/** Sets up SSH forwarding, port forwarding, networking, and env vars. */
async function prepareContainerNetworkAndEnv(
  config: SandboxConfig,
  args: string[],
  workdir: string,
  isPodmanMacOS: boolean,
  reservedTunnelPorts: Set<number>,
  lifecycle: SandboxLaunchLifecycle,
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
  // #3469: each live tunnel is owned from the moment it is up.
  lifecycle.own('tunnel', 'SSH agent forwarding tunnel', sshResult.cleanup);

  let portForwardingResult: PortForwardingResult | undefined;
  const podmanMacOSPortsForwarded = await setupPodmanMacosPortForwarding(
    isPodmanMacOS,
    reservedTunnelPorts,
    (result) => {
      portForwardingResult = result;
    },
  );
  lifecycle.own(
    'tunnel',
    'port-forwarding tunnels',
    portForwardingResult?.cleanup,
  );

  const proxyCommand = setupContainerNetworking(args, config, isPodmanMacOS);
  return {
    sshResult,
    podmanMacOSPortsForwarded,
    proxyCommand,
    portForwardingResult,
  };
}

interface ContainerEntrypointSetup {
  readonly args: string[];
  readonly workdir: string;
  readonly cliArgs: string[];
  readonly podmanMacOSPortsForwarded: Set<string>;
  readonly entrypointPrefixes: string[];
}

async function prepareContainerEntrypoint({
  args,
  workdir,
  cliArgs,
  podmanMacOSPortsForwarded,
  entrypointPrefixes,
}: ContainerEntrypointSetup): Promise<{
  finalEntrypoint: string[];
  userFlag: string;
}> {
  // #3469: on failure here the launch lifecycle still owns every resource
  // acquired above; there is nothing entrypoint-local to release.
  const finalEntrypoint = entrypoint(
    workdir,
    cliArgs,
    podmanMacOSPortsForwarded.size > 0 ? podmanMacOSPortsForwarded : undefined,
    entrypointPrefixes,
  );
  const userFlag = await setupContainerUser(args, finalEntrypoint);
  return { finalEntrypoint, userFlag };
}

async function planWorkspacesAndDependencies(
  config: SandboxConfig,
  cliConfig: Config | undefined,
): Promise<{
  readonly workspacePlan: ContainerWorkspacePlan;
  readonly dependencyMountPlan: DependencyMountPlan;
}> {
  const workdir = path.resolve(process.cwd());
  const acceptedWorkspaceRoots =
    cliConfig === undefined
      ? [workdir]
      : [
          ...cliConfig.getWorkspaceContext().getDirectories(),
          ...cliConfig.getConfiguredIncludeDirectories(),
        ];
  const workspacePlan = planContainerWorkspaces(
    workdir,
    acceptedWorkspaceRoots,
  );
  const dependencyMountPlan = planPrivateDependencyMounts(workspacePlan.roots);
  await reapOrphanedSandboxResources(config);
  return { workspacePlan, dependencyMountPlan };
}

/** Runs the Docker/Podman sandbox path: image build, arg assembly, and proxy setup. */
async function prepareContainerSandbox(
  config: SandboxConfig,
  nodeArgs: string[],
  cliConfig: Config | undefined,
  cliArgs: string[],
  lifecycle: SandboxLaunchLifecycle,
): Promise<ContainerSandboxPrepared> {
  validateContainerSandboxEnv();
  const { workspacePlan, dependencyMountPlan } =
    await planWorkspacesAndDependencies(config, cliConfig);

  const { image, workdir, sessionTmpdir, args, dependencyVolumeLifecycle } =
    await prepareContainerImageAndArgs(
      config,
      workspacePlan,
      dependencyMountPlan,
      lifecycle,
    );

  // #3469/#3450: from here on, every acquired resource is registered with
  // the launch lifecycle; a failure at any later step releases all of them.
  const reservedTunnelPorts = new Set<number>();
  const isPodmanMacOS =
    config.command === 'podman' && os.platform() === 'darwin';
  const networkAndEnv = await prepareContainerNetworkAndEnv(
    config,
    args,
    workdir,
    isPodmanMacOS,
    reservedTunnelPorts,
    lifecycle,
  );
  const containerName = assignContainerName(args, config, image);
  addContainerEnvVars(args, config, containerName, nodeArgs, workdir);
  const {
    sshResult,
    podmanMacOSPortsForwarded,
    proxyCommand,
    portForwardingResult,
  } = networkAndEnv;
  // Compose bridge prefixes after the trusted capability capture stanza (F1).
  const entrypointPrefixes: string[] = [];
  if (sshResult.entrypointPrefix !== undefined) {
    entrypointPrefixes.push(sshResult.entrypointPrefix);
  }
  const credentialProxySetup = await startCredentialProxyGuarded(
    args,
    config,
    sessionTmpdir,
    reservedTunnelPorts,
    entrypointPrefixes,
    lifecycle,
  );

  const { finalEntrypoint, userFlag } = await prepareContainerEntrypoint({
    args,
    workdir,
    cliArgs,
    podmanMacOSPortsForwarded,
    entrypointPrefixes,
  });

  return {
    args,
    finalEntrypoint,
    proxyCommand,
    userFlag,
    image,
    containerName,
    workdir,
    portForwardingResult,
    ...credentialProxySetup,
    dependencyVolumeLifecycle,
    reservedTunnelPorts,
    sshResult,
  };
}

async function startCredentialProxyGuarded(
  args: string[],
  config: SandboxConfig,
  sessionTmpdir: string,
  reservedTunnelPorts: Set<number>,
  entrypointPrefixes: string[],
  lifecycle: SandboxLaunchLifecycle,
): Promise<Awaited<ReturnType<typeof setupCredentialProxy>>> {
  let cpResult: Awaited<ReturnType<typeof setupCredentialProxy>>;
  try {
    cpResult = await setupCredentialProxy(
      args,
      config,
      sessionTmpdir,
      reservedTunnelPorts,
      entrypointPrefixes,
    );
  } catch (error) {
    // setupCredentialProxy releases everything it acquired on its own
    // failure paths (proxy server, bridge, env file, tmpdir); the launch
    // lifecycle owns nothing from it yet.
    if (error instanceof FatalSandboxError) throw error;
    // @plan:PLAN-20250214-CREDPROXY.P34 R25.1a: Proxy creation failure aborts before spawning container
    throw new FatalSandboxError(
      `Failed to start credential proxy: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  lifecycle.own(
    'credential-proxy',
    'credential proxy bridge',
    cpResult.credentialProxyBridgeCleanup,
  );
  lifecycle.own('credential-proxy', 'credential proxy server', () => {
    void stopProxy().catch((err) => {
      debugLogger.error(
        'Credential proxy stop() failed after failed launch:',
        err,
      );
    });
  });
  return cpResult;
}

/** Spawns container and proxy, wires cleanup, and waits for exit. */
async function executeContainerSandbox(
  config: SandboxConfig,
  cliConfig: Config | undefined,
  prepared: Awaited<ReturnType<typeof prepareContainerSandbox>>,
  lifecycle: SandboxLaunchLifecycle,
): Promise<{
  exitCode: number;
  portForwardingResult: PortForwardingResult | undefined;
  credentialProxyBridgeCleanup: (() => void) | undefined;
}> {
  const {
    args,
    finalEntrypoint,
    proxyCommand,
    userFlag,
    image,
    containerName,
    workdir,
    portForwardingResult,
    sshResult,
    dependencyVolumeLifecycle,
  } = prepared;
  let credentialProxyBridgeCleanup = prepared.credentialProxyBridgeCleanup;

  // Prefixes are already composed INTO the trusted entrypoint script body
  // (after the capture stanza) by entrypoint() during prepare.
  args.push(image);
  args.push(...finalEntrypoint);

  // #3469: a sidecar or main-launch failure here is still covered — every
  // resource stays owned by the launch lifecycle until the process/close
  // handlers take over below.
  const proxyContainerProcess =
    proxyCommand !== undefined
      ? await startProxyContainer(
          config,
          proxyCommand,
          userFlag,
          image,
          workdir,
          lifecycle,
        )
      : undefined;

  const { stdinWasPaused, stdinHadRawMode } = handleStdinForSandbox();
  const sandboxProcess = spawn(config.command, args, { stdio: 'inherit' });
  lifecycle.own('main-container', `main container ${containerName}`, () => {
    sandboxProcess.kill('SIGTERM');
  });
  dependencyVolumeLifecycle.recordMainContainerName(containerName);
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
    credentialProxyBridgeCleanup,
    (c) => {
      credentialProxyBridgeCleanup = c;
    },
  );
  // #3469: ownership explicitly moves to the wired process/close handlers;
  // from here the normal session lifecycle performs every release.
  lifecycle.transferToProcessHandlers();

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

  // Release volumes after every close listener and its queued I/O have
  // completed. Docker Desktop can expose a nested destination until teardown
  // finishes; an early release can leave an engine-created mountpoint behind.
  await new Promise<void>((resolve) => setImmediate(resolve));
  dependencyVolumeLifecycle.release();

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
  // #3469: one explicit owner for every launch-acquired resource. Any
  // failure in preparation or launch releases them all in stage order;
  // secondary release failures stay visible on stderr without replacing
  // the original error.
  const lifecycle = new SandboxLaunchLifecycle();
  try {
    const prepared = await prepareContainerSandbox(
      config,
      nodeArgs,
      cliConfig,
      cliArgs,
      lifecycle,
    );
    return await executeContainerSandbox(
      config,
      cliConfig,
      prepared,
      lifecycle,
    );
  } catch (error) {
    lifecycle.releaseForFailedLaunch();
    throw error;
  }
}

export function buildSandboxCommandArgs(
  isCustomProjectSandbox: boolean,
  resolvedProjectSandboxDockerfile: string,
  image: string,
): string[] {
  const buildArgsArray = ['scripts/build_sandbox.ts', '-s'];
  if (isCustomProjectSandbox) {
    if (resolvedProjectSandboxDockerfile.length === 0 || image.length === 0) {
      throw new Error('Custom sandbox requires both a Dockerfile and image.');
    }
    buildArgsArray.push('-f', resolvedProjectSandboxDockerfile, '-i', image);
  }
  return buildArgsArray;
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
  const resolvedProjectSandboxDockerfile = isCustomProjectSandbox
    ? path.resolve(projectSandboxDockerfile)
    : '';
  const buildArgsArray = buildSandboxCommandArgs(
    isCustomProjectSandbox,
    resolvedProjectSandboxDockerfile,
    image,
  );
  try {
    execFileSync('bun', buildArgsArray, {
      cwd: gcRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        LLXPRT_SANDBOX: config.command,
      },
    });
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === 'ENOENT' || error.code === 'EACCES')
    ) {
      throw new FatalSandboxError(
        `Bun runtime was not found or could not be executed: ${error.message}. Install Bun from https://bun.sh and ensure it is on PATH.`,
      );
    }
    // stdio: 'inherit' streams build output directly to the terminal, so the
    // child's stderr is already visible; error.stderr is never populated.
    throw new FatalSandboxError(
      `Sandbox image build failed: ${getErrorMessage(error)}`,
    );
  }
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
