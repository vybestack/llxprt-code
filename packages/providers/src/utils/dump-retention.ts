/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, readdir, realpath, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
  readonly skipped?: boolean;
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
const ACTIVE_GROUPS = new Map<string, Set<string>>();

async function readManagedGroups(
  directory: string,
  active: ReadonlySet<string>,
): Promise<DumpGroup[]> {
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
  for (const [baseId, files] of groups) {
    if (active.has(baseId) || files.length !== 2) groups.delete(baseId);
  }
  return [...groups].map(([baseId, files]) => ({
    baseId,
    files,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    oldestMtimeMs: Math.min(...files.map((file) => file.mtimeMs)),
  }));
}

async function removeGroup(
  directory: string,
  group: DumpGroup,
): Promise<boolean> {
  for (const file of group.files) {
    if ((await verifiedDirectory(directory)) !== directory) return false;
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
  return true;
}

async function prune(
  directory: string,
  limits: DumpRetentionLimits,
): Promise<DumpRetentionResult> {
  const entries = await readManagedGroups(
    directory,
    ACTIVE_GROUPS.get(directory) ?? new Set(),
  );
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
    if (!(await removeGroup(directory, group)))
      return { managedBytes: 0, removedGroups, skipped: true };
    removedGroups.push(group.baseId);
  }
  let managedBytes = keep.reduce((total, group) => total + group.bytes, 0);
  for (const group of keep) {
    if (managedBytes <= limits.maxBytes) break;
    if (!(await removeGroup(directory, group)))
      return { managedBytes, removedGroups, skipped: true };
    managedBytes -= group.bytes;
    removedGroups.push(group.baseId);
  }
  return { managedBytes, removedGroups };
}

export function markDumpGroupActive(directory: string, baseId: string): void {
  const active = ACTIVE_GROUPS.get(directory) ?? new Set<string>();
  active.add(baseId);
  ACTIVE_GROUPS.set(directory, active);
}

export function markDumpGroupPublished(
  directory: string,
  baseId: string,
): void {
  const active = ACTIVE_GROUPS.get(directory);
  active?.delete(baseId);
  if (active?.size === 0) ACTIVE_GROUPS.delete(directory);
}

async function verifiedDirectory(
  directory: string,
): Promise<string | undefined> {
  const directoryPath = resolve(directory);
  const directoryStat = await lstat(directoryPath);
  if (!directoryStat.isDirectory()) return undefined;
  return realpath(directoryPath);
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
    const verifiedPath = await verifiedDirectory(directory);
    if (verifiedPath === undefined)
      return { managedBytes: 0, removedGroups: [], skipped: true };
    const currentPath = await verifiedDirectory(directory);
    if (currentPath !== verifiedPath)
      return { managedBytes: 0, removedGroups: [], skipped: true };
    return await prune(verifiedPath, limits);
  } finally {
    release();
    if (DIRECTORY_QUEUES.get(directory) === queued)
      DIRECTORY_QUEUES.delete(directory);
  }
}
