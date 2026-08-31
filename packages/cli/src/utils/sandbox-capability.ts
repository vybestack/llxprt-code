/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';

const DEFAULT_ORPHAN_MAX_AGE_MS = 86_400_000;
const CAPABILITY_DIR_PREFIX = 'llxprt-code-cap-';
const LEGACY_CAPABILITY_DIR_PREFIX = '.llxprt-code-cap-';

export interface HostOnlyCapabilityResult {
  readonly args: readonly string[];
  readonly envFilePath: string;
  readonly cleanup: () => void;
}

function isIdempotentCleanupError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'EBADF';
}

export function runCapabilityCleanupStep(
  step: () => void,
  errors: unknown[],
): void {
  try {
    step();
  } catch (err) {
    if (!isIdempotentCleanupError(err)) errors.push(err);
  }
}

function resolveCapabilityRuntimeRoot(): string {
  switch (os.platform()) {
    case 'linux': {
      const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
      return xdgRuntimeDir !== undefined && xdgRuntimeDir.trim() !== ''
        ? xdgRuntimeDir
        : os.tmpdir();
    }
    case 'win32': {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData === undefined || localAppData.trim() === '') {
        return os.tmpdir();
      }
      const runtimeRoot = path.join(localAppData, 'llxprt-code');
      try {
        fs.mkdirSync(runtimeRoot, { recursive: true });
      } catch {
        // Best effort. The caller surfaces an actionable error if creation fails.
      }
      return runtimeRoot;
    }
    default:
      return os.tmpdir();
  }
}

function reclaimDirIfStale(
  root: string,
  entry: fs.Dirent,
  prefixes: ReadonlySet<string>,
  now: number,
  maxAgeMs: number,
): void {
  if (
    !entry.isDirectory() ||
    ![...prefixes].some((prefix) => entry.name.startsWith(prefix))
  ) {
    return;
  }
  const dirPath = path.join(root, entry.name);
  try {
    if (now - fs.lstatSync(dirPath).mtimeMs >= maxAgeMs) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch {
    // Orphan reclamation must not prevent a new sandbox session.
  }
}

export function reclaimOrphanCapabilityDirs(
  maxAgeMs: number = DEFAULT_ORPHAN_MAX_AGE_MS,
): void {
  const targets = new Map<string, Set<string>>();
  for (const [root, prefix] of [
    [resolveCapabilityRuntimeRoot(), CAPABILITY_DIR_PREFIX],
    [os.homedir(), LEGACY_CAPABILITY_DIR_PREFIX],
  ]) {
    const prefixes = targets.get(root) ?? new Set<string>();
    prefixes.add(prefix);
    targets.set(root, prefixes);
  }

  const now = Date.now();
  for (const [root, prefixes] of targets) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      reclaimDirIfStale(root, entry, prefixes, now, maxAgeMs);
    }
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function runtimeRootSource(runtimeRoot: string): string {
  const xdgRuntimeDir = process.env.XDG_RUNTIME_DIR;
  if (
    os.platform() === 'linux' &&
    xdgRuntimeDir !== undefined &&
    xdgRuntimeDir.trim() !== ''
  ) {
    return `XDG_RUNTIME_DIR '${runtimeRoot}'`;
  }
  return `capability runtime path '${runtimeRoot}'`;
}

function assertCapabilityOutsideMounts(
  runtimeRoot: string,
  mountSources: readonly string[],
): void {
  if (mountSources.length === 0) return;
  const canonicalRuntimeRoot = fs.realpathSync(runtimeRoot);
  const candidatePath = path.join(
    canonicalRuntimeRoot,
    CAPABILITY_DIR_PREFIX,
  );
  for (const mountSource of mountSources) {
    let canonicalMountSource: string;
    try {
      canonicalMountSource = fs.realpathSync(mountSource);
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) continue;
      throw error;
    }
    if (isPathInside(canonicalMountSource, candidatePath)) {
      throw new FatalSandboxError(
        `${runtimeRootSource(runtimeRoot)} collides with sandbox mount source '${mountSource}'. Move XDG_RUNTIME_DIR outside mounted paths or remove the colliding mount.`,
      );
    }
  }
}

function createHostOnlyDir(mountSources: readonly string[]): string {
  reclaimOrphanCapabilityDirs();
  const runtimeRoot = resolveCapabilityRuntimeRoot();
  assertCapabilityOutsideMounts(runtimeRoot, mountSources);
  try {
    return fs.mkdtempSync(path.join(runtimeRoot, CAPABILITY_DIR_PREFIX));
  } catch (err) {
    throw new Error(
      `Capability host-only directory could not be created: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function closeAfterWrite(fd: number, writeError?: unknown): void {
  try {
    fs.closeSync(fd);
  } catch (closeError) {
    if (isIdempotentCleanupError(closeError)) return;
    if (writeError === undefined) {
      throw new Error(
        `Capability env file could not be closed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
      );
    }
    throw new AggregateError(
      [writeError, closeError],
      'Capability env file could not be written and closed',
    );
  }
}

function writeCapabilityEnvFile(
  envFilePath: string,
  capabilityToken: string,
): void {
  const fd = fs.openSync(envFilePath, 'w', 0o600);
  let writeError: unknown;
  try {
    fs.writeSync(fd, `LLXPRT_CAPABILITY_TOKEN=${capabilityToken}\n`, 0, 'utf8');
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600);
  } catch (err) {
    writeError = err;
  }
  closeAfterWrite(fd, writeError);
  if (writeError !== undefined) throw writeError;
}

function removePath(remove: () => void): void {
  try {
    remove();
  } catch (err) {
    if (!isIdempotentCleanupError(err)) throw err;
  }
}

export function createHostOnlyCapabilityEnvFile(
  capabilityToken: string | undefined,
  mountSources: readonly string[] = [],
): HostOnlyCapabilityResult | undefined {
  if (capabilityToken === undefined) return undefined;
  if (/[\r\n=]/.test(capabilityToken)) {
    throw new Error(
      'Capability token contains invalid characters for env file',
    );
  }
  const hostOnlyDir = createHostOnlyDir(mountSources);
  const envFilePath = path.join(hostOnlyDir, 'capability.env');
  try {
    writeCapabilityEnvFile(envFilePath, capabilityToken);
  } catch (err) {
    const errors: unknown[] = [err];
    runCapabilityCleanupStep(
      () => removePath(() => fs.unlinkSync(envFilePath)),
      errors,
    );
    runCapabilityCleanupStep(
      () => removePath(() => fs.rmdirSync(hostOnlyDir)),
      errors,
    );
    throw errors.length === 1
      ? err
      : new AggregateError(errors, 'Capability env file creation failed');
  }
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    const errors: unknown[] = [];
    runCapabilityCleanupStep(
      () => removePath(() => fs.unlinkSync(envFilePath)),
      errors,
    );
    runCapabilityCleanupStep(
      () => removePath(() => fs.rmdirSync(hostOnlyDir)),
      errors,
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Capability host-only cleanup failed');
    }
    cleanedUp = true;
  };
  return { args: ['--env-file', envFilePath], envFilePath, cleanup };
}
