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
 * Lossless cold-archive compression for session recordings (AC-4, hardened
 * Items 1, 6, 8).
 *
 * Safety hardening:
 * - **Item 1**: The archive directory and source file are validated as
 *   regular non-symlink entries at mutation time.  A symlinked archive
 *   directory or symlinked source is rejected, preventing writes/unlinks
 *   outside the managed root.
 * - **Item 6**: After the final gzip rename, the archive directory is fsynced
 *   where the platform supports it.  The `durableCommit` field reports whether
 *   durability was established.  When it is `false` the caller must NOT
 *   unlink the source (ambiguous failure retains data).
 * - **Item 8**: Stale temp cleanup matches the exact janitor-generated temp
 *   grammar (`session-*.gz.tmp`), uses `lstat` to reject symlinks, and
 *   verifies containment.
 *
 * The lifecycle remains crash-safe: at every interruption point at least one
 * intact copy remains.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import {
  isRegularNonSymlinkFile,
  isRegularNonSymlinkDir,
  isPathContainedIn,
} from './sessionSafety.js';

/** Suffix for temporary gzip files. */
const TEMP_ARCHIVE_SUFFIX = '.gz.tmp';

/** Exact grammar for janitor-generated temp files (Item 8). */
const TEMP_ARCHIVE_GRAMMAR = /^session-.+\.gz\.tmp$/;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of archive integrity verification. */
export interface VerifyResult {
  readonly ok: boolean;
  readonly error?: string;
}

/**
 * Discriminated kind for an archive failure, so callers can isolate and log
 * each external filesystem failure by category (finding E).
 */
export type ArchiveErrorKind =
  | 'source-invalid'
  | 'mkdir'
  | 'existing-archive'
  | 'hash'
  | 'compress'
  | 'verify'
  | 'rename';

/** Result of an archive operation. */
export interface ArchiveResult {
  readonly success: boolean;
  readonly archivePath: string | null;
  /**
   * When `false`, the archive was written but directory-level durability
   * (fsync) could not be established.  The caller must NOT unlink the source.
   */
  readonly durableCommit: boolean;
  /** Actual physical byte size of the resulting archive (0 on failure). */
  readonly archiveBytes: number;
  readonly error?: string;
  readonly errorKind?: ArchiveErrorKind;
}

// ---------------------------------------------------------------------------
// Hashing and verification
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash and byte count of a file by streaming its contents.
 */
export async function computeFileHashAndSize(
  filePath: string,
): Promise<{ sha256: string; bytes: number }> {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const sink = new Writable({
    write(chunk: Buffer, _enc, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      callback();
    },
  });
  await pipeline(fs.createReadStream(filePath), sink);
  return { sha256: hash.digest('hex'), bytes };
}

/**
 * Stream-decompress a gzip archive and verify that its decompressed content
 * matches the given source SHA-256 and byte count.
 */
export async function verifyArchiveIntegrity(
  archivePath: string,
  expectedSha256: string,
  expectedBytes: number,
): Promise<VerifyResult> {
  try {
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const sink = new Writable({
      write(chunk: Buffer, _enc, callback) {
        bytes += chunk.length;
        hash.update(chunk);
        callback();
      },
    });
    await pipeline(fs.createReadStream(archivePath), zlib.createGunzip(), sink);
    if (bytes !== expectedBytes) {
      return {
        ok: false,
        error: `byte mismatch: ${bytes} != ${expectedBytes}`,
      };
    }
    const actualSha = hash.digest('hex');
    if (actualSha !== expectedSha256) {
      return { ok: false, error: 'sha256 mismatch' };
    }
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------

/**
 * Compress a raw JSONL recording into a lossless gzip archive inside the
 * specified archive directory (Item 1 hardening: validates non-symlink
 * identity at mutation time).
 *
 * The source file is **not** unlinked by this function.
 */
export async function compressToArchive(
  sourcePath: string,
  archiveDir: string,
): Promise<ArchiveResult> {
  // Item 1: Validate source is a regular non-symlink file.
  if (!(await isRegularNonSymlinkFile(sourcePath))) {
    return archiveError(
      'Source file is not a regular non-symlink file',
      'source-invalid',
    );
  }

  // Finding C: capture the source recording mtime so the archive can preserve
  // the original session chronology (age ranking + minRetention by original age).
  let sourceMtime: Date;
  try {
    const stat = await fsp.stat(sourcePath);
    sourceMtime = stat.mtime;
  } catch (error: unknown) {
    return archiveError(error, 'source-invalid');
  }

  const sourceBase = path.basename(sourcePath);
  const finalArchivePath = path.join(archiveDir, sourceBase + '.gz');

  // Item 1: If archiveDir already exists, it must be a regular non-symlink
  // dir.  This check MUST precede the reuse path so a symlinked archiveDir
  // is never traversed or mutated through existing-archive reuse.
  const existingDir = await isRegularNonSymlinkDir(archiveDir);
  if (existingDir === false && (await pathExists(archiveDir))) {
    return archiveError(
      'Archive directory is a symlink or non-directory — refusing to write',
      'mkdir',
    );
  }

  // If the archive already exists and is intact, reuse it (with symlink check).
  const reused = await tryReuseExistingArchive(
    sourcePath,
    finalArchivePath,
    archiveDir,
    sourceMtime,
  );
  if (reused !== null) return reused;

  try {
    await fsp.mkdir(archiveDir, { recursive: true });
  } catch (error: unknown) {
    return archiveError(error, 'mkdir');
  }

  let sourceInfo: { sha256: string; bytes: number };
  try {
    sourceInfo = await computeFileHashAndSize(sourcePath);
  } catch (error: unknown) {
    return archiveError(error, 'hash');
  }

  const tempName = sourceBase + '.' + crypto.randomUUID() + TEMP_ARCHIVE_SUFFIX;
  const tempPath = path.join(archiveDir, tempName);

  const compressed = await streamCompress(sourcePath, tempPath);
  if (!compressed) return archiveError('Compression failed', 'compress');

  const verified = await verifyArchiveIntegrity(
    tempPath,
    sourceInfo.sha256,
    sourceInfo.bytes,
  );
  if (!verified.ok) {
    await safeUnlink(tempPath);
    return archiveError(
      verified.error ?? 'Archive verification failed',
      'verify',
    );
  }

  return finalizeArchive(
    tempPath,
    finalArchivePath,
    sourceInfo,
    archiveDir,
    sourceMtime,
  );
}

/** Reuse an existing verified archive.  Null = proceed with fresh compression. */
async function tryReuseExistingArchive(
  sourcePath: string,
  finalArchivePath: string,
  archiveDir: string,
  sourceMtime: Date,
): Promise<ArchiveResult | null> {
  if (!(await fileExists(finalArchivePath))) return null;

  // Item 1: Existing archive must be a regular non-symlink file contained in archiveDir.
  if (!(await isRegularNonSymlinkFile(finalArchivePath))) {
    return archiveError(
      'Existing archive is a symlink — refusing to reuse',
      'existing-archive',
    );
  }
  if (!isPathContainedIn(archiveDir, finalArchivePath)) {
    return archiveError(
      'Existing archive path escapes archive directory',
      'existing-archive',
    );
  }

  // Finding 13: the source may disappear or become unreadable between the
  // initial validation in compressToArchive and this hash computation.
  // Catch and return a typed ArchiveResult — never an unhandled rejection.
  let sourceHash: { sha256: string; bytes: number };
  try {
    sourceHash = await computeFileHashAndSize(sourcePath);
  } catch (error: unknown) {
    return archiveError(error, 'source-invalid');
  }

  const verify = await verifyArchiveIntegrity(
    finalArchivePath,
    sourceHash.sha256,
    sourceHash.bytes,
  );
  if (verify.ok) {
    // Reused archive: fsync the directory to establish durability and preserve
    // the source recording chronology on the reused archive (finding C).
    const durable = await commitArchiveDurably(archiveDir, finalArchivePath);
    await applySourceMtime(finalArchivePath, sourceMtime);
    const archiveBytes = await physicalBytes(finalArchivePath);
    return {
      success: true,
      archivePath: finalArchivePath,
      durableCommit: durable,
      archiveBytes,
    };
  }
  // Finding 14/16: the existing archive failed integrity verification.
  // Return a typed error so compressToArchive does NOT proceed with fresh
  // compression (which would rename-over and destroy the existing archive
  // while claiming to "retain it").  Keep source and existing archive
  // untouched.  Source hashing is not duplicated because this returns a
  // concrete result, not null.
  return archiveError(
    verify.error ?? 'Existing archive failed integrity verification',
    'existing-archive',
  );
}

/** Stream-compress source into temp and durably flush.  False on failure. */
async function streamCompress(
  sourcePath: string,
  tempPath: string,
): Promise<boolean> {
  try {
    const gzip = zlib.createGzip({
      level: zlib.constants.Z_DEFAULT_COMPRESSION,
    });
    await pipeline(
      fs.createReadStream(sourcePath),
      gzip,
      fs.createWriteStream(tempPath),
    );
    let fd: fsp.FileHandle | undefined;
    try {
      fd = await fsp.open(tempPath, 'r+');
      await fd.sync();
    } finally {
      await fd?.close().catch(() => {});
    }
    return true;
  } catch {
    await safeUnlink(tempPath);
    return false;
  }
}

/** Atomic rename, then preserve source chronology and fsync archive directory (Items 6, C). */
async function finalizeArchive(
  tempPath: string,
  finalArchivePath: string,
  sourceInfo: { sha256: string; bytes: number },
  archiveDir: string,
  sourceMtime: Date,
): Promise<ArchiveResult> {
  try {
    await fsp.rename(tempPath, finalArchivePath);
  } catch (error: unknown) {
    await safeUnlink(tempPath);
    if (await fileExists(finalArchivePath)) {
      const ok = await verifyArchiveIntegrity(
        finalArchivePath,
        sourceInfo.sha256,
        sourceInfo.bytes,
      );
      if (ok.ok) {
        const durable = await commitArchiveDurably(
          archiveDir,
          finalArchivePath,
        );
        await applySourceMtime(finalArchivePath, sourceMtime);
        const archiveBytes = await physicalBytes(finalArchivePath);
        return {
          success: true,
          archivePath: finalArchivePath,
          durableCommit: durable,
          archiveBytes,
        };
      }
    }
    return archiveError(error, 'rename');
  }

  // Finding C: stamp the archive with the original recording mtime so age
  // ranking and minRetention apply by original session age.
  await applySourceMtime(finalArchivePath, sourceMtime);

  // Item 6: flush after the rename so the archive is durable before the caller
  // may unlink the source.  If the flush fails, report durableCommit=false so
  // the source is retained.
  const durable = await commitArchiveDurably(archiveDir, finalArchivePath);
  const archiveBytes = await physicalBytes(finalArchivePath);
  return {
    success: true,
    archivePath: finalArchivePath,
    durableCommit: durable,
    archiveBytes,
  };
}

/**
 * Apply the source recording mtime to the archive (finding C).  Best-effort:
 * a failure to set mtime does not invalidate an otherwise-verified archive.
 */
async function applySourceMtime(
  archivePath: string,
  sourceMtime: Date,
): Promise<void> {
  try {
    await fsp.utimes(archivePath, sourceMtime, sourceMtime);
  } catch {
    // Best-effort chronology preservation.
  }
}

/** Read the physical byte size of a file, or 0 when unreadable. */
async function physicalBytes(filePath: string): Promise<number> {
  try {
    const stat = await fsp.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Stale temp cleanup (Item 8)
// ---------------------------------------------------------------------------

/**
 * Clean up stale temporary archive artifacts matching the exact janitor temp
 * grammar (`session-*.gz.tmp`).  Uses `lstat` to reject symlinks and verifies
 * containment.  Only files older than `maxAgeMs` are removed (Item 8).
 */
export async function cleanupStaleTempArchives(
  archiveDir: string,
  maxAgeMs: number,
): Promise<number> {
  let files: string[];
  try {
    files = await fsp.readdir(archiveDir);
  } catch {
    return 0;
  }
  const now = Date.now();
  let cleaned = 0;
  for (const file of files) {
    if (await shouldUnlinkTempFile(archiveDir, file, now, maxAgeMs)) {
      try {
        await fsp.unlink(path.join(archiveDir, file));
        cleaned++;
      } catch {
        // Best-effort.
      }
    }
  }
  return cleaned;
}

/** Check whether a temp file matches grammar, is a regular file, and is old enough to remove. */
async function shouldUnlinkTempFile(
  archiveDir: string,
  file: string,
  now: number,
  maxAgeMs: number,
): Promise<boolean> {
  if (!TEMP_ARCHIVE_GRAMMAR.test(file)) return false;
  const filePath = path.join(archiveDir, file);
  // Item 8: containment check.
  if (!isPathContainedIn(archiveDir, filePath)) return false;
  try {
    // Item 8: use lstat to reject symlinks.
    const lstat = await fsp.lstat(filePath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) return false;
    return now - lstat.mtimeMs > maxAgeMs;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Whether this platform can fsync a directory handle.
 *
 * POSIX lets a directory be opened read-only and fsynced, which is what makes
 * a freshly renamed directory entry durable.  Windows has no equivalent:
 * `fs.open` on a directory fails outright, and NTFS journals metadata itself
 * rather than exposing a per-directory flush.
 *
 * This is a platform capability, not an error, and the distinction matters.
 * Reporting the absence as a durability *failure* made
 * {@link ArchiveResult.durableCommit} permanently false on Windows, and the
 * reclamation engine refuses to unlink a source whose archive is not durably
 * committed.  The net effect was that the session janitor archived files but
 * never reclaimed a single byte on Windows: archives accumulated while every
 * raw session was retained forever.
 */
function supportsDirectoryFsync(): boolean {
  return process.platform !== 'win32';
}

/**
 * Flush a freshly renamed archive so the reclamation engine may unlink its
 * source (Item 6).
 *
 * On POSIX this opens the containing directory read-only and fsyncs it, which
 * is what makes the new directory entry survive a crash.
 *
 * Windows has no directory fsync, but reporting durability there without
 * flushing anything would be a claim rather than a guarantee: Node does not
 * expose `MOVEFILE_WRITE_THROUGH`, so `fsp.rename` is not itself write-through.
 * Flush the renamed file instead — `FlushFileBuffers` on a file handle commits
 * that file's data and its metadata, which is the strongest durability the
 * platform exposes here. Either way the returned value reflects a flush that
 * actually succeeded, so a failure still holds the source back.
 */
async function commitArchiveDurably(
  archiveDir: string,
  archivePath: string,
): Promise<boolean> {
  // The open mode differs by target and is not incidental. A directory fsync
  // needs only read access, but FlushFileBuffers requires a handle with write
  // access, so opening the archive 'r' fails on Windows and would report the
  // whole commit as non-durable — reinstating the bug this function exists to
  // fix.
  const [target, mode] = supportsDirectoryFsync()
    ? ([archiveDir, 'r'] as const)
    : ([archivePath, 'r+'] as const);
  let fd: fsp.FileHandle | undefined;
  try {
    fd = await fsp.open(target, mode);
    await fd.sync();
    return true;
  } catch {
    return false;
  } finally {
    await fd?.close().catch(() => {});
  }
}

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Best-effort.
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Build a failure result with a readable error message and kind. */
function archiveError(error: unknown, kind: ArchiveErrorKind): ArchiveResult {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = String(error);
  }
  return {
    success: false,
    archivePath: null,
    durableCommit: false,
    archiveBytes: 0,
    error: message,
    errorKind: kind,
  };
}
