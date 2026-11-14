/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_DUMP_RETENTION = {
  maxBytes: 2_147_483_648,
  maxAgeDays: 14,
} as const;

export interface DumpRetentionLimits {
  readonly maxBytes: number;
  readonly maxAgeDays: number;
  readonly now?: Date;
}

export interface DumpRetentionResult {
  readonly managedBytes: number;
  readonly removedGroups: readonly string[];
}

interface DumpGroup {
  readonly baseId: string;
  readonly files: ReadonlyArray<{
    path: string;
    bytes: number;
    mtimeMs: number;
  }>;
  readonly bytes: number;
  readonly oldestMtimeMs: number;
}

const DIRECTORY_QUEUES = new Map<string, Promise<void>>();

async function readManagedGroups(directory: string): Promise<DumpGroup[]> {
  const entries = await readdir(directory);
  const groups = new Map<string, Array<DumpGroup['files'][number]>>();
  for (const name of entries) {
    const match = /^.*-(?:request|response)\.json$/.exec(name);
    if (match === null) continue;
    const baseId = match[0].slice(0, match[0].lastIndexOf('-'));
    const path = join(directory, name);
    const fileStat = await lstat(path);
    if (fileStat.isFile()) {
      const files = groups.get(baseId) ?? [];
      files.push({ path, bytes: fileStat.size, mtimeMs: fileStat.mtimeMs });
      groups.set(baseId, files);
    }
  }
  return [...groups].map(([baseId, files]) => ({
    baseId,
    files,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    oldestMtimeMs: Math.min(...files.map((file) => file.mtimeMs)),
  }));
}

async function removeGroup(group: DumpGroup): Promise<void> {
  for (const file of group.files) {
    try {
      const current = await lstat(file.path);
      if (current.isFile()) await unlink(file.path);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        continue;
      throw error;
    }
  }
}

async function prune(
  directory: string,
  limits: DumpRetentionLimits,
): Promise<DumpRetentionResult> {
  const entries = await readManagedGroups(directory);
  const now = (limits.now ?? new Date()).getTime();
  const expiration = now - limits.maxAgeDays * 86_400_000;
  const ordered = [...entries].sort((left, right) => {
    const ageComparison = left.oldestMtimeMs - right.oldestMtimeMs;
    if (ageComparison !== 0) return ageComparison;
    return left.baseId.localeCompare(right.baseId);
  });
  const expired = ordered.filter((group) => group.oldestMtimeMs < expiration);
  const keep = ordered.filter((group) => group.oldestMtimeMs >= expiration);
  const removedGroups: string[] = [];
  for (const group of expired) {
    await removeGroup(group);
    removedGroups.push(group.baseId);
  }
  let managedBytes = keep.reduce((total, group) => total + group.bytes, 0);
  for (const group of keep) {
    if (managedBytes <= limits.maxBytes) break;
    await removeGroup(group);
    managedBytes -= group.bytes;
    removedGroups.push(group.baseId);
  }
  return { managedBytes, removedGroups };
}

/** Prunes whole request/response groups; filesystem races are left to the caller's best-effort boundary. */
export async function pruneDumpDirectory(
  directory: string,
  limits: DumpRetentionLimits,
): Promise<DumpRetentionResult> {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0) {
    throw new RangeError(
      'Dump retention maxBytes must be a positive safe integer',
    );
  }
  if (!Number.isFinite(limits.maxAgeDays) || limits.maxAgeDays <= 0) {
    throw new RangeError(
      'Dump retention maxAgeDays must be positive and finite',
    );
  }
  const previous = DIRECTORY_QUEUES.get(directory) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  DIRECTORY_QUEUES.set(directory, queued);
  await previous;
  try {
    await stat(directory);
    return await prune(directory, limits);
  } finally {
    release();
    if (DIRECTORY_QUEUES.get(directory) === queued)
      DIRECTORY_QUEUES.delete(directory);
  }
}
