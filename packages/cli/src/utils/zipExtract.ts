/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openPromise, type Entry, type ZipFile } from 'yauzl';

export interface ZipExtractResult {
  /** Absolute paths of every file published inside the destination. */
  files: string[];
}

/**
 * Resource ceilings applied to an untrusted ZIP archive so an attacker cannot
 * force unbounded disk use through declared sizes, wasted entries, or decompressed
 * output. The defaults accommodate large extension and release archives while
 * still bounding total materialized bytes.
 */
export interface ZipExtractLimits {
  /** Maximum number of directory entries (files and directories) accepted. */
  readonly maxEntries: number;
  /** Maximum UTF-8 byte length of a single entry name. */
  readonly maxFileNameLength: number;
  /** Maximum uncompressed bytes a single entry may declare or stream. */
  readonly maxEntryUncompressedBytes: number;
  /** Maximum cumulative uncompressed bytes the archive may declare or stream. */
  readonly maxTotalUncompressedBytes: number;
}

export const ZIP_ARCHIVE_LIMITS: ZipExtractLimits = {
  maxEntries: 20_000,
  maxFileNameLength: 2_048,
  maxEntryUncompressedBytes: 2 * 1024 * 1024 * 1024,
  maxTotalUncompressedBytes: 10 * 1024 * 1024 * 1024,
};

export interface ZipExtractOptions {
  /** Overrides any subset of {@link ZIP_ARCHIVE_LIMITS}. */
  readonly limits?: Partial<ZipExtractLimits>;
  /**
   * @internal Removes an owned path during rollback and staging cleanup.
   * Production callers leave this unset; tests inject a failing removal to
   * exercise the error-aggregation path.
   */
  readonly remove?: (target: string) => Promise<void>;
  /**
   * @internal Runs immediately before a staged top-level path is published.
   * Tests use this hook to create a real concurrent filesystem collision.
   */
  readonly beforePublish?: (name: string, target: string) => Promise<void>;
}

const UNIX_TYPE_MASK = 0o170000;
const SYMLINK_TYPE = 0o120000;
const PERMISSION_BITS = 0o777;
const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIR_MODE = 0o755;

interface ErrnoError {
  readonly code: string;
}

function isErrnoError(error: unknown): error is ErrnoError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  );
}

const isSymlinkEntry = (entry: Entry): boolean => {
  const type = (entry.externalFileAttributes >>> 16) & UNIX_TYPE_MASK;
  return type === SYMLINK_TYPE;
};

/**
 * True when `target` resolves to a strict descendant of `root`. A leaf whose
 * relative path is exactly `..` or begins with `../` escapes the root; a name
 * that merely *starts* with two dots (for example `..valid/file.txt`) stays
 * contained.
 */
const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const normalizeEntryName = (name: string): string => {
  if (name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) {
    throw new Error(`absolute path entries are not supported: ${name}`);
  }
  if (name.includes('\\')) {
    throw new Error(`backslash path entries are not supported: ${name}`);
  }

  const segments = name.split('/');
  if (segments.includes('..')) {
    throw new Error(`path traversal is not supported: ${name}`);
  }

  const normalized = segments
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/');
  return name.endsWith('/') && normalized !== ''
    ? `${normalized}/`
    : normalized;
};

const topLevelOf = (name: string): string | null => {
  const segments = name.split('/').filter((segment) => segment !== '');
  return segments[0] ?? null;
};

/**
 * Case-insensitive identity of a complete normalized archive path. The trailing slash
 * of a directory entry is dropped so a file and a directory at the same path share
 * one identity and are rejected as ambiguous.
 */
const collisionKey = (name: string): string => {
  const noTrailingSlash = name.endsWith('/') ? name.slice(0, -1) : name;
  return noTrailingSlash.toLowerCase();
};

/** Permission bits only: owner/group/other rwx, never setuid/setgid/sticky. */
const safeFileMode = (entry: Entry): number => {
  const bits = (entry.externalFileAttributes >>> 16) & PERMISSION_BITS;
  return bits === 0 ? DEFAULT_FILE_MODE : bits;
};

const safeDirMode = (entry: Entry): number => {
  const bits = (entry.externalFileAttributes >>> 16) & PERMISSION_BITS;
  return bits === 0 ? DEFAULT_DIR_MODE : bits;
};

interface StagedArchive {
  /** Unique top-level output names, in first-seen order. */
  readonly topLevels: readonly string[];
  /** Relative paths of every file entry staged. */
  readonly filePaths: readonly string[];
  /**
   * Final permission bits requested by each explicit directory entry, keyed by its
   * complete archive-relative path. Applied to the published output only after every
   * entry has been staged.
   */
  readonly dirModes: ReadonlyMap<string, number>;
}

/**
 * Handles one file entry: validates its declared sizes before any output is
 * opened, then streams it through a byte counter that enforces the same ceilings
 * against the bytes actually decompressed.
 */
async function extractFileEntry(
  zipFile: ZipFile,
  entry: Entry,
  rawName: string,
  entryName: string,
  stagingDir: string,
  limits: ZipExtractLimits,
  declaredTotal: number,
  totalStreamed: number,
  filePaths: string[],
): Promise<{ declaredTotal: number; totalStreamed: number }> {
  declaredTotal += entry.uncompressedSize;
  if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
    throw new Error(
      `entry "${rawName}" declares ${entry.uncompressedSize} bytes exceeding the ` +
        `${limits.maxEntryUncompressedBytes} byte per-entry limit`,
    );
  }
  if (declaredTotal > limits.maxTotalUncompressedBytes) {
    throw new Error(
      `archive declares ${declaredTotal} cumulative bytes exceeding the ` +
        `${limits.maxTotalUncompressedBytes} byte total limit`,
    );
  }

  const target = path.join(stagingDir, entryName);
  await fs.mkdir(path.dirname(target), { recursive: true });

  const readStream = await zipFile.openReadStreamPromise(entry);
  let streamed = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      const size = chunk.length;
      streamed += size;
      if (streamed > limits.maxEntryUncompressedBytes) {
        callback(
          new Error(
            `entry "${rawName}" streamed ${streamed} bytes exceeding the ` +
              `${limits.maxEntryUncompressedBytes} byte per-entry limit`,
          ),
        );
        return;
      }
      totalStreamed += size;
      if (totalStreamed > limits.maxTotalUncompressedBytes) {
        callback(
          new Error(
            `archive streamed ${totalStreamed} bytes exceeding the ` +
              `${limits.maxTotalUncompressedBytes} byte total limit`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(readStream, limiter, createWriteStream(target));
  if (streamed !== entry.uncompressedSize) {
    throw new Error(
      `entry "${rawName}" streamed ${streamed} bytes but declared ` +
        `${entry.uncompressedSize} bytes`,
    );
  }
  await fs.chmod(target, safeFileMode(entry));
  filePaths.push(entryName);
  return { declaredTotal, totalStreamed };
}

/**
 * Lazy-pass extraction into `stagingDir`, enforcing the archive resource
 * limits. Declared sizes are validated before an entry's output is opened, and a
 * streaming byte counter enforces the same ceilings against the bytes actually
 * decompressed, so forged metadata cannot bypass the limits.
 *
 * Directories are created owner-writable so later entries can still be staged beneath
 * them; their archived final modes are only recorded here and applied to the published
 * output after every entry has been staged. Every complete normalized archive path is
 * validated case-insensitively before any content is written, so exact duplicates,
 * case-folded collisions, and file/directory conflicts cannot silently overwrite one
 * another, even on case-insensitive hosts.
 */
async function extractIntoStaging(
  zipFile: ZipFile,
  stagingDir: string,
  limits: ZipExtractLimits,
): Promise<StagedArchive> {
  const topLevels: string[] = [];
  const seenTopLevels = new Set<string>();
  const filePaths: string[] = [];
  const dirModes = new Map<string, number>();
  const seenPaths = new Set<string>();
  let entryCount = 0;
  let declaredTotal = 0;
  let totalStreamed = 0;

  for await (const entry of zipFile.eachEntry()) {
    entryCount += 1;
    const rawName = entry.fileName;
    if (entryCount > limits.maxEntries) {
      throw new Error(
        `archive contains more than ${limits.maxEntries} entries`,
      );
    }
    if (isSymlinkEntry(entry)) {
      throw new Error(`symlink entries are not supported: ${rawName}`);
    }
    const entryName = normalizeEntryName(rawName);
    if (Buffer.byteLength(entryName, 'utf8') > limits.maxFileNameLength) {
      throw new Error(
        `entry name exceeds the ${limits.maxFileNameLength} byte limit: ` +
          rawName.slice(0, 40),
      );
    }
    if (!isInside(stagingDir, path.join(stagingDir, entryName))) {
      throw new Error(`entry resolves outside destination: ${rawName}`);
    }
    const topLevel = topLevelOf(entryName);
    if (topLevel === null) {
      throw new Error(`entry has no top-level path: ${rawName}`);
    }
    if (seenPaths.has(collisionKey(entryName))) {
      throw new Error(`duplicate archive path: ${rawName}`);
    }
    seenPaths.add(collisionKey(entryName));
    if (!seenTopLevels.has(topLevel)) {
      seenTopLevels.add(topLevel);
      topLevels.push(topLevel);
    }

    if (entryName.endsWith('/')) {
      const dirTarget = path.join(stagingDir, entryName);
      await fs.mkdir(dirTarget, { recursive: true });
      dirModes.set(entryName, safeDirMode(entry));
      continue;
    }

    const tallies = await extractFileEntry(
      zipFile,
      entry,
      rawName,
      entryName,
      stagingDir,
      limits,
      declaredTotal,
      totalStreamed,
      filePaths,
    );
    declaredTotal = tallies.declaredTotal;
    totalStreamed = tallies.totalStreamed;
  }

  return { topLevels, filePaths, dirModes };
}

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

const elidedOrError = (
  errors: readonly unknown[],
  message: string,
): Error | undefined => {
  if (errors.length === 0) return undefined;
  if (errors.length === 1) return toError(errors[0]);
  return new AggregateError(errors, message);
};

/** Copies a staged tree without replacing any destination entry. */
async function copyTreeExclusive(
  source: string,
  target: string,
): Promise<void> {
  const sourceStat = await fs.stat(source);
  if (sourceStat.isDirectory()) {
    await fs.mkdir(target, { mode: 0o700 });
    for (const child of await fs.readdir(source)) {
      await copyTreeExclusive(
        path.join(source, child),
        path.join(target, child),
      );
    }
    await fs.chmod(target, sourceStat.mode & PERMISSION_BITS);
    return;
  }
  if (!sourceStat.isFile()) {
    throw new Error(`unsupported staged entry type: ${source}`);
  }
  await fs.copyFile(source, target, constants.COPYFILE_EXCL);
  await fs.chmod(target, sourceStat.mode & PERMISSION_BITS);
}

async function publishRootExclusive(
  source: string,
  target: string,
  name: string,
  published: string[],
): Promise<void> {
  const sourceStat = await fs.stat(source);
  if (sourceStat.isDirectory()) {
    await fs.mkdir(target, { mode: 0o700 });
    published.push(name);
    for (const child of await fs.readdir(source)) {
      await copyTreeExclusive(
        path.join(source, child),
        path.join(target, child),
      );
    }
    await fs.chmod(target, sourceStat.mode & PERMISSION_BITS);
    return;
  }
  if (!sourceStat.isFile()) {
    throw new Error(`unsupported staged entry type: ${source}`);
  }
  await fs.copyFile(source, target, constants.COPYFILE_EXCL);
  published.push(name);
  await fs.chmod(target, sourceStat.mode & PERMISSION_BITS);
}

/**
 * Applies each explicit directory's recorded archived mode to its published output.
 * Children are applied before their parents so a restrictive parent never stands between a
 * child and its own final mode. The modes were recorded while entries staged, so the
 * staging directories themselves stay owner-writable for the whole archive pass.
 */
async function applyDirectoryModes(
  destDir: string,
  dirModes: ReadonlyMap<string, number>,
): Promise<void> {
  const dirs = [...dirModes.entries()].sort(
    (left, right) =>
      right[0].split('/').filter((segment) => segment !== '').length -
      left[0].split('/').filter((segment) => segment !== '').length,
  );
  for (const [relativePath, mode] of dirs) {
    await fs.chmod(path.join(destDir, relativePath), mode);
  }
}

/**
 * Publishes each staged top-level output with filesystem-enforced exclusive
 * creation. Only roots created by this invocation are recorded for rollback. After
 * every root is published, the archived final directory modes are applied deepest-first
 * to the published output.
 */
async function publishStaged(
  staged: StagedArchive,
  stagingDir: string,
  destDir: string,
  published: string[],
  beforePublish?: (name: string, target: string) => Promise<void>,
): Promise<string[]> {
  const occupied = new Set(
    (await fs.readdir(destDir)).map((name) => name.toLowerCase()),
  );
  for (const name of staged.topLevels) {
    const key = name.toLowerCase();
    if (occupied.has(key)) {
      throw new Error(`destination already contains: ${name}`);
    }
    occupied.add(key);

    const source = path.join(stagingDir, name);
    const target = path.join(destDir, name);
    try {
      await beforePublish?.(name, target);
      await publishRootExclusive(source, target, name, published);
    } catch (error) {
      if (isErrnoError(error) && error.code === 'EEXIST') {
        throw new Error(`destination already contains: ${name}`, {
          cause: error,
        });
      }
      throw error;
    }
  }

  await applyDirectoryModes(destDir, staged.dirModes);

  return staged.filePaths.map((relativePath) =>
    path.join(destDir, relativePath),
  );
}

/**
 * Removes every owned published root. A removal that fails with ENOENT is an
 * idempotent double-removal race and is skipped; every other failure is returned
 * so it surfaces alongside the original publish error.
 */
async function rollBackPublished(
  destDir: string,
  published: readonly string[],
  remove: (target: string) => Promise<void>,
): Promise<Error | undefined> {
  const rollbackErrors: unknown[] = [];
  for (const name of published) {
    try {
      await remove(path.join(destDir, name));
    } catch (error) {
      if (!(isErrnoError(error) && error.code === 'ENOENT')) {
        rollbackErrors.push(error);
      }
    }
  }
  return elidedOrError(rollbackErrors, 'Published output rollback failed');
}

/**
 * Removes the staging directory (also inside the destination) and, when this
 * invocation created `destDir` and it is empty, `destDir`. Failures are
 * returned so they surface alongside the original error instead of being swallowed.
 */
async function cleanupAfterFailure(
  stagingDir: string | undefined,
  createdDest: boolean,
  destDir: string,
  remove: (target: string) => Promise<void>,
): Promise<Error | undefined> {
  const cleanupErrors: unknown[] = [];
  if (stagingDir !== undefined) {
    try {
      await remove(stagingDir);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (createdDest) {
    try {
      const remaining = await fs.readdir(destDir);
      if (remaining.length === 0) {
        await fs.rmdir(destDir);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  return elidedOrError(cleanupErrors, 'ZIP extraction cleanup failed');
}

/**
 * Safely extracts a zip archive to `destDir`. `destDir` is resolved to an
 * absolute path on entry, so `ZipExtractResult.files` is always absolute. Every
 * entry is first extracted into a private staging directory created *inside*
 * `destDir`, then the staged top-level outputs are published only after the archive has
 * passed validation. This both preserves unrelated preexisting destination content and
 * prevents a preexisting symlink directory inside the destination from redirecting
 * writes.
 *
 * Publication is filesystem-enforced and exclusive: a staged top-level output that
 * already exists in the destination (exactly or case-insensitively) aborts the
 * publish step and preserves the existing entry. If a later publish fails, every
 * top-level output already published is removed so no partial archive output is left
 * behind. On any failure the staging directory is removed and, when this invocation
 * created `destDir` and it is empty, `destDir` is removed. Rollback and
 * cleanup failures are surfaced via `AggregateError` alongside the original error
 * rather than swallowed. The ZIP handle is closed on every path.
 */
export async function extractZipSafe(
  zipPath: string,
  destDir: string,
  options: ZipExtractOptions = {},
): Promise<ZipExtractResult> {
  const resolvedDestDir = path.resolve(destDir);
  const limits: ZipExtractLimits = { ...ZIP_ARCHIVE_LIMITS, ...options.limits };
  const remove =
    options.remove ??
    ((target: string) => fs.rm(target, { recursive: true, force: true }));

  let createdDest = false;
  let stagingDir: string | undefined;
  const published: string[] = [];
  const zipFile = await openPromise(zipPath, {
    lazyEntries: true,
    strictFileNames: true,
    autoClose: true,
    validateEntrySizes: false,
  });
  try {
    try {
      await fs.mkdir(resolvedDestDir);
      createdDest = true;
    } catch (error) {
      if (!isErrnoError(error) || error.code !== 'EEXIST') {
        throw error;
      }
    }

    stagingDir = await fs.mkdtemp(
      path.join(resolvedDestDir, '.llxprt-zip-stage-'),
    );
    const staged = await extractIntoStaging(zipFile, stagingDir, limits);
    zipFile.close();

    const files = await publishStaged(
      staged,
      stagingDir,
      resolvedDestDir,
      published,
      options.beforePublish,
    );
    await fs.rm(stagingDir, { recursive: true, force: true });
    stagingDir = undefined;
    return { files };
  } catch (error) {
    const errors: unknown[] = [error];
    if (stagingDir !== undefined && published.length > 0) {
      const rollbackFailure = await rollBackPublished(
        resolvedDestDir,
        published,
        remove,
      );
      if (rollbackFailure !== undefined) errors.push(rollbackFailure);
    }
    const cleanupFailure = await cleanupAfterFailure(
      stagingDir,
      createdDest,
      resolvedDestDir,
      remove,
    );
    if (cleanupFailure !== undefined) errors.push(cleanupFailure);

    zipFile.close();
    if (errors.length === 1) {
      throw errors[0];
    }
    throw new AggregateError(
      errors,
      'ZIP extraction failed and cleanup also failed',
    );
  }
}
