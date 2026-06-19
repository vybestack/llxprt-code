/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { quote } from 'shell-quote';
import { exec } from 'node:child_process';
import type { Config, SandboxConfig } from '@vybestack/llxprt-code-core';
import { FatalSandboxError, debugLogger } from '@vybestack/llxprt-code-core';
import { SETTINGS_DIRECTORY_NAME } from '../config/settings.js';
import {
  getPassthroughEnvVars,
  isSandboxDebugModeEnabled,
} from './sandbox-env.js';

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

  const profile = (process.env.SEATBELT_PROFILE ??= 'permissive-open');
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

function buildSeatbeltArgs(
  profileFile: string,
  nodeOptions: string,
  cliConfig?: Config,
  cliArgs: string[] = [],
): string[] {
  const cacheDir = fs.realpathSync(
    execSync('getconf DARWIN_USER_CACHE_DIR').toString().trim(),
  );
  const args = [
    '-D',
    `TARGET_DIR=${fs.realpathSync(process.cwd())}`,
    '-D',
    `TMP_DIR=${fs.realpathSync(os.tmpdir())}`,
    '-D',
    `HOME_DIR=${fs.realpathSync(os.homedir())}`,
    '-D',
    `CACHE_DIR=${cacheDir}`,
  ];

  const MAX_INCLUDE_DIRS = 5;
  const targetDir = fs.realpathSync(cliConfig?.getTargetDir() ?? '');
  const includedDirs: string[] = [];
  if (cliConfig) {
    const workspaceContext = cliConfig.getWorkspaceContext();
    for (const dir of workspaceContext.getDirectories()) {
      const realDir = fs.realpathSync(dir);
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
  await execAsync(
    `until timeout 0.25 curl -s http://localhost:8877; do sleep 0.25; done`,
  );
  return { sandboxEnv, proxyProcess, proxyCommand };
}

function wireSeatbeltProxyCloseHandler(
  proxyProcess: ChildProcess | undefined,
  sandboxProcess: ChildProcess,
  proxyCommand: string | undefined,
): void {
  if (!proxyProcess || !proxyCommand) {
    return;
  }
  proxyProcess.on('close', (code, signal) => {
    const sandboxPid = sandboxProcess.pid;
    if (sandboxPid !== undefined && sandboxPid !== 0) {
      process.kill(-sandboxPid, 'SIGTERM');
    }
    throw new FatalSandboxError(
      `Proxy command '${proxyCommand}' exited with code ${code}, signal ${signal}`,
    );
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
