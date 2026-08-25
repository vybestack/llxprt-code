/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dirent } from 'node:fs';
import { createReadStream } from 'node:fs';
import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { createGunzip } from 'node:zlib';
import type { IContent } from '../../services/history/IContent.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { collectMediaReferences } from '../../storage/media-reference-lifecycle.js';

const PROJECT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const CONTENT_ID_PATTERN = /"contentId"\s*:\s*"(sha256:[0-9a-f]{64})"/g;
const STALE_MEDIA_TEMP_AGE_MS = 60 * 1000;
const SCAN_CHUNK_BYTES = 64 * 1024;
const MAX_PENDING_MATCH_CHARACTERS = 256;

export interface MediaReclamationLimits {
  readonly maxProjects: number;
  readonly maxFilesPerProject: number;
  readonly maxDirectoriesPerProject: number;
  readonly maxBytesPerFile: number;
  readonly maxBytesPerProject: number;
  readonly maxDecompressedBytesPerFile: number;
}

const DEFAULT_LIMITS: MediaReclamationLimits = {
  maxProjects: 4096,
  maxFilesPerProject: 100_000,
  maxDirectoriesPerProject: 10_000,
  maxBytesPerFile: 256 * 1024 * 1024,
  maxBytesPerProject: 2 * 1024 * 1024 * 1024,
  maxDecompressedBytesPerFile: 256 * 1024 * 1024,
};

interface ProjectScanBudget {
  files: number;
  directories: number;
  bytes: number;
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === code
  );
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid media reclamation limit ${name}`);
  }
  return value;
}

function resolveLimits(
  overrides: Partial<MediaReclamationLimits>,
): MediaReclamationLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  return {
    maxProjects: positiveLimit(limits.maxProjects, 'maxProjects'),
    maxFilesPerProject: positiveLimit(
      limits.maxFilesPerProject,
      'maxFilesPerProject',
    ),
    maxDirectoriesPerProject: positiveLimit(
      limits.maxDirectoriesPerProject,
      'maxDirectoriesPerProject',
    ),
    maxBytesPerFile: positiveLimit(limits.maxBytesPerFile, 'maxBytesPerFile'),
    maxBytesPerProject: positiveLimit(
      limits.maxBytesPerProject,
      'maxBytesPerProject',
    ),
    maxDecompressedBytesPerFile: positiveLimit(
      limits.maxDecompressedBytesPerFile,
      'maxDecompressedBytesPerFile',
    ),
  };
}

function collectSerializedContentIds(
  serialized: string,
  contentIds: Set<string>,
): void {
  for (const match of serialized.matchAll(CONTENT_ID_PATTERN)) {
    contentIds.add(match[1]);
  }
}

async function scanTextStream(
  stream: NodeJS.ReadableStream & AsyncIterable<Buffer | string>,
  contentIds: Set<string>,
  maxBytes: number,
): Promise<void> {
  const decoder = new StringDecoder('utf8');
  let tail = '';
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    bytes += buffer.byteLength;
    if (bytes > maxBytes)
      throw new Error('Decompressed ownership data exceeds limit');
    const text = tail + decoder.write(buffer);
    collectSerializedContentIds(text, contentIds);
    tail = text.slice(-MAX_PENDING_MATCH_CHARACTERS);
  }
  collectSerializedContentIds(tail + decoder.end(), contentIds);
}

async function collectFileContentIds(
  filePath: string,
  contentIds: Set<string>,
  limits: MediaReclamationLimits,
  budget: ProjectScanBudget,
): Promise<void> {
  if (
    !filePath.endsWith('.json') &&
    !filePath.endsWith('.jsonl') &&
    !filePath.endsWith('.gz')
  ) {
    return;
  }
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) return;
  if (
    budget.files >= limits.maxFilesPerProject ||
    fileStat.size > limits.maxBytesPerFile ||
    fileStat.size > limits.maxBytesPerProject - budget.bytes
  ) {
    throw new Error('Ownership data exceeds media reclamation scan limits');
  }
  budget.files += 1;
  budget.bytes += fileStat.size;
  const source = createReadStream(filePath, {
    highWaterMark: SCAN_CHUNK_BYTES,
  });
  if (filePath.endsWith('.gz')) {
    await scanTextStream(
      source.pipe(createGunzip({ chunkSize: SCAN_CHUNK_BYTES })),
      contentIds,
      limits.maxDecompressedBytesPerFile,
    );
    return;
  }
  await scanTextStream(source, contentIds, limits.maxBytesPerFile);
}

async function collectOwnedContentIds(
  directory: string,
  mediaDirectory: string,
  contentIds: Set<string>,
  limits: MediaReclamationLimits,
  budget: ProjectScanBudget,
): Promise<void> {
  if (budget.directories >= limits.maxDirectoriesPerProject) {
    throw new Error('Ownership directory count exceeds scan limit');
  }
  budget.directories += 1;
  let entries: Awaited<ReturnType<typeof opendir>>;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return;
    throw error;
  }
  for await (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entryPath === mediaDirectory) continue;
    if (entry.isDirectory()) {
      await collectOwnedContentIds(
        entryPath,
        mediaDirectory,
        contentIds,
        limits,
        budget,
      );
    } else if (entry.isFile()) {
      await collectFileContentIds(entryPath, contentIds, limits, budget);
    }
  }
}

async function mediaDirectoryExists(mediaDirectory: string): Promise<boolean> {
  try {
    const mediaStat = await lstat(mediaDirectory);
    return mediaStat.isDirectory() && !mediaStat.isSymbolicLink();
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return false;
    throw error;
  }
}

async function reclaimProjectMedia(
  globalTempDirectory: string,
  entry: Dirent,
  activeContentIds: ReadonlySet<string>,
  limits: MediaReclamationLimits,
): Promise<void> {
  if (!entry.isDirectory() || !PROJECT_HASH_PATTERN.test(entry.name)) return;
  const projectDirectory = join(globalTempDirectory, entry.name);
  const mediaDirectory = join(projectDirectory, 'media');
  if (!(await mediaDirectoryExists(mediaDirectory))) return;
  const contentIds = new Set(activeContentIds);
  await collectOwnedContentIds(
    projectDirectory,
    mediaDirectory,
    contentIds,
    limits,
    { files: 0, directories: 0, bytes: 0 },
  );
  const store = new LocalMediaStore({
    rootDirectory: mediaDirectory,
    quotaBytes: Number.MAX_SAFE_INTEGER,
  });
  await store.reclaimUnreferenced(
    contentIds,
    Date.now() - STALE_MEDIA_TEMP_AGE_MS,
  );
}

async function reclaimProjectEntry(
  globalTempDirectory: string,
  entry: Dirent,
  activeContentIds: ReadonlySet<string>,
  limits: MediaReclamationLimits,
): Promise<boolean> {
  try {
    await reclaimProjectMedia(
      globalTempDirectory,
      entry,
      activeContentIds,
      limits,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Reclaim unreferenced project media after bounded sequential ownership scans.
 *
 * @param globalTempDirectory - Root containing project-hash directories.
 * @param activeHistory - In-memory history whose media remains protected.
 * @param limitOverrides - Optional finite scan limits.
 * @returns Number of skipped or corrupt projects.
 */
export async function reclaimSessionMedia(
  globalTempDirectory: string,
  activeHistory: readonly IContent[] | undefined,
  limitOverrides: Partial<MediaReclamationLimits> = {},
): Promise<number> {
  const limits = resolveLimits(limitOverrides);
  const activeContentIds = new Set(
    activeHistory === undefined
      ? []
      : collectMediaReferences(activeHistory).flatMap((reference) => [
          reference.originalContentId,
          reference.selectedContentId,
        ]),
  );
  let entries: Awaited<ReturnType<typeof opendir>>;
  try {
    entries = await opendir(globalTempDirectory);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return 0;
    throw error;
  }
  let projects = 0;
  let errors = 0;
  for await (const entry of entries) {
    if (PROJECT_HASH_PATTERN.test(entry.name)) {
      if (projects >= limits.maxProjects) {
        errors += 1;
      } else {
        projects += 1;
        const reclaimed = await reclaimProjectEntry(
          globalTempDirectory,
          entry,
          activeContentIds,
          limits,
        );
        errors += reclaimed ? 0 : 1;
      }
    }
  }
  return errors;
}
