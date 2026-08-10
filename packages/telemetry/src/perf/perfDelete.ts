/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Perf directory deletion with live-writer safety (P11, REQ-3167-8, D3).
 *
 * Removes owned perf JSONL and stale claim artifacts only. Protects:
 *   - The current UTC-day perf file with recent/future mtime (active writer).
 *   - Any perf JSONL whose run UUID has a non-stale / future-dated claim (lease).
 *
 * Reuses the shared artifact parsing/protection logic from `perfArtifacts.ts`
 * so retention and delete cannot drift.
 *
 * Never deletes unrelated files (only `perf-YYYYMMDD-*.jsonl` and `*.claim`).
 * External filesystem failures fail open and are counted. Internal invalid
 * options fail fast. No broad `rm`.
 */

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import {
  PERF_MAINTENANCE_INTERVAL_MS,
  PERF_CLAIM_LEASE_MS,
} from './retention.js';
import {
  isPerfJsonl,
  isClaimFile,
  extractRunUuid,
  isNonStaleClaim,
  collectFreshClaimRunUuids,
  isPerfJsonlProtected,
} from './perfArtifacts.js';

/**
 * Narrow filesystem port for delete operations. Tests inject a custom
 * implementation to produce deterministic failures.
 */
export interface PerfDeleteFilesystem {
  readdir(dir: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  unlink(path: string): Promise<void>;
}

/** Default filesystem port using real `node:fs/promises`. */
class RealDeleteFilesystem implements PerfDeleteFilesystem {
  async readdir(dir: string): Promise<string[]> {
    return fsp.readdir(dir);
  }

  async stat(path: string): Promise<{ size: number; mtimeMs: number }> {
    const s = await fsp.stat(path);
    return { size: s.size, mtimeMs: s.mtimeMs };
  }

  async unlink(path: string): Promise<void> {
    await fsp.unlink(path);
  }
}

export interface PerfDeleteOptions {
  readonly dir: string;
  readonly fs?: PerfDeleteFilesystem;
  readonly now?: number;
  readonly maintenanceIntervalMs?: number;
  readonly claimLeaseMs?: number;
}

export interface PerfDeleteResult {
  readonly deleted: number;
  readonly protected: number;
  readonly failed: number;
  readonly deletedFiles: readonly string[];
  readonly protectedFiles: readonly string[];
  readonly failedFiles: readonly string[];
}

function isErrnoError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return typeof (err as NodeJS.ErrnoException).code === 'string';
}

function hasErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/**
 * Stable sentinel used as the failed-file name when a directory-level
 * filesystem failure (e.g. EACCES/EROFS on readdir) occurs and there is no
 * individual filename to attribute the failure to.
 */
const DIRECTORY_SENTINEL = '<directory>';

/**
 * Deletes owned perf JSONL and stale claim artifacts from a directory,
 * respecting live-writer safety.
 *
 * - A missing directory is a no-op (fail open, returns zero counts).
 * - External filesystem failures fail open and are counted.
 * - Internal invalid options (NaN/negative timing) fail fast.
 *
 * Protection rules (shared with retention via `perfArtifacts.ts`):
 *   - A perf JSONL whose day-key is today UTC AND mtime is within the
 *     maintenance interval is protected (active writer).
 *   - A perf JSONL whose run UUID has a non-stale/future claim is protected.
 *   - A claim that is non-stale (now - mtime ≤ lease) is protected.
 */
interface StatedArtifact {
  readonly name: string;
  readonly path: string;
  readonly mtimeMs: number;
  readonly runUuid: string | null;
}

interface DeleteAccumulator {
  readonly deleted: string[];
  readonly protected: string[];
  readonly failed: string[];
}

function emptyAccumulator(): DeleteAccumulator {
  return { deleted: [], protected: [], failed: [] };
}

function validateDeleteOptions(
  now: number,
  maintenanceIntervalMs: number,
  claimLeaseMs: number,
): void {
  if (!Number.isFinite(now)) {
    throw new RangeError(`perfDelete: now must be finite (got ${now})`);
  }
  if (!Number.isFinite(maintenanceIntervalMs) || maintenanceIntervalMs <= 0) {
    throw new RangeError(
      `perfDelete: maintenanceIntervalMs must be finite positive (got ${maintenanceIntervalMs})`,
    );
  }
  if (!Number.isFinite(claimLeaseMs) || claimLeaseMs <= 0) {
    throw new RangeError(
      `perfDelete: claimLeaseMs must be finite positive (got ${claimLeaseMs})`,
    );
  }
}

/**
 * Stats a single owned artifact. Returns the stated artifact, or `null` to
 * signal a skip (non-owned name or an ENOENT race). Genuine non-ENOENT
 * filesystem failures during stat are surfaced via `failures` so they are
 * counted rather than silently dropped to null. Internal/programming errors
 * (non-errno) rethrow.
 */
async function statOwnedArtifact(
  fsPort: PerfDeleteFilesystem,
  dir: string,
  name: string,
  failures: string[],
): Promise<StatedArtifact | null> {
  if (!isPerfJsonl(name) && !isClaimFile(name)) return null;
  try {
    const statResult = await fsPort.stat(join(dir, name));
    return {
      name,
      path: join(dir, name),
      mtimeMs: statResult.mtimeMs,
      runUuid: extractRunUuid(name),
    };
  } catch (err) {
    if (isErrnoError(err)) {
      if (hasErrnoCode(err, 'ENOENT')) {
        // ENOENT race (file deleted between readdir and stat) — skip.
        return null;
      }
      // Other errno (EACCES/EROFS/…) — count as a failure, do not delete.
      failures.push(name);
      return null;
    }
    throw err;
  }
}

/**
 * Phase 1: Stats all owned perf JSONL and claim artifacts.
 * ENOENT races skip silently; other errno errors are counted as failures;
 * internal errors throw.
 */
async function collectOwnedArtifacts(
  fsPort: PerfDeleteFilesystem,
  dir: string,
  names: readonly string[],
): Promise<{
  readonly jsonl: StatedArtifact[];
  readonly claims: StatedArtifact[];
  readonly statFailures: string[];
}> {
  const jsonl: StatedArtifact[] = [];
  const claims: StatedArtifact[] = [];
  const statFailures: string[] = [];

  for (const name of names) {
    const artifact = await statOwnedArtifact(fsPort, dir, name, statFailures);
    if (artifact !== null) {
      if (isPerfJsonl(name)) {
        jsonl.push(artifact);
      } else {
        claims.push(artifact);
      }
    }
  }

  return { jsonl, claims, statFailures };
}

/**
 * Attempts to delete one artifact via unlink, appending to the accumulator.
 */
async function attemptDelete(
  fsPort: PerfDeleteFilesystem,
  artifact: StatedArtifact,
  acc: DeleteAccumulator,
): Promise<void> {
  const ok = await safeUnlink(fsPort, artifact.path);
  if (ok) {
    acc.deleted.push(artifact.name);
  } else {
    acc.failed.push(artifact.name);
  }
}

/**
 * Phase 2: Delete claims. Non-stale claims are protected; stale claims are
 * deleted. Returns the set of non-stale claim UUIDs for JSONL protection,
 * computed via the centralized {@link collectFreshClaimRunUuids} so delete
 * and retention cannot drift (A).
 */
async function deleteClaims(
  fsPort: PerfDeleteFilesystem,
  claims: readonly StatedArtifact[],
  now: number,
  claimLeaseMs: number,
  acc: DeleteAccumulator,
): Promise<Set<string>> {
  const nonStaleUuids = collectFreshClaimRunUuids(
    claims.map((c) => ({ runUuid: c.runUuid, mtimeMs: c.mtimeMs })),
    now,
    claimLeaseMs,
  );

  for (const claim of claims) {
    const isProtected = isNonStaleClaim(claim.mtimeMs, now, claimLeaseMs);
    if (isProtected) {
      acc.protected.push(claim.name);
      continue;
    }
    await attemptDelete(fsPort, claim, acc);
  }

  return nonStaleUuids;
}

/**
 * Phase 3: Delete perf JSONL. Protects live-writer files and files whose
 * run UUID has a non-stale claim, via the centralized
 * {@link isPerfJsonlProtected} so delete and retention cannot drift (A).
 * Delete has no own-run override (pass null) — it protects only via
 * live-writer + claim lease.
 */
async function deletePerfJsonl(
  fsPort: PerfDeleteFilesystem,
  files: readonly StatedArtifact[],
  now: number,
  maintenanceIntervalMs: number,
  nonStaleClaimUuids: ReadonlySet<string>,
  acc: DeleteAccumulator,
): Promise<void> {
  for (const file of files) {
    const isProtected = isPerfJsonlProtected(
      file.name,
      file.mtimeMs,
      now,
      maintenanceIntervalMs,
      nonStaleClaimUuids,
      null, // delete has no own-run override
    );

    if (isProtected) {
      acc.protected.push(file.name);
      continue;
    }
    await attemptDelete(fsPort, file, acc);
  }
}

export async function perfDelete(
  options: PerfDeleteOptions,
): Promise<PerfDeleteResult> {
  const dir = options.dir;
  const fsPort = options.fs ?? new RealDeleteFilesystem();
  const now = options.now ?? Date.now();
  const maintenanceIntervalMs =
    options.maintenanceIntervalMs ?? PERF_MAINTENANCE_INTERVAL_MS;
  const claimLeaseMs = options.claimLeaseMs ?? PERF_CLAIM_LEASE_MS;

  validateDeleteOptions(now, maintenanceIntervalMs, claimLeaseMs);

  let names: string[];
  try {
    names = await fsPort.readdir(dir);
  } catch (err) {
    if (isErrnoError(err)) {
      if (hasErrnoCode(err, 'ENOENT')) {
        // Missing directory is a valid empty dataset — no-op.
        return {
          deleted: 0,
          protected: 0,
          failed: 0,
          deletedFiles: [],
          protectedFiles: [],
          failedFiles: [],
        };
      }
      // Other genuine filesystem failures (EACCES/EROFS/…) fail open but are
      // counted. There is no individual filename, so a stable directory
      // sentinel identifies the failure.
      return {
        deleted: 0,
        protected: 0,
        failed: 1,
        deletedFiles: [],
        protectedFiles: [],
        failedFiles: [DIRECTORY_SENTINEL],
      };
    }
    throw err;
  }

  const { jsonl, claims, statFailures } = await collectOwnedArtifacts(
    fsPort,
    dir,
    names,
  );

  const acc = emptyAccumulator();
  // Surface stat-level filesystem failures before deletion proceeds.
  for (const name of statFailures) {
    acc.failed.push(name);
  }

  const nonStaleClaimUuids = await deleteClaims(
    fsPort,
    claims,
    now,
    claimLeaseMs,
    acc,
  );

  await deletePerfJsonl(
    fsPort,
    jsonl,
    now,
    maintenanceIntervalMs,
    nonStaleClaimUuids,
    acc,
  );

  return {
    deleted: acc.deleted.length,
    protected: acc.protected.length,
    failed: acc.failed.length,
    deletedFiles: acc.deleted,
    protectedFiles: acc.protected,
    failedFiles: acc.failed,
  };
}

/**
 * Attempts to unlink a file. Returns true on success, false on filesystem
 * errors (fail open — counted). Rethrows internal/programming errors.
 */
async function safeUnlink(
  fsPort: PerfDeleteFilesystem,
  filePath: string,
): Promise<boolean> {
  try {
    await fsPort.unlink(filePath);
    return true;
  } catch (err) {
    if (isErrnoError(err)) return false;
    throw err;
  }
}

/**
 * Formats a delete result into a stable, human-readable string.
 */
export function formatDeleteResult(result: PerfDeleteResult): string {
  const lines: string[] = [];

  lines.push('Perf Delete');
  lines.push('===========');
  lines.push('');
  lines.push(`Deleted: ${result.deleted} file(s)`);
  lines.push(`Protected (live): ${result.protected} file(s)`);
  lines.push(`Failed: ${result.failed} file(s)`);

  if (result.deletedFiles.length > 0) {
    lines.push('');
    lines.push('Deleted files:');
    for (const f of result.deletedFiles) {
      lines.push(`  ${f}`);
    }
  }

  if (result.protectedFiles.length > 0) {
    lines.push('');
    lines.push('Protected files:');
    for (const f of result.protectedFiles) {
      lines.push(`  ${f}`);
    }
  }

  if (result.failedFiles.length > 0) {
    lines.push('');
    lines.push('Failed files:');
    for (const f of result.failedFiles) {
      lines.push(`  ${f}`);
    }
  }

  return lines.join('\n');
}
