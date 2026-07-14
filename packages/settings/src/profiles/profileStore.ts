/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { channel } from 'node:diagnostics_channel';

/**
 * diagnostics_channel name published exactly once per async lock acquisition
 * when the first EEXIST is observed. The payload is `{ lockPath: string }`.
 * Tests subscribe to this channel to deterministically observe lock
 * contention without sleeps.
 */
export const LOCK_CONTENTION_CHANNEL = 'llxprt:profilesLock:contention';

const LOCK_FILE_NAME = '.profiles.lock';

/**
 * Bounded deadline (ms) for async lock acquisition. When the lock is busy,
 * the async path polls every {@link ASYNC_POLL_MS} until this deadline
 * elapses, then throws {@link LockBusyError}.
 *
 * Safety over availability: a lock that cannot be acquired within this
 * deadline means a concurrent operation is in progress (or a stale lock
 * requires manual recovery). We refuse rather than risk data corruption.
 *
 * This is the production default. Tests inject a shorter deadline via the
 * optional {@link acquireProfilesLock} `deadlineMs` parameter so the stale-
 * lock path is exercised deterministically without fixed sleeps.
 */
const ASYNC_LOCK_DEADLINE_MS = 10_000;

/**
 * Polling interval (ms) for async lock acquisition while waiting for a
 * busy lock to become available.
 */
const ASYNC_POLL_MS = 50;

/**
 * Known errno codes where directory fsync is unsupported (primarily Windows
 * and some network filesystems). These are the ONLY errors swallowed by
 * {@link fsyncDirSync} / {@link fsyncDir}; all other errors propagate so
 * that genuine I/O failures (e.g. ENOSPC, EIO) are not silently hidden.
 */
const DIR_FSYNC_UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  'EINVAL',
  'ENOSYS',
  'EPERM',
  'ENOTSUP',
]);

// ─── Structural error / type guards ─────────────────────────────────────────

/**
 * Structural guard for Node.js filesystem errors that carry a `code`
 * property (ENOENT, EEXIST, EACCES, etc.). Avoids `as NodeJS.ErrnoException`
 * type assertions at every catch site. Only `code` is required; `message`
 * may be absent on values that pass the guard (the guard itself only checks
 * for the presence and type of `code`).
 */
export interface ErrnoError {
  readonly code: string;
  readonly message?: string;
}

/**
 * A value that has been structurally verified to carry a string `code`
 * property. This is the narrowed form used by internal guards so that
 * `error.code` is always `string` (never `undefined`) after narrowing.
 */
interface CodedError {
  readonly code: string;
}

export function hasErrnoCode(
  error: unknown,
  expectedCode: string,
): error is ErrnoError {
  return isObjectWithCode(error) && error.code === expectedCode;
}

function isObjectWithCode(error: unknown): error is CodedError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  );
}

// ─── Lock error types ───────────────────────────────────────────────────────

/**
 * Thrown when the exclusive lock artifact already exists and cannot be
 * acquired within the bounded deadline (async) or on the single sync
 * attempt. The error message includes the lock path and owner metadata
 * (when available) so the user can perform manual recovery.
 *
 * This is a BENIGN condition for the sync repair caller — it means a
 * concurrent operation is in progress and repair should be deferred to
 * the next startup.
 */
export class LockBusyError extends Error {
  readonly lockPath: string;
  readonly ownerMetadata: string | null;

  constructor(lockPath: string, ownerMetadata: string | null) {
    const ownerInfo =
      ownerMetadata !== null
        ? ` Owner metadata: ${ownerMetadata}`
        : ' No owner metadata available.';
    super(
      `Profiles lock is busy at ${lockPath}.${ownerInfo} ` +
        'Manual recovery: stop ALL possible LLxprt/profile owner processes ' +
        'first, then remove the lock file to recover. Do NOT remove the ' +
        'lock while any owner process is still running.',
    );
    this.name = 'LockBusyError';
    this.lockPath = lockPath;
    this.ownerMetadata = ownerMetadata;
  }
}

// ─── Lock types ─────────────────────────────────────────────────────────────

export interface LockHandle {
  readonly path: string;
  readonly ownerToken: string;
  release(): Promise<void>;
}

export interface SyncLockHandle {
  readonly path: string;
  readonly ownerToken: string;
  release(): void;
}

// ─── Owner metadata ─────────────────────────────────────────────────────────

export interface LockOwnerMetadata {
  readonly pid: number;
  readonly token: string;
  readonly created: string;
}

/**
 * Result of building owner metadata: the typed object (so the caller retains
 * the token without re-parsing JSON) and the serialized content written to
 * the lock artifact.
 */
interface BuiltOwnerMetadata {
  readonly metadata: LockOwnerMetadata;
  readonly serialized: string;
}

/**
 * Read owner metadata from a lock artifact file, if it exists and is
 * parseable. Returns null for absent or malformed files — used for
 * diagnostics in error messages only. NEVER used for stale-takeover
 * decisions.
 */
function readLockOwnerMetadataSync(lockPath: string): string | null {
  try {
    return fsSync.readFileSync(lockPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Read the owner token from a lock artifact file. Used by the release path
 * to verify that the artifact on disk still belongs to THIS process before
 * unlinking — preventing stale-takeover races. Returns null if the file is
 * absent or does not contain a recognizable token.
 */
function readLockTokenSync(lockPath: string): string | null {
  try {
    return extractTokenFromMetadata(fsSync.readFileSync(lockPath, 'utf-8'));
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
}

/**
 * Read the owner token from a lock artifact file (async). Used by the async
 * release path to verify ownership before unlinking.
 */
async function readLockToken(lockPath: string): Promise<string | null> {
  try {
    return extractTokenFromMetadata(await fs.readFile(lockPath, 'utf-8'));
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
}

/**
 * Extract the `token` field from serialized owner metadata without a type
 * assertion. Uses structural narrowing on the parsed value.
 */
function extractTokenFromMetadata(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return readTokenField(parsed);
}

/**
 * Structural type guard for the owner-token field. Narrows `unknown` to a
 * string token without a type assertion.
 */
function readTokenField(value: unknown): string | null {
  if (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof value.token === 'string'
  ) {
    return value.token;
  }
  return null;
}

// ─── Internal lock acquisition ──────────────────────────────────────────────

/**
 * Compute the lock file path for a profiles directory. Exported for tests
 * that need to verify the lock artifact on disk.
 *
 * @internal Tests inside settings can import this directly.
 */
export function lockPathForProfilesDir(profilesDir: string): string {
  return path.join(profilesDir, LOCK_FILE_NAME);
}

/**
 * Build the owner metadata typed object and its serialized JSON content for
 * a new lock artifact. Includes the process PID, a random token, and an ISO
 * timestamp for diagnostics. The typed object is returned alongside the
 * serialized form so callers retain the token without re-parsing (#2/#8).
 */
function buildOwnerMetadata(): BuiltOwnerMetadata {
  const metadata: LockOwnerMetadata = {
    pid: process.pid,
    token: crypto.randomUUID(),
    created: new Date().toISOString(),
  };
  return {
    metadata,
    serialized: JSON.stringify(metadata, null, 2),
  };
}

/**
 * Atomically create the lock artifact using `open wx` (O_CREAT | O_EXCL).
 * Returns the typed owner metadata (including the token). If the lock already
 * exists, throws an error with code EEXIST — the caller decides how to handle
 * it.
 *
 * If the `open wx` succeeds but the metadata write or fsync fails, the file
 * descriptor is closed and the artifact we just created is removed (we own it
 * — no other process can). This prevents a half-written lock from blocking
 * all future acquisitions (#2).
 *
 * The lock is a fixed-path file (not a directory). `O_EXCL` guarantees
 * atomic cross-process mutual exclusion: either exactly one process creates
 * the file, or all others get EEXIST. There is NO stale-takeover logic —
 * a lock left behind by a SIGKILL'd process requires explicit/manual
 * recovery (remove the file). Safety over availability.
 *
 * The file contains owner metadata (pid, token, timestamp) purely for
 * diagnostics — it is never read to decide stale reclamation.
 */
function createLockArtifactSync(lockPath: string): LockOwnerMetadata {
  const { metadata, serialized } = buildOwnerMetadata();
  const fd = fsSync.openSync(lockPath, 'wx', 0o600);
  try {
    fsSync.writeSync(fd, serialized, 0, 'utf-8');
    fsSync.fsyncSync(fd);
  } catch (error) {
    // The open wx succeeded so we created the artifact — we must clean it
    // up on failure so a half-written lock does not block all future
    // acquisitions (#2). Close first, then remove what we own.
    try {
      fsSync.closeSync(fd);
    } catch {
      // best-effort close
    }
    try {
      fsSync.unlinkSync(lockPath);
      fsyncDirSync(path.dirname(lockPath));
    } catch (cleanupError) {
      if (!hasErrnoCode(cleanupError, 'ENOENT')) {
        throw new AggregateError(
          [error, cleanupError],
          'Failed to initialize and clean up profiles lock',
        );
      }
    }
    throw error;
  }
  fsSync.closeSync(fd);
  return metadata;
}

/**
 * Remove the lock artifact, but ONLY if the file on disk still carries OUR
 * owner token. This is an ACCIDENTAL GUARD against double-release within the
 * same process — it does NOT make release safe against external replacement.
 *
 * Trust boundary (#lock decision): the token check prevents a process from
 * unlinking a lock it no longer owns in normal operation. However,
 * unlink/recreate of the lock file by an external actor while an owner
 * process is still live is UNSUPPORTED external interference — there is no
 * portable kernel primitive that prevents this. Manual recovery is supported
 * ONLY after stopping all possible LLxprt/profile owner processes.
 *
 * If the file is absent (already removed) or the token does not match, the
 * unlink is skipped silently.
 */
function removeOwnArtifactSync(lockPath: string, ownerToken: string): void {
  const onDiskToken = readLockTokenSync(lockPath);
  if (onDiskToken === null && !fsSync.existsSync(lockPath)) {
    return;
  }
  if (onDiskToken !== ownerToken) {
    throw new Error(`Profiles lock ownership changed at ${lockPath}`);
  }
  try {
    fsSync.unlinkSync(lockPath);
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) {
      throw error;
    }
    return;
  }
  fsyncDirSync(path.dirname(lockPath));
}

/**
 * Acquire the profiles-directory lock synchronously (single attempt). Uses
 * `open wx` (O_EXCL) for atomic cross-process mutual exclusion.
 *
 * If the lock already exists, throws {@link LockBusyError} — this is a
 * benign/deferred condition. The caller (sync repair) should treat this as
 * "try again next startup", NOT as an error.
 *
 * There is NO stale-takeover logic. A lock left by a SIGKILL'd process
 * requires explicit/manual recovery (remove the file). The error message
 * includes the exact path and owner metadata for recovery guidance.
 *
 * @internal Tests inside settings can import this directly.
 */
export function acquireProfilesLockSync(profilesDir: string): SyncLockHandle {
  fsSync.mkdirSync(profilesDir, { recursive: true, mode: 0o700 });
  const lockPath = lockPathForProfilesDir(profilesDir);
  try {
    const metadata = createLockArtifactSync(lockPath);
    return {
      path: lockPath,
      ownerToken: metadata.token,
      release() {
        removeOwnArtifactSync(lockPath, metadata.token);
      },
    };
  } catch (error) {
    if (hasErrnoCode(error, 'EEXIST')) {
      throw new LockBusyError(lockPath, readLockOwnerMetadataSync(lockPath));
    }
    throw error;
  }
}

/**
 * Acquire the profiles-directory lock asynchronously, waiting with a bounded
 * deadline if the lock is busy. Uses `open wx` (O_EXCL) for atomic
 * cross-process mutual exclusion.
 *
 * Polls every {@link ASYNC_POLL_MS} until `deadlineMs` elapses. If still busy
 * after the deadline, throws {@link LockBusyError}.
 *
 * If the `open wx` succeeds but the metadata write or fsync fails, the handle
 * is closed and the artifact we just created is removed (we own it — no other
 * process can). This prevents a half-written lock from blocking all future
 * acquisitions (#2).
 *
 * There is NO stale-takeover logic. A lock left by a SIGKILL'd process
 * requires explicit/manual recovery (remove the file). Safety over
 * availability.
 *
 * @param profilesDir The canonical profiles directory.
 * @param deadlineMs  Optional deadline override (ms). Production callers omit
 *                    this to use the 10s default; tests inject a shorter
 *                    value so the stale-lock path is deterministic (#1).
 * @internal Tests inside settings can import this directly.
 */
export async function acquireProfilesLock(
  profilesDir: string,
  deadlineMs?: number,
): Promise<LockHandle> {
  await fs.mkdir(profilesDir, { recursive: true, mode: 0o700 });
  const lockPath = lockPathForProfilesDir(profilesDir);
  const deadline = Date.now() + (deadlineMs ?? ASYNC_LOCK_DEADLINE_MS);
  let contentionPublished = false;

  for (;;) {
    const { metadata, serialized } = buildOwnerMetadata();
    try {
      await writeLockArtifact(lockPath, serialized);
      const token = metadata.token;
      return {
        path: lockPath,
        ownerToken: token,
        async release() {
          await removeOwnArtifact(lockPath, token);
        },
      };
    } catch (error) {
      if (!hasErrnoCode(error, 'EEXIST')) {
        throw error;
      }
      // Publish a contention event once per acquisition after the first
      // EEXIST, carrying a minimal lockPath payload. Tests subscribe to
      // this channel to observe lock contention without sleeps.
      if (!contentionPublished) {
        contentionPublished = true;
        channel(LOCK_CONTENTION_CHANNEL).publish({ lockPath });
      }
    }

    if (Date.now() >= deadline) {
      throw new LockBusyError(lockPath, readLockOwnerMetadataSync(lockPath));
    }
    await new Promise((resolve) => setTimeout(resolve, ASYNC_POLL_MS));
  }
}

/**
 * Write the lock artifact metadata to an `open wx` handle. If the write or
 * fsync fails after the file was created, the handle is closed and the
 * artifact is removed (we own it — no other process can, #2).
 */
async function writeLockArtifact(
  lockPath: string,
  serialized: string,
): Promise<void> {
  const handle = await fs.open(lockPath, 'wx', 0o600);
  try {
    await handle.writeFile(serialized, 'utf-8');
    await handle.sync();
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // best-effort close
    }
    try {
      await fs.unlink(lockPath);
      await fsyncDir(path.dirname(lockPath));
    } catch (cleanupError) {
      if (!hasErrnoCode(cleanupError, 'ENOENT')) {
        throw new AggregateError(
          [error, cleanupError],
          'Failed to initialize and clean up profiles lock',
        );
      }
    }
    throw error;
  }
  await handle.close();
}

/**
 * Async version of {@link removeOwnArtifactSync}: read the token from the lock
 * artifact and refuse unlink if it does not match our owner token (#3).
 */
async function removeOwnArtifact(
  lockPath: string,
  ownerToken: string,
): Promise<void> {
  const onDiskToken = await readLockToken(lockPath);
  if (onDiskToken === null) {
    try {
      await fs.lstat(lockPath);
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) {
        return;
      }
      throw error;
    }
    throw new Error(`Profiles lock ownership changed at ${lockPath}`);
  }
  if (onDiskToken !== ownerToken) {
    throw new Error(`Profiles lock ownership changed at ${lockPath}`);
  }
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) {
      throw error;
    }
    return;
  }
  await fsyncDir(path.dirname(lockPath));
}

// ─── Cohesive public sync lock API ──────────────────────────────────────────

/**
 * Cohesive sync-scoped lock API: acquire the shared profiles lock, run an
 * operation synchronously, and always release — even on error. This is the
 * ONLY sync lock entry point that external packages (CLI) should use.
 *
 * The release only removes the lock artifact owned by THIS process (created
 * via O_EXCL). If the operation throws, the lock is still released (normal
 * error path). SIGKILL during the operation will leave the lock artifact
 * requiring manual recovery.
 *
 * @param profilesDir The canonical profiles directory.
 * @param operation   A synchronous function executed under the lock.
 * @returns           Whatever the operation returns.
 * @throws            {@link LockBusyError} if the lock is busy; re-throws
 *                    any error from the operation.
 */
export function withProfilesLockSync<T>(
  profilesDir: string,
  operation: () => T,
): T {
  const lock = acquireProfilesLockSync(profilesDir);
  let outcome: { kind: 'result'; value: T } | { kind: 'error'; error: unknown };
  try {
    outcome = { kind: 'result', value: operation() };
  } catch (error) {
    outcome = { kind: 'error', error };
  }

  try {
    lock.release();
  } catch (releaseError) {
    if (outcome.kind === 'error') {
      throw new AggregateError(
        [toError(outcome.error), toError(releaseError)],
        'profiles operation and lock release both failed',
      );
    }
    throw releaseError;
  }

  if (outcome.kind === 'error') {
    throw outcome.error;
  }
  return outcome.value;
}

/**
 * Normalize a caught `unknown` value into an `Error` for inclusion in an
 * `AggregateError`. If the value is already an Error, it is returned as-is.
 * Otherwise, a best-effort description is produced without throwing, even
 * if the value's toString is hostile.
 */
function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  let description: string;
  try {
    if (typeof value === 'string') {
      description = value;
    } else {
      description = String(value);
    }
  } catch {
    description = '(unrepresentable value)';
  }
  return new Error(description);
}

export async function withProfilesLock<T>(
  profilesDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireProfilesLock(profilesDir);
  let outcome: { kind: 'result'; value: T } | { kind: 'error'; error: unknown };
  try {
    outcome = { kind: 'result', value: await operation() };
  } catch (error) {
    outcome = { kind: 'error', error };
  }

  try {
    await lock.release();
  } catch (releaseError) {
    if (outcome.kind === 'error') {
      throw new AggregateError(
        [toError(outcome.error), toError(releaseError)],
        'profiles operation and lock release both failed',
      );
    }
    throw releaseError;
  }

  if (outcome.kind === 'error') {
    throw outcome.error;
  }
  return outcome.value;
}

// ─── Directory fsync helper ─────────────────────────────────────────────────

/**
 * Fsync of a directory path (sync). On Linux and macOS, `fsyncSync` on a
 * directory fd flushes directory entry changes so renames, creates, and
 * unlinks are durable. On Windows and some network filesystems, directory
 * fsync is unsupported and throws — those known-unsupported errno codes are
 * silently ignored (#5).
 *
 * All other errors (ENOSPC, EIO, EACCES, etc.) PROPAGATE to the caller so
 * genuine I/O failures are not silently hidden. Durability is NOT best-effort
 * for real errors — callers must know when the filesystem is unhealthy.
 *
 * @internal Tests inside settings can import this directly.
 */
export function fsyncDirSync(dirPath: string): void {
  let fd: number | undefined;
  try {
    fd = fsSync.openSync(dirPath, 'r');
    fsSync.fsyncSync(fd);
  } catch (error) {
    if (!isDirFsyncUnsupported(error)) {
      throw error;
    }
    // Directory fsync is unsupported on this platform (e.g. Windows).
    // Silently ignore — the file-level fsync still applies.
  } finally {
    if (fd !== undefined) {
      try {
        fsSync.closeSync(fd);
      } catch {
        // best-effort close
      }
    }
  }
}

/**
 * Async version of {@link fsyncDirSync}.
 *
 * @internal Tests inside settings can import this directly.
 */
export async function fsyncDir(dirPath: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dirPath, 'r');
    await handle.sync();
  } catch (error) {
    if (!isDirFsyncUnsupported(error)) {
      throw error;
    }
    // Directory fsync is unsupported on this platform (e.g. Windows).
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // best-effort close
      }
    }
  }
}

/**
 * Determine whether a directory-fsync error is a known unsupported-platform
 * code that should be silently ignored (#5).
 */
function isDirFsyncUnsupported(error: unknown): boolean {
  return isObjectWithCode(error) && DIR_FSYNC_UNSUPPORTED_CODES.has(error.code);
}

// ─── File read helper ───────────────────────────────────────────────────────

export type ReadResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'content'; readonly content: string }
  | { readonly kind: 'error'; readonly error: Error };

/**
 * Read a file synchronously and return a discriminated result. ENOENT maps
 * to 'absent'; all other errors map to 'error' with the original Error.
 *
 * @internal Tests inside settings can import this directly.
 */
export function readProfileFileSync(filePath: string): ReadResult {
  let content: string;
  try {
    content = fsSync.readFileSync(filePath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return { kind: 'absent' };
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      kind: 'error',
    };
  }
  return { content, kind: 'content' };
}

// ─── Unique temp path ───────────────────────────────────────────────────────

/**
 * Generate a unique temporary path in the same directory as the target file.
 * The path includes the process PID and a random UUID so two concurrent
 * writers can never collide.
 *
 * @internal Tests inside settings can import this directly.
 */
export function uniqueTempPath(
  dir: string,
  baseFileName: string,
  suffix: string,
): string {
  const random = crypto.randomUUID();
  return path.join(dir, `${baseFileName}.${process.pid}.${random}${suffix}`);
}

// ─── Atomic writes (internal helpers) ───────────────────────────────────────

/**
 * Atomically write a file via temp + fsync + rename + directory fsync. The
 * temp file is ALWAYS opened with `wx` (exclusive create) regardless of
 * `mode`, so two concurrent writers can never collide on the same temp path.
 *
 * The temp file is fsync'd before rename, and the parent directory is
 * fsync'd after rename, so both the content and the directory entry update
 * are durable on platforms that support directory fsync.
 *
 * Error preservation (#2): if the primary write/rename fails, the primary
 * error is preserved. If cleanup (temp unlink) or directory fsync also
 * fails, those errors are collected and thrown alongside the primary error
 * as an AggregateError so genuine I/O failures are never silently masked.
 *
 * @internal Tests inside settings can import this directly.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
  mode?: number,
): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = uniqueTempPath(dir, base, '.tmp');
  const errors: Error[] = [];
  let primaryError: Error | null = null;
  try {
    const handle = await fs.open(tmpPath, 'wx', mode);
    try {
      await handle.writeFile(data, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, filePath);
    await fsyncDir(dir);
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
    errors.push(primaryError);
  } finally {
    let tempRemoved = false;
    try {
      await fs.unlink(tmpPath);
      tempRemoved = true;
    } catch (error) {
      // ENOENT means the temp was consumed by rename — not an error.
      if (!hasErrnoCode(error, 'ENOENT')) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (tempRemoved) {
      // Fsync parent directory after temp unlink so the directory entry
      // removal is durable on platforms that support directory fsync (#7).
      try {
        await fsyncDir(dir);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  if (errors.length > 1 && primaryError !== null) {
    // Primary error occurred AND cleanup/fsync also failed — aggregate so
    // the caller sees both (#2).
    const aggregate = new AggregateError(
      errors,
      `atomicWriteFile failed: primary error plus ${errors.length - 1} cleanup/fsync error(s)`,
    );
    throw aggregate;
  }
  if (primaryError !== null) {
    throw primaryError;
  }
}

// ─── Public profile write / delete API ──────────────────────────────────────

/**
 * Profile write mode: create-only (fail if exists) or overwrite.
 */
export type ProfileWriteMode = 'create' | 'overwrite';

/**
 * Result of a profile write operation.
 */
export type ProfileWriteResult =
  | { readonly kind: 'written'; readonly path: string }
  | { readonly kind: 'exists'; readonly path: string };

function profileFilePath(profilesDir: string, profileName: string): string {
  const trimmedName = profileName.trim();
  const forbiddenNames = new Set(['', '.', '..']);
  const hasForbiddenSeparator = /[\\/\0]/u.test(profileName);
  if (
    forbiddenNames.has(trimmedName) ||
    trimmedName !== profileName ||
    hasForbiddenSeparator ||
    path.isAbsolute(profileName)
  ) {
    throw new Error(`Invalid profile name: ${JSON.stringify(profileName)}`);
  }

  const resolvedDir = path.resolve(profilesDir);
  const resolvedFile = path.resolve(resolvedDir, `${profileName}.json`);
  if (path.dirname(resolvedFile) !== resolvedDir) {
    throw new Error(`Invalid profile name: ${JSON.stringify(profileName)}`);
  }
  return resolvedFile;
}

/**
 * Cohesive public API for writing a canonical profile JSON file under the
 * shared profiles lock. Preserves create-only vs overwrite behavior and
 * applies 0600 mode (owner read/write only) for new files. Existing file
 * mode is preserved on overwrite.
 *
 * Both modes use atomic publication (exclusive temp + fsync + rename for
 * overwrite; exclusive temp + fsync + hard-link for create). The parent
 * directory is fsync'd after publication on platforms that support it.
 *
 * @param profilesDir  The canonical profiles directory.
 * @param profileName  Profile name (without .json extension).
 * @param data         Serialized JSON content.
 * @param mode         'create' fails if the file exists; 'overwrite' replaces it.
 * @returns 'written' on success, 'exists' if create-mode collided.
 */
export async function writeProfileFile(
  profilesDir: string,
  profileName: string,
  data: string,
  mode: ProfileWriteMode = 'overwrite',
): Promise<ProfileWriteResult> {
  const filePath = profileFilePath(profilesDir, profileName);
  return withProfilesLock(profilesDir, async () => {
    if (mode === 'create') {
      return createProfileExclusive(filePath, data);
    }

    // overwrite: preserve existing mode, default 0600 for new files
    let fileMode: number | undefined;
    try {
      const stat = await fs.stat(filePath);
      fileMode = stat.mode & 0o777;
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) {
        throw error;
      }
      fileMode = 0o600;
    }
    await atomicWriteFile(filePath, data, fileMode);
    return { kind: 'written', path: filePath };
  });
}

/**
 * Create a profile file exclusively using crash-safe atomic publication.
 *
 * Writes to an exclusive same-directory temp (wx), fsync/close, then publishes
 * via hard-link (`link`, fails EEXIST atomically) then unlink temp + fsync
 * dir. If the final file already exists, EEXIST is caught and 'exists' is
 * returned. Primary errors are preserved; cleanup/fsync errors are aggregated
 * so they are not masked (#2).
 */
async function createProfileExclusive(
  filePath: string,
  data: string,
): Promise<ProfileWriteResult> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = uniqueTempPath(dir, base, '.create.tmp');

  const errors: Error[] = [];
  let primaryError: Error | null = null;
  let result: ProfileWriteResult | null = null;

  try {
    const handle = await fs.open(tmpPath, 'wx', 0o600);
    try {
      await handle.writeFile(data, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await fs.link(tmpPath, filePath);
      await fsyncDir(dir);
      result = { kind: 'written', path: filePath };
    } catch (error) {
      if (hasErrnoCode(error, 'EEXIST')) {
        result = { kind: 'exists', path: filePath };
      } else {
        throw error;
      }
    }
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
    errors.push(primaryError);
  } finally {
    let tempRemoved = false;
    try {
      await fs.unlink(tmpPath);
      tempRemoved = true;
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (tempRemoved) {
      // Fsync parent directory after temp unlink for durability (#7).
      try {
        await fsyncDir(dir);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  if (primaryError !== null && errors.length > 1) {
    throw new AggregateError(
      errors,
      `createProfileExclusive failed: primary error plus ${errors.length - 1} cleanup/fsync error(s)`,
    );
  }
  if (primaryError !== null) {
    throw primaryError;
  }
  // result is non-null here because no primary error was thrown
  return result ?? { kind: 'written', path: filePath };
}

/**
 * Cohesive public API for deleting a canonical profile JSON file under the
 * shared profiles lock. Throws ENOENT-based error if the file does not exist
 * (callers translate to user-facing messages).
 *
 * @internal ProfileManager imports this directly; not re-exported from root.
 */
export async function deleteProfileFile(
  profilesDir: string,
  profileName: string,
): Promise<void> {
  const filePath = profileFilePath(profilesDir, profileName);
  await withProfilesLock(profilesDir, async () => {
    await fs.unlink(filePath);
    await fsyncDir(profilesDir);
  });
}
