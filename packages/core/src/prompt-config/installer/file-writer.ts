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

/**
 * Structural errno guard: returns the `code` string property from an error,
 * or undefined. Avoids `as NodeJS.ErrnoException` assertions.
 */
function fsErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

/** Result of {@link cleanupTempFile}: ok, or a discriminated error. */
export interface CleanupTempFileResult {
  readonly ok: boolean;
  readonly benign: boolean;
  readonly error?: string;
}

/**
 * Best-effort async temp cleanup that classifies the outcome so callers
 * never silently swallow a non-benign failure and never add noise for a
 * benign one. ENOENT (the temp was never created or already removed) is
 * benign and must NOT surface as an error; all other failures are
 * non-benign and must be composed with any primary error.
 */
export async function cleanupTempFile(
  tempPath: string,
): Promise<CleanupTempFileResult> {
  try {
    await fs.unlink(tempPath);
    return { ok: true, benign: false };
  } catch (error) {
    const code = fsErrorCode(error);
    if (code === 'ENOENT') {
      return { ok: false, benign: true, error: String(error) };
    }
    return { ok: false, benign: false, error: String(error) };
  }
}
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
    const cleanup = await cleanupTempFile(tempPath);
    if (!cleanup.ok && !cleanup.benign) {
      return {
        installed: false,
        skipped: false,
        error: `${classifyWriteError(fullPath, errorMsg)} (cleanup: ${cleanup.error})`,
      };
    }
    return {
      installed: false,
      skipped: false,
      error: classifyWriteError(fullPath, errorMsg),
    };
  }
}
