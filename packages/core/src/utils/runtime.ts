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

export interface RuntimeDetector {
  isBunRuntime(): boolean;
  isBunPosix(): boolean;
  isWindows(): boolean;
}

export function createRuntimeDetector(
  getProcess: () => unknown = () => globalThis.process,
): RuntimeDetector {
  const isBunRuntimeForProcess = (processValue: unknown): boolean => {
    const bunVersion = getProcessVersions(processValue)?.bun;
    return typeof bunVersion === 'string' && bunVersion.length > 0;
  };

  return {
    isBunRuntime: () => isBunRuntimeForProcess(getProcess()),
    isBunPosix: () => {
      const processValue = getProcess();
      const platform = getProcessPlatform(processValue);
      return (
        isBunRuntimeForProcess(processValue) &&
        typeof platform === 'string' &&
        isBunTerminalPlatform(platform)
      );
    },
    isWindows: () => getProcessPlatform(getProcess()) === 'win32',
  };
}

const defaultDetector = createRuntimeDetector();

export function isBunRuntime(): boolean {
  return defaultDetector.isBunRuntime();
}

export function isBunPosix(): boolean {
  return defaultDetector.isBunPosix();
}

export function isWindows(): boolean {
  return defaultDetector.isWindows();
}
