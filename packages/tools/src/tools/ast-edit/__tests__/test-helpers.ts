/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared test helpers for ast-edit behavioral tests (issue #1758).
 */

import {
  mkdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach } from 'vitest';
import type { IToolHost } from '../../../interfaces/IToolHost.js';
import type { ASTEditTool, ASTEditToolParams } from '../../ast-edit.js';
import type { ToolResult } from '../../tools.js';

export function createTempDir(prefix = 'llxprt-ast-edit-test-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup after each test.
      }
    },
  };
}

/**
 * Wires temp-directory creation/destruction into beforeEach/afterEach
 * automatically so tests stay DRY without repeating setup boilerplate
 * in every describe block.
 *
 * IMPORTANT: Do NOT destructure the return value — `tempDir` is a getter
 * that resolves at test-run time (after beforeEach sets it). Access it
 * as `ctx.tempDir` instead.
 *
 * Usage inside a describe:
 *   const ctx = useTempDir();
 *   // ...
 *   const filePath = join(ctx.tempDir, 'file.ts');
 */
export function useTempDir(): { readonly tempDir: string } {
  let dir = '';
  let cleanup: () => void = () => {};

  beforeEach(() => {
    const tmp = createTempDir();
    dir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  return {
    get tempDir() {
      return dir;
    },
  };
}

export function createFakeToolHost(targetDir: string): IToolHost {
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths: string[]) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
  };
}

/**
 * Execute the tool in preview mode (force: false).
 */
export async function executePreview(
  tool: ASTEditTool,
  params: Omit<ASTEditToolParams, 'force'>,
): Promise<ToolResult> {
  return tool
    .build({ ...params, force: false })
    .execute(new AbortController().signal);
}

/**
 * Execute the tool in apply mode (force: true).
 */
export async function executeApply(
  tool: ASTEditTool,
  params: Omit<ASTEditToolParams, 'force'>,
): Promise<ToolResult> {
  return tool
    .build({ ...params, force: true })
    .execute(new AbortController().signal);
}

/**
 * Write a file and optionally set its mtime to a specific timestamp.
 */
export function writeFileWithMtime(
  filePath: string,
  content: string,
  mtimeMs?: number,
): void {
  writeFileSync(filePath, content, 'utf-8');
  if (mtimeMs !== undefined) {
    utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
  }
}

/**
 * Get the current mtime of a file in milliseconds.
 */
export function getFileMtime(filePath: string): number {
  return statSync(filePath).mtime.getTime();
}
