/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session-scoped Config construction for the Zed integration (issue #1604).
 * Extracted from zedIntegration.ts so that near-cap file stays within its
 * max-lines budget; the behavior is unchanged and exercised by
 * zedIntegration.test.ts (createSessionScopedConfig) and the loadSession/prompt
 * suites.
 */

import * as path from 'node:path';
import {
  type Config,
  isWithinRoot,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { FileSystemService } from '@vybestack/llxprt-code-storage';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

/**
 * Resolves the effective target directory for a session from an optional
 * client-supplied cwd: a missing/non-string/empty cwd falls back to the config
 * target dir; an absolute or config-relative cwd is accepted only when it
 * resolves WITHIN the config target dir (otherwise the target dir is used), so
 * a session can never escape the project root via lexical traversal (`..`
 * segments are resolved before the containment check).
 *
 * Trust model: the cwd comes from the ACP client (the user's own editor over
 * stdio), which shares the local user's privileges — this guard protects
 * against accidental misconfiguration, not a hostile client. Symlinks inside
 * the project are deliberately NOT realpath-resolved here; a client that can
 * plant symlinks already has direct filesystem access.
 */
export function resolveSessionTargetDir(
  config: Config,
  cwd: string | undefined,
): string {
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    return config.getTargetDir();
  }
  const candidate = path.isAbsolute(cwd)
    ? cwd
    : path.resolve(config.getTargetDir(), cwd);
  return isWithinRoot(candidate, config.getTargetDir())
    ? candidate
    : config.getTargetDir();
}

/**
 * Builds a per-session Config proxy that overrides the file-system service,
 * provider manager, and project/target dir for a single session WITHOUT
 * mutating the shared base Config. getFileSystemService/getProviderManager
 * return the session-scoped instances (swappable via their setters), and
 * getProjectRoot/getTargetDir return the resolved session target dir; every
 * other access falls through to the base Config.
 */
export function createSessionScopedConfig(
  config: Config,
  initialFileSystemService: FileSystemService,
  targetDir: string = config.getTargetDir(),
  resolveToolRegistry?: () => ToolRegistry | undefined,
): Config {
  let fileSystemService = initialFileSystemService;
  let providerManager: RuntimeProviderManager | undefined =
    config.getProviderManager();
  const propertyOverrides = new Map<PropertyKey, unknown>();
  return new Proxy(config, {
    get(target, property, receiver) {
      if (property === 'getToolRegistry' && resolveToolRegistry !== undefined) {
        return () => resolveToolRegistry() ?? config.getToolRegistry();
      }
      if (property === 'getFileSystemService') {
        return () => fileSystemService;
      }
      if (property === 'setFileSystemService') {
        return (nextFileSystemService: FileSystemService) => {
          fileSystemService = nextFileSystemService;
        };
      }
      if (property === 'getProviderManager') {
        return () => providerManager;
      }
      if (property === 'setProviderManager') {
        return (nextProviderManager: RuntimeProviderManager) => {
          providerManager = nextProviderManager;
        };
      }
      if (property === 'getProjectRoot') {
        return () => targetDir;
      }
      if (property === 'getTargetDir') {
        return () => targetDir;
      }
      if (propertyOverrides.has(property)) {
        return propertyOverrides.get(property);
      }
      return Reflect.get(target, property, receiver);
    },
    set(target, property, value) {
      if (property === 'fileSystemService' || property === 'providerManager') {
        propertyOverrides.set(property, value);
        return true;
      }
      return Reflect.set(target, property, value);
    },
  });
}
