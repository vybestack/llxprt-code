/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { quote } from 'shell-quote';
import { exec } from 'node:child_process';
import type { Config, SandboxConfig } from '@vybestack/llxprt-code-core';
import {
  FatalSandboxError,
  getErrorMessage,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';
import {
  getPassthroughEnvVars,
  isSandboxDebugModeEnabled,
} from './sandbox-env.js';
import { canonicalizeExistingPath } from './sandbox-path-canonicalization.js';
import { Storage } from '@vybestack/llxprt-code-storage';

const execAsync = promisify(exec);

const BUILTIN_SEATBELT_PROFILES = [
  'permissive-open',
  'permissive-closed',
  'permissive-proxied',
  'restrictive-open',
  'restrictive-closed',
  'restrictive-proxied',
];
export function normalizeExitCode(
  code: number | null,
  signal: NodeJS.Signals | null,
): number {
  if (typeof code === 'number') {
    return code;
  }
  if (signal === 'SIGINT') {
    return 130;
  }
  if (signal === 'SIGTERM') {
    return 143;
  }
  return 1;
}

/** Runs the macOS Seatbelt (sandbox-exec) sandbox path. */
export async function runSeatbeltSandbox(
  config: SandboxConfig,
  nodeArgs: string[],
  cliConfig?: Config,
  cliArgs: string[] = [],
): Promise<number> {
  // Seatbelt path does NOT use the container credential proxy lifecycle.
  // @plan:PLAN-20250214-CREDPROXY.P34 - no container credential proxy in seatbelt flow
  if (process.env['BUILD_SANDBOX']) {
    throw new FatalSandboxError(
      'Cannot BUILD_SANDBOX when using macOS Seatbelt',
    );
  }

  const explicitProfile = process.env.SEATBELT_PROFILE;
  const networkMode =
    process.env.LLXPRT_SANDBOX_NETWORK ?? process.env.SANDBOX_NETWORK;
  let automaticProfile = 'permissive-open';
  if (networkMode === 'off') {
    automaticProfile = 'permissive-closed';
  } else if (networkMode === 'proxied') {
    automaticProfile = 'permissive-proxied';
  }
  const profile =
    explicitProfile !== undefined && explicitProfile.length > 0
      ? explicitProfile
      : automaticProfile;
  process.env.SEATBELT_PROFILE = profile;
  if (
    (profile === 'permissive-proxied' || profile === 'restrictive-proxied') &&
    !process.env.LLXPRT_SANDBOX_PROXY_COMMAND?.trim()
  ) {
    throw new FatalSandboxError(
      'Seatbelt proxied profile requires a non-empty LLXPRT_SANDBOX_PROXY_COMMAND.',
    );
  }
  let profileFile = fileURLToPath(
    new URL(`./sandbox-macos-${profile}.sb`, import.meta.url),
  );
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
  debugLogger.error(`using macos seatbelt (profile: ${profile}) ...`);
  const nodeOptions = [
    ...(isSandboxDebugModeEnabled(process.env.DEBUG) ? ['--inspect-brk'] : []),
    ...nodeArgs,
  ].join(' ');

  const args = buildSeatbeltArgs(profileFile, nodeOptions, cliConfig, cliArgs);
  const { sandboxEnv, proxyProcess, proxyCommand } = await setupSeatbeltProxy();
  const sandboxProcess = spawnSeatbeltProcess(config, args, sandboxEnv);
  wireSeatbeltProxyCloseHandler(proxyProcess, sandboxProcess, proxyCommand);

  // Restore parent stdin mode/state after the sandbox exits.
  const stdinWasPaused = process.stdin.isPaused();
  const stdinHadRawMode =
    process.stdin.isTTY &&
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

  return waitForSeatbeltExit(
    sandboxProcess,
    stdinWasPaused,
    stdinHadRawMode,
    cliConfig,
  );
}
function resolveProxyUrl(): string {
  const candidates = [
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
  ];
  return candidates.find((v): v is string => !!v) ?? 'http://localhost:8877';
}

export function buildSeatbeltArgs(
  profileFile: string,
  nodeOptions: string,
  cliConfig?: Config,
  cliArgs: string[] = [],
): string[] {
  // Resolve canonical config/data/cache/log roots via the shared path
  // resolver (Storage delegates to path-resolver.ts). These are passed as
  // dedicated params so .sb profiles grant writes to the exact canonical
  // roots instead of the legacy HOME_DIR/.llxprt path. CACHE_DIR resolves
  // through Storage.getGlobalCacheDir() (honoring LLXPRT_CACHE_HOME →
  // LLXPRT_CONFIG_HOME → platform cache), NOT the Darwin per-user cache dir.
  const configDir = resolveSeatbeltRootDir(
    Storage.getGlobalConfigDir(),
    'config',
  );
  const dataDir = resolveSeatbeltRootDir(Storage.getGlobalDataDir(), 'data');
  const cacheDir = resolveSeatbeltRootDir(Storage.getGlobalCacheDir(), 'cache');
  const logDir = resolveSeatbeltRootDir(Storage.getGlobalLogDir(), 'log');
  const args = [
    '-D',
    `TARGET_DIR=${canonicalizeExistingPath(process.cwd(), 'resolve the sandbox workspace')}`,
    '-D',
    `TMP_DIR=${canonicalizeExistingPath(os.tmpdir(), 'resolve the sandbox temporary directory')}`,
    '-D',
    `HOME_DIR=${canonicalizeExistingPath(os.homedir(), 'resolve the sandbox home directory')}`,
    '-D',
    `CACHE_DIR=${cacheDir}`,
    '-D',
    `CONFIG_DIR=${configDir}`,
    '-D',
    `DATA_DIR=${dataDir}`,
    '-D',
    `LOG_DIR=${logDir}`,
  ];

  const MAX_INCLUDE_DIRS = 5;
  const targetDir = canonicalizeExistingPath(
    cliConfig?.getTargetDir() ?? '',
    'resolve the sandbox target directory',
  );
  const includedDirs: string[] = [];
  if (cliConfig) {
    const workspaceContext = cliConfig.getWorkspaceContext();
    for (const dir of workspaceContext.getDirectories()) {
      const realDir = canonicalizeExistingPath(
        dir,
        'resolve a sandbox include directory',
      );
      if (realDir !== targetDir) {
        includedDirs.push(realDir);
      }
    }
  }
  for (let i = 0; i < MAX_INCLUDE_DIRS; i++) {
    const dirPath = i < includedDirs.length ? includedDirs[i] : '/dev/null';
    args.push('-D', `INCLUDE_DIR_${i}=${dirPath}`);
  }

  args.push(
    '-f',
    profileFile,
    'sh',
    '-c',
    [
      `SANDBOX=sandbox-exec`,
      `NODE_OPTIONS="${nodeOptions}"`,
      ...cliArgs.map((arg) => quote([arg])),
    ].join(' '),
  );
  return args;
}

/**
 * Resolves the canonical real path for a seatbelt root directory, creating
 * it first if it does not exist (so fresh installs work). Uses mode 0o700
 * so auto-created canonical roots — including DATA_DIR which can hold
 * OAuth fallback files — are not world-readable. Canonicalization failure
 * is a classified sandbox error naming the path and root role; there is no
 * lexical fallback, because the .sb profile must grant access to the exact
 * canonical root.
 */
function resolveSeatbeltRootDir(dirPath: string, role: string): string {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new FatalSandboxError(
        `Failed to resolve the sandbox ${role} directory: creating ` +
          `'${dirPath}' failed (${getErrorMessage(error)}). Verify the ` +
          `path and its permissions, then retry.`,
      );
    }
  }
  return canonicalizeExistingPath(
    dirPath,
    `resolve the sandbox ${role} directory`,
  );
}

interface SeatbeltProxySetup {
  sandboxEnv: NodeJS.ProcessEnv;
  proxyProcess?: ChildProcess;
  proxyCommand?: string;
}

async function setupSeatbeltProxy(): Promise<SeatbeltProxySetup> {
  const proxyCommand = process.env.LLXPRT_SANDBOX_PROXY_COMMAND;
  const sandboxEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...getPassthroughEnvVars(process.env),
  };

  // O15: The seatbelt child must NEVER inherit capability transport markers
  // from the parent, even if the parent env still contains them.
  delete sandboxEnv['LLXPRT_CAPABILITY_TOKEN'];
  delete sandboxEnv['LLXPRT_CAPABILITY_FD'];
  delete sandboxEnv['LLXPRT_CREDENTIAL_SOCKET'];

  if (!proxyCommand) {
    return { sandboxEnv };
  }

  const proxy = resolveProxyUrl();
  sandboxEnv['HTTPS_PROXY'] = proxy;
  sandboxEnv['https_proxy'] = proxy;
  sandboxEnv['HTTP_PROXY'] = proxy;
  sandboxEnv['http_proxy'] = proxy;
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
  if (noProxy) {
    sandboxEnv['NO_PROXY'] = noProxy;
    sandboxEnv['no_proxy'] = noProxy;
  }
  const proxyProcess = spawn(proxyCommand, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    detached: true,
  });
  const stopProxyHandler = () => {
    debugLogger.log('stopping proxy ...');
    const proxyPid = proxyProcess.pid;
    if (proxyPid !== undefined && proxyPid !== 0) {
      process.kill(-proxyPid, 'SIGTERM');
    }
  };
  process.on('exit', stopProxyHandler);
  process.on('SIGINT', stopProxyHandler);
  process.on('SIGTERM', stopProxyHandler);
  proxyProcess.stderr.on('data', (data) => {
    debugLogger.error(data.toString());
  });
  debugLogger.log('waiting for proxy to start ...');
  const SEATBELT_PROXY_READY_TIMEOUT_MS = 30000;
  try {
    await execAsync(
      `timeout ${Math.floor(SEATBELT_PROXY_READY_TIMEOUT_MS / 1000)} bash -c 'until curl -s http://localhost:8877; do sleep 0.25; done'`,
      { timeout: SEATBELT_PROXY_READY_TIMEOUT_MS + 5000 },
    );
  } catch (err) {
    const proxyPid = proxyProcess.pid;
    if (proxyPid !== undefined && proxyPid !== 0) {
      try {
        process.kill(-proxyPid, 'SIGTERM');
      } catch {
        // ignore
      }
    }
    throw new FatalSandboxError(
      `Proxy command failed to become ready within ${SEATBELT_PROXY_READY_TIMEOUT_MS}ms: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { sandboxEnv, proxyProcess, proxyCommand };
}

function signalSeatbeltProcessGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
    ) {
      throw error;
    }
  }
}

/**
 * Terminate the sandbox when its credential proxy dies unexpectedly.
 *
 * Exported for direct unit testing of the ordering contract: a proxy close is
 * fatal only while the sandbox is still running.
 */
export function wireSeatbeltProxyCloseHandler(
  proxyProcess: ChildProcess | undefined,
  sandboxProcess: ChildProcess,
  proxyCommand: string | undefined,
): void {
  if (!proxyProcess || !proxyCommand) {
    return;
  }
  // The proxy is a child of this process and closes as part of normal teardown
  // once the sandbox itself has exited. A close is therefore only a failure
  // while the sandbox is still running; treating every close as fatal forces
  // exit(1) at the end of an otherwise successful session.
  let sandboxExited = false;
  sandboxProcess.once('exit', () => {
    sandboxExited = true;
  });

  proxyProcess.on('close', (code, signal) => {
    if (sandboxExited) {
      return;
    }
    const sandboxPid = sandboxProcess.pid;
    if (sandboxPid !== undefined && sandboxPid !== 0) {
      signalSeatbeltProcessGroup(sandboxPid);
    }
    // Avoid throwing inside an event callback (uncaught async throw).
    // Log the failure and terminate the process group so the sandbox exits.
    debugLogger.error(
      `Proxy command '${proxyCommand}' exited with code ${code}, signal ${signal}`,
    );
    process.exit(1);
  });
}

function spawnSeatbeltProcess(
  config: SandboxConfig,
  args: string[],
  sandboxEnv: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(config.command, args, {
    stdio: 'inherit',
    env: sandboxEnv,
  });
}

async function waitForSeatbeltExit(
  sandboxProcess: ChildProcess,
  stdinWasPaused: boolean,
  stdinHadRawMode: boolean,
  cliConfig?: Config,
): Promise<number> {
  return new Promise<number>((resolve) => {
    sandboxProcess.on('close', (code, signal) => {
      if (!process.stdin.isTTY) {
        resolve(normalizeExitCode(code, signal));
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
      resolve(normalizeExitCode(code, signal));
    });
  });
}
