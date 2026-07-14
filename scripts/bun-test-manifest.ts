/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface BunTestWorkspaceEntry {
  readonly workspace: string;
  readonly files: readonly string[];
}

export interface BunTestFile {
  readonly file: string;
  readonly cwd: string;
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
];

export function resolveBunNativeTestFiles(
  repoRoot: string,
  workspaceFilter?: string,
): BunTestFile[] {
  return BUN_NATIVE_TEST_MANIFEST.filter(
    ({ workspace }) => !workspaceFilter || workspace === workspaceFilter,
  )
    .flatMap(({ workspace, files }) => {
      const cwd = join(repoRoot, 'packages', workspace);
      return files.map((file) => ({ cwd, file: join(cwd, file) }));
    })
    .filter(({ file }) => existsSync(file))
    .sort((left, right) => left.file.localeCompare(right.file));
}
