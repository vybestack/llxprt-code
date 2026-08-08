/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Role interface for hierarchical memory access concerns.
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface MemoryAccess {
  getUserMemory(): string;
  getCoreMemory(): string | undefined;
  getLlxprtMdFileCount(): number;
  getCoreMemoryFileCount(): number;
  getGlobalMemory(): string;
  getJitMemoryForPath(targetPath: string): Promise<string>;
  isJitContextEnabled(): boolean;
  setUserMemory(newUserMemory: string): void;
  getLlxprtMdFilePaths(): string[];
  setCoreMemory(_content: string): void;
  refreshMemory(): Promise<{
    memoryContent: string;
    fileCount: number;
    filePaths: string[];
  }>;
}
