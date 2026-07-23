/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backup directory snapshotting for the prompt installer.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { copyDirectory, countFiles } from './directory-utils.js';

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

export interface BackupSnapshotResult {
  readonly success: boolean;
  readonly backupPath: string;
  readonly fileCount: number;
  readonly totalSize: number;
}

export class BackupVerificationError extends Error {
  readonly expected: number;
  readonly actual: number;
  readonly backupDir: string;

  constructor(expected: number, actual: number, backupDir: string) {
    super(
      `Backup verification failed: expected ${expected} files in staging, found ${actual}. The backup at ${backupDir} could not be created because staging was incomplete.`,
    );
    this.name = 'BackupVerificationError';
    this.expected = expected;
    this.actual = actual;
    this.backupDir = backupDir;
  }
}

/**
 * Thrown when a backup was successfully published but the publish-claim
 * could not be released. {@link backupPath} points at the populated final
 * directory; the leftover claim is recovered by the UUID candidate strategy
 * on future runs.
 */
export class BackupClaimCleanupError extends Error {
  readonly backupPath: string;
  readonly claimPath: string;
  readonly cleanupError: Error;

  constructor(backupPath: string, claimPath: string, cleanupError: Error) {
    super(
      `Backup was published at ${backupPath} but claim cleanup failed for ${claimPath}: ${cleanupError.message}`,
    );
    this.name = 'BackupClaimCleanupError';
    this.backupPath = backupPath;
    this.claimPath = claimPath;
    this.cleanupError = cleanupError;
  }
}

export type ClaimReleaseFn = (claimPath: string) => Promise<Error | undefined>;

export interface SnapshotDirectoryOptions {
  readonly releaseClaim?: ClaimReleaseFn;
}

/**
 * Copies the source directory into a unique staging directory, verifies the
 * file count, then atomically publishes to `backupDir`. If `backupDir` already
 * exists (file or directory), a unique suffixed candidate is chosen so the
 * existing destination is NEVER overwritten.
 *
 * Publication uses an O_EXCL publish-claim to serialize concurrent publishers
 * of the same candidate. A UUID-suffixed candidate makes each publisher's
 * claim unique, so contention only occurs on the requested path.
 *
 * Cleanup errors are observable and composed with primary errors via
 * AggregateError. On the published path, a claim-release failure produces
 * {@link BackupClaimCleanupError} so the caller observes both the successful
 * publish and the cleanup failure.
 */
export async function snapshotDirectory(
  expandedBaseDir: string,
  backupDir: string,
  options?: SnapshotDirectoryOptions,
): Promise<BackupSnapshotResult> {
  const backupParent = path.dirname(backupDir);
  const stagingDir = path.join(
    backupParent,
    `.${path.basename(backupDir)}.staging-${randomUUID()}`,
  );

  await fs.mkdir(backupParent, { recursive: true });
  await fs.mkdir(stagingDir, { mode: 0o755 });

  try {
    let fileCount = 0;
    let totalSize = 0;

    await copyDirectory(expandedBaseDir, stagingDir, async (filePath) => {
      fileCount++;
      const stats = await fs.stat(filePath);
      totalSize += stats.size;
    });

    const manifest = {
      backupDate: new Date().toISOString(),
      sourcePath: expandedBaseDir,
      fileCount,
      totalSize,
    };

    await fs.writeFile(
      path.join(stagingDir, 'backup-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );

    const expectedCount = fileCount + 1;
    const verifyCount = await countFiles(stagingDir);
    if (verifyCount !== expectedCount) {
      throw new BackupVerificationError(expectedCount, verifyCount, backupDir);
    }

    const finalPath = await publishStagingExclusive(
      stagingDir,
      backupDir,
      options,
    );

    return { success: true, backupPath: finalPath, fileCount, totalSize };
  } catch (error) {
    try {
      await fs.rm(stagingDir, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Backup failed and staging cleanup failed for ${stagingDir}`,
      );
    }
    throw error;
  }
}

async function publishStagingExclusive(
  stagingDir: string,
  requestedBackupDir: string,
  options?: SnapshotDirectoryOptions,
): Promise<string> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate =
      attempt === 0
        ? requestedBackupDir
        : `${requestedBackupDir}-${attempt}-${randomUUID().slice(0, 8)}`;
    const outcome = await tryPublishCandidate(stagingDir, candidate, options);
    if (outcome.kind === 'published') {
      return outcome.path;
    }
  }
  throw new Error(
    `Backup publish could not find a free destination near ${requestedBackupDir}`,
  );
}

type PublishCandidateOutcome =
  | { readonly kind: 'published'; readonly path: string }
  | { readonly kind: 'busy' };

async function tryPublishCandidate(
  stagingDir: string,
  candidate: string,
  options?: SnapshotDirectoryOptions,
): Promise<PublishCandidateOutcome> {
  const claimPath = sidecarClaimPath(candidate);

  let claimAcquired: boolean;
  try {
    claimAcquired = await tryAcquireClaim(claimPath);
  } catch (error) {
    if (isCollisionError(error)) {
      return { kind: 'busy' };
    }
    throw error;
  }
  if (!claimAcquired) {
    return { kind: 'busy' };
  }

  const releaseClaim: ClaimReleaseFn =
    options?.releaseClaim ?? defaultReleaseClaim;

  let publishOutcome: PublishCandidateOutcome;
  try {
    const exists = await pathExists(candidate);
    if (exists) {
      publishOutcome = { kind: 'busy' };
    } else {
      await fs.rename(stagingDir, candidate);
      publishOutcome = { kind: 'published', path: candidate };
    }
  } catch (error) {
    // Treat rename collision (EEXIST/ENOTEMPTY) as busy so the retry loop
    // advances to the next suffixed candidate instead of aborting.
    if (isCollisionError(error)) {
      publishOutcome = { kind: 'busy' };
    } else {
      const releaseError = await releaseClaim(claimPath);
      if (releaseError !== undefined) {
        throw new AggregateError(
          [error, releaseError],
          `Backup publish failed and claim release failed for ${claimPath}`,
        );
      }
      throw error;
    }
  }

  const releaseError = await releaseClaim(claimPath);
  if (releaseError !== undefined && publishOutcome.kind === 'busy') {
    throw releaseError;
  }
  if (releaseError !== undefined && publishOutcome.kind === 'published') {
    throw new BackupClaimCleanupError(
      publishOutcome.path,
      claimPath,
      releaseError,
    );
  }
  return publishOutcome;
}

function sidecarClaimPath(candidate: string): string {
  return path.join(
    path.dirname(candidate),
    `.${path.basename(candidate)}.publish-claim`,
  );
}

async function tryAcquireClaim(claimPath: string): Promise<boolean> {
  try {
    const fh = await fs.open(claimPath, 'wx', 0o600);
    try {
      await fh.writeFile(
        JSON.stringify({
          id: randomUUID(),
          pid: process.pid,
          created: new Date().toISOString(),
        }),
        'utf8',
      );
    } finally {
      await fh.close();
    }
    return true;
  } catch (error) {
    if (isCollisionError(error)) {
      return false;
    }
    throw error;
  }
}

async function defaultReleaseClaim(
  claimPath: string,
): Promise<Error | undefined> {
  try {
    await fs.unlink(claimPath);
    return undefined;
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT') {
      return undefined;
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function isCollisionError(error: unknown): boolean {
  const code = fsErrorCode(error);
  return code === 'EEXIST' || code === 'ENOTEMPTY';
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch (error) {
    if (fsErrorCode(error) === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
