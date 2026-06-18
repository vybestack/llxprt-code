/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { DebugLogger } from '../../debug/DebugLogger.js';
import {
  type InstalledManifest,
  hashContent,
  updateManifestEntry,
} from './manifest-operations.js';

const logger = new DebugLogger('llxprt:prompt-config:installer');

export interface WriteFileResult {
  installed: boolean;
  skipped: boolean;
  error?: string;
}

/** Classify a write error into a user-friendly message. */
export function classifyWriteError(fullPath: string, errorMsg: string): string {
  if (errorMsg.includes('EACCES') || errorMsg.includes('Permission denied')) {
    return `Permission denied: ${fullPath}. Try running with elevated permissions or changing the directory ownership.`;
  }
  if (errorMsg.includes('ENOSPC')) {
    return `Disk full: Cannot write ${fullPath}. Free up some disk space and try again.`;
  }
  return `Failed to write ${fullPath}: ${errorMsg}`;
}

/**
 * Atomically write a prompt file via a temp file + rename, updating the
 * manifest with the content hash on success.
 */
export async function writeInstallFile(
  expandedBaseDir: string,
  relativePath: string,
  content: string,
  manifest: InstalledManifest | null,
  options?: { dryRun?: boolean; verbose?: boolean },
): Promise<WriteFileResult> {
  const fullPath = path.join(expandedBaseDir, relativePath);

  if (options?.dryRun === true) {
    if (options.verbose === true) {
      logger.debug('Would write:', fullPath);
    }
    return { installed: true, skipped: false };
  }

  const tempPath = `${fullPath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}`;
  try {
    await fs.writeFile(tempPath, content, { mode: 0o644 });
    try {
      await fs.rename(tempPath, fullPath);
      if (manifest !== null) {
        updateManifestEntry(manifest, relativePath, hashContent(content));
      }
      if (options?.verbose === true) {
        logger.debug('Installed:', relativePath);
      }
      return { installed: true, skipped: false };
    } catch (renameError) {
      const renameMsg =
        renameError instanceof Error
          ? renameError.message
          : String(renameError);
      if (renameMsg.includes('EEXIST') || existsSync(fullPath)) {
        await fs.unlink(tempPath);
        return { installed: false, skipped: true };
      }
      throw renameError;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    return {
      installed: false,
      skipped: false,
      error: classifyWriteError(fullPath, errorMsg),
    };
  }
}
