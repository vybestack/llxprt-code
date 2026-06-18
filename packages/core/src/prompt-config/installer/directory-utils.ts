/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, type Dirent } from 'fs';
import { DebugLogger } from '../../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:prompt-config:installer');

export interface DirectoryCreationResult {
  errors: string[];
}

/** Create a single directory, returning a user-friendly error string on failure. */
export async function createSingleDir(
  fullPath: string,
  dryRun: boolean | undefined,
  verbose: boolean | undefined,
): Promise<string | null> {
  if (dryRun === true) {
    if (verbose === true) {
      logger.debug('Would create:', fullPath);
    }
    return null;
  }

  try {
    await fs.mkdir(fullPath, { recursive: true, mode: 0o755 });
    if (verbose === true) {
      logger.debug('Created directory:', fullPath);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('EACCES') || errorMsg.includes('permission denied')) {
      return `Permission denied: ${fullPath}`;
    }
    return `Failed to create directory ${fullPath}: ${errorMsg}`;
  }
  return null;
}

/** Create the required directory structure under the base directory. */
export async function createDirectoryStructure(
  expandedBaseDir: string,
  requiredDirs: readonly string[],
  options?: { dryRun?: boolean; verbose?: boolean },
): Promise<string[]> {
  const errors: string[] = [];

  for (const dir of requiredDirs) {
    const fullPath = path.join(expandedBaseDir, dir);
    const error = await createSingleDir(
      fullPath,
      options?.dryRun,
      options?.verbose,
    );
    if (error) errors.push(error);
  }

  return errors;
}

/** Recursively collect all files in a directory relative to baseDir. */
export async function collectAllFiles(
  baseDir: string,
  currentDir: string,
  files: string[],
): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      await collectAllFiles(baseDir, fullPath, files);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

/** Set permissions on installed files and directories. */
export async function setInstalledPermissions(
  expandedBaseDir: string,
  requiredDirs: readonly string[],
  installed: string[],
  verbose?: boolean,
): Promise<void> {
  try {
    await fs.chmod(expandedBaseDir, 0o755);

    for (const dir of requiredDirs) {
      if (dir === '') {
        continue;
      }
      const dirPath = path.join(expandedBaseDir, dir);
      if (existsSync(dirPath)) {
        await fs.chmod(dirPath, 0o755);
      }
    }

    for (const file of installed) {
      const filePath = path.join(expandedBaseDir, file);
      if (existsSync(filePath)) {
        await fs.chmod(filePath, 0o644);
      }
    }
  } catch (error) {
    if (verbose === true) {
      logger.debug('Could not set permissions:', error);
    }
  }
}

/** Remove empty directories under the base directory. */
export async function removeEmptyDirs(
  expandedBaseDir: string,
  requiredDirs: readonly string[],
): Promise<string[]> {
  const removed: string[] = [];
  const dirsToCheck = [...requiredDirs].reverse();

  for (const dir of dirsToCheck) {
    const fullPath =
      dir === '' ? expandedBaseDir : path.join(expandedBaseDir, dir);

    try {
      const contents = await fs.readdir(fullPath);
      if (contents.length === 0) {
        await fs.rmdir(fullPath);
        removed.push(dir === '' ? 'base directory' : dir);
      }
    } catch {
      // Ignore errors when removing directories
    }
  }

  return removed;
}

/** Fix file permissions recursively (directories 755, files 644). */
export async function fixFilePermissions(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    await applyPermissionEntries(dir, entries);
  } catch {
    // Silently continue - permissions might not be changeable in some environments
  }
}

async function applyPermissionEntries(
  dir: string,
  entries: Dirent[],
): Promise<void> {
  const subdirs: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    try {
      if (entry.isDirectory()) {
        await fs.chmod(fullPath, 0o755);
        subdirs.push(fullPath);
      } else if (entry.isFile()) {
        await fs.chmod(fullPath, 0o644);
      }
    } catch {
      // Silently continue with other files - some filesystems don't support chmod
    }
  }

  for (const subdir of subdirs) {
    await fixFilePermissions(subdir);
  }
}

/** Copy a directory recursively with optional per-file callback. */
export async function copyDirectory(
  source: string,
  dest: string,
  onFile?: (filePath: string) => Promise<void>,
): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destPath, onFile);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destPath);
      await fs.chmod(destPath, 0o644);
      if (onFile) {
        await onFile(sourcePath);
      }
    }
  }
}

/** Count files in a directory recursively. */
export async function countFiles(dir: string): Promise<number> {
  let count = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFiles(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      count++;
    }
  }

  return count;
}
