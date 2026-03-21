/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workspace context provider for enriching context with working-set files.
 */

import { promises as fsPromises } from 'fs';
import type { ConnectedFile } from './types.js';
import type { ASTQueryExtractor } from './ast-query-extractor.js';
import type { RepositoryContextProvider } from './repository-context-provider.js';

/**
 * Enrich context with declarations from working-set files.
 * Gets the current working set from git (unstaged/staged/recent commits),
 * reads each file, and extracts declarations for a skeleton view.
 *
 * @param targetFilePath - The file currently being edited
 * @param workspaceRoot - The workspace root directory
 * @param repoProvider - Repository context provider for git operations
 * @param astExtractor - AST query extractor for declaration extraction
 * @returns Array of connected files with their declarations
 */
export async function enrichWithWorkingSetContext(
  targetFilePath: string,
  workspaceRoot: string,
  repoProvider: RepositoryContextProvider,
  astExtractor: ASTQueryExtractor,
): Promise<ConnectedFile[]> {
  const connectedFiles: ConnectedFile[] = [];

  // Phase 2: Working Set Context (Git-based)
  // Replace BM25 search with working set file declarations
  const workingSetFiles = await repoProvider.getWorkingSetFiles(workspaceRoot);

  // Filter out current file
  const otherFiles = workingSetFiles.filter((f) => f !== targetFilePath);

  for (const filePath of otherFiles) {
    try {
      const fileContent = await fsPromises.readFile(filePath, 'utf-8');
      // Skeleton View: only extract declarations, not full code
      const declarations = await astExtractor.extractDeclarations(
        filePath,
        fileContent,
      );

      connectedFiles.push({
        filePath,
        declarations,
      });
    } catch {
      // Ignore read errors
    }
  }

  return connectedFiles;
}
