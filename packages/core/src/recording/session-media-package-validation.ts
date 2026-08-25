/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Stats } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isMediaReferenceBlock,
  type IContent,
  type MediaReferenceBlock,
  type MediaStoredObject,
} from '../services/history/IContent.js';

export const PACKAGE_VERSION = 2;
const SUPPORTED_RECORDING_VERSIONS = new Set([1, 2]);
export const SUPPORTED_PERSISTED_SESSION_VERSION = 1;
export const RECORDING_FILE = 'session.jsonl';
export const MANIFEST_FILE = 'manifest.json';
const CONTENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MIME_TYPE_PATTERN =
  /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+\/[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
export const PERSISTED_SESSION_PREFIX = 'persisted-session-';
export const HASH_CHUNK_BYTES = 64 * 1024;
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const MAX_RECORDING_BYTES = 256 * 1024 * 1024;
export const MAX_PERSISTED_STATES = 256;
export const MAX_PERSISTED_STATE_BYTES = 64 * 1024 * 1024;
export const MAX_PERSISTED_STATE_AGGREGATE_BYTES = 256 * 1024 * 1024;
const MAX_REFERENCES = 10_000;
const MAX_OBJECTS = 20_000;
export const MAX_OBJECT_BYTES = 256 * 1024 * 1024;
export const MAX_OBJECT_AGGREGATE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_HISTORY_CONTENTS = 100_000;

export interface PackagedPersistedState {
  readonly file: string;
  readonly version: number;
}

export interface MediaPackageManifest {
  readonly version: number;
  readonly recording: string;
  readonly persistedStates: readonly PackagedPersistedState[];
  readonly references: readonly MediaReferenceBlock[];
  readonly objects: readonly MediaStoredObject[];
}

export interface VerifiedPackageBlob {
  readonly object: MediaStoredObject;
  readonly sourcePath: string;
}

export interface PortableRecording {
  readonly bytes: Uint8Array;
  readonly sessionId: string;
  readonly histories: readonly IContent[][];
}

export interface PortablePersistedState {
  readonly file: string;
  readonly serialized: string;
  readonly history: readonly IContent[];
}

export function packageBlobPath(root: string, contentId: string): string {
  return join(root, 'blobs', 'sha256', contentId.slice('sha256:'.length));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ENOENT') return false;
    throw error;
  }
}

export async function boundedFileSize(
  path: string,
  maxBytes: number,
  label: string,
): Promise<number> {
  const fileStat = await stat(path);
  if (!fileStat.isFile() || fileStat.size > maxBytes) {
    throw new Error(`${label} exceeds finite byte limit`);
  }
  return fileStat.size;
}

function boundedReadChanged(
  before: Stats,
  after: Stats,
  current: Stats,
  total: number,
): boolean {
  if (before.dev !== after.dev || before.ino !== after.ino) return true;
  if (before.size !== total || after.size !== total) return true;
  if (before.mtimeMs !== after.mtimeMs) return true;
  if (before.ctimeMs !== after.ctimeMs) return true;
  return current.dev !== after.dev || current.ino !== after.ino;
}

export async function readBoundedFile(
  path: string,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const handle = await open(path, 'r');
  const chunks: Buffer[] = [];
  let total = 0;
  let result: Buffer | undefined;
  let failure: unknown;
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) {
      throw new Error(`${label} exceeds finite byte limit`);
    }
    while (total <= maxBytes) {
      const remaining = maxBytes + 1 - total;
      const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, remaining));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    const [after, current] = await Promise.all([handle.stat(), stat(path)]);
    if (total > maxBytes) {
      throw new Error(`${label} exceeds finite byte limit`);
    }
    if (boundedReadChanged(before, after, current, total)) {
      throw new Error(`${label} changed during bounded read`);
    }
    result = Buffer.concat(chunks, total);
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (closeError) {
    failure =
      failure === undefined
        ? closeError
        : new AggregateError(
            [failure, closeError],
            `${label} read and file close failed`,
          );
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) throw new Error(`${label} bounded read failed`);
  return result;
}

export function boundedAggregate(
  values: readonly number[],
  maxBytes: number,
  label: string,
): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maxBytes - total) {
      throw new Error(`${label} exceeds finite aggregate byte limit`);
    }
    total += value;
  }
  return total;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isDimensions(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isPositiveInteger(value['width']) &&
    isPositiveInteger(value['height'])
  );
}

function isStoredObject(value: unknown): value is MediaStoredObject {
  if (!isRecord(value)) return false;
  const contentId = value['contentId'];
  if (typeof contentId !== 'string' || !CONTENT_ID_PATTERN.test(contentId)) {
    return false;
  }
  const mimeType = value['mimeType'];
  if (typeof mimeType !== 'string' || !MIME_TYPE_PATTERN.test(mimeType)) {
    return false;
  }
  const byteLength = value['byteLength'];
  if (!isPositiveInteger(byteLength)) return false;
  if (value['normalizedBase64Length'] !== Math.ceil(byteLength / 3) * 4) {
    return false;
  }
  return value['dimensions'] === undefined || isDimensions(value['dimensions']);
}

function isPackagedPersistedState(
  value: unknown,
): value is PackagedPersistedState {
  return (
    isRecord(value) &&
    typeof value['file'] === 'string' &&
    /^state\/persisted-[0-9]+\.json$/.test(value['file']) &&
    value['version'] === SUPPORTED_PERSISTED_SESSION_VERSION
  );
}

export function parseManifest(serialized: string): MediaPackageManifest {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) {
    throw new Error('Invalid session media package manifest');
  }
  if (parsed['version'] !== PACKAGE_VERSION) {
    throw new Error(
      `Unsupported session media package version ${String(parsed['version'])}`,
    );
  }
  if (parsed['recording'] !== RECORDING_FILE) {
    throw new Error('Invalid session media package manifest');
  }
  const references = parsed['references'];
  const objects = parsed['objects'];
  const persistedStates = parsed['persistedStates'];
  if (!Array.isArray(references) || !references.every(isMediaReferenceBlock)) {
    throw new Error('Invalid session media package manifest');
  }
  if (!Array.isArray(objects) || !objects.every(isStoredObject)) {
    throw new Error('Invalid session media package manifest');
  }
  if (
    !Array.isArray(persistedStates) ||
    !persistedStates.every(isPackagedPersistedState)
  ) {
    throw new Error('Invalid session media package manifest');
  }
  if (references.length > MAX_REFERENCES) {
    throw new Error('Session media package reference count exceeds limit');
  }
  if (objects.length > MAX_OBJECTS) {
    throw new Error('Session media package object count exceeds limit');
  }
  if (persistedStates.length > MAX_PERSISTED_STATES) {
    throw new Error(
      'Session media package persisted state count exceeds limit',
    );
  }
  return {
    version: PACKAGE_VERSION,
    recording: RECORDING_FILE,
    persistedStates,
    references,
    objects,
  };
}

function hasSameDimensions(
  first: MediaStoredObject['dimensions'],
  second: MediaStoredObject['dimensions'],
): boolean {
  if (first === undefined || second === undefined) return first === second;
  return first.width === second.width && first.height === second.height;
}

export function hasSameObjectMetadata(
  first: MediaStoredObject,
  second: MediaStoredObject,
): boolean {
  return (
    first.mimeType === second.mimeType &&
    first.byteLength === second.byteLength &&
    first.normalizedBase64Length === second.normalizedBase64Length &&
    hasSameDimensions(first.dimensions, second.dimensions)
  );
}

export function uniqueReferences(
  references: readonly MediaReferenceBlock[],
): readonly MediaReferenceBlock[] {
  const byContentId = new Map<string, MediaReferenceBlock>();
  for (const reference of references) {
    const existing = byContentId.get(reference.contentId);
    if (
      existing !== undefined &&
      (existing.byteLength !== reference.byteLength ||
        existing.mimeType !== reference.mimeType ||
        existing.originalContentId !== reference.originalContentId)
    ) {
      throw new Error(
        `Conflicting media reference metadata [contentId=${reference.contentId}]`,
      );
    }
    byContentId.set(reference.contentId, reference);
  }
  return [...byContentId.values()];
}

export function requiredObjects(
  references: readonly MediaReferenceBlock[],
): readonly MediaStoredObject[] {
  const byContentId = new Map<string, MediaStoredObject>();
  for (const reference of references) {
    for (const object of [reference.originalObject, reference.selectedObject]) {
      const existing = byContentId.get(object.contentId);
      if (existing !== undefined && !hasSameObjectMetadata(existing, object)) {
        throw new Error(
          `Conflicting media object metadata [contentId=${object.contentId}]`,
        );
      }
      byContentId.set(object.contentId, object);
    }
  }
  return [...byContentId.values()];
}

export function verifyManifestObjectSet(
  expected: readonly MediaStoredObject[],
  packaged: readonly MediaStoredObject[],
): void {
  const packagedById = new Map<string, MediaStoredObject>();
  for (const object of packaged) {
    if (packagedById.has(object.contentId)) {
      throw new Error(
        `Session media package contains duplicate object [contentId=${object.contentId}]`,
      );
    }
    packagedById.set(object.contentId, object);
  }
  if (packagedById.size !== expected.length) {
    throw new Error('Session media package object set is incomplete');
  }
  for (const object of expected) {
    const packagedObject = packagedById.get(object.contentId);
    if (
      packagedObject === undefined ||
      !hasSameObjectMetadata(packagedObject, object)
    ) {
      throw new Error(
        `Session media package object metadata is invalid [contentId=${object.contentId}]`,
      );
    }
  }
}

function isContentSpeaker(value: unknown): boolean {
  return value === 'human' || value === 'ai' || value === 'tool';
}

export function isContent(value: unknown): value is IContent {
  return (
    isRecord(value) &&
    isContentSpeaker(value['speaker']) &&
    Array.isArray(value['blocks'])
  );
}

export function requireRecordingLine(value: unknown, lineNumber: number) {
  if (!isRecord(value)) {
    throw new Error(`Invalid recording line ${lineNumber}`);
  }
  const version = value['v'];
  if (
    typeof version !== 'number' ||
    !SUPPORTED_RECORDING_VERSIONS.has(version)
  ) {
    throw new Error(
      `Unsupported recording version ${String(version)} at line ${lineNumber}`,
    );
  }
  if (
    !Number.isSafeInteger(value['seq']) ||
    typeof value['type'] !== 'string' ||
    !isRecord(value['payload'])
  ) {
    throw new Error(`Invalid recording line ${lineNumber}`);
  }
  return value;
}

export function requirePortableMediaContent(content: IContent): IContent {
  for (const block of content.blocks) {
    if (
      block.type === 'media' &&
      block.encoding !== 'reference' &&
      block.encoding !== 'url'
    ) {
      throw new Error('Packaged recording contains raw JSON media');
    }
  }
  return content;
}
