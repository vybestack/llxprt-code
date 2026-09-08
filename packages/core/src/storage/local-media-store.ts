/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isMediaReferenceBlock } from '../services/history/IContent.js';
import type {
  MediaReferenceBlock,
  MediaSemanticMetadata,
  MediaStoredObject,
} from '../services/history/IContent.js';
import { LocalMediaStorePersistence } from './local-media-store-persistence.js';
import {
  MediaObjectCorruptError,
  MediaObjectHashMismatchError,
  MediaStoreError,
  type LocalMediaStoreOptions,
  type MediaAdmissionInput,
  type MediaKnownAdmissionInput,
  type MediaReclamationResult,
  type MediaStoredObjectAdmission,
  type MediaStoredObjectFileAdmission,
  type PreparedAdmission,
  type PublishedMediaObjectPath,
  type StagedMediaObjectAdmission,
} from './local-media-store-types.js';
import {
  buildIdentityReference,
  buildReference,
  buildStoredObject,
  contentIdFor,
  isPositiveSafeInteger,
  prepareAdmission,
  uniqueStoredObjects,
  validateContentId,
  validatedProviderFileIds,
  validatedSemanticMetadata,
  validateStoredObjectMetadata,
} from './local-media-store-validation.js';

export {
  MediaObjectCorruptError,
  MediaObjectHashMismatchError,
  MediaObjectMissingError,
  MediaStoreError,
} from './local-media-store-types.js';
export type {
  LocalMediaStoreFileOperations,
  LocalMediaStoreOptions,
  MediaAdmissionInput,
  MediaKnownAdmissionInput,
  MediaObjectAdmissionInput,
  MediaReclamationResult,
  MediaStoredObjectAdmission,
  MediaStoredObjectFileAdmission,
  MediaTransformationInput,
} from './local-media-store-types.js';

interface StoredObjectWithBytes {
  readonly object: MediaStoredObject;
  readonly bytes: Uint8Array;
}

interface StoredObjectWithFile {
  readonly object: MediaStoredObject;
  readonly sourcePath: string;
}

function storedObjectMetadataMatches(
  left: MediaStoredObject,
  right: MediaStoredObject,
): boolean {
  return (
    left.mimeType === right.mimeType &&
    left.byteLength === right.byteLength &&
    left.dimensions?.width === right.dimensions?.width &&
    left.dimensions?.height === right.dimensions?.height
  );
}

export class LocalMediaStore {
  readonly rootDirectory: string;
  readonly quotaBytes: number;
  private readonly persistence: LocalMediaStorePersistence;

  constructor(options: LocalMediaStoreOptions) {
    this.persistence = new LocalMediaStorePersistence(options);
    this.rootDirectory = this.persistence.rootDirectory;
    this.quotaBytes = this.persistence.quotaBytes;
  }

  async close(): Promise<void> {
    await this.persistence.close();
  }

  async admit(input: MediaAdmissionInput): Promise<MediaReferenceBlock> {
    const selectedBytes = new Uint8Array(input.bytes);
    const originalBytes =
      input.original === undefined
        ? selectedBytes
        : new Uint8Array(input.original.bytes);
    return this.persistence.runExclusive(
      'admit object',
      undefined,
      async () => {
        const prepared = prepareAdmission(input, selectedBytes, originalBytes);
        await this.admitPreparedUnlocked(prepared);
        return buildReference(prepared);
      },
    );
  }

  async preflightObjects(objects: readonly MediaStoredObject[]): Promise<void> {
    await this.persistence.runExclusive(
      'preflight object batch',
      undefined,
      async () => {
        const unique = uniqueStoredObjects(objects);
        const additionalBytes = await this.measureMissingObjects(unique);
        if (!Number.isSafeInteger(additionalBytes)) {
          throw new MediaStoreError(
            'preflight object batch',
            undefined,
            new Error('Object batch byte length exceeds safe integer range'),
          );
        }
        const storedBytes = await this.persistence.measureStoredBytesUnlocked();
        this.persistence.enforceQuota(storedBytes, additionalBytes, 'batch');
      },
    );
  }

  async admitObjects(
    admissions: readonly MediaStoredObjectAdmission[],
  ): Promise<void> {
    await this.admitObjectsTransaction(admissions, () => Promise.resolve());
  }

  async stageObjects(
    admissions: readonly MediaStoredObjectAdmission[],
  ): Promise<StagedMediaObjectAdmission> {
    const copied = admissions.map((admission) => ({
      object: admission.object,
      bytes: new Uint8Array(admission.bytes),
    }));
    const published = await this.persistence.runExclusive(
      'stage object batch',
      undefined,
      () => this.stageObjectBatchUnlocked(copied),
    );
    let pending = true;
    return {
      createdContentIds: published.map((entry) => entry.contentId),
      commit(): void {
        pending = false;
      },
      rollback: async (): Promise<void> => {
        if (!pending) return;
        await this.persistence.rollbackStagedObjects(published);
        pending = false;
      },
    };
  }

  async stageObjectFiles(
    admissions: readonly MediaStoredObjectFileAdmission[],
  ): Promise<StagedMediaObjectAdmission> {
    const published = await this.persistence.runExclusive(
      'stage object file batch',
      undefined,
      () => this.stageObjectFileBatchUnlocked(admissions),
    );
    let pending = true;
    return {
      createdContentIds: published.map((entry) => entry.contentId),
      commit(): void {
        pending = false;
      },
      rollback: async (): Promise<void> => {
        if (!pending) return;
        await this.persistence.rollbackStagedObjects(published);
        pending = false;
      },
    };
  }

  async admitObjectsTransaction<T>(
    admissions: readonly MediaStoredObjectAdmission[],
    publish: () => Promise<T>,
  ): Promise<T> {
    const copied = admissions.map((admission) => ({
      object: admission.object,
      bytes: new Uint8Array(admission.bytes),
    }));
    return this.persistence.runExclusive('admit object batch', undefined, () =>
      this.admitObjectBatchUnlocked(copied, publish),
    );
  }

  async preflightKnown(
    contentId: string,
    knownByteLength: number,
  ): Promise<void> {
    validateContentId(contentId, 'preflight known object');
    this.validateKnownByteLength(knownByteLength, contentId);
    await this.persistence.runExclusive(
      'preflight known object',
      contentId,
      async () => {
        if (await this.persistence.objectExistsUnlocked(contentId)) return;
        const storedBytes = await this.persistence.measureStoredBytesUnlocked();
        this.persistence.enforceQuota(storedBytes, knownByteLength, contentId);
      },
    );
  }

  async admitKnown(
    input: MediaKnownAdmissionInput,
    readBytes: () => Promise<Uint8Array>,
  ): Promise<MediaReferenceBlock> {
    validateContentId(input.contentId, 'admit known object');
    this.validateKnownByteLength(input.knownByteLength, input.contentId);
    const metadata = buildStoredObject(
      input.contentId,
      input.mimeType,
      input.knownByteLength,
      input.dimensions,
    );
    const semanticMetadata = validatedSemanticMetadata(
      input.semanticMetadata,
      input.contentId,
    );
    const providerFileIds = validatedProviderFileIds(
      input.providerFileIds,
      input.contentId,
    );
    const existing = await this.persistence.runExclusive(
      'preflight known object admission',
      input.contentId,
      async () => {
        if (await this.persistence.objectExistsUnlocked(input.contentId)) {
          await this.persistence.readObjectVerifiedUnlocked(
            metadata,
            'admit deduplicated object',
          );
          return buildIdentityReference(
            metadata,
            semanticMetadata,
            providerFileIds,
          );
        }
        const storedBytes = await this.persistence.measureStoredBytesUnlocked();
        this.persistence.enforceQuota(
          storedBytes,
          input.knownByteLength,
          input.contentId,
        );
        return undefined;
      },
    );
    if (existing !== undefined) return existing;
    const bytes = new Uint8Array(await readBytes());
    if (
      bytes.byteLength !== input.knownByteLength ||
      contentIdFor(bytes) !== input.contentId
    ) {
      throw new MediaStoreError(
        'validate known object source',
        input.contentId,
        new Error('Known object source changed after preflight'),
      );
    }
    return this.persistence.runExclusive(
      'admit known object',
      input.contentId,
      () =>
        this.admitKnownSnapshotUnlocked(
          input,
          metadata,
          semanticMetadata,
          providerFileIds,
          bytes,
        ),
    );
  }

  async readObjectVerified(reference: MediaStoredObject): Promise<Uint8Array> {
    return this.persistence.readObjectVerified(reference);
  }

  async readVerified(reference: MediaReferenceBlock): Promise<Uint8Array> {
    if (!isMediaReferenceBlock(reference)) {
      throw new MediaObjectCorruptError(
        'read verified',
        undefined,
        new Error('Malformed media reference'),
      );
    }
    return this.readObjectVerified(reference.selectedObject);
  }

  async getStoredByteLength(): Promise<number> {
    return this.persistence.getStoredByteLength();
  }

  async reserve(
    reference: MediaReferenceBlock,
    ownerId: string,
  ): Promise<void> {
    await this.reserveAndReadVerified(reference, ownerId);
  }

  async reserveAndReadVerified(
    reference: MediaReferenceBlock,
    ownerId: string,
  ): Promise<Uint8Array> {
    return this.persistence.reserveAndReadVerified(reference, ownerId);
  }

  async release(contentId: string, ownerId: string): Promise<void> {
    await this.persistence.release(contentId, ownerId);
  }

  async hasReservations(contentId: string): Promise<boolean> {
    return this.persistence.hasReservations(contentId);
  }

  async reclaimUnreferenced(
    protectedContentIds: ReadonlySet<string>,
    staleTemporaryBefore: number,
  ): Promise<MediaReclamationResult> {
    return this.persistence.reclaimUnreferenced(
      protectedContentIds,
      staleTemporaryBefore,
    );
  }

  private async measureMissingObjects(
    objects: ReadonlyMap<string, MediaStoredObject>,
  ): Promise<number> {
    let additionalBytes = 0;
    for (const object of objects.values()) {
      if (!(await this.persistence.objectExistsUnlocked(object.contentId))) {
        additionalBytes += object.byteLength;
      }
    }
    return additionalBytes;
  }

  private async stageObjectFileBatchUnlocked(
    admissions: readonly StoredObjectWithFile[],
  ): Promise<readonly PublishedMediaObjectPath[]> {
    const byContentId = new Map<string, StoredObjectWithFile>();
    for (const admission of admissions) {
      validateStoredObjectMetadata(admission.object, 'stage object file batch');
      const existing = byContentId.get(admission.object.contentId);
      if (
        existing !== undefined &&
        !storedObjectMetadataMatches(existing.object, admission.object)
      ) {
        throw new MediaStoreError(
          'stage object file batch',
          admission.object.contentId,
          new Error('Conflicting stored object metadata'),
        );
      }
      byContentId.set(admission.object.contentId, admission);
    }
    const missing: StoredObjectWithFile[] = [];
    for (const admission of byContentId.values()) {
      if (
        await this.persistence.objectExistsUnlocked(admission.object.contentId)
      ) {
        await this.persistence.readObjectVerifiedUnlocked(
          admission.object,
          'stage deduplicated object file batch',
        );
      } else {
        missing.push(admission);
      }
    }
    const additionalBytes = missing.reduce(
      (total, admission) => total + admission.object.byteLength,
      0,
    );
    const storedBytes = await this.persistence.measureStoredBytesUnlocked();
    this.persistence.enforceQuota(storedBytes, additionalBytes, 'batch');
    const published: PublishedMediaObjectPath[] = [];
    try {
      for (const admission of missing) {
        const path = await this.persistence.publishObjectFile(
          admission.sourcePath,
          admission.object.contentId,
          admission.object.byteLength,
          'stage object file batch',
        );
        if (path !== undefined) {
          published.push({ contentId: admission.object.contentId, path });
        }
      }
      return published;
    } catch (error) {
      return this.throwAfterRollback(
        error,
        published.map((entry) => entry.path),
        'stage object file batch and rollback',
        undefined,
      );
    }
  }

  private async stageObjectBatchUnlocked(
    admissions: readonly StoredObjectWithBytes[],
  ): Promise<readonly PublishedMediaObjectPath[]> {
    const byContentId = this.prepareObjectAdmissions(admissions);
    const missing = await this.findMissingAdmissions(byContentId);
    const additionalBytes = missing.reduce(
      (total, admission) => total + admission.object.byteLength,
      0,
    );
    const storedBytes = await this.persistence.measureStoredBytesUnlocked();
    this.persistence.enforceQuota(storedBytes, additionalBytes, 'batch');
    const published: PublishedMediaObjectPath[] = [];
    try {
      for (const admission of missing) {
        const path = await this.persistence.publishObjectBytes(
          admission.bytes,
          admission.object.contentId,
          'stage object batch',
        );
        if (path !== undefined) {
          published.push({ contentId: admission.object.contentId, path });
        }
      }
      await this.verifyAdmissions(missing, 'verify staged object batch');
      return published;
    } catch (error) {
      return this.throwAfterRollback(
        error,
        published.map((entry) => entry.path),
        'stage object batch and rollback',
        undefined,
      );
    }
  }

  private async admitObjectBatchUnlocked<T>(
    admissions: readonly StoredObjectWithBytes[],
    publish: () => Promise<T>,
  ): Promise<T> {
    const byContentId = this.prepareObjectAdmissions(admissions);
    const missing = await this.findMissingAdmissions(byContentId);
    const additionalBytes = missing.reduce(
      (total, admission) => total + admission.object.byteLength,
      0,
    );
    const storedBytes = await this.persistence.measureStoredBytesUnlocked();
    this.persistence.enforceQuota(storedBytes, additionalBytes, 'batch');
    const published: string[] = [];
    try {
      await this.publishAdmissions(missing, published, 'commit object batch');
      await this.verifyAdmissions(missing, 'verify admitted object batch');
      return await publish();
    } catch (error) {
      return this.throwAfterRollback(
        error,
        published,
        'admit object batch and rollback',
        undefined,
      );
    }
  }

  private prepareObjectAdmissions(
    admissions: readonly StoredObjectWithBytes[],
  ): ReadonlyMap<string, StoredObjectWithBytes> {
    const byContentId = new Map<string, StoredObjectWithBytes>();
    for (const admission of admissions) {
      validateStoredObjectMetadata(admission.object, 'admit object batch');
      if (
        admission.bytes.byteLength !== admission.object.byteLength ||
        contentIdFor(admission.bytes) !== admission.object.contentId
      ) {
        throw new MediaObjectHashMismatchError(
          'admit object batch',
          admission.object.contentId,
        );
      }
      this.validateCompatibleAdmission(byContentId, admission);
      byContentId.set(admission.object.contentId, admission);
    }
    return byContentId;
  }

  private validateCompatibleAdmission(
    admissions: ReadonlyMap<string, StoredObjectWithBytes>,
    admission: StoredObjectWithBytes,
  ): void {
    const existing = admissions.get(admission.object.contentId);
    if (existing === undefined) return;
    if (storedObjectMetadataMatches(existing.object, admission.object)) return;
    throw new MediaStoreError(
      'admit object batch',
      admission.object.contentId,
      new Error('Conflicting stored object metadata'),
    );
  }

  private async findMissingAdmissions(
    admissions: ReadonlyMap<string, StoredObjectWithBytes>,
  ): Promise<readonly StoredObjectWithBytes[]> {
    const missing: StoredObjectWithBytes[] = [];
    for (const admission of admissions.values()) {
      if (
        await this.persistence.objectExistsUnlocked(admission.object.contentId)
      ) {
        await this.persistence.readObjectVerifiedUnlocked(
          admission.object,
          'admit deduplicated object batch',
        );
      } else {
        missing.push(admission);
      }
    }
    return missing;
  }

  private async publishAdmissions(
    admissions: Iterable<StoredObjectWithBytes>,
    published: string[],
    operation: string,
  ): Promise<void> {
    for (const admission of admissions) {
      const path = await this.persistence.publishObjectBytes(
        admission.bytes,
        admission.object.contentId,
        operation,
      );
      if (path !== undefined) published.push(path);
    }
  }

  private async verifyAdmissions(
    admissions: Iterable<StoredObjectWithBytes>,
    operation: string,
  ): Promise<void> {
    for (const admission of admissions) {
      await this.persistence.readObjectVerifiedUnlocked(
        admission.object,
        operation,
      );
    }
  }

  private async throwAfterRollback(
    error: unknown,
    published: readonly string[],
    operation: string,
    contentId: string | undefined,
  ): Promise<never> {
    const cleanupErrors =
      await this.persistence.rollbackPublishedPaths(published);
    if (cleanupErrors.length > 0) {
      throw new MediaStoreError(
        operation,
        contentId,
        new AggregateError([error, ...cleanupErrors]),
      );
    }
    throw error;
  }

  private validateKnownByteLength(
    knownByteLength: number,
    contentId: string,
  ): void {
    if (!isPositiveSafeInteger(knownByteLength)) {
      throw new MediaStoreError(
        'validate known byte length',
        contentId,
        new Error('Known byte length must be a positive safe integer'),
      );
    }
  }

  private async admitKnownSnapshotUnlocked(
    input: MediaKnownAdmissionInput,
    metadata: MediaStoredObject,
    semanticMetadata: MediaSemanticMetadata,
    providerFileIds: Readonly<Record<string, string>> | undefined,
    bytes: Uint8Array,
  ): Promise<MediaReferenceBlock> {
    if (await this.persistence.objectExistsUnlocked(input.contentId)) {
      await this.persistence.readObjectVerifiedUnlocked(
        metadata,
        'admit deduplicated object',
      );
      return buildIdentityReference(
        metadata,
        semanticMetadata,
        providerFileIds,
      );
    }
    const storedBytes = await this.persistence.measureStoredBytesUnlocked();
    this.persistence.enforceQuota(
      storedBytes,
      input.knownByteLength,
      input.contentId,
    );
    const published = await this.persistence.publishObjectBytes(
      bytes,
      input.contentId,
      'commit object',
    );
    try {
      await this.persistence.readObjectVerifiedUnlocked(
        metadata,
        'verify admitted object',
      );
      return buildIdentityReference(
        metadata,
        semanticMetadata,
        providerFileIds,
      );
    } catch (error) {
      return this.throwAfterRollback(
        error,
        published === undefined ? [] : [published],
        'admit known object and rollback',
        input.contentId,
      );
    }
  }

  private async admitPreparedUnlocked(
    prepared: PreparedAdmission,
  ): Promise<void> {
    const objects = new Map<string, StoredObjectWithBytes>();
    objects.set(prepared.original.contentId, {
      object: prepared.original,
      bytes: prepared.originalBytes,
    });
    objects.set(prepared.selected.contentId, {
      object: prepared.selected,
      bytes: prepared.selectedBytes,
    });
    const missing = await this.findMissingPreparedObjects(objects);
    const additionalBytes = missing.reduce(
      (total, entry) => total + entry.object.byteLength,
      0,
    );
    const storedBytes = await this.persistence.measureStoredBytesUnlocked();
    this.persistence.enforceQuota(
      storedBytes,
      additionalBytes,
      prepared.selected.contentId,
    );
    await this.publishAndVerifyPrepared(prepared, missing);
  }

  private async findMissingPreparedObjects(
    objects: ReadonlyMap<string, StoredObjectWithBytes>,
  ): Promise<readonly StoredObjectWithBytes[]> {
    const missing: StoredObjectWithBytes[] = [];
    for (const entry of objects.values()) {
      if (await this.persistence.objectExistsUnlocked(entry.object.contentId)) {
        await this.persistence.readObjectVerifiedUnlocked(
          entry.object,
          'admit deduplicated object',
        );
      } else {
        missing.push(entry);
      }
    }
    return missing;
  }

  private async publishAndVerifyPrepared(
    prepared: PreparedAdmission,
    missing: readonly StoredObjectWithBytes[],
  ): Promise<void> {
    const published: string[] = [];
    try {
      await this.publishAdmissions(missing, published, 'commit object');
      await this.verifyAdmissions(missing, 'verify admitted object');
    } catch (error) {
      await this.throwAfterRollback(
        error,
        published,
        'admit objects and rollback',
        prepared.selected.contentId,
      );
    }
  }
}
