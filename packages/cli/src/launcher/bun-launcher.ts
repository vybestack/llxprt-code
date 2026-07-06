/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { FatalError } from '@vybestack/llxprt-code-core';
import { resolveBunPath } from './bun-path-resolver.js';
import { resolveBunEntry } from './bun-entry-resolver.js';

const NEWLINE = '\n';

interface LauncherCredentialEnvModule {
  readonly BUN_RELAUNCH_ENV: string;
  readonly CREDENTIAL_SOCKET_ENV: string;
  readonly PROXY_SOCKET_PREFIX: string;
  readonly createLauncherChildEnv: (options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly credentialSocketPath?: string | null;
  }) => NodeJS.ProcessEnv;
  readonly hasUsableCredentialSocket: (env?: NodeJS.ProcessEnv) => boolean;
}

function isModuleNotFoundError(error: unknown, targetModule: string): boolean {
  if (
    !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND'
    )
  ) {
    return false;
  }
  // Only treat this as "the candidate helper itself is missing" when the error
  // names the candidate module. A MODULE_NOT_FOUND about a transitive
  // dependency inside the helper must propagate so the real root cause is not
  // masked by the path-probing fallback.
  const message =
    error instanceof Error && typeof error.message === 'string'
      ? error.message
      : '';
  // A MODULE_NOT_FOUND from Node's require() always carries a descriptive
  // message naming the failed specifier. If no message is present, the error did
  // not originate from the standard resolution pipeline, so propagate it (return
  // false) rather than risk masking a real transitive failure by falling back.
  if (message.length === 0) {
    return false;
  }
  // Inspect only the failed-specifier portion (the first line, before any
  // "Require stack:" trailer). When a transitive dependency inside the helper
  // is missing, the require stack lists this helper as the importer, so matching
  // against the whole message would wrongly swallow that error and mask the real
  // root cause. Node.js quotes the resolved absolute path in the message, so
  // only the basename is meaningful for the relative candidate specifiers.
  const [firstLine = ''] = message.split(NEWLINE, 1);
  return firstLine.includes(basename(targetModule));
}

const loadCommonJsModule = createRequire(import.meta.url);

function loadLauncherCredentialEnv(): LauncherCredentialEnvModule {
  // Resolve the shared helper relative to this module across the layouts this
  // file can run from:
  //   - source/dev tree: packages/cli/src/launcher -> ../../bin
  //   - compiled output: packages/cli/dist/src/launcher -> ../../../bin
  //   - flattened/packed: packages/cli/dist/launcher -> ../../bin (covered by
  //     the first entry) or a shallower layout -> ../bin
  const candidatePaths = [
    '../../bin/launcher-credential-env.cjs',
    '../../../bin/launcher-credential-env.cjs',
    '../bin/launcher-credential-env.cjs',
  ];
  for (const candidatePath of candidatePaths) {
    try {
      const loaded: unknown = loadCommonJsModule(candidatePath);
      if (!isLauncherCredentialEnvModule(loaded)) {
        throw new FatalError(
          `Launcher credential-env helper at ${candidatePath} is corrupt or incomplete. Your installation may be corrupt; reinstall @vybestack/llxprt-code and try again.`,
          43,
        );
      }
      return loaded;
    } catch (error) {
      if (!isModuleNotFoundError(error, candidatePath)) {
        throw error;
      }
    }
  }
  throw new FatalError(
    'Unable to locate the launcher credential-env helper (bin/launcher-credential-env.cjs). Your installation may be corrupt; reinstall @vybestack/llxprt-code and try again.',
    43,
  );
}

function isLauncherCredentialEnvModule(
  value: unknown,
): value is LauncherCredentialEnvModule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const stringKeys = [
    'BUN_RELAUNCH_ENV',
    'CREDENTIAL_SOCKET_ENV',
    'PROXY_SOCKET_PREFIX',
  ];
  const functionKeys = ['createLauncherChildEnv', 'hasUsableCredentialSocket'];
  return (
    stringKeys.every((key) => typeof candidate[key] === 'string') &&
    functionKeys.every((key) => typeof candidate[key] === 'function')
  );
}

// The helper is loaded lazily on first use rather than at module-evaluation
// time. If the helper cannot be resolved (a corrupt install), the resulting
// FatalError then surfaces inside relaunchUnderBunIfNeeded/runBunLauncherIfNeeded
// where index.ts's top-level catch translates it into the correct exit code and
// user-facing message, instead of crashing as an unhandled import-time throw.
let launcherCredentialEnvCache: LauncherCredentialEnvModule | undefined;

function getLauncherCredentialEnv(): LauncherCredentialEnvModule {
  launcherCredentialEnvCache ??= loadLauncherCredentialEnv();
  return launcherCredentialEnvCache;
}

export type ExitFn = (code?: number) => never;

export interface LauncherOutcome {
  readonly relaunched: boolean;
  readonly exitCode?: number;
}

export interface CredentialProxyHandle {
  readonly socketPath: string;
  readonly stop: () => Promise<void>;
}

export interface RelaunchOptions {
  readonly isRunningUnderBun?: () => boolean;
  readonly envGuardSet?: () => boolean;
  readonly resolveBun?: () => Promise<string | null>;
  readonly resolveEntry?: () => Promise<string | null>;
  readonly spawn?: typeof spawn;
  readonly platform?: string;
  readonly createCredentialProxy?: () => Promise<CredentialProxyHandle | null>;
}

export interface RunLauncherOptions extends RelaunchOptions {
  readonly exit?: ExitFn;
}

function isRunningUnderBunDefault(): boolean {
  return (
    typeof process.versions.bun === 'string' && process.versions.bun.length > 0
  );
}

function envGuardSetDefault(): boolean {
  const { BUN_RELAUNCH_ENV } = getLauncherCredentialEnv();
  return process.env[BUN_RELAUNCH_ENV] === 'true';
}

function restoreCredentialSocket(
  credentialSocketEnv: string,
  originalSocket: string | undefined,
): void {
  // Treat an empty original value the same as "absent" so the restored
  // environment matches how hasUsableCredentialSocket() interprets it — an
  // empty-but-present socket var would otherwise mislead any consumer that
  // checks for mere presence.
  if (originalSocket === undefined || originalSocket.length === 0) {
    delete process.env[credentialSocketEnv];
    return;
  }
  process.env[credentialSocketEnv] = originalSocket;
}

function toCredentialProxyFatalError(error: unknown): FatalError {
  const detail = error instanceof Error ? error.message : String(error);
  return new FatalError(
    `Failed to start the credential proxy needed for Bun runtime access to saved provider credentials (${detail}). Reinstall dependencies with "npm install" and try again.`,
    43,
  );
}

async function createCredentialProxyDefault(): Promise<CredentialProxyHandle | null> {
  // Resolve the helper constants once up-front. If the helper is corrupt, the
  // FatalError surfaces here (before any side effects), never inside the
  // cleanup paths below where it would mask the original failure.
  const { CREDENTIAL_SOCKET_ENV, PROXY_SOCKET_PREFIX } =
    getLauncherCredentialEnv();
  const originalSocket = process.env[CREDENTIAL_SOCKET_ENV];
  const socketDir = await mkdtemp(join(tmpdir(), PROXY_SOCKET_PREFIX));
  let handle: { stop: () => Promise<void> } | undefined;
  try {
    const { createAndStartProxy, getProxySocketPath } = await import(
      '@vybestack/llxprt-code-providers/auth.js'
    );
    handle = await createAndStartProxy({ socketPath: socketDir });
    const socketPath = getProxySocketPath();
    if (socketPath === undefined) {
      throw new Error('proxy socket path was not reported');
    }
    // Provider proxy startup exposes its socket through module state but also
    // mutates process.env. Restore immediately so only the Bun child receives
    // the proxy socket in its environment.
    restoreCredentialSocket(CREDENTIAL_SOCKET_ENV, originalSocket);

    const startedHandle = handle;
    return {
      socketPath,
      stop: async () => {
        const removeSocketDir = rm(socketDir, { force: true, recursive: true });
        try {
          await Promise.allSettled([startedHandle.stop(), removeSocketDir]);
        } finally {
          restoreCredentialSocket(CREDENTIAL_SOCKET_ENV, originalSocket);
        }
      },
    };
  } catch (error) {
    if (handle !== undefined) {
      await handle.stop().catch(() => {});
    }
    restoreCredentialSocket(CREDENTIAL_SOCKET_ENV, originalSocket);
    await rm(socketDir, { force: true, recursive: true });
    throw toCredentialProxyFatalError(error);
  }
}

async function stopCredentialProxy(
  proxy: CredentialProxyHandle | null,
): Promise<void> {
  if (proxy === null) {
    return;
  }
  await proxy.stop().catch(() => {});
}

/**
 * npm shims on Windows produce `bun.cmd` wrappers that cannot be executed
 * directly by child_process.spawn without a shell. Detecting these lets the
 * spawn layer opt into shell mode only for the unsafe case.
 */
function isWindowsCmdShim(bunPath: string, platform: string): boolean {
  return platform === 'win32' && basename(bunPath).toLowerCase() === 'bun.cmd';
}

/**
 * Converts a spawn failure (synchronous throw or asynchronous 'error' event)
 * into a FatalError so the caller prints an actionable message instead of an
 * unhandled stack trace or a hung promise.
 */
function toSpawnFatalError(error: unknown, bunPath: string): FatalError {
  const detail = error instanceof Error ? error.message : String(error);
  return new FatalError(
    `Failed to launch Bun at "${bunPath}" (${detail}). Reinstall dependencies with "npm install" to restore the bundled Bun, or ensure a working Bun is executable and on your PATH (see https://bun.sh).`,
    43,
  );
}

async function resolveRequiredBunPath(
  resolveBun: () => Promise<string | null>,
): Promise<string> {
  const bunPath = await resolveBun();
  if (bunPath !== null) {
    return bunPath;
  }
  throw new FatalError(
    'Bun runtime was not found. Install it with "npm install" (it is bundled as the "bun" dependency) or install Bun directly from https://bun.sh and ensure it is on your PATH.',
    43,
  );
}

async function resolveRequiredEntry(
  resolveEntry: () => Promise<string | null>,
): Promise<string> {
  const entry = await resolveEntry();
  if (entry !== null) {
    return entry;
  }
  throw new FatalError(
    'Could not locate the LLxprt Code entry point (packages/cli/index.ts or dist/index.js). Your installation may be corrupt; reinstall @vybestack/llxprt-code.',
    43,
  );
}

async function createChildEnv(
  createCredentialProxy: () => Promise<CredentialProxyHandle | null>,
): Promise<{
  readonly childEnv: NodeJS.ProcessEnv;
  readonly credentialProxy: CredentialProxyHandle | null;
}> {
  const { createLauncherChildEnv, hasUsableCredentialSocket } =
    getLauncherCredentialEnv();
  const credentialProxy = hasUsableCredentialSocket()
    ? null
    : await createCredentialProxy();
  const childEnv = createLauncherChildEnv({
    credentialSocketPath: credentialProxy?.socketPath ?? null,
  });
  return { childEnv, credentialProxy };
}

function createSpawnOptions(
  bunPath: string,
  platform: string,
  childEnv: NodeJS.ProcessEnv,
): { stdio: 'inherit'; env: NodeJS.ProcessEnv; shell?: boolean } {
  const spawnOptions: {
    stdio: 'inherit';
    env: NodeJS.ProcessEnv;
    shell?: boolean;
  } = { stdio: 'inherit', env: childEnv };
  if (isWindowsCmdShim(bunPath, platform)) {
    spawnOptions.shell = true;
  }
  return spawnOptions;
}

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGILL: 132,
  SIGTRAP: 133,
  SIGABRT: 134,
  SIGBUS: 135,
  SIGFPE: 136,
  SIGKILL: 137,
  SIGUSR1: 138,
  SIGSEGV: 139,
  SIGUSR2: 140,
  SIGPIPE: 141,
  SIGALRM: 142,
  SIGTERM: 143,
  SIGBREAK: 149,
};

function exitCodeForClose(
  code: number | null,
  signal: NodeJS.Signals | null,
): number {
  if (code !== null) return code;
  if (signal !== null) return SIGNAL_EXIT_CODES[signal] ?? 1;
  return 1;
}

function hasWindowsCmdMetaCharacter(arg: string): boolean {
  return /[&|<>^()%!"\r\n]/.test(arg);
}

function resolveSpawnArgs(
  bunPath: string,
  platform: string,
  entry: string,
): string[] {
  const args = [entry, ...process.argv.slice(2)];
  if (
    isWindowsCmdShim(bunPath, platform) &&
    args.some(hasWindowsCmdMetaCharacter)
  ) {
    throw new FatalError(
      'Cannot safely forward arguments containing Windows command-shell metacharacters through the bundled bun.cmd shim. Install Bun directly so bun.exe is on PATH, or remove shell metacharacters from the CLI arguments.',
      43,
    );
  }
  return args;
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGBREAK',
];

function waitForChildExit(
  child: ChildProcess,
  bunPath: string,
  credentialProxy: CredentialProxyHandle | null,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const forwardSignal = (signal: NodeJS.Signals): void => {
      // child.killed only means a signal was sent, not that the child exited;
      // gate on the launcher's settled state so signals forward until exit.
      if (!settled) {
        child.kill(signal);
      }
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      child.off('close', onClose);
      child.off('error', onError);
      for (const signal of FORWARDED_SIGNALS) {
        process.off(signal, forwardSignal);
      }
      child.on('error', () => {
        // Swallow post-settle errors; the launcher outcome is already fixed.
      });
      void stopCredentialProxy(credentialProxy).then(callback);
    };
    const onClose = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => settle(() => resolve(exitCodeForClose(code, signal)));
    const onError = (error: Error): void => {
      const fatalError = toSpawnFatalError(error, bunPath);
      settle(() => reject(fatalError));
    };
    for (const signal of FORWARDED_SIGNALS) {
      process.on(signal, forwardSignal);
    }
    child.on('close', onClose);
    child.on('error', onError);
  });
}

export async function relaunchUnderBunIfNeeded(
  options: RelaunchOptions = {},
): Promise<LauncherOutcome> {
  const isRunningUnderBun =
    options.isRunningUnderBun ?? isRunningUnderBunDefault;
  const envGuardSet = options.envGuardSet ?? envGuardSetDefault;
  if (isRunningUnderBun() || envGuardSet()) return { relaunched: false };

  const resolveBun = options.resolveBun ?? (() => resolveBunPath());
  const resolveEntry = options.resolveEntry ?? (() => resolveBunEntry());
  const spawnFn = options.spawn ?? spawn;
  const platform = options.platform ?? process.platform;
  const createCredentialProxy =
    options.createCredentialProxy ?? createCredentialProxyDefault;
  const bunPath = await resolveRequiredBunPath(resolveBun);
  const entry = await resolveRequiredEntry(resolveEntry);
  const { childEnv, credentialProxy } = await createChildEnv(
    createCredentialProxy,
  );

  let child: ChildProcess;
  try {
    const spawnOptions = createSpawnOptions(bunPath, platform, childEnv);
    const spawnArgs = resolveSpawnArgs(bunPath, platform, entry);
    child = spawnFn(bunPath, spawnArgs, spawnOptions);
  } catch (spawnError) {
    await stopCredentialProxy(credentialProxy);
    if (spawnError instanceof FatalError) {
      throw spawnError;
    }
    throw toSpawnFatalError(spawnError, bunPath);
  }

  const exitCode = await waitForChildExit(child, bunPath, credentialProxy);
  return { relaunched: true, exitCode };
}

export async function runBunLauncherIfNeeded(
  options: RunLauncherOptions = {},
): Promise<void> {
  const outcome = await relaunchUnderBunIfNeeded(options);
  if (outcome.relaunched) {
    const exit = options.exit ?? process.exit;
    exit(outcome.exitCode);
  }
}
