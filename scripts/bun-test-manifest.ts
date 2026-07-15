/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';

export interface BunTestWorkspaceEntry {
  readonly workspace: string;
  readonly files: readonly string[];
  /**
   * Optional explicit working directory override. When omitted, the workspace
   * name is resolved under `packages/` (e.g. `packages/core`). When set, this
   * path is used as the cwd and file resolution root.
   */
  readonly cwd?: string;
}

export interface BunTestFile {
  readonly file: string;
  readonly cwd: string;
}

export interface BunManifestDependencies {
  stat(path: string): { isFile(): boolean };
}

export class BunManifestStatError extends Error {
  readonly path: string;
  readonly code: string | undefined;

  constructor(path: string, code: string | undefined, cause: unknown) {
    super(
      `Unable to inspect Bun native test manifest path: ${path}${
        code ? ` (${code})` : ''
      }`,
      { cause },
    );
    this.name = 'BunManifestStatError';
    this.path = path;
    this.code = code;
  }
}

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

/** Files that have been explicitly verified with Bun's native test runner. */
export const BUN_NATIVE_TEST_MANIFEST: readonly BunTestWorkspaceEntry[] = [
  {
    workspace: 'a2a-server',
    files: [
      'src/agent/task-support.test.ts',
      'src/agent/task.neutral-continuation.test.ts',
      'src/agent/task.test.ts',
      'src/agent/task.factory-migration.integration.test.ts',
      'src/commands/command-registry.test.ts',
      'src/commands/extensions.test.ts',
      'src/commands/init.test.ts',
      'src/commands/restore.test.ts',
      'src/config/config.test.ts',
      'src/config/config.factory-migration.test.ts',
      'src/http/app.test.ts',
      'src/http/endpoints.test.ts',
      'src/persistence/gcs.test.ts',
      'src/utils/testing_utils.test.ts',
    ],
  },
  {
    workspace: 'cli',
    files: [
      'src/__tests__/cliSessionDispatch.characterization.test.tsx',
      'test-utils/augment-bun-vi-cleanup.bun.ts',
    ],
  },
  {
    workspace: 'core',
    files: ['src/utils/errors.test.ts'],
  },
  {
    workspace: 'providers',
    files: ['src/BaseProvider.test.ts'],
  },
  {
    workspace: 'test-setup',
    cwd: '.',
    files: [
      'test-setup/augment-bun-vi.test.ts',
      'test-setup/stub-helpers.bun.test.ts',
    ],
  },
];

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
  ).flatMap(({ workspace, files, cwd }) => {
    const resolvedCwd = resolveWorkspaceCwd(repoRoot, workspace, cwd);
    return files.map((file) => ({
      cwd: resolvedCwd,
      file: join(resolvedCwd, file),
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
