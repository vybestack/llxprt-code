/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  open,
  readFile,
  rename,
  unlink,
  utimes,
} from 'node:fs/promises';
import { hostname } from 'node:os';
import { isAbsolute, join } from 'node:path';
import {
  isMediaReferenceBlock,
  type MediaReferenceBlock,
  type MediaStoredObject,
} from '../services/history/IContent.js';
import { LocalMediaStoreFiles } from './local-media-store-files.js';
import { recoverStaleStoreLock } from './local-media-store-lock-recovery.js';
import { measureStoredBytesWithinBound } from './local-media-store-quota.js';
import { LocalMediaStoreReservations } from './local-media-store-reservations.js';
import {
  MediaObjectCorruptError,
  MediaObjectHashMismatchError,
  MediaObjectMissingError,
  MediaStoreError,
  type LocalMediaStoreOptions,
  type MediaReclamationResult,
  type PublishedMediaObjectPath,
  type ReservationRecord,
  type StoreLockOwner,
} from './local-media-store-types.js';
import {
  LOCK_VERSION,
  RESERVATION_VERSION,
  contentIdFor,
  hasErrnoCode,
  isNonNegativeSafeInteger,
  parseStoreLockOwner,
  requiredObjects,
  validateContentId,
  validateOwnerId,
  validatePositiveDuration,
  validateStoredObjectMetadata,
  wrapError,
} from './local-media-store-validation.js';

const FILE_MODE = 0o600;
const DEFAULT_LOCK_TIMEOUT_MS = 2_000;
const DEFAULT_STALE_LOCK_MS = 30_000;
const DEFAULT_RESERVATION_LEASE_MS = 30_000;
const DEFAULT_QUOTA_SCAN_MAX_ENTRIES = 10_000;
const LOCK_RETRY_MS = 10;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

interface LeaseHeartbeat {
  stop(): Promise<unknown | undefined>;
}

export class LocalMediaStorePersistence extends LocalMediaStoreReservations {
  readonly rootDirectory: string;
  readonly quotaBytes: number;
  protected override readonly files: LocalMediaStoreFiles;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  protected override readonly reservationLeaseMs: number;
  private readonly quotaScanMaxEntries: number;

  constructor(options: LocalMediaStoreOptions) {
    super();
    this.validateOptions(options);
    const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
    const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
    const reservationLeaseMs =
      options.reservationLeaseMs ?? DEFAULT_RESERVATION_LEASE_MS;
    const quotaScanMaxEntries =
      options.quotaScanMaxEntries ?? DEFAULT_QUOTA_SCAN_MAX_ENTRIES;
    validatePositiveDuration(lockTimeoutMs, 'Lock timeout');
    validatePositiveDuration(staleLockMs, 'Stale lock duration');
    validatePositiveDuration(reservationLeaseMs, 'Reservation lease duration');
    validatePositiveDuration(quotaScanMaxEntries, 'Quota scan entry bound');
    this.rootDirectory = options.rootDirectory;
    this.quotaBytes = options.quotaBytes;
    this.files = new LocalMediaStoreFiles(
      options.rootDirectory,
      options.fileOperations,
    );
    this.lockTimeoutMs = lockTimeoutMs;
    this.staleLockMs = staleLockMs;
    this.reservationLeaseMs = reservationLeaseMs;
    this.quotaScanMaxEntries = quotaScanMaxEntries;
  }

  async runExclusive<T>(
    operation: string,
    contentId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    this.assertOpen(operation, contentId);
    await this.files.ensureDirectories(contentId);
    this.assertInstanceLeaseHealthy(contentId);
    const owner = await this.acquireStoreLock(operation, contentId);
    const heartbeat = this.startStoreLockHeartbeat(owner, operation, contentId);
    let outcome:
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly error: unknown };
    try {
      outcome = { ok: true, value: await work() };
    } catch (error) {
      outcome = { ok: false, error };
    }
    const heartbeatFailure = await heartbeat.stop();
    if (heartbeatFailure !== undefined) {
      outcome = {
        ok: false,
        error: outcome.ok
          ? heartbeatFailure
          : new AggregateError([outcome.error, heartbeatFailure]),
      };
    }
    await this.releaseAfterWork(owner, operation, contentId, outcome);
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  async readObjectVerified(reference: MediaStoredObject): Promise<Uint8Array> {
    return this.runExclusive('read verified', reference.contentId, () =>
      this.readObjectVerifiedUnlocked(reference, 'read verified'),
    );
  }

  async readObjectVerifiedUnlocked(
    reference: MediaStoredObject,
    operation: string,
  ): Promise<Uint8Array> {
    validateStoredObjectMetadata(reference, operation);
    const objectPath = this.files.objectPath(reference.contentId);
    const storedBytes = await this.files.readRegularFile(
      objectPath,
      reference.contentId,
      operation,
    );
    if (storedBytes.byteLength !== reference.byteLength) {
      throw new MediaObjectCorruptError(
        operation,
        reference.contentId,
        new Error(
          `Stored byte length ${storedBytes.byteLength} does not match ${reference.byteLength}`,
        ),
      );
    }
    if (contentIdFor(storedBytes) !== reference.contentId) {
      throw new MediaObjectHashMismatchError(operation, reference.contentId);
    }
    return storedBytes;
  }

  async objectExistsUnlocked(contentId: string): Promise<boolean> {
    try {
      const objectStat = await lstat(this.files.objectPath(contentId));
      if (!objectStat.isFile()) {
        throw new MediaObjectCorruptError(
          'inspect admitted object',
          contentId,
          new Error('Stored object is not a regular file'),
        );
      }
      return true;
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return false;
      throw wrapError('inspect admitted object', contentId, error);
    }
  }

  async measureStoredBytesUnlocked(): Promise<number> {
    return measureStoredBytesWithinBound(
      this.files.objectDirectory,
      this.quotaScanMaxEntries,
      this.lockTimeoutMs,
    );
  }

  enforceQuota(
    storedBytes: number,
    additionalBytes: number,
    contentId: string,
  ): void {
    if (additionalBytes > this.quotaBytes - storedBytes) {
      throw new MediaStoreError(
        'enforce spool quota',
        contentId,
        new Error(
          `Admission exceeds quota: ${storedBytes} + ${additionalBytes} > ${this.quotaBytes}`,
        ),
      );
    }
  }

  async publishObjectBytes(
    bytes: Uint8Array,
    contentId: string,
    operation: string,
  ): Promise<string | undefined> {
    return this.files.publishObjectBytes(bytes, contentId, operation);
  }

  async publishObjectFile(
    sourcePath: string,
    contentId: string,
    expectedByteLength: number,
    operation: string,
  ): Promise<string | undefined> {
    return this.files.publishObjectFile(
      sourcePath,
      contentId,
      expectedByteLength,
      operation,
    );
  }

  async rollbackPublishedPaths(paths: readonly string[]): Promise<unknown[]> {
    return this.files.rollbackPublishedPaths(paths);
  }

  async rollbackStagedObjects(
    published: readonly PublishedMediaObjectPath[],
  ): Promise<void> {
    await this.runExclusive(
      'rollback staged object batch',
      undefined,
      async () => {
        const removable: string[] = [];
        for (const entry of published) {
          if (!(await this.hasReservationsUnlocked(entry.contentId))) {
            removable.push(entry.path);
          }
        }
        const failures = await this.files.rollbackPublishedPaths(removable);
        if (failures.length > 0) {
          throw new MediaStoreError(
            'rollback staged object batch',
            undefined,
            new AggregateError(failures),
          );
        }
      },
    );
  }

  async getStoredByteLength(): Promise<number> {
    return this.runExclusive('measure spool quota', undefined, () =>
      this.measureStoredBytesUnlocked(),
    );
  }

  async reserveAndReadVerified(
    reference: MediaReferenceBlock,
    ownerId: string,
  ): Promise<Uint8Array> {
    if (!isMediaReferenceBlock(reference)) {
      throw new MediaObjectCorruptError(
        'reserve reference',
        undefined,
        new Error('Malformed media reference'),
      );
    }
    const contentId = reference.contentId;
    validateOwnerId(ownerId, contentId, 'reserve reference');
    return this.runExclusive('reserve reference', contentId, () =>
      this.reserveUnlocked(reference, ownerId),
    );
  }

  async release(contentId: string, ownerId: string): Promise<void> {
    validateContentId(contentId, 'release reference');
    validateOwnerId(ownerId, contentId, 'release reference');
    await this.runExclusive('release reference', contentId, async () => {
      const ownerDigest = createHash('sha256').update(ownerId).digest('hex');
      const record = await this.readReservationIfPresent(
        contentId,
        ownerDigest,
      );
      if (record === undefined) return;
      for (const relatedContentId of record.relatedContentIds) {
        await this.removeReservation(relatedContentId, ownerDigest);
      }
      await this.files.syncDirectory(this.files.reservationDirectory);
    });
  }

  async hasReservations(contentId: string): Promise<boolean> {
    validateContentId(contentId, 'inspect references');
    return this.runExclusive('inspect references', contentId, () =>
      this.hasReservationsUnlocked(contentId),
    );
  }

  async reclaimUnreferenced(
    protectedContentIds: ReadonlySet<string>,
    staleTemporaryBefore: number,
  ): Promise<MediaReclamationResult> {
    if (!Number.isFinite(staleTemporaryBefore)) {
      throw new MediaStoreError(
        'reclaim media',
        undefined,
        new Error('Stale temporary cutoff must be finite'),
      );
    }
    const objectCreatedBefore = Date.now();
    await this.runExclusive('prepare media reclamation', undefined, () =>
      Promise.resolve(),
    );
    const candidates = await this.scanReclamationCandidates(
      protectedContentIds,
      objectCreatedBefore,
    );
    let objectsRemoved = 0;
    for (const candidate of candidates) {
      const removed = await this.runExclusive(
        'reclaim media object',
        candidate.contentId,
        () =>
          this.reclaimObjectUnlocked(
            candidate,
            protectedContentIds,
            objectCreatedBefore,
          ),
      );
      if (removed) objectsRemoved += 1;
    }
    const temporaryFilesRemoved = await this.runExclusive(
      'reclaim temporary media',
      undefined,
      () => this.reclaimTemporaryFilesUnlocked(staleTemporaryBefore),
    );
    return { objectsRemoved, temporaryFilesRemoved };
  }

  private validateOptions(options: LocalMediaStoreOptions): void {
    if (
      !isAbsolute(options.rootDirectory) ||
      options.rootDirectory.length === 0
    ) {
      throw new MediaStoreError(
        'initialize',
        undefined,
        new Error('Root directory must be absolute'),
      );
    }
    if (!isNonNegativeSafeInteger(options.quotaBytes)) {
      throw new MediaStoreError(
        'validate quota',
        undefined,
        new Error('Quota must be a non-negative safe integer'),
      );
    }
  }

  private startStoreLockHeartbeat(
    owner: StoreLockOwner,
    operation: string,
    contentId: string | undefined,
  ): LeaseHeartbeat {
    const intervalMs = Math.max(1, Math.floor(this.staleLockMs / 3));
    let stopped = false;
    let refresh = Promise.resolve();
    let failure: unknown;
    const timer = setInterval(() => {
      if (stopped || failure !== undefined) return;
      refresh = refresh.then(async () => {
        try {
          await this.refreshStoreLock(owner, operation, contentId);
        } catch (error) {
          failure = error;
        }
      });
    }, intervalMs);
    timer.unref();
    return {
      stop: async (): Promise<unknown | undefined> => {
        stopped = true;
        clearInterval(timer);
        await refresh;
        return failure;
      },
    };
  }

  private async refreshStoreLock(
    owner: StoreLockOwner,
    operation: string,
    contentId: string | undefined,
  ): Promise<void> {
    try {
      const before = await lstat(this.files.lockPath);
      const parsed: unknown = JSON.parse(
        await readFile(this.files.lockPath, 'utf8'),
      );
      const current = parseStoreLockOwner(parsed);
      if (current?.token !== owner.token || before.nlink !== 1) {
        throw new Error('Store lock ownership changed during heartbeat');
      }
      const now = new Date();
      await utimes(this.files.lockPath, now, now);
      const after = await lstat(this.files.lockPath);
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        after.nlink !== 1
      ) {
        throw new Error('Store lock identity changed during heartbeat');
      }
    } catch (error) {
      throw wrapError(
        `heartbeat store lock for ${operation}`,
        contentId,
        error,
      );
    }
  }

  private async releaseAfterWork<T>(
    owner: StoreLockOwner,
    operation: string,
    contentId: string | undefined,
    outcome:
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly error: unknown },
  ): Promise<void> {
    try {
      await this.releaseStoreLock(owner, operation, contentId);
    } catch (releaseError) {
      if (!outcome.ok) {
        throw new MediaStoreError(
          `${operation} and release lock`,
          contentId,
          new AggregateError([outcome.error, releaseError]),
        );
      }
      throw releaseError;
    }
  }

  private async acquireStoreLock(
    operation: string,
    contentId: string | undefined,
  ): Promise<StoreLockOwner> {
    const deadline = Date.now() + this.lockTimeoutMs;
    let owner = await this.tryAcquireStoreLock(operation, contentId);
    while (owner === undefined) {
      const recovered = await this.recoverStaleLock(operation, contentId);
      if (!recovered) {
        if (Date.now() >= deadline) {
          throw new MediaStoreError(
            `acquire store lock for ${operation}`,
            contentId,
            new Error(`Lock contention exceeded ${this.lockTimeoutMs}ms`),
          );
        }
        await sleep(
          Math.min(LOCK_RETRY_MS, Math.max(1, deadline - Date.now())),
        );
      }
      owner = await this.tryAcquireStoreLock(operation, contentId);
    }
    return owner;
  }

  private async tryAcquireStoreLock(
    operation: string,
    contentId: string | undefined,
  ): Promise<StoreLockOwner | undefined> {
    const owner: StoreLockOwner = {
      version: LOCK_VERSION,
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      createdAt: Date.now(),
    };
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let identity:
      | { readonly device: number; readonly inode: number }
      | undefined;
    try {
      handle = await open(this.files.lockPath, 'wx', FILE_MODE);
      const metadata = await handle.stat();
      identity = { device: metadata.dev, inode: metadata.ino };
      await handle.writeFile(JSON.stringify(owner));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.files.syncDirectory(this.files.lockDirectory);
      return owner;
    } catch (error) {
      if (identity === undefined && hasErrnoCode(error, 'EEXIST')) {
        return undefined;
      }
      const cleanupFailures = await this.cleanupOwnedLockAfterFailure(
        handle,
        identity,
      );
      const failure =
        cleanupFailures.length === 0
          ? error
          : new AggregateError(
              [error, ...cleanupFailures],
              'Store lock initialization and cleanup failed',
            );
      throw wrapError(
        `acquire store lock for ${operation}`,
        contentId,
        failure,
      );
    }
  }

  private async cleanupOwnedLockAfterFailure(
    handle: Awaited<ReturnType<typeof open>> | undefined,
    identity: { readonly device: number; readonly inode: number } | undefined,
  ): Promise<unknown[]> {
    const failures: unknown[] = [];
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (identity === undefined) return failures;
    try {
      const current = await lstat(this.files.lockPath);
      if (current.dev === identity.device && current.ino === identity.inode) {
        await unlink(this.files.lockPath);
        await this.files.syncDirectory(this.files.lockDirectory);
      }
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) failures.push(error);
    }
    return failures;
  }

  private recoverStaleLock(
    operation: string,
    contentId: string | undefined,
  ): Promise<boolean> {
    return recoverStaleStoreLock({
      lockPath: this.files.lockPath,
      lockDirectory: this.files.lockDirectory,
      staleLockMs: this.staleLockMs,
      operation,
      contentId,
      syncDirectory: () => this.files.syncDirectory(this.files.lockDirectory),
    });
  }

  private async releaseStoreLock(
    owner: StoreLockOwner,
    operation: string,
    contentId: string | undefined,
  ): Promise<void> {
    let before: Awaited<ReturnType<typeof lstat>>;
    let after: Awaited<ReturnType<typeof lstat>>;
    let current: StoreLockOwner | undefined;
    try {
      before = await lstat(this.files.lockPath);
      const parsed: unknown = JSON.parse(
        await readFile(this.files.lockPath, 'utf8'),
      );
      current = parseStoreLockOwner(parsed);
      after = await lstat(this.files.lockPath);
    } catch (error) {
      throw wrapError(`verify store lock for ${operation}`, contentId, error);
    }
    const invalidFileType = !before.isFile() || !after.isFile();
    const inodeChanged = before.dev !== after.dev || before.ino !== after.ino;
    const claimPresent = before.nlink !== 1 || after.nlink !== 1;
    const identityChanged = invalidFileType || inodeChanged || claimPresent;
    if (
      current === undefined ||
      current.token !== owner.token ||
      identityChanged
    ) {
      throw new MediaStoreError(
        `verify store lock for ${operation}`,
        contentId,
        new Error('Store lock ownership changed before release'),
      );
    }
    const releasedPath = join(
      this.files.lockDirectory,
      `store.lock.${owner.token}.released`,
    );
    try {
      await rename(this.files.lockPath, releasedPath);
      await unlink(releasedPath);
      await this.files.syncDirectory(this.files.lockDirectory);
    } catch (error) {
      throw wrapError(`release store lock for ${operation}`, contentId, error);
    }
  }

  private async rollbackReservationAfterReadFailure(
    objects: readonly MediaStoredObject[],
    ownerDigest: string,
    error: unknown,
  ): Promise<never> {
    const failures: unknown[] = [];
    for (const object of objects) {
      try {
        await this.removeReservation(object.contentId, ownerDigest);
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    try {
      await this.files.syncDirectory(this.files.reservationDirectory);
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    if (failures.length > 0) {
      throw new AggregateError(
        [error, ...failures],
        'Media reservation and verification cleanup failed',
      );
    }
    throw error;
  }

  private async reserveUnlocked(
    reference: MediaReferenceBlock,
    ownerId: string,
  ): Promise<Uint8Array> {
    const objects = requiredObjects(reference);
    await this.verifyObjectsExistForReservation(objects);
    await this.ensureInstanceLeaseUnlocked();
    const ownerDigest = createHash('sha256').update(ownerId).digest('hex');
    const existing = await this.readReservationIfPresent(
      reference.contentId,
      ownerDigest,
    );
    if (
      existing !== undefined &&
      this.reservationMatches(existing, objects) &&
      (Date.now() < existing.expiresAt ||
        (await this.instanceLeaseIsFresh(existing.instanceId)))
    ) {
      try {
        return await this.readObjectVerifiedUnlocked(
          reference.selectedObject,
          'reserve reference',
        );
      } catch (error) {
        return this.rollbackReservationAfterReadFailure(
          objects,
          ownerDigest,
          error,
        );
      }
    }
    const record = this.buildReservationRecord(objects, ownerDigest);
    try {
      for (const object of objects) {
        const reservationPath = await this.prepareReservationPath(
          object.contentId,
          ownerDigest,
        );
        await this.files.replacePublishedBytes(
          Buffer.from(JSON.stringify(record), 'utf8'),
          reservationPath,
          object.contentId,
          'reserve reference',
        );
      }
      return await this.readObjectVerifiedUnlocked(
        reference.selectedObject,
        'reserve reference',
      );
    } catch (error) {
      return this.rollbackReservationAfterReadFailure(
        objects,
        ownerDigest,
        error,
      );
    }
  }

  private async verifyObjectsExistForReservation(
    objects: readonly MediaStoredObject[],
  ): Promise<void> {
    for (const object of objects) {
      if (!(await this.objectExistsUnlocked(object.contentId))) {
        throw new MediaObjectMissingError(
          'reserve reference',
          object.contentId,
        );
      }
    }
  }

  private buildReservationRecord(
    objects: readonly MediaStoredObject[],
    ownerDigest: string,
  ): ReservationRecord {
    const now = Date.now();
    return {
      version: RESERVATION_VERSION,
      ownerDigest,
      instanceId: this.instanceId,
      pid: process.pid,
      hostname: hostname(),
      createdAt: now,
      expiresAt: now + this.reservationLeaseMs,
      relatedContentIds: objects.map((object) => object.contentId),
    };
  }

  private reservationMatches(
    record: ReservationRecord,
    objects: readonly MediaStoredObject[],
  ): boolean {
    const contentIds = objects.map((object) => object.contentId);
    return (
      record.relatedContentIds.length === contentIds.length &&
      record.relatedContentIds.every(
        (contentId, index) => contentId === contentIds[index],
      )
    );
  }
}
