/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime detection helpers.
 *
 * These are dependency-free and synchronous so they can be called from hot
 * paths (PTY selection, WASM loading) without import or await overhead.
 */

type ProcessWithMaybeVersions = {
  versions?: {
    bun?: unknown;
  };
};

type RuntimeObject = Record<string, unknown>;

function isRuntimeObject(value: unknown): value is RuntimeObject {
  return typeof value === 'object' && value !== null;
}

function getProcessVersions(
  value: unknown,
): ProcessWithMaybeVersions['versions'] {
  if (!isRuntimeObject(value)) {
    return undefined;
  }
  const versions = value.versions;
  return isRuntimeObject(versions) ? versions : undefined;
}

function getProcessPlatform(value: unknown): unknown {
  if (!isRuntimeObject(value)) {
    return undefined;
  }
  return value.platform;
}

function isBunTerminalPlatform(platform: string): boolean {
  return platform === 'linux' || platform === 'darwin';
}

/**
 * Returns true when the current process is running under the Bun runtime.
 *
 * Bun populates `process.versions.bun` with its version string; Node and other
 * runtimes leave it `undefined`. Reading the version avoids referencing Bun's
 * global object, so this helper stays type-checkable without Bun type packages.
 */
export function isBunRuntime(): boolean {
  const bunVersion = getProcessVersions(globalThis.process)?.bun;
  return typeof bunVersion === 'string' && bunVersion.length > 0;
}

/**
 * Returns true when running under Bun on a platform where Bun.Terminal is
 * supported.
 *
 * `Bun.Terminal` (the PTY bridge used by the Bun adapter) is supported on Linux
 * and macOS; Windows and other platforms must use the node-pty path.
 */
export function isBunPosix(): boolean {
  const platform = getProcessPlatform(globalThis.process);
  if (!isBunRuntime() || typeof platform !== 'string') {
    return false;
  }

  return isBunTerminalPlatform(platform);
}

/**
 * Returns true when the current process platform is Windows (win32).
 */
export function isWindows(): boolean {
  const platform = getProcessPlatform(globalThis.process);
  return typeof platform === 'string' && platform === 'win32';
}
