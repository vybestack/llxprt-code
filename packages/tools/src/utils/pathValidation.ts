/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

function normalizeWorkspacePath(candidatePath: string): string {
  const resolvedPath = path.resolve(candidatePath);
  try {
    return fs.realpathSync.native(resolvedPath);
  } catch {
    const parentPath = path.dirname(resolvedPath);
    if (parentPath === resolvedPath) {
      return resolvedPath;
    }
    const normalizedParent = normalizeWorkspacePath(parentPath);
    return path.join(normalizedParent, path.basename(resolvedPath));
  }
}

export function isPathWithinWorkspace(
  workspaceRoots: readonly string[],
  inputPath: string,
): boolean {
  const resolvedInput = normalizeWorkspacePath(inputPath);
  return workspaceRoots.some((root) => {
    const resolvedRoot = normalizeWorkspacePath(root);
    const relative = path.relative(resolvedRoot, resolvedInput);
    return (
      relative === '' ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    );
  });
}

export function validatePathWithinWorkspace(
  workspaceRoots: readonly string[],
  inputPath: string,
  pathTypeLabel: string = 'File path',
): string | null {
  if (isPathWithinWorkspace(workspaceRoots, inputPath)) {
    return null;
  }
  return `${pathTypeLabel} must be within one of the workspace directories: ${workspaceRoots.join(', ')}`;
}
