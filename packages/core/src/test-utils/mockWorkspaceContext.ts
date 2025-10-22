/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';
import { WorkspaceContext } from '../utils/workspaceContext.js';

/**
 * Creates a mock WorkspaceContext for testing
 */
export function createMockWorkspaceContext(
  rootDir: string,
  additionalDirs: string[] = [],
): WorkspaceContext {
  const allDirs = [rootDir, ...additionalDirs];

  const mockWorkspaceContext = {
    addDirectory: vi.fn<WorkspaceContext['addDirectory']>(),
    getDirectories: vi
      .fn<WorkspaceContext['getDirectories']>()
      .mockReturnValue(allDirs),
    isPathWithinWorkspace: vi
      .fn<WorkspaceContext['isPathWithinWorkspace']>()
      .mockImplementation((path: string) =>
        allDirs.some((dir) => path.startsWith(dir)),
      ),
  } as unknown as WorkspaceContext;

  return mockWorkspaceContext;
}
