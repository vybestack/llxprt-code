/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

const PASSTHROUGH_VARIABLES = [
  'LLXPRT_CODE_IDE_SERVER_PORT',
  'LLXPRT_CODE_IDE_WORKSPACE_PATH',
  'LLXPRT_CODE_WELCOME_CONFIG_PATH',
  'TERM_PROGRAM',
] as const;

export function getContainerPath(hostPath: string): string {
  if (os.platform() !== 'win32') {
    return hostPath;
  }

  const withForwardSlashes = hostPath.replace(/\\/g, '/');
  const match = withForwardSlashes.match(/^([A-Z]):\/(.*)/i);
  if (match) {
    return `/${match[1].toLowerCase()}/${match[2]}`;
  }
  return hostPath;
}

export function getPassthroughEnvVars(
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const envVar of PASSTHROUGH_VARIABLES) {
    const value = env[envVar];
    if (typeof value === 'string' && value.length > 0) {
      result[envVar] = value;
    }
  }

  return result;
}

export function buildSandboxEnvArgs(env: NodeJS.ProcessEnv): string[] {
  return Object.entries(getPassthroughEnvVars(env)).flatMap(([key, value]) => [
    '--env',
    `${key}=${value}`,
  ]);
}

export function mountGitConfigFiles(
  args: string[],
  hostHomedir: string,
  containerHomePath: string,
): void {
  const gitConfigFiles = [
    '.gitconfig',
    path.join('.config', 'git', 'config'),
    '.gitignore_global',
    path.join('.ssh', 'known_hosts'),
  ];

  for (const relPath of gitConfigFiles) {
    const hostPath = path.join(hostHomedir, relPath);
    if (!fs.existsSync(hostPath)) {
      continue;
    }

    const containerHostPath = getContainerPath(hostPath);
    args.push('--volume', `${hostPath}:${containerHostPath}:ro`);

    // The bind source stays host-native, but the container-side destination
    // is a Linux path and must always be built with path.posix so it never
    // contains backslashes on Windows hosts.
    const containerAltPath = path.posix.join(
      getContainerPath(containerHomePath),
      relPath.split(path.sep).join(path.posix.sep),
    );
    if (containerAltPath !== containerHostPath) {
      args.push('--volume', `${hostPath}:${containerAltPath}:ro`);
    }
  }
}

export function sandboxPorts(): string[] {
  return (process.env.SANDBOX_PORTS ?? '')
    .split(',')
    .filter((p) => p.trim())
    .map((p) => p.trim());
}

export function isSandboxDebugModeEnabled(debugValue?: string): boolean {
  return debugValue === 'true' || debugValue === '1';
}

/**
 * True only when the sandbox launches from a positively identified
 * llxprt-code source checkout in development mode (#3455).
 *
 * `NODE_ENV=development` alone is an ambient shell value that can leak into
 * any repository, so it never selects the source path by itself; the
 * workspace must contain the checked-out CLI source entrypoint that the
 * source command execs. Entrypoint command selection and the #3450 private
 * dependency-volume planning share this one predicate so an arbitrary
 * repository can neither receive a nonexistent source command nor bypass
 * private dependency isolation, while a supported source checkout keeps the
 * shared workspace bind its bootstrap requires.
 */
export function isSourceDevelopmentWorkdir(workdir: string): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return false;
  }
  try {
    return fs
      .statSync(path.join(workdir, 'packages', 'cli', 'index.ts'))
      .isFile();
  } catch {
    return false;
  }
}

function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  if (env.CI === 'true' || env.CI === '1') {
    return true;
  }
  if (env.GITHUB_ACTIONS === 'true') {
    return true;
  }
  return env.BUILD_ID !== undefined || env.BUILD_NUMBER !== undefined;
}

export function shouldAllocateSandboxTty(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const hasExplicitParentTty =
    process.stdin.isTTY === true || process.stdout.isTTY === true;

  if (hasExplicitParentTty) {
    return true;
  }

  if (isCiEnvironment(env)) {
    return false;
  }

  const term = env.TERM;
  return typeof term === 'string' && term.length > 0 && term !== 'dumb';
}

export function resolveDebugPort(): string {
  const debugPort = process.env.DEBUG_PORT;
  return debugPort !== undefined && debugPort !== '' ? debugPort : '9229';
}

export function parseImageName(image: string): string {
  const [fullName, tag] = image.split(':');
  const name = fullName.split('/').at(-1) ?? 'unknown-image';
  return tag ? `${name}-${tag}` : name;
}

function osReleaseValue(content: string, key: string): string | undefined {
  const prefix = `${key}=`;
  const line = content.split('\n').find((entry) => entry.startsWith(prefix));
  if (line === undefined) {
    return undefined;
  }
  const value = line.slice(prefix.length).trim();
  const quote = value.at(0);
  if (quote !== '"' && quote !== "'") {
    return value;
  }
  const closingQuote = value.endsWith(quote) ? -1 : undefined;
  return value.slice(1, closingQuote);
}

function isDebianLikeOsRelease(content: string): boolean {
  const id = osReleaseValue(content, 'ID');
  if (id === 'debian' || id === 'ubuntu') {
    return true;
  }
  const idLike = osReleaseValue(content, 'ID_LIKE');
  return (
    idLike
      ?.split(/\s+/)
      .some((value) => value === 'debian' || value === 'ubuntu') ?? false
  );
}

export function shouldUseCurrentUserInSandbox(): boolean {
  const envVar = process.env.SANDBOX_SET_UID_GID?.toLowerCase().trim();

  if (envVar === '1' || envVar === 'true') {
    return true;
  }
  if (envVar === '0' || envVar === 'false') {
    return false;
  }

  if (os.platform() === 'linux') {
    try {
      const osReleaseContent = fs.readFileSync('/etc/os-release', 'utf8');
      if (isDebianLikeOsRelease(osReleaseContent)) {
        debugLogger.log(
          'INFO: Defaulting to use current user UID/GID for Debian/Ubuntu-based Linux.',
        );
        return true;
      }
    } catch {
      debugLogger.warn(
        'Warning: Could not read /etc/os-release to auto-detect Debian/Ubuntu for UID/GID default.',
      );
    }
  }
  return false;
}

/**
 * The container HOME used to derive container-local XDG directories.
 *
 * Mirrors the HOME that {@link setupContainerUser} pins (the host home under
 * `SANDBOX_SET_UID_GID`/Debian-Ubuntu auto-detect, otherwise the image default
 * `/home/node`). Sharing this single resolution between
 * {@link buildContainerRunArgs} — which sets the `LLXPRT_*_HOME` env overrides
 * — and the user setup guarantees the in-container HOME and the pinned roots
 * can never disagree.
 */
export function resolveSandboxContainerHome(): string {
  return shouldUseCurrentUserInSandbox()
    ? getContainerPath(os.homedir())
    : '/home/node';
}
