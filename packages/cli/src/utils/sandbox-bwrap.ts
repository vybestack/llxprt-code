/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FatalSandboxError,
  type Config,
  type SandboxConfig,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import { normalizeExitCode } from './sandbox-seatbelt.js';
import {
  createBwrapSignalDelivery,
  type BwrapSignalDeliveryOptions,
} from './sandbox-bwrap-signal-delivery.js';
import { forwardSignalsToSandboxProcess } from './sandbox-signal-forwarding.js';
import {
  addBwrapDestinationParents,
  buildBwrapMountArgs,
  isWithin,
  storageRootsRequiringMask,
} from './sandbox-bwrap-policy.js';
import { resolveBwrapExecutable } from './sandbox-bwrap-executable.js';
import { acquireHostCredentialProxy } from './sandbox-credential-proxy.js';
import { getPassthroughEnvVars } from './sandbox-env.js';
import {
  createBwrapSessionDir,
  reapStaleBwrapSessionDirs,
} from './sandbox-bwrap-session-dirs.js';
import type { ContainerWorkspacePlan } from './sandbox-workspaces.js';

/** 128 + SIGKILL, reported when the launcher had to kill a stuck sandbox. */
const SIGKILL_EXIT_STATUS = 137;
const PRIVATE_CREDENTIAL_DESTINATION = '/run/llxprt/credentials';
const CAPABILITY_FD = 3;
const CAPABILITY_PIPE_FD = 5;

type BwrapConfig = Extract<SandboxConfig, { readonly command: 'bwrap' }>;
type CredentialProxy = Awaited<ReturnType<typeof acquireHostCredentialProxy>>;

interface RuntimeContext {
  readonly runtimeRoots: readonly string[];
  readonly cliEntry: string;
  readonly runtime: string;
  readonly runtimeArgs: readonly string[];
}

interface BwrapLaunchPlan {
  readonly config: BwrapConfig;
  readonly workspacePlan: ContainerWorkspacePlan;
  readonly runtimeContext: RuntimeContext;
  readonly homeDir: string;
  readonly configHome: string;
  readonly privateData: string;
  readonly privateCache: string;
  readonly privateLog: string;
  readonly projectKey: string;
  readonly projectHistory: string;
  readonly projectLogs: string;
  readonly mountArgs: readonly string[];
  readonly childEnv: NodeJS.ProcessEnv;
}

function resolveRuntimeContext(nodeArgs: readonly string[]): RuntimeContext {
  const cliEntry = fs.realpathSync(process.argv[1]);
  const runtime = process.execPath;
  const runtimeRoot = fs.realpathSync(path.dirname(runtime));
  let packageRoot = path.dirname(cliEntry);
  while (
    packageRoot !== path.dirname(packageRoot) &&
    !(
      fs.existsSync(
        path.join(packageRoot, 'packages', 'cli', 'package.json'),
      ) && fs.existsSync(path.join(packageRoot, 'package.json'))
    )
  ) {
    packageRoot = path.dirname(packageRoot);
  }
  if (
    !fs.existsSync(path.join(packageRoot, 'packages', 'cli', 'package.json'))
  ) {
    packageRoot = path.resolve(path.dirname(cliEntry), '../../..');
  }
  const dependencyRoot = path.join(packageRoot, 'node_modules');
  const packageSources = path.join(packageRoot, 'packages');
  const runtimeRoots = [runtimeRoot, path.dirname(cliEntry)];
  if (fs.existsSync(dependencyRoot)) {
    runtimeRoots.push(dependencyRoot, packageSources);
  }
  return { runtimeRoots, cliEntry, runtime, runtimeArgs: nodeArgs };
}

function ensurePrivateRoot(root: string): void {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
}

function planBwrapWorkspaces(
  workdir: string,
  candidates: readonly string[],
): ContainerWorkspacePlan {
  const primaryRoot = fs.realpathSync(workdir);
  const includeRoots = [
    ...new Set(candidates.map((candidate) => fs.realpathSync(candidate))),
  ].filter((candidate) => candidate !== primaryRoot);
  for (const root of [primaryRoot, ...includeRoots]) {
    if (!fs.statSync(root).isDirectory()) {
      throw new FatalSandboxError(
        `Bwrap workspace '${root}' is not a directory.`,
      );
    }
    fs.accessSync(
      root,
      fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
    );
  }
  const roots = [primaryRoot, ...includeRoots];
  for (let index = 0; index < roots.length; index += 1) {
    for (const other of roots.slice(index + 1)) {
      if (isWithin(roots[index], other) || isWithin(other, roots[index])) {
        throw new FatalSandboxError(
          `Bwrap workspace roots overlap: '${roots[index]}' and '${other}'.`,
        );
      }
    }
  }
  return { primaryRoot, roots, includeRoots };
}

function sanitizedPath(sourcePath: string | undefined): string {
  const home = os.homedir();
  const entries = (sourcePath ?? '')
    .split(path.delimiter)
    .filter(
      (entry) => path.isAbsolute(entry) && !isWithin(home, path.resolve(entry)),
    );
  return entries.length > 0
    ? entries.join(path.delimiter)
    : '/usr/local/bin:/usr/bin:/bin';
}

const PROTECTED_ENVIRONMENT_KEYS = [
  'SANDBOX',
  'HOME',
  'PWD',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
  'LLXPRT_PROMPTS_DIR',
  'LLXPRT_CREDENTIAL_SOCKET',
  'LLXPRT_CAPABILITY_TOKEN',
  'LLXPRT_CAPABILITY_FD',
  'LLXPRT_SANDBOX_NETWORK',
  'SANDBOX_NETWORK',
  'LLXPRT_SANDBOX_CPUS',
  'SANDBOX_CPUS',
  'LLXPRT_SANDBOX_MEMORY',
  'SANDBOX_MEMORY',
  'LLXPRT_SANDBOX_PIDS',
  'SANDBOX_PIDS',
  'SANDBOX_FLAGS',
  'DBUS_SESSION_BUS_ADDRESS',
  'DBUS_SYSTEM_BUS_ADDRESS',
  'SESSION_MANAGER',
  'SSH_AUTH_SOCK',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'NODE_OPTIONS',
  'BUN_OPTIONS',
  'BASH_ENV',
  'ENV',
] as const;

function assertNoProtectedEnvironmentOverrides(config: BwrapConfig): void {
  const protectedOverride = PROTECTED_ENVIRONMENT_KEYS.find((key) =>
    Object.hasOwn(config.env ?? {}, key),
  );
  if (protectedOverride !== undefined) {
    throw new FatalSandboxError(
      `bwrap profile env cannot override protected variable '${protectedOverride}'.`,
    );
  }
}

function createChildEnvironment(
  workspace: string,
  config: BwrapConfig,
  configHome: string,
  dataHome: string,
  cacheHome: string,
  logHome: string,
  runtimeRoot: string,
  sshAgentSocket?: string,
): NodeJS.ProcessEnv {
  assertNoProtectedEnvironmentOverrides(config);
  const source = process.env;
  const env: NodeJS.ProcessEnv = {
    PATH: sanitizedPath(source.PATH),
    TERM: source.TERM,
    COLORTERM: source.COLORTERM,
    LANG: source.LANG,
    LC_ALL: source.LC_ALL,
    LC_CTYPE: source.LC_CTYPE,
    ...getPassthroughEnvVars(source),
    ...config.env,
    HOME: os.homedir(),
    PWD: workspace,
    TMPDIR: '/tmp',
    XDG_RUNTIME_DIR: '/run/llxprt/runtime',
    LLXPRT_CONFIG_HOME: configHome,
    LLXPRT_DATA_HOME: dataHome,
    LLXPRT_CACHE_HOME: cacheHome,
    LLXPRT_LOG_HOME: logHome,
    LLXPRT_PROMPTS_DIR: '/tmp/llxprt-prompts',
    SANDBOX: 'bwrap',
  };
  if (sshAgentSocket) {
    env.SSH_AUTH_SOCK = '/run/llxprt/ssh-agent.sock';
  }
  if (runtimeRoot.length === 0) {
    throw new FatalSandboxError('Could not resolve the current bwrap runtime.');
  }
  return env;
}

function childCommand(
  context: RuntimeContext,
  cliArgs: readonly string[],
): readonly string[] {
  return [
    '/bin/bash',
    '--noprofile',
    '--norc',
    '-c',
    `exec ${CAPABILITY_FD}<&${CAPABILITY_PIPE_FD}; exec ${CAPABILITY_PIPE_FD}<&-; exec "$@"`,
    'llxprt-bwrap',
    context.runtime,
    ...context.runtimeArgs,
    context.cliEntry,
    ...cliArgs.slice(2),
  ];
}

/**
 * NUL separates the arguments in the bwrap options stream, so a value that
 * contains one would split into several arguments. The message names the
 * source of the value, never the value, which can be a secret.
 */
function assertNoNul(values: Iterable<string>, source: string): void {
  for (const value of values) {
    if (value.includes('\0')) {
      throw new FatalSandboxError(
        `A ${source} contains a NUL character, which cannot be passed to bwrap.`,
      );
    }
  }
}

function assertLaunchValuesHaveNoNul(
  plan: BwrapLaunchPlan,
  cliArgs: readonly string[],
): void {
  assertNoNul(plan.mountArgs, 'bwrap mount option');
  for (const [name, value] of Object.entries(plan.childEnv)) {
    assertNoNul([name], 'sandbox environment variable name');
    assertNoNul(
      value === undefined ? [] : [value],
      `sandbox environment value for '${name}'`,
    );
  }
  assertNoNul(
    [
      plan.runtimeContext.runtime,
      plan.runtimeContext.cliEntry,
      ...plan.runtimeContext.runtimeArgs,
      ...cliArgs,
    ],
    'sandbox command argument',
  );
}

function serializeOptions(
  options: readonly string[],
  socketPath: string,
): Buffer {
  assertNoNul(options, 'bwrap option');
  const values = [
    ...options,
    '--setenv',
    'LLXPRT_CAPABILITY_FD',
    String(CAPABILITY_FD),
    '--setenv',
    'LLXPRT_CREDENTIAL_SOCKET',
    `${PRIVATE_CREDENTIAL_DESTINATION}/${path.basename(socketPath)}`,
  ];
  return Buffer.from(`${values.join('\0')}\0`, 'utf8');
}

function isWritablePipe(
  value: ReturnType<typeof spawn>['stdio'][number],
): value is Writable {
  return value instanceof Writable;
}

function isReadablePipe(
  value: ReturnType<typeof spawn>['stdio'][number],
): value is Readable {
  return value instanceof Readable;
}

function launchBwrap(
  executable: string,
  args: readonly string[],
  token: string,
  context: RuntimeContext,
  cliArgs: readonly string[],
  socketPath: string,
  signalOptions: BwrapSignalDeliveryOptions,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        '--args',
        '3',
        '--info-fd',
        '4',
        '--',
        ...childCommand(context, cliArgs),
      ],
      {
        // The payload environment reaches the sandbox through --setenv; the
        // host-side launcher needs none of it.
        env: {},
        stdio: ['inherit', 'inherit', 'inherit', 'pipe', 'pipe', 'pipe'],
        shell: false,
      },
    );
    // ChildProcess types stdio as a five-element tuple, but the capability pipe
    // is descriptor 5.
    const pipes: ReadonlyArray<ReturnType<typeof spawn>['stdio'][number]> =
      child.stdio;
    const optionsPipe = pipes[3];
    const infoPipe = pipes[4];
    const capabilityPipe = pipes[CAPABILITY_PIPE_FD];
    if (
      !isWritablePipe(optionsPipe) ||
      !isReadablePipe(infoPipe) ||
      !isWritablePipe(capabilityPipe)
    ) {
      child.kill('SIGKILL');
      reject(new Error('Unable to create bwrap options and info pipes.'));
      return;
    }
    forwardSignalsToSandboxProcess(
      child,
      createBwrapSignalDelivery(child, infoPipe, signalOptions),
    );
    // bwrap can exit before it reads these pipes, which makes the write fail
    // with EPIPE; the child's own 'close' event reports the outcome.
    optionsPipe.on('error', () => {});
    capabilityPipe.on('error', () => {});
    optionsPipe.end(serializeOptions(args, socketPath));
    capabilityPipe.end(`${token}\n`);
    child.once('error', reject);
    child.once('close', (code, signal) =>
      resolve(
        signal === 'SIGKILL'
          ? SIGKILL_EXIT_STATUS
          : normalizeExitCode(code, signal),
      ),
    );
  });
}

function prepareBwrapLaunchPlan(
  config: BwrapConfig,
  nodeArgs: readonly string[],
  directories: (() => readonly string[]) | undefined,
): BwrapLaunchPlan {
  const workdir = fs.realpathSync(process.cwd());
  const runtimeContext = resolveRuntimeContext(nodeArgs);
  const homeDir = os.homedir();
  const workspacePlan = planBwrapWorkspaces(
    workdir,
    directories === undefined ? [workdir] : [...directories()],
  );
  const configuredConfigHome = Storage.getGlobalConfigDir();
  ensurePrivateRoot(configuredConfigHome);
  const configHome = fs.realpathSync(configuredConfigHome);
  const globalData = path.resolve(Storage.getGlobalDataDir());
  const globalCache = path.resolve(Storage.getGlobalCacheDir());
  const globalLog = path.resolve(Storage.getGlobalLogDir());
  const globalHistory = path.join(globalData, 'history');
  const projectKey = Storage.getProjectHistoryKey(workspacePlan.primaryRoot);
  const projectHistory = path.join(globalHistory, projectKey);
  const projectLogs = path.join(globalLog, 'tmp', projectKey);
  const privateData = path.join(homeDir, '.local/share/llxprt-code');
  const privateCache = path.join(homeDir, '.cache/llxprt-code');
  const privateLog = path.join(homeDir, '.local/state/llxprt-code');
  for (const root of [
    globalData,
    globalCache,
    globalLog,
    globalHistory,
    projectHistory,
    projectLogs,
  ]) {
    ensurePrivateRoot(root);
  }
  const childEnv = createChildEnvironment(
    workspacePlan.primaryRoot,
    config,
    configHome,
    privateData,
    privateCache,
    privateLog,
    runtimeContext.runtimeRoots[0] ?? '',
    config.sshAgent === 'off' ? undefined : process.env.SSH_AUTH_SOCK,
  );
  const mountArgs = buildBwrapMountArgs({
    workspaceRoot: workspacePlan.primaryRoot,
    includeRoots: workspacePlan.includeRoots,
    mounts: config.mounts,
    devices: config.devices,
    network: config.network,
    homeDir,
    maskedRoots: storageRootsRequiringMask(
      [globalData, globalCache, globalLog],
      homeDir,
    ),
    runtimeRoots: runtimeContext.runtimeRoots,
    sshAgentSocket:
      childEnv.SSH_AUTH_SOCK === '/run/llxprt/ssh-agent.sock'
        ? process.env.SSH_AUTH_SOCK
        : undefined,
  });
  return {
    config,
    workspacePlan,
    runtimeContext,
    homeDir,
    configHome,
    privateData,
    privateCache,
    privateLog,
    projectKey,
    projectHistory,
    projectLogs,
    mountArgs,
    childEnv,
  };
}

function buildBwrapLaunchOptions(
  plan: BwrapLaunchPlan,
  proxy: CredentialProxy,
): readonly string[] {
  const { configHome, privateData, privateLog, projectKey } = plan;
  const persistentHistoryDestination = path.join(
    privateData,
    'history',
    projectKey,
  );
  const persistentLogDestination = path.join(privateLog, 'tmp', projectKey);
  const destinationArgs: string[] = [];
  for (const destination of [
    configHome,
    persistentHistoryDestination,
    persistentLogDestination,
    '/run/llxprt',
    '/run/llxprt/runtime',
    PRIVATE_CREDENTIAL_DESTINATION,
    '/tmp/llxprt-prompts',
  ]) {
    addBwrapDestinationParents(destinationArgs, destination);
  }
  return [
    ...plan.mountArgs,
    ...destinationArgs,
    '--ro-bind',
    configHome,
    configHome,
    '--dir',
    persistentHistoryDestination,
    '--bind',
    plan.projectHistory,
    persistentHistoryDestination,
    '--dir',
    persistentLogDestination,
    '--bind',
    plan.projectLogs,
    persistentLogDestination,
    '--dir',
    '/run/llxprt',
    '--dir',
    '/run/llxprt/runtime',
    '--dir',
    PRIVATE_CREDENTIAL_DESTINATION,
    '--dir',
    '/tmp/llxprt-prompts',
    '--ro-bind',
    proxy.socketPath,
    `${PRIVATE_CREDENTIAL_DESTINATION}/${path.basename(proxy.socketPath)}`,
    '--chdir',
    plan.workspacePlan.primaryRoot,
    '--clearenv',
    ...Object.entries(plan.childEnv).flatMap(([key, value]) =>
      value === undefined ? [] : ['--setenv', key, value],
    ),
  ];
}

async function stopProxy(proxy: CredentialProxy | undefined): Promise<void> {
  await proxy?.stop();
}

async function releaseLaunchResources(
  proxy: CredentialProxy | undefined,
  sessionDir: string,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await stopProxy(proxy);
  } catch (error) {
    errors.push(error);
  }
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'bwrap launch cleanup failed');
  }
}

export async function runBwrapSandbox(
  config: SandboxConfig,
  nodeArgs: string[],
  _cliConfig?: Config,
  cliArgs: string[] = [],
  directories?: () => readonly string[],
  signalOptions: BwrapSignalDeliveryOptions = {},
): Promise<number> {
  if (config.command !== 'bwrap') {
    throw new FatalSandboxError(
      'runBwrapSandbox requires a bwrap configuration.',
    );
  }
  const plan = prepareBwrapLaunchPlan(config, nodeArgs, directories);
  assertLaunchValuesHaveNoNul(plan, cliArgs);
  const executable = resolveBwrapExecutable();
  if (executable === undefined) {
    throw new FatalSandboxError('The bwrap executable was not found on PATH.');
  }
  reapStaleBwrapSessionDirs();
  const sessionDir = createBwrapSessionDir();
  let proxy: CredentialProxy | undefined;
  let exitCode: number | undefined;
  let primaryError: unknown;
  try {
    proxy = await acquireHostCredentialProxy(sessionDir);
    const options = buildBwrapLaunchOptions(plan, proxy);
    exitCode = await launchBwrap(
      executable,
      options,
      proxy.capabilityToken,
      plan.runtimeContext,
      cliArgs,
      proxy.socketPath,
      signalOptions,
    );
  } catch (error) {
    primaryError = error;
  }
  try {
    await releaseLaunchResources(proxy, sessionDir);
  } catch (cleanupError) {
    if (primaryError !== undefined) {
      throw new AggregateError(
        [primaryError, cleanupError],
        'bwrap launch and cleanup failed',
      );
    }
    throw cleanupError;
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
  if (exitCode === undefined) {
    throw new FatalSandboxError('bwrap launch completed without an exit code.');
  }
  return exitCode;
}
