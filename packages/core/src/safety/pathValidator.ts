/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface WorkspacePathBoundary {
  getDirectories(): readonly string[];
  isPathWithinWorkspace(inputPath: string): boolean;
}

/**
 * Validates that a path is within the workspace boundaries.
 *
 * @param workspaceContext - The workspace context to validate against
 * @param inputPath - The path to validate
 * @param pathTypeLabel - Label for the path type used in error messages (default: 'File path')
 * @returns null if valid, or an error message string if the path is outside the workspace
 */
export function validatePathWithinWorkspace(
  workspaceContext: WorkspacePathBoundary,
  inputPath: string,
  pathTypeLabel: string = 'File path',
): string | null {
  if (workspaceContext.isPathWithinWorkspace(inputPath)) {
    return null;
  }
  const directories = workspaceContext.getDirectories();
  return `${pathTypeLabel} must be within one of the workspace directories: ${directories.join(', ')}`;
}
