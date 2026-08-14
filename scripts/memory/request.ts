/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Portable, cross-platform request channel between a separate request CLI and
 * the in-process probe.
 *
 * No signals, ports, pgrep, or shell commands are involved: a requester
 * atomically writes a JSON request file into the run's `requests/` directory
 * (temp file + rename), and the probe's unref'd poller claims, validates, and
 * processes each request at most once before removing it.
 *
 * REQUEST IDs AND PATH SAFETY
 * IDs follow a strict bounded grammar (see REQUEST_ID_PATTERN): two or more
 * hyphen-separated alphanumeric segments including the requester's pid. The
 * grammar excludes every path-significant character — POSIX separators (/),
 * Windows separators (\), drive-letter colons, dot segments, and whitespace —
 * and caps total length. Because `validateRequest` rejects any ID outside the
 * grammar, every path derived from an accepted ID (the request file, the
 * claimed file, the done marker, the snapshot file) is a plain file name
 * inside its intended directory; traversal is unrepresentable.
 *
 * Kept dependency-light so the lifecycle (create/claim/finish/validate) is
 * unit-testable against a temp directory.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { isErrnoException } from '../utils/error-guards.ts';
import { FILE_MODE, ensureSecureDir } from './perms.ts';

/** Bumped only on an incompatible request-schema change. */
export const REQUEST_VERSION = 1;

/** Subdirectory of a run directory holding pending request files. */
export const REQUEST_DIR_NAME = 'requests';

/** Subdirectory of `requests/` holding completion markers. */
export const DONE_DIR_NAME = 'done';

/** Extension used while a request is claimed (being processed). */
export const CLAIMED_SUFFIX = '.claimed';

/**
 * A request older than this is rejected as stale so a leftover PENDING file
 * cannot loop forever or trigger work long after it was issued. Claimed
 * requests (already accepted by a probe) are exempt — see
 * `validateRequestShape`.
 */
export const DEFAULT_STALE_MS = 5 * 60_000;

/**
 * Request-ID grammar: two or more hyphen-separated alphanumeric segments.
 * Hyphens may not lead, trail, or repeat, so an ID is always a single path
 * component. Everything path-significant (/, \, :, ., NUL, ...) is excluded
 * by construction on both POSIX and Windows.
 */
export const REQUEST_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** Hard upper bound on request-ID length. Real IDs are ~20 characters. */
export const REQUEST_ID_MAX_LENGTH = 96;

/** Request temp files older than this are removed by the poller. */
export const REQUEST_TEMP_MAX_AGE_MS = 60_000;

export type RequestKind = 'sample' | 'snapshot';

export interface MemRequest {
  readonly version: number;
  readonly id: string;
  readonly createdAt: number;
  readonly kind: RequestKind;
}

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export interface ValidateOptions {
  readonly now: () => number;
  readonly staleMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when an ID obeys the bounded grammar: alphanumeric segments joined by
 * single hyphens, at least two segments, within the length cap. This is the
 * gate that keeps every derived path inside its intended directory.
 */
export function isValidRequestId(id: string): boolean {
  return (
    REQUEST_ID_PATTERN.test(id) &&
    id.length <= REQUEST_ID_MAX_LENGTH &&
    !id.includes('--')
  );
}

function validateRequestId(id: string): void {
  if (!isValidRequestId(id)) {
    throw new RequestValidationError(
      `request id is malformed: ${id.slice(0, 64)}` +
        (id.length > 64 ? '...' : '') +
        ' (expected hyphen-separated alphanumeric segments, ' +
        `<= ${REQUEST_ID_MAX_LENGTH} chars)`,
    );
  }
}

/**
 * Narrows an already-parsed JSON value to a MemRequest or rejects it, checking
 * structure only (no staleness). Malformed structure, a wrong version, an
 * unknown kind, or an ID outside the bounded grammar throws
 * RequestValidationError.
 */
export function validateRequestShape(raw: unknown): MemRequest {
  if (!isRecord(raw)) {
    throw new RequestValidationError('request must be a JSON object');
  }
  if (raw['version'] !== REQUEST_VERSION) {
    throw new RequestValidationError(
      `unsupported request version ${String(raw['version'])}`,
    );
  }
  const id = raw['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new RequestValidationError('request id is missing or empty');
  }
  validateRequestId(id);
  if (
    typeof raw['createdAt'] !== 'number' ||
    !Number.isFinite(raw['createdAt'])
  ) {
    throw new RequestValidationError(
      'request createdAt must be a finite number',
    );
  }
  const kind = raw['kind'];
  if (kind !== 'sample' && kind !== 'snapshot') {
    throw new RequestValidationError(`unknown request kind ${String(kind)}`);
  }
  return { version: raw['version'], id, createdAt: raw['createdAt'], kind };
}

/**
 * Full validation of a PENDING request: shape plus staleness. A request older
 * than staleMs (or implausibly future-dated from clock skew) is rejected so a
 * leftover unclaimed file cannot loop forever.
 */
export function validateRequest(
  raw: unknown,
  options: ValidateOptions,
): MemRequest {
  const request = validateRequestShape(raw);
  const age = options.now() - request.createdAt;
  if (age > options.staleMs) {
    throw new RequestValidationError(
      `request is stale (${Math.round(age / 1000)}s old)`,
    );
  }
  if (age < -options.staleMs) {
    throw new RequestValidationError('request timestamp is in the future');
  }
  return request;
}

let requestCounter = 0;

/**
 * Builds a unique, sortable request id: timestamp, the producing process's
 * pid, an in-process counter, and a random suffix — all inside the bounded
 * grammar, so ids are unique across processes and restarts and safe in every
 * derived path.
 */
export function makeRequestId(
  nowMs: number,
  pid: number,
  salt: number,
): string {
  requestCounter += 1;
  const stamp = nowMs.toString(36);
  const owner = `p${pid.toString(36)}`;
  const counter = requestCounter.toString(36);
  const suffix = Math.floor(salt * 46_656)
    .toString(36)
    .padStart(3, '0');
  return `${stamp}-${owner}-${counter}-${suffix}`;
}

export interface QueueDeps {
  readonly requestDir: string;
  readonly now: () => number;
  readonly random: () => number;
  readonly pid: number;
}

export interface QueuedRequest {
  readonly request: MemRequest;
  /** Path of the published `.json` request file. */
  readonly path: string;
}

/**
 * Atomically queues a request by writing to a temp file and renaming it into
 * place, so a poller never observes a half-written request. Returns the
 * request and its published path.
 */
export function queueRequest(
  kind: RequestKind,
  deps: QueueDeps,
): QueuedRequest {
  ensureSecureDir(deps.requestDir);
  const createdAt = deps.now();
  const id = makeRequestId(createdAt, deps.pid, deps.random());
  const request: MemRequest = {
    version: REQUEST_VERSION,
    id,
    createdAt,
    kind,
  };
  const published = join(deps.requestDir, `${id}.json`);
  const temp = `${published}.${deps.pid.toString(36)}.${createdAt.toString(36)}.tmp`;
  writeFileSync(temp, JSON.stringify(request), { mode: FILE_MODE });
  renameSync(temp, published);
  return { request, path: published };
}

export interface ClaimResult {
  /** Raw file contents of the claimed request. */
  readonly raw: string;
  /** Path of the `.claimed` file (to be finished after processing). */
  readonly path: string;
  readonly fileName: string;
}

/**
 * Attempts to atomically claim one request file (rename to `.claimed`) and
 * read it. Returns null when the file vanished mid-claim (a concurrent poll),
 * so the caller moves on to the next candidate without a `continue`.
 *
 * A read failure after a successful claim (permissions, I/O — genuinely
 * external filesystem conditions) does NOT delete the claim: the file is
 * restored to `.json` so a later poll can retry it, and the error propagates.
 */
function tryClaimFile(
  requestDir: string,
  fileName: string,
): ClaimResult | null {
  const requestPath = join(requestDir, fileName);
  const claimedPath = `${requestPath}${CLAIMED_SUFFIX}`;
  try {
    renameSync(requestPath, claimedPath);
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
  try {
    return {
      raw: readFileSync(claimedPath, 'utf8'),
      path: claimedPath,
      fileName,
    };
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return null;
    }
    // Recoverable: put the request back so the next poll retries it. If the
    // restore itself fails the `.claimed` file remains for startup recovery.
    try {
      renameSync(claimedPath, requestPath);
    } catch {
      // Best-effort restore; the original error is the one to report.
    }
    throw error;
  }
}

/**
 * Claims the next pending request (deterministic name order) by atomically
 * renaming `.json` to `.claimed`. Returns null when nothing is pending. A
 * missing directory is reported as "nothing pending".
 */
export function claimNextRequest(requestDir: string): ClaimResult | null {
  let entries: string[];
  try {
    entries = readdirSync(requestDir);
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }
  const pending = entries.filter((name) => name.endsWith('.json')).sort();
  for (const fileName of pending) {
    const claimed = tryClaimFile(requestDir, fileName);
    if (claimed !== null) {
      return claimed;
    }
  }
  return null;
}

/** Removes a claimed request file so it is never processed again. */
export function finishRequest(claimedPath: string): void {
  rmSync(claimedPath, { force: true });
}

/**
 * Writes an atomic completion marker for a request ID.
 *
 * After processing a request's side effects (and before removing the claimed
 * file), the probe records that the request finished. On restart, an orphaned
 * `.claimed` file with a completion marker is simply removed; one without a
 * marker is re-processed — safely, because outputs are keyed by request ID.
 */
export function writeDoneMarker(
  runDir: string,
  requestId: string,
  pid: number,
): void {
  const doneDir = join(runDir, REQUEST_DIR_NAME, DONE_DIR_NAME);
  ensureSecureDir(doneDir);
  const final = join(doneDir, requestId);
  const temp = `${final}.${pid.toString(36)}.${Date.now().toString(36)}.tmp`;
  writeFileSync(temp, '', { mode: FILE_MODE });
  renameSync(temp, final);
}

/** True when a completion marker exists for the request ID. */
export function isRequestDone(runDir: string, requestId: string): boolean {
  return existsSync(join(runDir, REQUEST_DIR_NAME, DONE_DIR_NAME, requestId));
}

/**
 * Removes one temp file when its mtime is older than the cutoff. Returns 1
 * when removed, 0 otherwise. A vanished file (ENOENT race) counts as removed
 * by another pass.
 */
function removeTempIfStale(path: string, cutoff: number): number {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return 0;
    }
    throw error;
  }
  if (mtimeMs >= cutoff) {
    return 0;
  }
  rmSync(path, { force: true });
  return 1;
}

/**
 * Removes request temp files (`*.tmp`) older than `olderThanMs`, using the
 * injected clock against each file's modification time. A requester that died
 * mid-write cannot leave temp files accumulating forever. Returns how many
 * were removed; a missing directory removes nothing.
 */
export function cleanStaleRequestTemps(
  requestDir: string,
  nowMs: number,
  olderThanMs: number,
): number {
  let entries: string[];
  try {
    entries = readdirSync(requestDir);
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return 0;
    }
    throw error;
  }
  let removed = 0;
  const cutoff = nowMs - olderThanMs;
  for (const name of entries) {
    if (!name.endsWith('.tmp')) {
      continue;
    }
    removed += removeTempIfStale(join(requestDir, name), cutoff);
  }
  return removed;
}

/**
 * Lists orphaned `.claimed` files in the request directory.
 *
 * A `.claimed` file exists only while a probe is processing a request; if
 * the process terminated between claiming and finishing, the file survives.
 * Recovery on startup re-examines each one against its completion marker.
 * Deterministic name order. A missing directory yields none. A claim that
 * cannot be read is left in place (still recoverable) rather than dropped.
 */
export function findOrphanedClaims(requestDir: string): ClaimResult[] {
  let entries: string[];
  try {
    entries = readdirSync(requestDir);
  } catch {
    return [];
  }
  const orphans: ClaimResult[] = [];
  for (const fileName of entries) {
    if (!fileName.endsWith(CLAIMED_SUFFIX)) {
      continue;
    }
    const path = join(requestDir, fileName);
    try {
      orphans.push({ raw: readFileSync(path, 'utf8'), path, fileName });
    } catch {
      // Unreadable now; leave it for the next recovery attempt.
    }
  }
  orphans.sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
  return orphans;
}
