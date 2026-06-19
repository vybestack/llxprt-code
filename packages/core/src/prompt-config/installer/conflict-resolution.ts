/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import type { Stats } from 'fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  type InstalledManifest,
  hashContent,
  getInstalledHash,
} from './manifest-operations.js';

export type PromptConflictReason =
  | 'default-newer'
  | 'user-newer'
  | 'content-diff'
  | 'user-modified'
  | 'user-protected'
  | 'unknown-baseline';

export interface PromptConflictDetails {
  path: string;
  userTimestamp?: string;
  defaultTimestamp?: string;
  reason: PromptConflictReason;
}

export interface PromptConflictSummary extends PromptConflictDetails {
  action: 'kept' | 'overwritten';
  reviewFile?: string;
}

export type ExistingFileDecision =
  | { action: 'same' }
  | { action: 'overwrite' }
  | { action: 'keep'; conflict: PromptConflictSummary; notice: string | null }
  | { action: 'resolved' };

/** Default prompt files checked during uninstall (non-user-file mode). */
const DEFAULT_UNINSTALL_PATHS = [
  'core.md',
  'env/development.md',
  'env/dev.md',
  'tools/git.md',
  'providers/openai.md',
];

/**
 * Determine how to handle an existing file when installing a default.
 */
export async function handleExistingFile(
  expandedBaseDir: string,
  relativePath: string,
  fullPath: string,
  content: string,
  createReviewCopy: boolean,
  manifest: InstalledManifest | null,
  defaultSourceDirs?: readonly string[],
): Promise<ExistingFileDecision> {
  const existingContent = await fs.readFile(fullPath, 'utf-8');

  // 1. Content identical - skip (no change needed)
  if (existingContent === content) {
    return { action: 'same' };
  }

  // 2. Check for NO OVERWRITE flag - user explicitly protects this file
  if (hasNoOverwriteFlag(existingContent)) {
    return createKeepDecision(
      expandedBaseDir,
      relativePath,
      content,
      'user-protected',
      createReviewCopy,
      defaultSourceDirs,
    );
  }

  // 3. Get installed hash to determine if user modified the file
  const installedHash = getInstalledHash(manifest, relativePath);
  const currentHash = hashContent(existingContent);

  // 4. No manifest entry - first run or corrupt manifest (conservative: assume modified)
  if (installedHash === null) {
    return createKeepDecision(
      expandedBaseDir,
      relativePath,
      content,
      'unknown-baseline',
      createReviewCopy,
      defaultSourceDirs,
    );
  }

  // 5. User never modified file - safe to overwrite silently
  if (currentHash === installedHash) {
    return { action: 'overwrite' };
  }

  // 6. User DID modify file - preserve their changes, create review file
  return createKeepDecision(
    expandedBaseDir,
    relativePath,
    content,
    'user-modified',
    createReviewCopy,
    defaultSourceDirs,
  );
}

/** Create a keep decision with optional review file. */
export async function createKeepDecision(
  expandedBaseDir: string,
  relativePath: string,
  content: string,
  reason: PromptConflictReason,
  createReviewCopy: boolean,
  defaultSourceDirs?: readonly string[],
): Promise<ExistingFileDecision> {
  const defaultStats = await getDefaultFileStats(
    relativePath,
    defaultSourceDirs,
  );
  const timestamp = getReviewTimestamp(defaultStats);
  const reviewRelativePath = generateReviewFilename(relativePath, timestamp);
  const reviewFullPath = path.join(expandedBaseDir, reviewRelativePath);

  // Check if review file already exists
  if (existsSync(reviewFullPath)) {
    return { action: 'resolved' };
  }

  if (createReviewCopy) {
    await fs.mkdir(path.dirname(reviewFullPath), {
      recursive: true,
      mode: 0o755,
    });
    await fs.writeFile(reviewFullPath, content, { mode: 0o644 });
  }

  const conflict: PromptConflictSummary = {
    path: relativePath,
    action: 'kept',
    reviewFile: reviewRelativePath,
    reason,
  };

  const notice = buildConflictNotice(
    path.join(expandedBaseDir, relativePath),
    reviewFullPath,
  );

  return {
    action: 'keep',
    conflict,
    notice,
  };
}

/**
 * Check if content has NO OVERWRITE flag.
 * Hash-based patterns (#, # LLXPRT:) must be at absolute start of file.
 * HTML comment pattern (<!-- -->) can be anywhere in file.
 */
export function hasNoOverwriteFlag(content: string): boolean {
  return (
    isHashNoOverwriteFlag(content) ||
    isHashLlxprtNoOverwriteFlag(content) ||
    containsHtmlNoOverwriteFlag(content)
  );
}

/** Check for `# NO OVERWRITE` at the start of content (case-insensitive, flexible whitespace). */
function isHashNoOverwriteFlag(content: string): boolean {
  if (!content.startsWith('#')) {
    return false;
  }
  const afterHash = content.slice(1);
  return keywordAfterPrefix(afterHash, '');
}

/** Check for `# LLXPRT: NO OVERWRITE` at the start of content (case-insensitive). */
function isHashLlxprtNoOverwriteFlag(content: string): boolean {
  if (!content.startsWith('#')) {
    return false;
  }
  const afterHash = content.slice(1);
  return keywordAfterPrefix(afterHash, 'LLXPRT:');
}

/** Check for `<!-- NO OVERWRITE -->` HTML comment anywhere in content. */
function containsHtmlNoOverwriteFlag(content: string): boolean {
  const upper = content.toUpperCase();
  let openIdx = upper.indexOf('<!--');
  while (openIdx !== -1) {
    const closeIdx = upper.indexOf('-->', openIdx);
    if (closeIdx === -1) {
      return false;
    }
    const inner = upper.slice(openIdx + 4, closeIdx).trim();
    const normalized = inner.replace(/\s+/g, ' ');
    if (normalized === 'NO OVERWRITE') {
      return true;
    }
    openIdx = upper.indexOf('<!--', closeIdx + 3);
  }
  return false;
}

/** Check if `afterPrefix` contains `keyword NO OVERWRITE` after leading whitespace. */
function keywordAfterPrefix(afterPrefix: string, keyword: string): boolean {
  const stripped = afterPrefix.replace(/^\s*/, '');
  if (keyword) {
    const upper = stripped.toUpperCase();
    if (!upper.startsWith(keyword.toUpperCase())) {
      return false;
    }
  }
  return checkNoOverwriteKeyword(stripped.slice(keyword.length));
}

/** Check if text starts with `NO OVERWRITE` (case-insensitive, flexible whitespace). */
function checkNoOverwriteKeyword(text: string): boolean {
  const upper = text.toUpperCase().replace(/^\s*/, '');
  if (!upper.startsWith('NO')) {
    return false;
  }
  const afterNo = upper.slice(2).replace(/^\s+/, '');
  return afterNo.startsWith('OVERWRITE');
}

/** Build a user-facing conflict notice message. */
export function buildConflictNotice(
  userPath: string,
  reviewPath: string,
): string {
  return `Warning: this version includes a newer version of ${userPath} which you customized. We put ${reviewPath} next to it for your review.`;
}

/** Generate a review filename by appending a timestamp. */
export function generateReviewFilename(
  relativePath: string,
  timestamp: string,
): string {
  return `${relativePath}.${timestamp}`;
}

/** Format a date as a UTC timestamp string for filenames. */
export function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear().toString();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

/** Get the review timestamp from default file stats, or epoch if unavailable. */
export function getReviewTimestamp(defaultStats: Stats | null): string {
  if (defaultStats) {
    return formatTimestamp(defaultStats.mtime);
  }
  return formatTimestamp(new Date(0));
}

const defaultSourceDirsCache = new Map<string, string[]>();

/** Get candidate directories where default files may live. */
export function getDefaultSourceDirectories(): string[] {
  const cached = defaultSourceDirsCache.get('');
  if (cached) {
    return cached;
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = new Set<string>();
  candidates.add(path.join(moduleDir, 'defaults'));
  candidates.add(path.join(moduleDir, '..', 'defaults'));
  candidates.add(path.join(moduleDir, '..', '..', 'defaults'));
  candidates.add(
    path.join(moduleDir, '..', '..', 'src', 'prompt-config', 'defaults'),
  );
  candidates.add(path.join(process.cwd(), 'bundle'));
  candidates.add(
    path.join(process.cwd(), 'packages/core/src/prompt-config/defaults'),
  );

  const dirs = Array.from(candidates);
  defaultSourceDirsCache.set('', dirs);
  return dirs;
}

/** Get stats for a default file by searching candidate source directories. */
export async function getDefaultFileStats(
  relativePath: string,
  defaultSourceDirs?: readonly string[],
): Promise<Stats | null> {
  const sourceDirs = defaultSourceDirs ?? getDefaultSourceDirectories();
  for (const baseDir of sourceDirs) {
    const candidate = path.join(baseDir, relativePath);
    try {
      const stats = await fs.stat(candidate);
      if (stats.isFile()) {
        return stats;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/** Build the list of files to remove during uninstall. */
export async function buildRemovalList(
  expandedBaseDir: string,
  removeUserFiles: boolean,
  collectAll: (
    baseDir: string,
    currentDir: string,
    files: string[],
  ) => Promise<void>,
): Promise<string[]> {
  if (removeUserFiles) {
    const toRemove: string[] = [];
    await collectAll(expandedBaseDir, expandedBaseDir, toRemove);
    return toRemove;
  }

  return DEFAULT_UNINSTALL_PATHS.filter((p) =>
    existsSync(path.join(expandedBaseDir, p)),
  );
}
