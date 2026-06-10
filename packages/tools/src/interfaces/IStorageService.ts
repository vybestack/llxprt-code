/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned interface for storage operations.
 *
 * Provides LLXPRT directory access and file read/write/ensureDir
 * needed by the memory tool.
 *
 * Consumed by: memoryTool.
 * Implemented by: CoreStorageServiceAdapter in packages/core.
 */

export interface IStorageService {
  /**
   * Get the path to the LLXPRT directory.
   * @returns The LLXPRT directory path.
   */
  getLLXPRTDir(): string;

  /**
   * Read a file's content as a string.
   * @param path - The file path to read.
   * @returns The file content.
   */
  readFile(path: string): Promise<string>;

  /**
   * Write content to a file.
   * @param path - The file path to write.
   * @param content - The content to write.
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Ensure a directory exists, creating it if necessary.
   * @param path - The directory path to ensure.
   */
  ensureDir(path: string): Promise<void>;
}
