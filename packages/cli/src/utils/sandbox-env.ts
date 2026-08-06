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

/** Checks if any ID_LIKE= line in /etc/os-release contains the given keyword. */
function osReleaseContainsLike(content: string, keyword: string): boolean {
  for (const line of content.split('\n')) {
    if (line.startsWith('ID_LIKE=') && line.includes(keyword)) {
      return true;
    }
  }
  return false;
}

export function shouldUseCurrentUserInSandboxSync(): boolean {
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
      if (
        osReleaseContent.includes('ID=debian') ||
        osReleaseContent.includes('ID=ubuntu') ||
        osReleaseContainsLike(osReleaseContent, 'debian') ||
        osReleaseContainsLike(osReleaseContent, 'ubuntu')
      ) {
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

export async function shouldUseCurrentUserInSandbox(): Promise<boolean> {
  return shouldUseCurrentUserInSandboxSync();
}

/**
 * The container HOME used to derive container-local XDG directories.
 *
 * Mirrors the HOME that {@link setupContainerUser} pins (the host home under
 * `SANDBOX_SET_UID_GID`/Debian-Ubuntu auto-detect, otherwise the image default
 * `/home/node`). Sharing this single resolution between
 * {@link buildContainerRunArgs} — which sets the `LLXPRT_*_HOME` env overrides
 * — and the user setup guarantees the in-container HOME and the pinned roots
 * can never disagree. Synchronous so it is callable from the synchronous
 * arg builder.
 */
export function resolveSandboxContainerHome(): string {
  return shouldUseCurrentUserInSandboxSync()
    ? getContainerPath(os.homedir())
    : '/home/node';
}
