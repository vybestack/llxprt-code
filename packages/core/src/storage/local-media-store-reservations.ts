/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dirent } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import type { LocalMediaStoreFiles } from './local-media-store-files.js';
import {
  MediaStoreError,
  type ReservationRecord,
} from './local-media-store-types.js';
import {
  CONTENT_ID_PREFIX,
  DIGEST_PATTERN,
  digestFor,
  hasErrnoCode,
  parseReservationRecord,
  wrapError,
} from './local-media-store-validation.js';

export interface InstanceLeaseRecord {
  readonly version: 1;
  readonly instanceId: string;
  readonly token: string;
  readonly createdAt: number;
}

interface ReclamationCandidate {
  readonly contentId: string;
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

export function parseInstanceLeaseRecord(
  value: unknown,
): InstanceLeaseRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const version = Reflect.get(value, 'version');
  const instanceId = Reflect.get(value, 'instanceId');
  const token = Reflect.get(value, 'token');
  const createdAt = Reflect.get(value, 'createdAt');
  if (version !== 1) return undefined;
  const validIdentity =
    typeof instanceId === 'string' &&
    instanceId.length > 0 &&
    typeof token === 'string' &&
    token.length > 0;
  const validCreationTime =
    typeof createdAt === 'number' &&
    Number.isSafeInteger(createdAt) &&
    createdAt >= 0;
  if (!validIdentity || !validCreationTime) return undefined;
  return { version, instanceId, token, createdAt };
}

export abstract class LocalMediaStoreReservations {
  protected abstract readonly files: LocalMediaStoreFiles;
  protected abstract readonly reservationLeaseMs: number;
  protected readonly instanceId = randomUUID();
  private readonly instanceLeaseToken = randomUUID();
  private readonly instanceLeaseContentId = `sha256:${createHash('sha256')
    .update(this.instanceId)
    .digest('hex')}`;
  private instanceLeaseTimer: ReturnType<typeof setInterval> | undefined;
  private instanceLeaseRefresh: Promise<void> = Promise.resolve();
  private instanceLeaseFailure: unknown;
  private closed = false;

  protected assertOpen(operation: string, contentId: string | undefined): void {
    if (!this.closed) return;
    throw new MediaStoreError(
      operation,
      contentId,
      new Error('Local media store is closed'),
    );
  }

  protected assertInstanceLeaseHealthy(contentId: string | undefined): void {
    if (this.instanceLeaseFailure === undefined) return;
    throw wrapError(
      'refresh media owner lease',
      contentId,
      this.instanceLeaseFailure,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const timer = this.instanceLeaseTimer;
    this.instanceLeaseTimer = undefined;
    if (timer === undefined) return;
    clearInterval(timer);

    const failures: unknown[] = [];
    try {
      await this.instanceLeaseRefresh;
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      await this.removeInstanceLease();
    } catch (error: unknown) {
      failures.push(error);
    }
    if (failures.length === 1) {
      throw wrapError('close media store', undefined, failures[0]);
    }
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Failed to close media store');
    }
  }

  private async removeInstanceLease(): Promise<void> {
    const path = this.files.instancePath(this.instanceId);
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const lease = parseInstanceLeaseRecord(parsed);
    if (
      lease?.instanceId !== this.instanceId ||
      lease.token !== this.instanceLeaseToken
    ) {
      throw new Error('Media owner lease identity changed before close');
    }
    await unlink(path);
    await this.files.syncDirectory(this.files.instanceDirectory);
  }

  protected async ensureInstanceLeaseUnlocked(): Promise<void> {
    if (this.instanceLeaseTimer !== undefined) return;
    const record: InstanceLeaseRecord = {
      version: 1,
      instanceId: this.instanceId,
      token: this.instanceLeaseToken,
      createdAt: Date.now(),
    };
    await this.files.publishInstanceBytes(
      Buffer.from(JSON.stringify(record), 'utf8'),
      this.instanceId,
      this.instanceLeaseContentId,
    );
    const intervalMs = Math.max(1, Math.floor(this.reservationLeaseMs / 3));
    this.instanceLeaseTimer = setInterval(() => {
      if (this.instanceLeaseFailure !== undefined) return;
      this.instanceLeaseRefresh = this.instanceLeaseRefresh.then(
        () => this.refreshInstanceLease(),
        () => this.refreshInstanceLease(),
      );
      void this.instanceLeaseRefresh.catch((error: unknown) => {
        this.instanceLeaseFailure = error;
      });
    }, intervalMs);
    this.instanceLeaseTimer.unref();
  }

  private async refreshInstanceLease(): Promise<void> {
    const path = this.files.instancePath(this.instanceId);
    try {
      const before = await lstat(path);
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      const current = parseInstanceLeaseRecord(parsed);
      if (
        current?.instanceId !== this.instanceId ||
        current.token !== this.instanceLeaseToken
      ) {
        throw new Error('Media owner lease identity changed');
      }
      const now = new Date();
      await utimes(path, now, now);
      const after = await lstat(path);
      if (before.dev !== after.dev || before.ino !== after.ino) {
        throw new Error('Media owner lease file changed during heartbeat');
      }
    } catch (error) {
      throw wrapError('refresh media owner lease', undefined, error);
    }
  }

  protected async instanceLeaseIsFresh(instanceId: string): Promise<boolean> {
    const path = this.files.instancePath(instanceId);
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile()) {
        throw new Error('Media owner lease is not a regular file');
      }
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      const record = parseInstanceLeaseRecord(parsed);
      if (record?.instanceId !== instanceId) {
        throw new Error(
          'Media owner lease is malformed or has changed identity',
        );
      }
      return Date.now() - metadata.mtimeMs < this.reservationLeaseMs;
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return false;
      throw wrapError('inspect media owner lease', undefined, error);
    }
  }

  protected async readReservationIfPresent(
    contentId: string,
    ownerDigest: string,
  ): Promise<ReservationRecord | undefined> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.reservationPath(contentId, ownerDigest), 'utf8'),
      );
      const validated = parseReservationRecord(parsed);
      if (validated === undefined || validated.ownerDigest !== ownerDigest) {
        await this.removeReservation(contentId, ownerDigest);
        return undefined;
      }
      return validated;
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return undefined;
      if (error instanceof SyntaxError) {
        await this.removeReservation(contentId, ownerDigest);
        return undefined;
      }
      throw wrapError('reserve reference', contentId, error);
    }
  }

  protected async removeReservation(
    contentId: string,
    ownerDigest: string,
  ): Promise<void> {
    try {
      await unlink(this.reservationPath(contentId, ownerDigest));
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) {
        throw wrapError('release reference', contentId, error);
      }
    }
  }

  protected async scanReclamationCandidates(
    protectedContentIds: ReadonlySet<string>,
    createdBefore: number,
  ): Promise<readonly ReclamationCandidate[]> {
    const candidates: ReclamationCandidate[] = [];
    for (const entry of await this.readObjectDirectoryUnlocked(
      'reclaim media',
    )) {
      const candidate = await this.scanReclamationCandidate(
        entry,
        protectedContentIds,
        createdBefore,
      );
      if (candidate !== undefined) candidates.push(candidate);
    }
    return candidates;
  }

  private async scanReclamationCandidate(
    entry: Dirent<string>,
    protectedContentIds: ReadonlySet<string>,
    createdBefore: number,
  ): Promise<ReclamationCandidate | undefined> {
    this.validateObjectDirectoryEntry(entry, 'reclaim media');
    const contentId = `${CONTENT_ID_PREFIX}${entry.name}`;
    if (protectedContentIds.has(contentId)) return undefined;
    const path = join(this.files.objectDirectory, entry.name);
    await this.files.inspectReclamationCandidate(path);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return undefined;
      throw wrapError('scan reclaimable media object', contentId, error);
    }
    if (metadata.ctimeMs >= createdBefore) return undefined;
    return {
      contentId,
      path,
      device: metadata.dev,
      inode: metadata.ino,
    };
  }

  protected async reclaimObjectUnlocked(
    candidate: ReclamationCandidate,
    protectedContentIds: ReadonlySet<string>,
    createdBefore: number,
  ): Promise<boolean> {
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(candidate.path);
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return false;
      throw wrapError('revalidate media object', candidate.contentId, error);
    }
    const identityChanged =
      !metadata.isFile() ||
      metadata.dev !== candidate.device ||
      metadata.ino !== candidate.inode;
    if (identityChanged) return false;
    const noLongerEligible =
      metadata.ctimeMs >= createdBefore ||
      protectedContentIds.has(candidate.contentId);
    if (noLongerEligible) return false;
    if (await this.hasReservationsUnlocked(candidate.contentId)) return false;
    try {
      await unlink(candidate.path);
      await this.files.syncDirectory(this.files.objectDirectory);
      return true;
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return false;
      throw wrapError('reclaim media object', candidate.contentId, error);
    }
  }

  protected validateObjectDirectoryEntry(
    entry: Dirent<string>,
    operation: string,
  ): void {
    if (!DIGEST_PATTERN.test(entry.name) || !entry.isFile()) {
      throw new MediaStoreError(
        operation,
        entry.name,
        new Error('Unexpected object-store entry'),
      );
    }
  }

  protected async readObjectDirectoryUnlocked(
    operation: string,
  ): Promise<Array<Dirent<string>>> {
    try {
      return await readdir(this.files.objectDirectory, { withFileTypes: true });
    } catch (error) {
      throw wrapError(operation, undefined, error);
    }
  }

  protected async prepareReservationPath(
    contentId: string,
    ownerDigest: string,
  ): Promise<string> {
    const ownerDirectory = join(
      this.files.reservationDirectory,
      digestFor(contentId),
    );
    await this.files.ensureDirectory(
      ownerDirectory,
      contentId,
      'reserve reference',
    );
    return join(ownerDirectory, ownerDigest);
  }

  protected reservationPath(contentId: string, ownerDigest: string): string {
    return join(
      this.files.reservationDirectory,
      digestFor(contentId),
      ownerDigest,
    );
  }

  protected async hasReservationsUnlocked(contentId: string): Promise<boolean> {
    const directory = join(
      this.files.reservationDirectory,
      digestFor(contentId),
    );
    const entries = await this.readReservationDirectory(directory, contentId);
    for (const entry of entries) {
      const record = await this.readReservationEntry(
        directory,
        entry,
        contentId,
      );
      if (record === undefined) continue;
      if (await this.instanceLeaseIsFresh(record.instanceId)) return true;
      await this.removeStaleReservation(join(directory, entry.name), contentId);
    }
    return false;
  }

  protected async readReservationDirectory(
    directory: string,
    contentId: string,
  ): Promise<Array<Dirent<string>>> {
    try {
      return await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return [];
      throw wrapError('inspect references', contentId, error);
    }
  }

  protected async readReservationEntry(
    directory: string,
    entry: Dirent<string>,
    contentId: string,
  ): Promise<ReservationRecord | undefined> {
    if (!entry.isFile()) return undefined;
    const path = join(directory, entry.name);
    if (!DIGEST_PATTERN.test(entry.name)) {
      await this.removeStaleReservation(path, contentId);
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      const record = parseReservationRecord(parsed);
      if (
        record === undefined ||
        record.ownerDigest !== entry.name ||
        !record.relatedContentIds.includes(contentId)
      ) {
        await this.removeStaleReservation(path, contentId);
        return undefined;
      }
      return record;
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return undefined;
      if (error instanceof SyntaxError) {
        await this.removeStaleReservation(path, contentId);
        return undefined;
      }
      throw wrapError('inspect references', contentId, error);
    }
  }

  protected async removeStaleReservation(
    path: string,
    contentId: string,
  ): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!hasErrnoCode(error, 'ENOENT')) {
        throw wrapError('recover stale reference', contentId, error);
      }
    }
  }

  protected async reclaimTemporaryFilesUnlocked(
    staleTemporaryBefore: number,
  ): Promise<number> {
    let entries: Array<Dirent<string>>;
    try {
      entries = await readdir(this.files.temporaryDirectory, {
        withFileTypes: true,
      });
    } catch (error) {
      throw wrapError('scan temporary media', undefined, error);
    }
    let removed = 0;
    for (const entry of entries) {
      if (await this.reclaimTemporaryEntry(entry, staleTemporaryBefore)) {
        removed++;
      }
    }
    return removed;
  }

  protected async reclaimTemporaryEntry(
    entry: Dirent<string>,
    staleTemporaryBefore: number,
  ): Promise<boolean> {
    if (!entry.isFile()) return false;
    const path = join(this.files.temporaryDirectory, entry.name);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return false;
      throw wrapError('inspect temporary media', undefined, error);
    }
    if (metadata.mtimeMs >= staleTemporaryBefore) return false;
    try {
      await unlink(path);
      return true;
    } catch (error) {
      if (hasErrnoCode(error, 'ENOENT')) return false;
      throw wrapError('reclaim temporary media', undefined, error);
    }
  }
}
