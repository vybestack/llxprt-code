/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  MediaDimensions,
  MediaSemanticMetadata,
  MediaStoredObject,
  MediaTransformation,
} from '../services/history/IContent.js';

export class MediaStoreError extends Error {
  readonly operation: string;
  readonly contentId: string | undefined;

  constructor(
    operation: string,
    contentId: string | undefined,
    cause?: unknown,
  ) {
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    super(
      `Media store ${operation} failed [contentId=${contentId ?? 'unavailable'}]${detail}`,
      { cause },
    );
    this.name = 'MediaStoreError';
    this.operation = operation;
    this.contentId = contentId;
  }
}

export class MediaObjectMissingError extends MediaStoreError {
  constructor(operation: string, contentId: string, cause?: unknown) {
    super(operation, contentId, cause);
    this.name = 'MediaObjectMissingError';
  }
}

export class MediaObjectCorruptError extends MediaStoreError {
  constructor(
    operation: string,
    contentId: string | undefined,
    cause?: unknown,
  ) {
    super(operation, contentId, cause);
    this.name = 'MediaObjectCorruptError';
  }
}

export class MediaObjectHashMismatchError extends MediaStoreError {
  constructor(operation: string, contentId: string) {
    super(operation, contentId);
    this.name = 'MediaObjectHashMismatchError';
  }
}

export interface LocalMediaStoreFileOperations {
  link(sourcePath: string, destinationPath: string): Promise<void>;
  rename?(sourcePath: string, destinationPath: string): Promise<void>;
  syncDirectory?(path: string): Promise<void>;
  inspectReclamationCandidate?(path: string): Promise<void>;
}

export interface LocalMediaStoreOptions {
  readonly rootDirectory: string;
  readonly quotaBytes: number;
  readonly fileOperations?: LocalMediaStoreFileOperations;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
  readonly reservationLeaseMs?: number;
  readonly quotaScanMaxEntries?: number;
}

export interface MediaReclamationResult {
  readonly objectsRemoved: number;
  readonly temporaryFilesRemoved: number;
}

export interface MediaObjectAdmissionInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly dimensions?: MediaDimensions;
}

export interface MediaTransformationInput {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly parameters?: MediaSemanticMetadata;
}

export interface MediaAdmissionInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly knownByteLength?: number;
  readonly dimensions?: MediaDimensions;
  readonly original?: MediaObjectAdmissionInput;
  readonly transformation?: MediaTransformationInput;
  readonly semanticMetadata: MediaSemanticMetadata;
  readonly providerFileIds?: Readonly<Record<string, string>>;
}

export interface MediaKnownAdmissionInput {
  readonly contentId: string;
  readonly knownByteLength: number;
  readonly mimeType: string;
  readonly dimensions?: MediaDimensions;
  readonly semanticMetadata: MediaSemanticMetadata;
  readonly providerFileIds?: Readonly<Record<string, string>>;
}

export interface MediaStoredObjectAdmission {
  readonly object: MediaStoredObject;
  readonly bytes: Uint8Array;
}

export interface MediaStoredObjectFileAdmission {
  readonly object: MediaStoredObject;
  readonly sourcePath: string;
}

export interface StagedMediaObjectAdmission {
  readonly createdContentIds: readonly string[];
  commit(): void;
  rollback(): Promise<void>;
}

export interface PublishedMediaObjectPath {
  readonly contentId: string;
  readonly path: string;
}

export interface StoreLockOwner {
  readonly version: number;
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: number;
}

export interface ReservationRecord {
  readonly version: number;
  readonly ownerDigest: string;
  readonly instanceId: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly relatedContentIds: readonly string[];
}

export interface PreparedAdmission {
  readonly selected: MediaStoredObject;
  readonly selectedBytes: Uint8Array;
  readonly original: MediaStoredObject;
  readonly originalBytes: Uint8Array;
  readonly transformation: MediaTransformation;
  readonly semanticMetadata: MediaSemanticMetadata;
  readonly providerFileIds?: Readonly<Record<string, string>>;
}
