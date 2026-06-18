/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Check if a file exists (is accessible). */
export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Check if a path is a directory. */
export function isDirectory(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/** Check if a path is a regular file. */
export function isRegularFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/** Read directory entries, returning empty array on error. */
export function readDirectory(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

/** Walk a directory recursively, invoking callback for each file. */
export function walkDirectory(
  dirPath: string,
  callback: (filePath: string, relativePath: string) => void,
  baseDir: string = dirPath,
): void {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      processDirectoryEntry(dirPath, baseDir, entry, callback);
    }
  } catch {
    // Ignore errors in subdirectories
  }
}

function processDirectoryEntry(
  dirPath: string,
  baseDir: string,
  entry: fs.Dirent,
  callback: (filePath: string, relativePath: string) => void,
): void {
  const fullPath = path.join(dirPath, entry.name);
  const relativePath = path.relative(baseDir, fullPath);

  // Skip hidden files (starting with .)
  if (entry.name.startsWith('.')) {
    return;
  }

  if (entry.isDirectory()) {
    // Recurse into subdirectory
    walkDirectory(fullPath, callback, baseDir);
  } else if (entry.isFile()) {
    // Process file
    callback(fullPath, relativePath);
  }
  // Skip symlinks and other special files
}
