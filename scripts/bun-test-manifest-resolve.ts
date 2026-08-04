/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Path resolution and validation for the Bun native test manifest.
 *
 * Split out of `bun-test-manifest.ts` so that file stays within the 800-line
 * cap: it is almost entirely data, and every merge that marks another file
 * Bun-native grows it. Keeping this logic here means routine manifest additions
 * do not push the module over the limit, and follows the split already used for
 * the per-workspace data modules (`bun-test-manifest-data-*.ts`).
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUN_NATIVE_TEST_MANIFEST,
  BunManifestStatError,
  type BunManifestDependencies,
  type BunTestFile,
} from './bun-test-manifest.ts';

const defaultManifestDependencies: BunManifestDependencies = {
  stat: statSync,
};

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * Resolves the working directory for a workspace entry.
 *
 * - When `cwd` is `undefined`, the workspace name is resolved under
 *   `packages/` (e.g. `packages/core`).
 * - When `cwd` is an empty string, the repo root itself is used.
 * - When `cwd` is a non-empty string, it is joined under the repo root.
 *
 * Using `cwd !== undefined` (not truthiness) ensures an empty string
 * correctly means the repo root rather than falling through to the
 * `packages/` default.
 */
export function resolveWorkspaceCwd(
  repoRoot: string,
  workspace: string,
  cwd: string | undefined,
): string {
  if (cwd === undefined) {
    return join(repoRoot, 'packages', workspace);
  }
  return join(repoRoot, cwd);
}

export function resolveBunNativeTestFiles(
  repoRoot: string,
  workspaceFilter?: string,
  dependencies: BunManifestDependencies = defaultManifestDependencies,
): BunTestFile[] {
  const files = BUN_NATIVE_TEST_MANIFEST.filter(
    ({ workspace }) => !workspaceFilter || workspace === workspaceFilter,
  ).flatMap(({ workspace, files, cwd, preload }) => {
    const resolvedCwd = resolveWorkspaceCwd(repoRoot, workspace, cwd);
    const resolvedPreload =
      preload !== undefined ? join(resolvedCwd, preload) : undefined;
    return files.map((file) => ({
      cwd: resolvedCwd,
      file: join(resolvedCwd, file),
      preload: resolvedPreload,
    }));
  });
  const missingFiles: string[] = [];
  const nonFiles: string[] = [];
  for (const { file } of files) {
    try {
      if (!dependencies.stat(file).isFile()) {
        nonFiles.push(file);
      }
    } catch (error: unknown) {
      const code = getErrorCode(error);
      if (code === 'ENOENT') {
        missingFiles.push(file);
      } else {
        throw new BunManifestStatError(file, code, error);
      }
    }
  }
  // Validate declared preload scripts exist (deduplicated — one per workspace).
  const preloadPaths = new Set<string>();
  for (const { preload } of files) {
    if (preload !== undefined) {
      preloadPaths.add(preload);
    }
  }
  for (const preload of preloadPaths) {
    try {
      if (!dependencies.stat(preload).isFile()) {
        throw new BunManifestStatError(
          preload,
          undefined,
          new Error('not a file'),
        );
      }
    } catch (error: unknown) {
      if (error instanceof BunManifestStatError) {
        throw error;
      }
      const code = getErrorCode(error);
      if (code === 'ENOENT') {
        throw new Error(
          `Bun native test manifest declares a missing preload: ${preload}`,
        );
      }
      throw new BunManifestStatError(preload, code, error);
    }
  }
  if (missingFiles.length > 0) {
    throw new Error(
      `Bun native test manifest contains missing files:\n${missingFiles
        .map((file) => `  - ${file}`)
        .join('\n')}`,
    );
  }
  if (nonFiles.length > 0) {
    throw new Error(
      `Bun native test manifest contains non-files:\n${nonFiles
        .map((file) => `  - ${file}`)
        .join('\n')}`,
    );
  }
  return files.sort((left, right) => left.file.localeCompare(right.file));
}
