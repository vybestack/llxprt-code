/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Portable liveness lease for the in-process memory probe (issue #3230).
 *
 * Each run directory carries a probe-owned lease file: a tiny JSON record of
 * the owning probe (owner token + pid) with a heartbeat timestamp the probe
 * refreshes on every poll tick. This answers "is a probe actually running in
 * this directory?" without signals, process.kill, pgrep, sockets, or shell
 * commands — the only operations are file read/write/rename/remove.
 *
 * OWNERSHIP RULES
 * - `acquireLease` refuses when a fresh lease names a different owner, so a
 *   second probe cannot take over a live probe's run directory — and
 *   therefore can never treat a live probe's in-flight `.claimed` requests as
 *   orphaned.
 * - `renewLease` and `releaseLease` are owner-checked: a probe only updates
 *   or removes a lease it owns.
 * - All writes go through a same-directory temp file and an atomic rename, so
 *   a reader never observes a partial lease.
 *
 * STALENESS
 * A lease whose heartbeat is older than LEASE_STALE_MS is treated as dead.
 * The threshold deliberately exceeds any single blocking operation the probe
 * performs (writeHeapSnapshot is synchronous); a false "dead" verdict would
 * require the owning process to freeze for that long without exiting.
 */

import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as nodePath from 'node:path';
import { ensureSecureDir, FILE_MODE } from './perms.ts';

/** Lease file name inside a run directory. */
export const LEASE_FILE_NAME = 'probe.lease';

/**
 * A lease older than this is dead. Ten minutes exceeds any plausible single
 * synchronous snapshot under the heap guard while still bounding how long a
 * crashed probe's run directory stays "active" to outside observers.
 */
export const LEASE_STALE_MS = 10 * 60_000;

export interface LeaseRecord {
  /** Opaque owner token unique per probe process incarnation. */
  readonly owner: string;
  readonly pid: number;
  readonly heartbeatAt: number;
}

export interface LeaseDeps {
  readonly now: () => number;
  readonly pid: () => number;
  readonly random: () => number;
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, contents: string) => void;
  readonly rename: (from: string, to: string) => void;
  readonly rm: (path: string) => void;
  readonly join: (...segments: string[]) => string;
}

export const defaultLeaseDeps: LeaseDeps = {
  now: () => Date.now(),
  pid: () => process.pid,
  random: () => Math.random(),
  exists: existsSync,
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, contents) => writeFileSync(p, contents, { mode: FILE_MODE }),
  rename: renameSync,
  rm: (p) => rmSync(p, { force: true }),
  join: nodePath.join,
};

export type LeaseStatus =
  /** A probe heartbeat arrived within LEASE_STALE_MS. */
  | 'active'
  /** A lease exists but its heartbeat is too old. */
  | 'stale'
  /** No lease file exists. */
  | 'missing'
  /** A lease file exists but is not a valid record. */
  | 'malformed'
  /** The lease file could not be read (external filesystem failure). */
  | 'unreadable';

export interface LeaseCheck {
  readonly status: LeaseStatus;
  readonly lease?: LeaseRecord;
  readonly reason?: string;
}

/** Path of the lease file inside a run directory. */
export function leasePath(runDir: string): string {
  return nodePath.join(runDir, LEASE_FILE_NAME);
}

/** Builds the owner token for a probe process incarnation. */
export function makeLeaseOwner(pid: number, random: () => number): string {
  return `p${pid.toString(36)}-${Math.floor(random() * 2_176_782_336)
    .toString(36)
    .padStart(6, '0')}`;
}

function isLeaseOwner(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{4,64}$/.test(value);
}

/**
 * Parses raw lease file contents into a record, or null when malformed.
 * Every field is validated: owner token grammar, positive integer pid, and a
 * finite heartbeat.
 */
export function parseLease(raw: string): LeaseRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (!isLeaseOwner(record['owner'])) {
    return null;
  }
  const pid = record['pid'];
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const heartbeatAt = record['heartbeatAt'];
  if (typeof heartbeatAt !== 'number' || !Number.isFinite(heartbeatAt)) {
    return null;
  }
  return { owner: record['owner'], pid, heartbeatAt };
}

/** Reads and classifies the lease of a run directory. */
export function checkLease(
  runDir: string,
  deps: LeaseDeps = defaultLeaseDeps,
): LeaseCheck {
  const path = deps.join(runDir, LEASE_FILE_NAME);
  let raw: string;
  try {
    if (!deps.exists(path)) {
      return { status: 'missing' };
    }
    raw = deps.readFile(path);
  } catch (error) {
    return {
      status: 'unreadable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const lease = parseLease(raw);
  if (lease === null) {
    return { status: 'malformed' };
  }
  if (deps.now() - lease.heartbeatAt > LEASE_STALE_MS) {
    return { status: 'stale', lease };
  }
  return { status: 'active', lease };
}

/** Writes a lease record atomically (temp file + rename), owner-only mode. */
function writeLease(runDir: string, lease: LeaseRecord, deps: LeaseDeps): void {
  ensureSecureDir(runDir);
  const final = deps.join(runDir, LEASE_FILE_NAME);
  const temp = deps.join(
    runDir,
    `${LEASE_FILE_NAME}.${lease.pid.toString(36)}.${lease.heartbeatAt}.tmp`,
  );
  deps.writeFile(temp, JSON.stringify(lease));
  deps.rename(temp, final);
}

export type AcquireResult =
  | { readonly outcome: 'acquired'; readonly lease: LeaseRecord }
  | { readonly outcome: 'refused'; readonly check: LeaseCheck };

/**
 * Acquires the run directory's lease for this probe process. Refuses when a
 * fresh lease names another owner (a live competing probe). Takes over a
 * missing, stale, or malformed lease — but NOT an unreadable one, which could
 * be a live lease hidden by a transient filesystem error.
 */
export function acquireLease(
  runDir: string,
  deps: LeaseDeps = defaultLeaseDeps,
): AcquireResult {
  const check = checkLease(runDir, deps);
  if (check.status === 'active' || check.status === 'unreadable') {
    return { outcome: 'refused', check };
  }
  const lease: LeaseRecord = {
    owner: makeLeaseOwner(deps.pid(), deps.random),
    pid: deps.pid(),
    heartbeatAt: deps.now(),
  };
  writeLease(runDir, lease, deps);
  // Re-check after publishing: if another probe won the same takeover race,
  // its record is what survived the rename. Only the recorded owner proceeds.
  const after = checkLease(runDir, deps);
  if (after.status !== 'active' || after.lease?.owner !== lease.owner) {
    return { outcome: 'refused', check: after };
  }
  return { outcome: 'acquired', lease };
}

/**
 * Refreshes the heartbeat of a lease this probe owns. Returns false when the
 * lease no longer names this probe (lost the directory); the caller must stop
 * processing requests in that directory.
 */
export function renewLease(
  runDir: string,
  owner: string,
  deps: LeaseDeps = defaultLeaseDeps,
): boolean {
  const check = checkLease(runDir, deps);
  if (check.status === 'active' || check.status === 'stale') {
    if (check.lease === undefined || check.lease.owner !== owner) {
      return false;
    }
    writeLease(runDir, { ...check.lease, heartbeatAt: deps.now() }, deps);
    return true;
  }
  if (check.status === 'missing') {
    // Our lease vanished (external deletion): re-publish it, but only keep
    // running if this probe still owns the directory afterwards.
    writeLease(
      runDir,
      { owner, pid: deps.pid(), heartbeatAt: deps.now() },
      deps,
    );
    const after = checkLease(runDir, deps);
    return after.status === 'active' && after.lease?.owner === owner;
  }
  return false;
}

/** Removes the lease on normal exit, but only when this probe owns it. */
export function releaseLease(
  runDir: string,
  owner: string,
  deps: LeaseDeps = defaultLeaseDeps,
): void {
  const check = checkLease(runDir, deps);
  if (check.lease?.owner === owner) {
    deps.rm(deps.join(runDir, LEASE_FILE_NAME));
  }
}
