/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dependency-neutral shared path resolution for the canonical llxprt-code
 * platform directories.
 *
 * This module is the SINGLE source of truth for the env-override + platform
 * default algorithm consumed by {@link Storage} and by pre-build scripts
 * that cannot import the built `dist` Storage. It deliberately depends ONLY
 * on `env-paths` and `node:path` so it can be imported from scripts that run
 * before the workspace packages are built.
 *
 * `@vybestack/llxprt-code-storage` re-exports these helpers; `Storage`
 * delegates to them, remaining the authoritative OS-platform path surface
 * for application code. Scripts that run pre-build import this source module
 * directly (via the established `../packages/storage/src/config/...`
 * convention) to avoid a dependency on built `dist` output while still using
 * the IDENTICAL algorithm (no duplication).
 */

import { isAbsolute, resolve } from 'node:path';
import envPaths from 'env-paths';

/**
 * The env-paths configuration shared by Storage and scripts. `suffix: ''`
 * matches the secure-store.ts pattern and the Storage module.
 */
export const LLXPRT_PLATFORM_PATHS = envPaths('llxprt-code', { suffix: '' });

/**
 * Resolves an environment-variable override value: non-empty, absolute,
 * resolved. Returns undefined when the env var is absent, empty, or not an
 * absolute path (matching the Storage contract).
 */
export function resolveEnvOverride(
  raw: string | undefined,
): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return undefined;
  }
  if (!isAbsolute(trimmed)) {
    return undefined;
  }
  return resolve(trimmed);
}

/**
 * Resolves a canonical directory from a primary env override, an optional
 * backward-compat fallback env override, and the platform default. Mirrors
 * the contract documented on {@link resolveDir} (formerly private to
 * Storage, now the shared authority).
 */
export function resolveCanonicalDir(
  primaryEnv: string,
  fallbackEnv: string | undefined,
  platformDefault: string,
): string {
  const primary = resolveEnvOverride(process.env[primaryEnv]);
  if (primary !== undefined) {
    return primary;
  }
  if (fallbackEnv !== undefined) {
    const fallback = resolveEnvOverride(process.env[fallbackEnv]);
    if (fallback !== undefined) {
      return fallback;
    }
  }
  if (!platformDefault) {
    throw new Error(
      'platformDefault must not be empty for resolveCanonicalDir',
    );
  }
  return platformDefault;
}

/**
 * Platform-standard directory for user-editable **configuration** files.
 *
 * Override precedence:
 * 1. `LLXPRT_CONFIG_HOME` environment variable
 * 2. `envPaths('llxprt-code').config`
 */
export function resolveGlobalConfigDir(): string {
  return resolveCanonicalDir(
    'LLXPRT_CONFIG_HOME',
    undefined,
    LLXPRT_PLATFORM_PATHS.config,
  );
}

/**
 * Platform-standard directory for app-managed **data** files.
 *
 * Override precedence:
 * 1. `LLXPRT_DATA_HOME` environment variable
 * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
 * 3. `envPaths('llxprt-code').data`
 */
export function resolveGlobalDataDir(): string {
  return resolveCanonicalDir(
    'LLXPRT_DATA_HOME',
    'LLXPRT_CONFIG_HOME',
    LLXPRT_PLATFORM_PATHS.data,
  );
}

/**
 * Platform-standard directory for non-essential **cache** files.
 *
 * Override precedence:
 * 1. `LLXPRT_CACHE_HOME` environment variable
 * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
 * 3. `envPaths('llxprt-code').cache`
 */
export function resolveGlobalCacheDir(): string {
  return resolveCanonicalDir(
    'LLXPRT_CACHE_HOME',
    'LLXPRT_CONFIG_HOME',
    LLXPRT_PLATFORM_PATHS.cache,
  );
}

/**
 * Platform-standard directory for **log/state** files.
 *
 * Override precedence:
 * 1. `LLXPRT_LOG_HOME` environment variable
 * 2. `LLXPRT_CONFIG_HOME` (backward-compat fallback)
 * 3. `envPaths('llxprt-code').log`
 */
export function resolveGlobalLogDir(): string {
  return resolveCanonicalDir(
    'LLXPRT_LOG_HOME',
    'LLXPRT_CONFIG_HOME',
    LLXPRT_PLATFORM_PATHS.log,
  );
}
