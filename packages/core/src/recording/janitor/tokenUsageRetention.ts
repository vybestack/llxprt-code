/**
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token-usage log retention for the session janitor (#4068).
 *
 * Every model request appends to `<project tmp>/token-usage/<session>.jsonl`,
 * and nothing used to delete those files. The janitor now applies the chat age
 * policy (`sessionRetention.maxAge`, guarded by `minRetention`) to them and
 * keeps their machine-wide total under `sessionRetention.tokenUsageMaxTotalSizeMB`,
 * evicting the oldest files first. It runs under the janitor's global lease.
 *
 * A file belongs to the root session named before `::` in its file name
 * (subagent logs are `<root>::<child runtime>.jsonl`). A file is never deleted
 * when its root session is the current process's session, when that session
 * holds a live lock in the project's chats directory, or when the file was
 * written within the `minRetention` floor — the same protections the janitor
 * applies to chat recordings. A root id outside the safe session-id grammar
 * cannot be lock-checked, so such files are left alone.
 *
 * The live-lock check at selection time is advisory. Each deletion then takes
 * the root session's lock itself (skipping the file when the lock is busy),
 * revalidates the file under it and unlinks before releasing, so a session
 * that starts between selection and deletion keeps its log.
 *
 * Token-usage directories are never removed, even when empty. A writer
 * creates the directory once and then appends without holding any lock, so
 * removing an empty directory could make every later write of a starting
 * session fail.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  SessionLockManager,
  SessionLockedError,
  type LockHandle,
} from '../SessionLockManager.js';
import { hasErrnoCode } from '../../storage/local-media-store-validation.js';
import type { ResolvedRetentionConfig } from './cleanupTypes.js';
import { PROJECT_HASH_RE } from './sessionScanner.js';
import { isValidSafeSessionId } from './sessionSafety.js';

export const TOKEN_USAGE_DIR_NAME = 'token-usage';

const JSONL_SUFFIX = '.jsonl';

interface TokenUsageFile {
  readonly filePath: string;
  readonly chatsDir: string;
  readonly rootSessionId: string;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly dev: number;
  readonly ino: number;
}

/** Outcome counts of one token-usage cleanup pass. */
export interface TokenUsageCleanupResult {
  readonly scanned: number;
  readonly deleted: number;
  readonly bytesDeleted: number;
  readonly failed: number;
}

interface CleanupState {
  deleted: number;
  bytesDeleted: number;
  failed: number;
}

/**
 * Optional seams for one cleanup pass. Production callers pass none.
 */
export interface TokenUsageCleanupOptions {
  /**
   * Runs after a file was selected for deletion and before the deletion takes
   * the session lock, the token-usage twin of the janitor's scan-to-mutation
   * hook. Tests use it to acquire that lock, append to the file or replace it
   * in exactly that window.
   */
  readonly beforeDelete?: (filePath: string) => Promise<void> | void;
}

function rootSessionIdOf(fileName: string): string {
  const sessionId = fileName.slice(0, -JSONL_SUFFIX.length);
  const separator = sessionId.indexOf('::');
  return separator === -1 ? sessionId : sessionId.slice(0, separator);
}

async function listProjectDirs(
  globalTempDir: string,
  state: CleanupState,
): Promise<string[]> {
  try {
    const entries = await fs.readdir(globalTempDir, { withFileTypes: true });
    return entries
      .filter(
        (entry) => entry.isDirectory() && PROJECT_HASH_RE.test(entry.name),
      )
      .map((entry) => path.join(globalTempDir, entry.name));
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) state.failed += 1;
    return [];
  }
}

/** Regular `.jsonl` files directly inside one project's token-usage dir. */
async function listProjectFiles(
  projectDir: string,
  state: CleanupState,
): Promise<TokenUsageFile[]> {
  const tokenDir = path.join(projectDir, TOKEN_USAGE_DIR_NAME);
  let entries: string[];
  try {
    const dirStat = await fs.lstat(tokenDir);
    if (!dirStat.isDirectory()) return [];
    entries = await fs.readdir(tokenDir);
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) state.failed += 1;
    return [];
  }
  const files: TokenUsageFile[] = [];
  for (const name of entries.filter((entry) => entry.endsWith(JSONL_SUFFIX))) {
    const filePath = path.join(tokenDir, name);
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile()) continue;
      files.push({
        filePath,
        chatsDir: path.join(projectDir, 'chats'),
        rootSessionId: rootSessionIdOf(name),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        dev: stat.dev,
        ino: stat.ino,
      });
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) state.failed += 1;
    }
  }
  return files;
}

async function isProtected(
  file: TokenUsageFile,
  currentSessionId: string | undefined,
  config: ResolvedRetentionConfig,
  now: number,
): Promise<boolean> {
  if (now - file.mtimeMs < config.minRetentionMs) return true;
  if (file.rootSessionId === currentSessionId) return true;
  if (!isValidSafeSessionId(file.rootSessionId)) return true;
  return SessionLockManager.isLocked(file.chatsDir, file.rootSessionId);
}

/**
 * Exclusive ownership of the file's root session lock, or null when it is
 * held (a live session, or this process's own session). Any other failure is
 * counted, not hidden. Acquiring may create the project's `chats/` directory,
 * which is where a starting session would create the same lock.
 */
async function lockRootSession(
  file: TokenUsageFile,
  state: CleanupState,
): Promise<LockHandle | null> {
  try {
    return await SessionLockManager.acquire(file.chatsDir, file.rootSessionId);
  } catch (error) {
    if (!(error instanceof SessionLockedError)) state.failed += 1;
    return null;
  }
}

/**
 * Delete one selected file while holding its root session's lock, the same
 * discipline the chat reclamation engine uses for recordings. The scan-time
 * lock check alone leaves a window: a session can take its lock after that
 * check without changing the file. Holding the lock closes it, because a
 * session cannot start or resume until the lock is released. A busy lock
 * skips the file.
 */
async function deleteScanned(
  file: TokenUsageFile,
  state: CleanupState,
  options: TokenUsageCleanupOptions,
): Promise<void> {
  if (options.beforeDelete !== undefined) {
    await options.beforeDelete(file.filePath);
  }
  const lock = await lockRootSession(file, state);
  if (lock === null) return;
  try {
    await unlinkIfUnchanged(file, lock, state);
  } finally {
    await lock.release();
  }
}

/**
 * Revalidate under the lock, then unlink. The protections checked at scan
 * time either cannot change (the current session id, the id grammar) or are
 * re-established here: the lock is ours, and an unchanged identity, size and
 * mtime mean nothing was written since the scan, so the minRetention floor
 * still does not apply. A file replaced or appended to since the scan (a
 * resumed session recreating or extending its log) is kept.
 */
async function unlinkIfUnchanged(
  file: TokenUsageFile,
  lock: LockHandle,
  state: CleanupState,
): Promise<void> {
  try {
    const stat = await fs.lstat(file.filePath);
    if (!stat.isFile() || stat.dev !== file.dev || stat.ino !== file.ino) {
      return;
    }
    if (stat.mtimeMs !== file.mtimeMs || stat.size !== file.sizeBytes) return;
    if (!(await lock.ownsLock())) return;
    await fs.unlink(file.filePath);
    state.deleted += 1;
    state.bytesDeleted += file.sizeBytes;
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) state.failed += 1;
  }
}

function oldestFirst(a: TokenUsageFile, b: TokenUsageFile): number {
  if (a.mtimeMs !== b.mtimeMs) return a.mtimeMs - b.mtimeMs;
  if (a.filePath === b.filePath) return 0;
  return a.filePath < b.filePath ? -1 : 1;
}

/**
 * Apply the age policy, then the byte budget, to every token-usage file under
 * `globalTempDir`. The budget counts protected files too (it bounds what is
 * on disk); only unprotected files are ever evicted.
 */
export async function cleanupTokenUsageFiles(
  globalTempDir: string,
  currentSessionId: string | undefined,
  config: ResolvedRetentionConfig,
  options: TokenUsageCleanupOptions = {},
): Promise<TokenUsageCleanupResult> {
  const state: CleanupState = { deleted: 0, bytesDeleted: 0, failed: 0 };
  const projectDirs = await listProjectDirs(globalTempDir, state);
  const files: TokenUsageFile[] = [];
  for (const projectDir of projectDirs) {
    files.push(...(await listProjectFiles(projectDir, state)));
  }

  const now = Date.now();
  const evictable: TokenUsageFile[] = [];
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.sizeBytes;
    if (!(await isProtected(file, currentSessionId, config, now))) {
      evictable.push(file);
    }
  }
  evictable.sort(oldestFirst);

  for (const file of evictable) {
    const pastAge =
      config.maxAgeMs !== null && now - file.mtimeMs > config.maxAgeMs;
    const overBudget = totalBytes > config.tokenUsageMaxTotalSizeBytes;
    if (!pastAge && !overBudget) continue;
    const before = state.deleted;
    await deleteScanned(file, state, options);
    if (state.deleted > before) totalBytes -= file.sizeBytes;
  }
  return {
    scanned: files.length,
    deleted: state.deleted,
    bytesDeleted: state.bytesDeleted,
    failed: state.failed,
  };
}
