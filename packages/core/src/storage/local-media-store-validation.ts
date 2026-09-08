/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type {
  MediaDimensions,
  MediaReferenceBlock,
  MediaSemanticMetadata,
  MediaSemanticMetadataValue,
  MediaStoredObject,
  MediaTransformation,
} from '../services/history/IContent.js';
import {
  MediaObjectCorruptError,
  MediaStoreError,
  type MediaAdmissionInput,
  type MediaTransformationInput,
  type PreparedAdmission,
  type ReservationRecord,
  type StoreLockOwner,
} from './local-media-store-types.js';

export const CONTENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const MIME_TYPE_PATTERN =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
export const CONTENT_ID_PREFIX = 'sha256:';
export const RESERVATION_VERSION = 1;
export const LOCK_VERSION = 1;

export function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === code
  );
}

export function contentIdFor(bytes: Uint8Array): string {
  return `${CONTENT_ID_PREFIX}${createHash('sha256').update(bytes).digest('hex')}`;
}

export function digestFor(contentId: string): string {
  return contentId.slice(CONTENT_ID_PREFIX.length);
}

export function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validDimensions(value: unknown): value is MediaDimensions {
  if (!isPlainRecord(value) || Object.keys(value).length !== 2) return false;
  const width = value['width'];
  const height = value['height'];
  if (typeof width !== 'number' || typeof height !== 'number') return false;
  return isPositiveSafeInteger(width) && isPositiveSafeInteger(height);
}

const MAX_SEMANTIC_METADATA_DEPTH = 64;

function semanticChildPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function cloneSemanticValue(
  value: unknown,
  ancestors: Set<object>,
  depth: number,
  location: string,
): MediaSemanticMetadataValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('numbers must be finite');
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error('values must be JSON-compatible');
  }
  if (depth > MAX_SEMANTIC_METADATA_DEPTH) {
    throw new Error(
      `${location} exceeds maximum depth ${MAX_SEMANTIC_METADATA_DEPTH}`,
    );
  }
  if (ancestors.has(value)) throw new Error('cycles are not allowed');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((entry, index) =>
          cloneSemanticValue(
            entry,
            ancestors,
            depth + 1,
            `${location}[${index}]`,
          ),
        ),
      );
    }
    if (!isPlainRecord(value)) {
      throw new Error('objects must have a plain prototype');
    }
    const cloned: Record<string, MediaSemanticMetadataValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key.length === 0) throw new Error('keys must not be empty');
      cloned[key] = cloneSemanticValue(
        entry,
        ancestors,
        depth + 1,
        semanticChildPath(location, key),
      );
    }
    return Object.freeze(cloned);
  } finally {
    ancestors.delete(value);
  }
}

function cloneSemanticMetadata(value: unknown): MediaSemanticMetadata {
  if (!isPlainRecord(value)) {
    throw new Error('metadata must be a plain object');
  }
  const cloned = cloneSemanticValue(
    value,
    new Set<object>(),
    0,
    'semanticMetadata',
  );
  if (!isPlainRecord(cloned)) throw new Error('metadata must be an object');
  return cloned;
}

function cloneProviderFileIds(
  value: unknown,
): Readonly<Record<string, string>> {
  if (!isPlainRecord(value)) {
    throw new Error('provider file IDs must be a plain object');
  }
  const cloned: Record<string, string> = {};
  for (const [provider, fileId] of Object.entries(value)) {
    if (
      provider.length === 0 ||
      typeof fileId !== 'string' ||
      fileId.length === 0
    ) {
      throw new Error('provider names and file IDs must not be empty');
    }
    cloned[provider] = fileId;
  }
  return Object.freeze(cloned);
}

export function validateContentId(contentId: string, operation: string): void {
  if (!CONTENT_ID_PATTERN.test(contentId)) {
    throw new MediaStoreError(
      operation,
      contentId,
      new Error('Invalid content ID'),
    );
  }
}

export function validatePositiveDuration(value: number, name: string): void {
  if (!isPositiveSafeInteger(value)) {
    throw new MediaStoreError(
      'initialize',
      undefined,
      new Error(`${name} must be a positive safe integer`),
    );
  }
}

export function wrapError(
  operation: string,
  contentId: string | undefined,
  error: unknown,
): MediaStoreError {
  if (error instanceof MediaStoreError) return error;
  return new MediaStoreError(operation, contentId, error);
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrnoCode(error, 'ESRCH');
  }
}

function hasValidLockOwnerFields(value: Record<string, unknown>): boolean {
  if (value['version'] !== LOCK_VERSION) return false;
  if (typeof value['token'] !== 'string' || value['token'].length === 0) {
    return false;
  }
  if (typeof value['pid'] !== 'number') return false;
  if (!isPositiveSafeInteger(value['pid'])) return false;
  if (typeof value['hostname'] !== 'string') return false;
  if (value['hostname'].length === 0) return false;
  if (typeof value['createdAt'] !== 'number') return false;
  return isNonNegativeSafeInteger(value['createdAt']);
}

export function parseStoreLockOwner(
  value: unknown,
): StoreLockOwner | undefined {
  if (!isPlainRecord(value) || !hasValidLockOwnerFields(value))
    return undefined;
  const token = value['token'];
  const pid = value['pid'];
  const ownerHostname = value['hostname'];
  const createdAt = value['createdAt'];
  if (
    typeof token !== 'string' ||
    typeof pid !== 'number' ||
    typeof ownerHostname !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return undefined;
  }
  return {
    version: LOCK_VERSION,
    token,
    pid,
    hostname: ownerHostname,
    createdAt,
  };
}

function hasValidReservationIdentity(value: Record<string, unknown>): boolean {
  if (value['version'] !== RESERVATION_VERSION) return false;
  if (typeof value['ownerDigest'] !== 'string') return false;
  if (!DIGEST_PATTERN.test(value['ownerDigest'])) return false;
  if (typeof value['instanceId'] !== 'string') return false;
  if (value['instanceId'].length === 0) return false;
  if (typeof value['pid'] !== 'number') return false;
  if (!isPositiveSafeInteger(value['pid'])) return false;
  if (typeof value['hostname'] !== 'string') return false;
  return value['hostname'].length > 0;
}

function hasValidReservationTimes(value: Record<string, unknown>): boolean {
  if (typeof value['createdAt'] !== 'number') return false;
  if (!isNonNegativeSafeInteger(value['createdAt'])) return false;
  if (typeof value['expiresAt'] !== 'number') return false;
  return isNonNegativeSafeInteger(value['expiresAt']);
}

function validRelatedContentIds(value: unknown): value is string[] {
  if (!isUnknownArray(value) || value.length === 0) return false;
  return value.every(
    (contentId) =>
      typeof contentId === 'string' && CONTENT_ID_PATTERN.test(contentId),
  );
}

export function parseReservationRecord(
  value: unknown,
): ReservationRecord | undefined {
  if (!isPlainRecord(value)) return undefined;
  if (!hasValidReservationIdentity(value)) return undefined;
  if (!hasValidReservationTimes(value)) return undefined;
  const relatedContentIds = value['relatedContentIds'];
  if (!validRelatedContentIds(relatedContentIds)) return undefined;
  return buildReservationRecord(value, relatedContentIds);
}

function buildReservationRecord(
  value: Record<string, unknown>,
  relatedContentIds: readonly string[],
): ReservationRecord | undefined {
  const ownerDigest = value['ownerDigest'];
  if (typeof ownerDigest !== 'string') return undefined;
  const instanceId = value['instanceId'];
  if (typeof instanceId !== 'string') return undefined;
  const pid = value['pid'];
  if (typeof pid !== 'number') return undefined;
  const ownerHostname = value['hostname'];
  if (typeof ownerHostname !== 'string') return undefined;
  const createdAt = value['createdAt'];
  if (typeof createdAt !== 'number') return undefined;
  const expiresAt = value['expiresAt'];
  if (typeof expiresAt !== 'number') return undefined;
  return {
    version: RESERVATION_VERSION,
    ownerDigest,
    instanceId,
    pid,
    hostname: ownerHostname,
    createdAt,
    expiresAt,
    relatedContentIds,
  };
}

export function validateStoredObjectMetadata(
  object: MediaStoredObject,
  operation: string,
): void {
  validateContentId(object.contentId, operation);
  if (!MIME_TYPE_PATTERN.test(object.mimeType)) {
    throwMalformedStoredObject(object, operation);
  }
  if (!isPositiveSafeInteger(object.byteLength)) {
    throwMalformedStoredObject(object, operation);
  }
  if (object.normalizedBase64Length !== Math.ceil(object.byteLength / 3) * 4) {
    throwMalformedStoredObject(object, operation);
  }
  if (object.dimensions !== undefined && !validDimensions(object.dimensions)) {
    throwMalformedStoredObject(object, operation);
  }
}

function throwMalformedStoredObject(
  object: MediaStoredObject,
  operation: string,
): never {
  throw new MediaObjectCorruptError(
    operation,
    object.contentId,
    new Error('Malformed stored object metadata'),
  );
}

export function buildStoredObject(
  contentId: string,
  mimeType: string,
  byteLength: number,
  dimensionsValue: unknown,
): MediaStoredObject {
  validateContentId(contentId, 'validate stored object');
  if (!MIME_TYPE_PATTERN.test(mimeType)) {
    throw new MediaStoreError(
      'validate MIME type',
      contentId,
      new Error('Invalid MIME type'),
    );
  }
  if (!isPositiveSafeInteger(byteLength)) {
    throw new MediaStoreError(
      'validate byte length',
      contentId,
      new Error('Byte length must be a positive safe integer'),
    );
  }
  const dimensions = validatedDimensions(dimensionsValue, contentId);
  return Object.freeze({
    contentId,
    mimeType,
    byteLength,
    normalizedBase64Length: Math.ceil(byteLength / 3) * 4,
    ...(dimensions === undefined ? {} : { dimensions }),
  });
}

function validatedDimensions(
  value: unknown,
  contentId: string,
): MediaDimensions | undefined {
  if (value === undefined) return undefined;
  if (!validDimensions(value)) {
    throw new MediaStoreError(
      'validate dimensions',
      contentId,
      new Error('Malformed dimensions'),
    );
  }
  return Object.freeze({ width: value.width, height: value.height });
}

export function validatedSemanticMetadata(
  value: unknown,
  contentId: string,
): MediaSemanticMetadata {
  try {
    return cloneSemanticMetadata(value);
  } catch (error) {
    throw new MediaStoreError('validate semantic metadata', contentId, error);
  }
}

export function validatedProviderFileIds(
  value: unknown,
  contentId: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  try {
    return cloneProviderFileIds(value);
  } catch (error) {
    throw new MediaStoreError('validate provider file IDs', contentId, error);
  }
}

function validatedTransformation(
  value: MediaTransformationInput | undefined,
  identity: boolean,
  contentId: string,
): MediaTransformation {
  if (value === undefined) return identityTransformation(identity, contentId);
  if (
    value.policyId.length === 0 ||
    !isPositiveSafeInteger(value.policyVersion)
  ) {
    throw new MediaStoreError(
      'validate transformation',
      contentId,
      new Error('Invalid transformation policy identity'),
    );
  }
  return Object.freeze({
    policyId: value.policyId,
    policyVersion: value.policyVersion,
    parameters: validatedSemanticMetadata(value.parameters ?? {}, contentId),
  });
}

function identityTransformation(
  identity: boolean,
  contentId: string,
): MediaTransformation {
  if (!identity) {
    throw new MediaStoreError(
      'validate transformation',
      contentId,
      new Error('Derived media requires transformation policy identity'),
    );
  }
  return Object.freeze({
    policyId: 'identity',
    policyVersion: 1,
    parameters: Object.freeze({}),
  });
}

export function prepareAdmission(
  input: MediaAdmissionInput,
  selectedBytes: Uint8Array,
  originalBytes: Uint8Array,
): PreparedAdmission {
  if (selectedBytes.byteLength === 0 || originalBytes.byteLength === 0) {
    throw new MediaStoreError(
      'admit empty bytes',
      undefined,
      new Error('Media bytes must not be empty'),
    );
  }
  const selectedContentId = contentIdFor(selectedBytes);
  validateKnownByteLength(input, selectedBytes, selectedContentId);
  const selected = buildStoredObject(
    selectedContentId,
    input.mimeType,
    selectedBytes.byteLength,
    input.dimensions,
  );
  const original = buildStoredObject(
    contentIdFor(originalBytes),
    input.original?.mimeType ?? input.mimeType,
    originalBytes.byteLength,
    input.original?.dimensions ?? input.dimensions,
  );
  const providerFileIds = validatedProviderFileIds(
    input.providerFileIds,
    selectedContentId,
  );
  return {
    selected,
    selectedBytes,
    original,
    originalBytes,
    transformation: validatedTransformation(
      input.transformation,
      original.contentId === selected.contentId,
      selectedContentId,
    ),
    semanticMetadata: validatedSemanticMetadata(
      input.semanticMetadata,
      selectedContentId,
    ),
    ...(providerFileIds === undefined ? {} : { providerFileIds }),
  };
}

function validateKnownByteLength(
  input: MediaAdmissionInput,
  selectedBytes: Uint8Array,
  contentId: string,
): void {
  if (input.knownByteLength === undefined) return;
  if (
    isPositiveSafeInteger(input.knownByteLength) &&
    input.knownByteLength === selectedBytes.byteLength
  ) {
    return;
  }
  throw new MediaStoreError(
    'validate known byte length',
    contentId,
    new Error('Known byte length is inconsistent with actual bytes'),
  );
}

export function buildReference(
  prepared: PreparedAdmission,
): MediaReferenceBlock {
  return Object.freeze({
    type: 'media',
    encoding: 'reference',
    mimeType: prepared.selected.mimeType,
    contentId: prepared.selected.contentId,
    originalContentId: prepared.original.contentId,
    selectedContentId: prepared.selected.contentId,
    originalObject: prepared.original,
    selectedObject: prepared.selected,
    transformation: prepared.transformation,
    byteLength: prepared.selected.byteLength,
    normalizedBase64Length: prepared.selected.normalizedBase64Length,
    ...(prepared.selected.dimensions === undefined
      ? {}
      : { dimensions: prepared.selected.dimensions }),
    semanticMetadata: prepared.semanticMetadata,
    ...(prepared.providerFileIds === undefined
      ? {}
      : { providerFileIds: prepared.providerFileIds }),
  });
}

export function buildIdentityReference(
  object: MediaStoredObject,
  semanticMetadata: MediaSemanticMetadata,
  providerFileIds: Readonly<Record<string, string>> | undefined,
): MediaReferenceBlock {
  return Object.freeze({
    type: 'media',
    encoding: 'reference',
    mimeType: object.mimeType,
    contentId: object.contentId,
    originalContentId: object.contentId,
    selectedContentId: object.contentId,
    originalObject: object,
    selectedObject: object,
    transformation: identityTransformation(true, object.contentId),
    byteLength: object.byteLength,
    normalizedBase64Length: object.normalizedBase64Length,
    ...(object.dimensions === undefined
      ? {}
      : { dimensions: object.dimensions }),
    semanticMetadata,
    ...(providerFileIds === undefined ? {} : { providerFileIds }),
  });
}

export function uniqueStoredObjects(
  objects: readonly MediaStoredObject[],
): ReadonlyMap<string, MediaStoredObject> {
  const unique = new Map<string, MediaStoredObject>();
  for (const object of objects) {
    validateStoredObjectMetadata(object, 'validate object batch');
    const existing = unique.get(object.contentId);
    const dimensionsDiffer =
      existing?.dimensions?.width !== object.dimensions?.width ||
      existing?.dimensions?.height !== object.dimensions?.height;
    if (
      existing !== undefined &&
      (existing.mimeType !== object.mimeType ||
        existing.byteLength !== object.byteLength ||
        dimensionsDiffer)
    ) {
      throw new MediaStoreError(
        'validate object batch',
        object.contentId,
        new Error('Conflicting stored object metadata'),
      );
    }
    unique.set(object.contentId, object);
  }
  return unique;
}

export function requiredObjects(
  reference: MediaReferenceBlock,
): readonly MediaStoredObject[] {
  if (
    reference.originalObject.contentId === reference.selectedObject.contentId
  ) {
    return [reference.selectedObject];
  }
  return [reference.originalObject, reference.selectedObject];
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function validateOwnerId(
  ownerId: string,
  contentId: string,
  operation: string,
): void {
  if (
    ownerId.length === 0 ||
    ownerId.length > 512 ||
    containsControlCharacter(ownerId)
  ) {
    throw new MediaStoreError(
      operation,
      contentId,
      new Error(
        'Owner ID must contain between 1 and 512 non-control characters',
      ),
    );
  }
}
