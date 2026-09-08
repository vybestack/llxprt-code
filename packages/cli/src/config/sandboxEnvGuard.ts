/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import * as dotenv from 'dotenv';
import { Storage } from '@vybestack/llxprt-code-settings';

/**
 * Environment variables that decide how the host sandbox launcher is built:
 * the raw engine argv, the engine and image, the bind mounts, the network
 * policy, and the resource limits.
 *
 * A repository the user merely checked out must not be able to set any of
 * these through its own `.env`, because doing so hands the repository control
 * of the host container command. That is the credential boundary issue #2946
 * established and issue #2958 closes.
 *
 * The `LLXPRT_*_HOME` roots are included for two reasons. They select the host
 * directory that `buildContainerRunArgs` bind-mounts into the container, and
 * they are what `isUserGlobalEnvFile` consults to decide whether a file is
 * user-global. Leaving them settable let a repo `.env` point the config root at
 * its own directory, after which the second loader classified that same file as
 * user-global and accepted its `SANDBOX_FLAGS`.
 */
export const SANDBOX_LAUNCHER_ENV_VARS: ReadonlySet<string> = new Set([
  'SANDBOX_FLAGS',
  'SANDBOX_ENV',
  'LLXPRT_SANDBOX_MOUNTS',
  'SANDBOX_MOUNTS',
  'LLXPRT_SANDBOX',
  'SANDBOX',
  'LLXPRT_SANDBOX_IMAGE',
  'BUILD_SANDBOX',
  'SEATBELT_PROFILE',
  'LLXPRT_SANDBOX_NETWORK',
  'SANDBOX_NETWORK',
  'LLXPRT_SANDBOX_PROXY_COMMAND',
  'LLXPRT_SANDBOX_CPUS',
  'SANDBOX_CPUS',
  'LLXPRT_SANDBOX_MEMORY',
  'SANDBOX_MEMORY',
  'LLXPRT_SANDBOX_PIDS',
  'SANDBOX_PIDS',
  'SANDBOX_PORTS',
  'LLXPRT_SANDBOX_SSH_AGENT',
  'SANDBOX_SSH_AGENT',
  'SANDBOX_SET_UID_GID',
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
]);

/**
 * The subset of {@link SANDBOX_LAUNCHER_ENV_VARS} that relocates the storage
 * roots, and therefore decides which env files count as user-global.
 */
const STORAGE_ROOT_ENV_VARS: ReadonlySet<string> = new Set([
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
]);

/**
 * Windows environment variable names are case-insensitive, so `sandbox_flags`
 * in a `.env` resolves as `process.env.SANDBOX_FLAGS` at the consumer. Matching
 * on an upper-cased key closes that bypass; every guarded name is ASCII, and
 * `toUpperCase` (unlike `toLocaleUpperCase`) is locale-independent.
 */
export function isSandboxLauncherEnvVar(key: string): boolean {
  return SANDBOX_LAUNCHER_ENV_VARS.has(key.toUpperCase());
}

/**
 * Env files the user owns, and which may therefore still set launcher
 * controls. Only the exact global locations that the two `findEnvFile`
 * implementations can return are trusted — not every descendant of a global
 * root, so a repository that happens to sit under one is still repo-controlled.
 */
export function isUserGlobalEnvFile(envFilePath: string): boolean {
  const resolvedEnvPath = path.resolve(envFilePath);
  const trustedEnvFiles = [
    path.resolve(Storage.getGlobalConfigDir(), '.env'),
    path.resolve(Storage.getGlobalDataDir(), '.env'),
    path.resolve(homedir(), '.env'),
  ];
  return trustedEnvFiles.includes(resolvedEnvPath);
}

/**
 * The env files the Bun runtime loads from the working directory on its own,
 * before any application code runs.
 *
 * Bun defaults the mode to `development` when `NODE_ENV` is unset, which is the
 * ordinary case for a user running the CLI: with no default here, a repository
 * could put its launcher controls in `.env.development` and Bun would load a
 * file this scrub never looked at.
 */
function runtimeAutoLoadedEnvFiles(): string[] {
  const nodeEnv = process.env.NODE_ENV;
  const mode =
    nodeEnv !== undefined && nodeEnv !== '' ? nodeEnv : 'development';
  return ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
}

/**
 * Removes sandbox launcher controls that the runtime injected from a
 * repo-controlled env file.
 *
 * The published `llxprt` bin execs Bun, and Bun reads `<cwd>/.env` into
 * `process.env` before the first line of application code. By the time either
 * env loader runs, a repository's `SANDBOX_FLAGS` is already indistinguishable
 * from one the user exported in their shell, so declining to apply the file is
 * not enough: the value has to be taken back out.
 *
 * A launcher control is dropped whenever a repo-controlled env file NAMES it,
 * without comparing values. Bun performs `$VAR` expansion that `dotenv.parse`
 * does not, so the two spellings of the same entry need not match, and a
 * comparison would fail open exactly on the credential-forwarding case this
 * exists to stop. The cost is that a user's own export of the same variable is
 * also dropped when the repository tries to set it — the repository cannot
 * thereby choose a value, only decline to have one, and a sandbox profile still
 * applies afterwards.
 */
export function stripRuntimeInjectedLauncherVars(
  cwd: string,
): readonly string[] {
  const files: Array<{
    readonly envFilePath: string;
    readonly parsed: Record<string, string>;
  }> = [];
  for (const name of runtimeAutoLoadedEnvFiles()) {
    const envFilePath = path.join(cwd, name);
    try {
      files.push({
        envFilePath,
        parsed: dotenv.parse(fs.readFileSync(envFilePath, 'utf-8')),
      });
    } catch {
      // Absent or unreadable: nothing the runtime could have injected from it.
    }
  }

  const homeEnvFile = path.resolve(homedir(), '.env');
  const stripped: string[] = [];

  // Pass one. The storage roots are what decide which files count as
  // user-global, so a file in the working directory may never supply them —
  // otherwise it nominates itself as trusted and the rest of the guard
  // evaluates against a root it chose. `~/.env` is exempt because `homedir()`
  // is not reachable from any guarded variable.
  for (const { envFilePath, parsed } of files) {
    if (path.resolve(envFilePath) === homeEnvFile) {
      continue;
    }
    for (const key of Object.keys(parsed)) {
      if (STORAGE_ROOT_ENV_VARS.has(key.toUpperCase())) {
        deleteEnvVar(key);
        stripped.push(key);
      }
    }
  }

  // Pass two. The roots are now authentic, so classification is trustworthy.
  for (const { envFilePath, parsed } of files) {
    if (isUserGlobalEnvFile(envFilePath)) {
      continue;
    }
    for (const key of Object.keys(parsed)) {
      if (isSandboxLauncherEnvVar(key)) {
        deleteEnvVar(key);
        stripped.push(key);
      }
    }
  }
  return stripped;
}

/**
 * Deletes both spellings: Windows resolves environment names
 * case-insensitively, so a lower-cased key in a file reaches the upper-cased
 * name every consumer reads.
 */
function deleteEnvVar(key: string): void {
  delete process.env[key];
  delete process.env[key.toUpperCase()];
}
