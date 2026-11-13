/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface GitStats {
  linesAdded: number;
  linesRemoved: number;
  filesChanged: number;
}

/**
 * Service for tracking git statistics during file operations.
 * This service is optional and can be set by the CLI package when logging is enabled.
 */
export interface IGitStatsService {
  /**
   * Track file edit statistics
   * @param filePath Path to the file being edited
   * @param oldContent Original file content
   * @param newContent New file content after edit
   * @returns Git statistics or null if tracking is disabled
   */
  trackFileEdit(
    filePath: string,
    oldContent: string,
    newContent: string,
  ): Promise<GitStats | null>;
}
