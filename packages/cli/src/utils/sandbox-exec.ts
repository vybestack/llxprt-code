/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
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
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';

function removeSessionTmpdir(sessionTmpdir: string): void {
  fs.rmSync(sessionTmpdir, { recursive: true, force: true });
}

/** Validates image and builds initial container run args. */
async function prepareContainerImageAndArgs(
  config: SandboxConfig,
  workdir: string,
  dependencyMountPlan: DependencyMountPlan,
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
  const gcPath = fs.realpathSync(process.argv[1]);
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
    // #3450: append fresh engine-owned dependency volumes after the shared
    // workspace bind so the nested mounts win. Host preflight and destination
    // planning already completed before any engine operation.
    const dependencyVolumeLifecycle = addPrivateDependencyMounts(
      config,
      args,
      workdir,
      dependencyMountPlan,
    );
    return {
      image,
      workdir,
      containerWorkdir,
      sessionTmpdir,
      args,
      dependencyVolumeLifecycle,
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
  readonly dependencyVolumeLifecycle: DependencyVolumeLifecycle;
}

async function prepareContainerEntrypoint({
  args,
  workdir,
  cliArgs,
  podmanMacOSPortsForwarded,
  entrypointPrefixes,
  credentialProxyBridgeCleanup,
  dependencyVolumeLifecycle,
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
    runBestEffortSyncCleanup(dependencyVolumeLifecycle);
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

const SANDBOX_MANAGED_LABEL = 'com.vybestack.llxprt.sandbox-managed=true';
const SANDBOX_OWNER_LABEL = 'com.vybestack.llxprt.sandbox-owner';
const PROCESS_START_TOLERANCE_MS = 2_000;
const PS_WEEKDAYS: readonly string[] = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
];
const PS_MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const PS_LSTART_PATTERN =
  /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( [1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d) (\d{4})$/;

interface SandboxOwnerMetadata {
  readonly version: 1;
  readonly hostname: string;
  readonly pid: number;
  readonly startTimeMs: number;
  readonly startTimeSource: 'observed' | 'estimated';
}

function execFileOutput(
  command: string,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: 'utf8',
        timeout: 5_000,
        killSignal: 'SIGKILL',
        env: process.env,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSandboxOwnerMetadata(value: unknown): value is SandboxOwnerMetadata {
  if (!isUnknownRecord(value) || value.version !== 1) {
    return false;
  }
  if (typeof value.hostname !== 'string' || value.hostname.length === 0) {
    return false;
  }
  if (
    typeof value.pid !== 'number' ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0
  ) {
    return false;
  }
  if (
    typeof value.startTimeMs !== 'number' ||
    !Number.isFinite(value.startTimeMs) ||
    value.startTimeMs <= 0
  ) {
    return false;
  }
  return (
    value.startTimeSource === 'observed' ||
    value.startTimeSource === 'estimated'
  );
}

function parseSandboxOwner(payload: string): SandboxOwnerMetadata | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isSandboxOwnerMetadata(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseManagedContainerRow(
  row: string,
): readonly [string, SandboxOwnerMetadata] | undefined {
  const separator = row.indexOf('	');
  if (separator <= 0) return undefined;
  const containerId = row.slice(0, separator);
  const owner = parseSandboxOwner(row.slice(separator + 1));
  return owner === undefined ? undefined : [containerId, owner];
}

function parseProcessStartTime(output: string): number | undefined {
  const match = PS_LSTART_PATTERN.exec(output);
  if (match === null) return undefined;
  const [
    ,
    weekday,
    month,
    dayText,
    hourText,
    minuteText,
    secondText,
    yearText,
  ] = match;
  const monthIndex = PS_MONTHS.indexOf(month);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const year = Number(yearText);
  const startTimeMs = Date.UTC(year, monthIndex, day, hour, minute, second);
  const parsed = new Date(startTimeMs);
  if (parsed.getUTCFullYear() !== year) return undefined;
  if (parsed.getUTCMonth() !== monthIndex) return undefined;
  if (parsed.getUTCDate() !== day) return undefined;
  if (PS_WEEKDAYS[parsed.getUTCDay()] !== weekday) return undefined;
  return startTimeMs;
}

function readProcessStartTime(pid: number): number | undefined {
  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 250,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
    }).trim();
    return parseProcessStartTime(output);
  } catch {
    return undefined;
  }
}

function sandboxOwnerIsDead(owner: SandboxOwnerMetadata): boolean {
  try {
    if (owner.hostname !== os.hostname()) return false;
  } catch {
    return false;
  }
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    return isNodeError(error) && error.code === 'ESRCH';
  }
  if (owner.startTimeSource !== 'observed') return false;
  const currentStartTimeMs = readProcessStartTime(owner.pid);
  return (
    currentStartTimeMs !== undefined &&
    Math.abs(currentStartTimeMs - owner.startTimeMs) >
      PROCESS_START_TOLERANCE_MS
  );
}

function listManagedSandboxContainers(config: SandboxConfig): Promise<string> {
  return execFileOutput(config.command, [
    'ps',
    '--filter',
    `label=${SANDBOX_MANAGED_LABEL}`,
    '--format',
    `{{.ID}}	{{.Label "${SANDBOX_OWNER_LABEL}"}}`,
  ]);
}

async function reapManagedSandboxContainer(
  config: SandboxConfig,
  row: string,
): Promise<void> {
  const container = parseManagedContainerRow(row);
  if (container === undefined) return;
  const [containerId, owner] = container;
  if (!sandboxOwnerIsDead(owner)) return;
  try {
    await execFileOutput(config.command, ['rm', '-f', containerId]);
  } catch (error) {
    debugLogger.warn(
      `Could not reap orphaned ${config.command} sandbox ${containerId}: ${getErrorMessage(error)}`,
    );
  }
}

async function reapOrphanedSandboxContainers(
  config: SandboxConfig,
): Promise<void> {
  if (config.command !== 'docker' && config.command !== 'podman') return;
  let output: string;
  try {
    output = await listManagedSandboxContainers(config);
  } catch (error) {
    debugLogger.warn(
      `Could not list managed ${config.command} sandboxes for orphan recovery: ${getErrorMessage(error)}`,
    );
    return;
  }
  const rows = output
    .split('\n')
    .map((row) => (row.endsWith('\r') ? row.slice(0, -1) : row))
    .filter((row) => row.length > 0);
  for (const row of rows) {
    await reapManagedSandboxContainer(config, row);
  }
}

async function planDependenciesAndReapOrphans(config: SandboxConfig): Promise<{
  readonly workdir: string;
  readonly dependencyMountPlan: DependencyMountPlan;
}> {
  const workdir = path.resolve(process.cwd());
  const dependencyMountPlan = planPrivateDependencyMounts(workdir);
  await reapOrphanedSandboxContainers(config);
  return { workdir, dependencyMountPlan };
}

/** Runs the Docker/Podman sandbox path: image build, arg assembly, and proxy setup. */
async function prepareContainerSandbox(
  config: SandboxConfig,
  nodeArgs: string[],
  cliConfig: Config | undefined,
  cliArgs: string[],
): Promise<ContainerSandboxPrepared> {
  validateContainerSandboxEnv();
  const { workdir, dependencyMountPlan } =
    await planDependenciesAndReapOrphans(config);

  const { image, sessionTmpdir, args, dependencyVolumeLifecycle } =
    await prepareContainerImageAndArgs(config, workdir, dependencyMountPlan);

  // #3450: the private dependency storage exists from here on; every abort
  // path below releases it, and the per-session tmpdir (#3440) alongside it.
  const reservedTunnelPorts = new Set<number>();
  let networkAndEnv: ContainerNetworkAndEnv;
  let containerName: string;
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
    containerName = assignContainerName(args, config, image);
    addContainerEnvVars(args, config, containerName, nodeArgs, workdir);
  } catch (error) {
    runBestEffortSyncCleanup(() => removeSessionTmpdir(sessionTmpdir));
    runBestEffortSyncCleanup(dependencyVolumeLifecycle);
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
    runBestEffortSyncCleanup(dependencyVolumeLifecycle);
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
    dependencyVolumeLifecycle,
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
  } catch (err) {
    runBestEffortSyncCleanup(dependencyVolumeLifecycle);
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
