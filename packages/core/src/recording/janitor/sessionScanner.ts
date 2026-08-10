/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Global session scanner for the janitor.
 *
 * Scans every direct child of `Storage.getGlobalTempDir()` whose name is
 * exactly a 64-character lowercase hexadecimal project hash.  Within each
 * project hash directory it discovers `chats/session-*.jsonl` (raw recordings)
 * and `chats/archive/session-*.jsonl.gz` (cold archives).  It uses bounded
 * concurrency and the canonical header reader — never reading entire files
 * into memory.
 *
 * Blast-radius safety (AC-10): symlinks are never followed; unknown files are
 * ignored; non-hash directories are skipped.
 */

import * as fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import * as path from 'node:path';
import type { SessionCandidate } from './cleanupTypes.js';
import { readSessionJsonlHeader } from './sessionHeaderReader.js';

/** Regex matching a 64-character lowercase hex project hash directory name. */
const PROJECT_HASH_RE = /^[0-9a-f]{64}$/;

/** Bounded concurrency for stat/header operations within a directory. */
const MAX_CONCURRENT_OPS = 8;

/** Archive sub-directory name inside a chats directory. */
export const ARCHIVE_DIR_NAME = 'archive';

/** Prefix and suffix for raw session recordings. */
const SESSION_PREFIX = 'session-';
const SESSION_JSONL_SUFFIX = '.jsonl';
const ARCHIVE_SUFFIX = '.jsonl.gz';

/** Result of scanning the global temp tree. */
export interface ScanResult {
  readonly candidates: readonly SessionCandidate[];
  readonly chatsDirs: readonly string[];
  /** Number of non-benign (non-ENOENT) per-project scan failures (OCR 38/39). */
  readonly scanErrorCount: number;
}

/** Internal batch result from scanning a single directory. */
interface ScanBatch {
  readonly candidates: SessionCandidate[];
  readonly errors: number;
}

const EMPTY_BATCH: ScanBatch = { candidates: [], errors: 0 };

/**
 * Determine whether a file uses allocated blocks and return the allocated
 * size when available, falling back to file length otherwise.  On filesystems
 * that do not expose blocks (e.g. some Windows setups), this returns
 * `stat.size`.
 */
function getFileSize(stat: Stats): number {
  const allocated =
    typeof stat.blocks === 'number' && stat.blksize > 0 ? stat.blocks * 512 : 0;
  return allocated > 0 ? allocated : stat.size;
}

/**
 * Run an async mapper over an array with a bounded number of concurrent
 * operations, preserving the input order in the output.
 */
async function boundedMap<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await mapper(items[i]);
    }
  };
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * Scan the global temp directory tree for all session recordings and cold
 * archives across every 64-hex project-hash directory.
 *
 * @param globalTempDir - The return value of `Storage.getGlobalTempDir()`.
 * @param currentSessionId - The current process's session ID (to mark as active).
 * @returns Discovered candidates and the list of chats directories found.
 */
export async function scanGlobalSessions(
  globalTempDir: string,
  currentSessionId?: string,
): Promise<ScanResult> {
  let topEntries: string[];
  try {
    topEntries = await fs.readdir(globalTempDir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { candidates: [], chatsDirs: [], scanErrorCount: 0 };
    }
    throw error;
  }

  const hashDirs = topEntries.filter((name) => PROJECT_HASH_RE.test(name));
  const chatsDirs: string[] = [];
  const allCandidates: SessionCandidate[] = [];
  let scanErrorCount = 0;

  // Process project-hash directories with bounded concurrency.
  await boundedMap(hashDirs, MAX_CONCURRENT_OPS, async (hashDirName) => {
    const hashDirPath = path.join(globalTempDir, hashDirName);
    const chatsDir = path.join(hashDirPath, 'chats');

    let lstat: Stats;
    try {
      lstat = await fs.lstat(hashDirPath);
    } catch {
      return; // vanished between readdir and lstat — benign.
    }
    // Never follow symlinks (AC-10).
    if (lstat.isSymbolicLink()) return;
    if (!lstat.isDirectory()) return;

    // Never follow symlinks at any directory boundary (AC-10).  The chats
    // directory itself must be a real directory, not a symlink pointing
    // outside the project hash tree.
    let chatsExists = true;
    try {
      const chatsLstat = await fs.lstat(chatsDir);
      if (chatsLstat.isSymbolicLink() || !chatsLstat.isDirectory()) {
        chatsExists = false;
      }
    } catch {
      chatsExists = false;
    }
    if (!chatsExists) return;

    chatsDirs.push(chatsDir);

    const rawBatch = await scanRawSessions(
      chatsDir,
      hashDirName,
      currentSessionId,
    );
    allCandidates.push(...rawBatch.candidates);
    scanErrorCount += rawBatch.errors;

    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    const archiveBatch = await scanArchiveSessions(archiveDir, hashDirName);
    allCandidates.push(...archiveBatch.candidates);
    scanErrorCount += archiveBatch.errors;
  });

  return { candidates: allCandidates, chatsDirs, scanErrorCount };
}

/** Scan `session-*.jsonl` files inside a chats directory. */
async function scanRawSessions(
  chatsDir: string,
  projectHashDir: string,
  currentSessionId?: string,
): Promise<ScanBatch> {
  let files: string[];
  try {
    files = await fs.readdir(chatsDir);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return EMPTY_BATCH;
    // Non-ENOENT error (EACCES, EIO, …) — count as a scan failure (OCR 38/39).
    return { candidates: [], errors: 1 };
  }

  const sessionFiles = files.filter(
    (f) =>
      f.startsWith(SESSION_PREFIX) &&
      f.endsWith(SESSION_JSONL_SUFFIX) &&
      !f.endsWith(ARCHIVE_SUFFIX),
  );

  let perFileErrors = 0;
  const candidates = (
    await boundedMap(sessionFiles, MAX_CONCURRENT_OPS, async (fileName) => {
      const filePath = path.join(chatsDir, fileName);
      try {
        const lstat = await fs.lstat(filePath);
        if (lstat.isSymbolicLink()) return null;
        if (!lstat.isFile()) return null;
        const header = await readSessionJsonlHeader(filePath);
        const candidate: SessionCandidate = {
          kind: 'raw',
          filePath,
          fileName,
          containerDir: chatsDir,
          projectHashDir,
          sessionId: header?.sessionId ?? null,
          isCurrentSession:
            header?.sessionId != null &&
            currentSessionId != null &&
            header.sessionId === currentSessionId,
          sizeBytes: getFileSize(lstat),
          mtime: lstat.mtime,
          dev: lstat.dev,
          ino: lstat.ino,
        };
        return candidate;
      } catch {
        perFileErrors++;
        return null;
      }
    })
  ).filter((c): c is SessionCandidate => c !== null);

  return { candidates, errors: perFileErrors };
}

/** Scan `session-*.jsonl.gz` archive files inside a chats/archive directory. */
async function scanArchiveSessions(
  archiveDir: string,
  projectHashDir: string,
): Promise<ScanBatch> {
  // Never follow a symlinked archive directory, and require a real directory
  // (not a regular file) so readdir does not throw ENOTDIR (AC-10, OCR 38).
  try {
    const archiveLstat = await fs.lstat(archiveDir);
    if (archiveLstat.isSymbolicLink() || !archiveLstat.isDirectory()) {
      return EMPTY_BATCH;
    }
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return EMPTY_BATCH;
    // Non-ENOENT error (EACCES, EIO, …) — count as a scan failure (OCR 39).
    return { candidates: [], errors: 1 };
  }

  let files: string[];
  try {
    files = await fs.readdir(archiveDir);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return EMPTY_BATCH;
    return { candidates: [], errors: 1 };
  }

  const archiveFiles = files.filter(
    (f) => f.startsWith(SESSION_PREFIX) && f.endsWith(ARCHIVE_SUFFIX),
  );

  let perFileErrors = 0;
  const candidates = (
    await boundedMap(archiveFiles, MAX_CONCURRENT_OPS, async (fileName) => {
      const filePath = path.join(archiveDir, fileName);
      try {
        const lstat = await fs.lstat(filePath);
        if (lstat.isSymbolicLink()) return null;
        if (!lstat.isFile()) return null;
        const candidate: SessionCandidate = {
          kind: 'archive',
          filePath,
          fileName,
          containerDir: archiveDir,
          projectHashDir,
          sessionId: null,
          isCurrentSession: false,
          sizeBytes: getFileSize(lstat),
          mtime: lstat.mtime,
          dev: lstat.dev,
          ino: lstat.ino,
        };
        return candidate;
      } catch {
        perFileErrors++;
        return null;
      }
    })
  ).filter((c): c is SessionCandidate => c !== null);

  return { candidates, errors: perFileErrors };
}
