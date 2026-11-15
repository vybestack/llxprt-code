/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, readdir, realpath, unlink, writeFile } from 'node:fs/promises';
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
  readonly singleton: boolean;
}

const ACTIVE_MARKER_PREFIX = '.llxprt-dump-active-';
const ACTIVE_MARKER_SUFFIX = '.json';

function activeMarkerPath(directory: string, baseId: string): string {
  return join(
    directory,
    `${ACTIVE_MARKER_PREFIX}${encodeURIComponent(baseId)}${ACTIVE_MARKER_SUFFIX}`,
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function readActiveGroups(
  directory: string,
  now: number,
  maxAgeDays: number,
): Promise<Set<string>> {
  const active = new Set<string>();
  const expiration = now - maxAgeDays * 86_400_000;
  const entries = await readdir(directory);
  await Promise.all(
    entries
      .filter(
        (name) =>
          name.startsWith(ACTIVE_MARKER_PREFIX) &&
          name.endsWith(ACTIVE_MARKER_SUFFIX),
      )
      .map(async (name) => {
        let baseId: string;
        try {
          baseId = decodeURIComponent(
            name.slice(
              ACTIVE_MARKER_PREFIX.length,
              -ACTIVE_MARKER_SUFFIX.length,
            ),
          );
        } catch {
          return;
        }
        const path = join(directory, name);
        try {
          const fileStat = await lstat(path);
          if (!fileStat.isFile()) return;
          if (fileStat.mtimeMs < expiration) {
            await unlink(path);
            return;
          }
          active.add(baseId);
        } catch (error) {
          if (isNotFound(error)) return;
          throw error;
        }
      }),
  );
  return active;
}

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
  for (const [baseId] of groups) {
    if (active.has(baseId)) groups.delete(baseId);
  }
  return [...groups].map(([baseId, files]) => ({
    baseId,
    files,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    oldestMtimeMs: Math.min(...files.map((file) => file.mtimeMs)),
    singleton: files.length === 1,
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
  activeInProcess: ReadonlySet<string> = new Set(),
): Promise<DumpRetentionResult> {
  const now = (limits.now ?? new Date()).getTime();
  const active = await readActiveGroups(directory, now, limits.maxAgeDays);
  for (const baseId of activeInProcess) active.add(baseId);
  const entries = await readManagedGroups(directory, active);
  const expiration = now - limits.maxAgeDays * 86_400_000;
  // Another process may still be publishing the other half of a dump pair.
  // Do not treat a singleton as abandoned until it has been quiet for 10 minutes.
  const singletonGraceExpiration = now - 10 * 60_000;
  const ordered = [...entries].sort((left, right) => {
    const ageComparison = left.oldestMtimeMs - right.oldestMtimeMs;
    if (ageComparison !== 0) return ageComparison;
    return left.baseId.localeCompare(right.baseId);
  });
  const isExpired = (group: DumpGroup): boolean =>
    group.oldestMtimeMs < expiration ||
    (group.singleton && group.oldestMtimeMs < singletonGraceExpiration);
  const expired = ordered.filter(isExpired);
  const keep = ordered.filter((group) => !isExpired(group));
  const removedGroups: string[] = [];
  for (const group of expired) {
    if (!(await removeGroup(directory, group)))
      return { managedBytes: 0, removedGroups, skipped: true };
    removedGroups.push(group.baseId);
  }
  let managedBytes = keep.reduce((total, group) => total + group.bytes, 0);
  for (const group of keep) {
    if (managedBytes <= limits.maxBytes) break;
    if (!group.singleton) {
      if (!(await removeGroup(directory, group)))
        return { managedBytes, removedGroups, skipped: true };
      managedBytes -= group.bytes;
      removedGroups.push(group.baseId);
    }
  }
  return { managedBytes, removedGroups };
}

export class DumpRetentionCoordinator {
  private readonly activeGroups = new Map<string, Set<string>>();
  private readonly directoryQueues = new Map<string, Promise<void>>();

  async markActive(directory: string, baseId: string): Promise<void> {
    const path = activeMarkerPath(directory, baseId);
    try {
      await writeFile(path, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const current = await lstat(path);
      if (!current.isFile()) throw error;
    }
    const active = this.activeGroups.get(directory) ?? new Set<string>();
    active.add(baseId);
    this.activeGroups.set(directory, active);
  }

  async markPublished(directory: string, baseId: string): Promise<void> {
    const active = this.activeGroups.get(directory);
    active?.delete(baseId);
    if (active?.size === 0) this.activeGroups.delete(directory);
    const path = activeMarkerPath(directory, baseId);
    try {
      const current = await lstat(path);
      if (current.isFile()) await unlink(path);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async prune(
    directory: string,
    limits: DumpRetentionLimits,
  ): Promise<DumpRetentionResult> {
    const previous = this.directoryQueues.get(directory) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolveCurrent) => {
      release = resolveCurrent;
    });
    const queued = previous.then(() => current);
    this.directoryQueues.set(directory, queued);
    await previous;
    try {
      const verifiedPath = await verifiedDirectory(directory);
      if (verifiedPath === undefined)
        return { managedBytes: 0, removedGroups: [], skipped: true };
      if ((await verifiedDirectory(directory)) !== verifiedPath)
        return { managedBytes: 0, removedGroups: [], skipped: true };
      return await prune(
        verifiedPath,
        limits,
        this.activeGroups.get(directory),
      );
    } finally {
      release();
      if (this.directoryQueues.get(directory) === queued)
        this.directoryQueues.delete(directory);
    }
  }
}

export async function markDumpGroupActive(
  directory: string,
  baseId: string,
  coordinator = new DumpRetentionCoordinator(),
): Promise<void> {
  await coordinator.markActive(directory, baseId);
}

export async function markDumpGroupPublished(
  directory: string,
  baseId: string,
  coordinator = new DumpRetentionCoordinator(),
): Promise<void> {
  await coordinator.markPublished(directory, baseId);
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
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
  coordinator = new DumpRetentionCoordinator(),
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
  return coordinator.prune(directory, limits);
}
