/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Reads file contents from a given path
 */
export function readPath(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Checks if a path exists
 */
export function pathExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

/**
 * Reads directory contents
 */
export function readDirectory(dirPath: string): string[] {
  return fs.readdirSync(dirPath);
}

/**
 * Gets path information
 */
export function getPathInfo(filePath: string): {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  basename: string;
  dirname: string;
  extension: string;
} {
  const exists = fs.existsSync(filePath);
  let isFile = false;
  let isDirectory = false;

  if (exists) {
    const stats = fs.statSync(filePath);
    isFile = stats.isFile();
    isDirectory = stats.isDirectory();
  }

  return {
    exists,
    isFile,
    isDirectory,
    basename: path.basename(filePath),
    dirname: path.dirname(filePath),
    extension: path.extname(filePath),
  };
}
