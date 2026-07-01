/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, constants } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';

const PATH_COMMAND_TIMEOUT_MS = 5_000;
const MAX_PATH_COMMAND_OUTPUT_BYTES = 65_536;
export type PathChecker = (targetPath: string) => Promise<boolean>;

export type PathCommand = (
  tool: string,
  args: string[],
) => Promise<string | null>;

export interface ResolveBunPathOptions {
  readonly platform?: string;
  readonly moduleDir?: string;
  readonly pathChecker?: PathChecker;
  readonly pathCommand?: PathCommand;
}

/**
 * `.bin` shim names probed per platform. These correspond to the symlinks npm
 * (or other package managers) create under node_modules/.bin for the "bun"
 * bin entry.
 */
function binCandidatesForPlatform(platform: string): readonly string[] {
  return platform === 'win32' ? ['bun.exe', 'bun.cmd'] : ['bun'];
}

/**
 * Direct dependency executable names under node_modules/bun/bin.
 *
 * The published "bun" npm package maps its "bun" bin entry to "bin/bun.exe"
 * on every platform (see node_modules/bun/package.json), so the real native
 * executable is always named bun.exe. On Windows we additionally tolerate a
 * bun.cmd wrapper for robustness, though the canonical path is bun.exe.
 */
function directDependencyCandidatesForPlatform(
  platform: string,
): readonly string[] {
  return platform === 'win32' ? ['bun.exe', 'bun.cmd'] : ['bun.exe'];
}

/**
 * Collects each ancestor directory starting from moduleDir through the
 * filesystem root.
 */
export function* ancestorDirs(startDir: string): Generator<string> {
  if (startDir.length === 0) {
    return;
  }
  let dir = startDir;
  while (dir !== dirname(dir)) {
    yield dir;
    dir = dirname(dir);
  }
  yield dir;
}

async function resolveFromNodeModules(
  moduleDir: string,
  platform: string,
  pathChecker: PathChecker,
): Promise<string | null> {
  const binCandidates = binCandidatesForPlatform(platform);
  const depCandidates = directDependencyCandidatesForPlatform(platform);

  for (const dir of ancestorDirs(moduleDir)) {
    // 1. Prefer the package-local .bin shim (fastest, correct symlink target).
    for (const candidate of binCandidates) {
      const candidatePath = join(dir, 'node_modules', '.bin', candidate);
      if (await pathChecker(candidatePath)) {
        return candidatePath;
      }
    }
    // 2. Fall back to the direct dependency executable. In published npm
    //    installs the .bin shim may be absent (e.g., some pnpm layouts or
    //    partial installs) but the bun package still ships its executable at
    //    node_modules/bun/bin/bun.exe.
    for (const candidate of depCandidates) {
      const candidatePath = join(dir, 'node_modules', 'bun', 'bin', candidate);
      if (await pathChecker(candidatePath)) {
        return candidatePath;
      }
    }
  }
  return null;
}

async function resolveFromPath(
  platform: string,
  pathCommand: PathCommand,
  pathChecker: PathChecker,
): Promise<string | null> {
  const tool = platform === 'win32' ? 'where' : 'which';
  let result: string | null;
  try {
    result = await pathCommand(tool, ['bun']);
  } catch {
    return null;
  }
  if (result === null) {
    return null;
  }
  for (const line of result.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/^(["'])(.+?)\1$/, '$2');
    if (trimmed.length > 0 && (await pathChecker(trimmed))) {
      return trimmed;
    }
  }
  return null;
}

export async function resolveBunPath(
  options: ResolveBunPathOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const moduleDir =
    options.moduleDir ?? dirname(fileURLToPath(import.meta.url));
  const pathChecker = options.pathChecker ?? defaultPathChecker;
  const pathCommand = options.pathCommand ?? defaultPathCommand;

  const fromNodeModules = await resolveFromNodeModules(
    moduleDir,
    platform,
    pathChecker,
  );
  if (fromNodeModules !== null) {
    return fromNodeModules;
  }

  return resolveFromPath(platform, pathCommand, pathChecker);
}

async function defaultPathChecker(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

type PathCommandResult =
  | { readonly kind: 'close'; readonly code: number | null }
  | { readonly kind: 'error' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'output-too-large' };

function spawnPathCommand(tool: string, args: string[]): ChildProcess | null {
  try {
    // The default command runs on the current host, so shell behavior follows
    // process.platform even when tests inject logical platform values elsewhere.
    return spawn(tool, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      ...(process.platform === 'win32'
        ? { windowsHide: true, shell: true }
        : {}),
    });
  } catch {
    return null;
  }
}

interface PathCommandRace {
  readonly chunks: Buffer[];
  readonly promise: Promise<PathCommandResult>;
  readonly cleanup: () => void;
}

function createPathCommandRace(
  child: ChildProcess,
  timeoutMs: number,
): PathCommandRace {
  const chunks: Buffer[] = [];
  let resolveRace!: (result: PathCommandResult) => void;
  const promise = new Promise<PathCommandResult>((resolve) => {
    resolveRace = resolve;
  });
  const safeKill = (): void => {
    try {
      child.kill();
    } catch {
      // The process may already have exited between the race settling and kill.
    }
  };
  let settled = false;
  const finish = (result: PathCommandResult): void => {
    if (settled) return;
    settled = true;
    resolveRace(result);
  };
  const onClose = (code: number | null): void =>
    finish({ kind: 'close', code });
  const onError = (): void => {
    safeKill();
    child.stdout?.destroy();
    finish({ kind: 'error' });
  };
  const timeout = setTimeout(() => {
    safeKill();
    child.stdout?.destroy();
    finish({ kind: 'timeout' });
  }, timeoutMs);
  timeout.unref();
  let outputBytes = 0;
  const onData = (chunk: Buffer): void => {
    if (settled) return;
    outputBytes += chunk.length;
    if (outputBytes > MAX_PATH_COMMAND_OUTPUT_BYTES) {
      safeKill();
      child.stdout?.destroy();
      finish({ kind: 'output-too-large' });
      return;
    }
    chunks.push(chunk);
  };
  const onStdoutError = (): void => {
    safeKill();
    finish({ kind: 'error' });
  };
  child.stdout?.on('data', onData);
  child.stdout?.on('error', onStdoutError);
  child.once('close', onClose);
  child.once('error', onError);
  const cleanup = (): void => {
    clearTimeout(timeout);
    child.off('close', onClose);
    child.off('error', onError);
    child.stdout?.off('data', onData);
    child.stdout?.off('error', onStdoutError);
    child.on('error', () => {});
  };
  return { chunks, promise, cleanup };
}

export async function defaultPathCommand(
  tool: string,
  args: string[],
  options: { readonly timeoutMs?: number } = {},
): Promise<string | null> {
  const child = spawnPathCommand(tool, args);
  if (child === null) {
    return null;
  }

  const race = createPathCommandRace(
    child,
    options.timeoutMs ?? PATH_COMMAND_TIMEOUT_MS,
  );
  try {
    const result = await race.promise;
    if (result.kind !== 'close' || result.code !== 0) {
      return null;
    }
    return Buffer.concat(race.chunks).toString('utf8');
  } finally {
    race.cleanup();
  }
}
