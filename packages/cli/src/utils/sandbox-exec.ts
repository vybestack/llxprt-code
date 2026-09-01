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
import type {
  PortForwardingResult,
  CredentialProxyBridgeResult,
  SshAgentResult,
} from './sandbox-ssh.js';
import type { ContainerSandboxPrepared } from './sandbox-containers.js';
import { runBestEffortSyncCleanup } from './cleanup.js';
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
import { addPrivateDependencyMounts } from './sandbox-node-modules.js';
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

function removeSessionTmpdir(sessionTmpdir: string): void {
  fs.rmSync(sessionTmpdir, { recursive: true, force: true });
}

/** Validates image and builds initial container run args. */
async function prepareContainerImageAndArgs(config: SandboxConfig): Promise<{
  image: string;
  workdir: string;
  containerWorkdir: string;
  sessionTmpdir: string;
  args: string[];
  dependencyStorageCleanup: () => void;
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
  const sessionTmpdir = fs.mkdtempSync(
    path.join(resolvedTmpdir, 'llxprt-sandbox-'),
  );
  try {
    const args = buildContainerRunArgs(
      config,
      image,
      workdir,
      containerWorkdir,
      sessionTmpdir,
    );
    addContainerVolumeMounts(args);
    // #3450: replace the workspace's node_modules destinations with fresh
    // per-run private binds, appended after the shared workspace bind so the
    // nested mounts win. The host-side contamination preflight runs inside
    // this call BEFORE any storage is created.
    const dependencyStorageCleanup = addPrivateDependencyMounts(
      config,
      args,
      workdir,
    );
    return {
      image,
      workdir,
      containerWorkdir,
      sessionTmpdir,
      args,
      dependencyStorageCleanup,
    };
  } catch (error) {
    runBestEffortSyncCleanup(() => removeSessionTmpdir(sessionTmpdir));
    throw error;
  }
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

type ContainerNetworkAndEnv = Awaited<
  ReturnType<typeof prepareContainerNetworkAndEnv>
>;

interface ContainerEntrypointSetup {
  readonly args: string[];
  readonly workdir: string;
  readonly cliArgs: string[];
  readonly podmanMacOSPortsForwarded: Set<string>;
  readonly entrypointPrefixes: string[];
  readonly credentialProxyBridgeCleanup: (() => void) | undefined;
  readonly dependencyStorageCleanup: (() => void) | undefined;
}

async function prepareContainerEntrypoint({
  args,
  workdir,
  cliArgs,
  podmanMacOSPortsForwarded,
  entrypointPrefixes,
  credentialProxyBridgeCleanup,
  dependencyStorageCleanup,
}: ContainerEntrypointSetup): Promise<{
  finalEntrypoint: string[];
  userFlag: string;
}> {
  try {
    const finalEntrypoint = entrypoint(
      workdir,
      cliArgs,
      podmanMacOSPortsForwarded.size > 0
        ? podmanMacOSPortsForwarded
        : undefined,
      entrypointPrefixes,
    );
    const userFlag = await setupContainerUser(args, finalEntrypoint);
    return { finalEntrypoint, userFlag };
  } catch (error) {
    runBestEffortSyncCleanup(credentialProxyBridgeCleanup);
    runBestEffortSyncCleanup(dependencyStorageCleanup);
    throw error;
  }
}

async function rethrowCredentialProxySetupError(
  error: unknown,
  credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined,
): Promise<never> {
  runBestEffortSyncCleanup(credentialProxyBridgeResult?.cleanup);
  try {
    await stopProxy();
  } catch {
    // best-effort cleanup; the original error is the one we want to throw
  }
  if (error instanceof FatalSandboxError) throw error;
  // @plan:PLAN-20250214-CREDPROXY.P34 R25.1a: Proxy creation failure aborts before spawning container
  throw new FatalSandboxError(
    `Failed to start credential proxy: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** Runs the Docker/Podman sandbox path — image build, arg assembly, and proxy setup. */
async function prepareContainerSandbox(
  config: SandboxConfig,
  nodeArgs: string[],
  cliConfig: Config | undefined,
  cliArgs: string[],
): Promise<ContainerSandboxPrepared> {
  validateContainerSandboxEnv();

  const { image, workdir, sessionTmpdir, args, dependencyStorageCleanup } =
    await prepareContainerImageAndArgs(config);

  // #3450: the private dependency storage exists from here on; every abort
  // path below releases it, and the per-session tmpdir (#3440) alongside it.
  const reservedTunnelPorts = new Set<number>();
  let networkAndEnv: ContainerNetworkAndEnv;
  try {
    const isPodmanMacOS =
      config.command === 'podman' && os.platform() === 'darwin';
    networkAndEnv = await prepareContainerNetworkAndEnv(
      config,
      args,
      workdir,
      isPodmanMacOS,
      reservedTunnelPorts,
    );
    const containerName = assignContainerName(args, config, image);
    addContainerEnvVars(args, config, containerName, nodeArgs, workdir);
  } catch (error) {
    runBestEffortSyncCleanup(() => removeSessionTmpdir(sessionTmpdir));
    runBestEffortSyncCleanup(dependencyStorageCleanup);
    throw error;
  }
  const {
    sshResult,
    podmanMacOSPortsForwarded,
    proxyCommand,
    portForwardingResult,
  } = networkAndEnv;

  // Compose bridge prefixes after the trusted capability capture stanza (F1).
  const entrypointPrefixes: string[] = [];
  let credentialProxySetup: Awaited<ReturnType<typeof setupCredentialProxy>>;
  try {
    if (sshResult.entrypointPrefix !== undefined) {
      entrypointPrefixes.push(sshResult.entrypointPrefix);
    }
    credentialProxySetup = await startCredentialProxyGuarded(
      args,
      config,
      sessionTmpdir,
      reservedTunnelPorts,
      entrypointPrefixes,
    );
  } catch (error) {
    runBestEffortSyncCleanup(() => removeSessionTmpdir(sessionTmpdir));
    runBestEffortSyncCleanup(dependencyStorageCleanup);
    throw error;
  }

  // #3450: entrypoint/user-setup aborts release the private dependency
  // storage inside prepareContainerEntrypoint's failure path.
  const { finalEntrypoint, userFlag } = await prepareContainerEntrypoint({
    args,
    workdir,
    cliArgs,
    podmanMacOSPortsForwarded,
    entrypointPrefixes,
    credentialProxyBridgeCleanup:
      credentialProxySetup.credentialProxyBridgeCleanup,
    dependencyStorageCleanup,
  });

  return {
    args,
    finalEntrypoint,
    proxyCommand,
    userFlag,
    image,
    workdir,
    portForwardingResult,
    ...credentialProxySetup,
    dependencyStorageCleanup,
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
): Promise<Awaited<ReturnType<typeof setupCredentialProxy>>> {
  let credentialProxyBridgeResult: CredentialProxyBridgeResult | undefined;
  try {
    const cpResult = await setupCredentialProxy(
      args,
      config,
      sessionTmpdir,
      reservedTunnelPorts,
      entrypointPrefixes,
    );
    credentialProxyBridgeResult = cpResult.credentialProxyBridgeResult;
    const credentialProxyBridgeCleanup = cpResult.credentialProxyBridgeCleanup;
    return { credentialProxyBridgeResult, credentialProxyBridgeCleanup };
  } catch (error) {
    return rethrowCredentialProxySetupError(error, credentialProxyBridgeResult);
  }
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
    finalEntrypoint,
    proxyCommand,
    userFlag,
    image,
    workdir,
    portForwardingResult,
    sshResult,
    dependencyStorageCleanup,
  } = prepared;
  let credentialProxyBridgeCleanup = prepared.credentialProxyBridgeCleanup;

  // Prefixes are already composed INTO the trusted entrypoint script body
  // (after the capture stanza) by entrypoint() during prepare.
  args.push(image);
  args.push(...finalEntrypoint);

  // #3450: from here through process exit, a sidecar or main-launch
  // failure must release the per-run private dependency storage again.
  try {
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
      credentialProxyBridgeCleanup,
      (c) => {
        credentialProxyBridgeCleanup = c;
      },
      dependencyStorageCleanup,
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
  } catch (err) {
    runBestEffortSyncCleanup(dependencyStorageCleanup);
    throw err;
  }
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
