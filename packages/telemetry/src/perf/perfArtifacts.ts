/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared artifact parsing/protection logic for the perf directory (P11, F).
 *
 * Extracted from {@link PerfRetention} so that retention eviction and
 * {@link perfDelete} cannot drift apart. Both operations must agree on what
 * constitutes an owned artifact, how to parse day-key / run-UUID from a
 * filename, and how to determine live-writer / claim protection.
 *
 * File-name conventions (P04B):
 *   - Perf JSONL: `perf-YYYYMMDD-<runUuid>.jsonl`
 *   - Claim:      `<runUuid>.claim`
 *
 * Canonical run IDs (F): production run UUIDs are standard `crypto.randomUUID()`
 * values. Internal constructor boundaries ({@link PerfRetention},
 * {@link PerfSink}) validate the UUID before joining it into a filesystem
 * path, rejecting separators, traversal sequences, and malformed IDs
 * (fail-fast). External filename parsing ({@link extractRunUuid}) remains
 * tolerant — files on disk are external input and may carry any string.
 */

/** Regex matching perf JSONL file names: perf-YYYYMMDD-uuid.jsonl */
export const PERF_FILE_RE = /^perf-(\d{8})-(.+)\.jsonl$/;

/** Regex matching claim file names: uuid.claim */
export const CLAIM_FILE_RE = /^(.+)\.claim$/;

/**
 * Path-safe run ID validation (internal boundary, fail-fast).
 *
 * A run ID is path-safe when it is non-empty, contains no path separators
 * (`/` or `\`), no traversal sequence (`..`), no C0 control characters
 * (0x00–0x1F), no DEL (0x7F), and no ASCII whitespace. Canonical production
 * run UUIDs (standard `crypto.randomUUID()` output) always satisfy this; the
 * check is deliberately broader than strict UUID format so it validates the
 * actual safety concern (path injection) without rejecting legitimate IDs.
 *
 * Implemented with explicit char-code tests (not a control-character regex)
 * so it is lint-clean while still rejecting control characters per the
 * documented contract.
 */
function isRunIdCharUnsafe(code: number): boolean {
  if (code === 0x2f || code === 0x5c) return true; // '/' and '\'
  if (code <= 0x20 || code === 0x7f) return true; // C0 controls, space, DEL
  return false;
}

function hasUnsafeRunIdChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (isRunIdCharUnsafe(value.charCodeAt(i))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Canonical run ID validation (F — internal boundary, fail-fast)
// ---------------------------------------------------------------------------

/**
 * Returns true if the value is a path-safe run ID (no separators, traversal
 * sequences, null bytes, or control characters). Canonical production run
 * UUIDs (`crypto.randomUUID()`) always satisfy this. Used at INTERNAL
 * constructor boundaries to prevent path injection.
 */
export function isValidRunUuid(value: string): boolean {
  if (value.length === 0) return false;
  if (value.includes('..')) return false;
  return !hasUnsafeRunIdChar(value);
}

/**
 * Validates a run ID at an internal constructor boundary, throwing a
 * TypeError if it is not path-safe. Call this BEFORE joining the ID into a
 * filesystem path so a programming error (e.g. a path separator in the ID)
 * cannot cause directory traversal.
 *
 * This is fail-fast for internal/programming errors — it does NOT affect
 * external-input tolerance (files on disk are parsed by
 * {@link extractRunUuid}, which is tolerant).
 */
export function requireValidRunUuid(value: string): string {
  if (!isValidRunUuid(value)) {
    throw new TypeError(
      `Invalid run UUID: contains path separators, traversal, or control characters (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Shared filename parser (F — one strict parser used everywhere)
// ---------------------------------------------------------------------------

/** A parsed perf JSONL filename. */
export interface ParsedPerfFilename {
  readonly kind: 'perf';
  readonly dayKey: string;
  readonly runUuid: string;
}

/** A parsed claim filename. */
export interface ParsedClaimFilename {
  readonly kind: 'claim';
  readonly runUuid: string;
}

/** A parsed owned-artifact filename (perf JSONL or claim). */
export type ParsedArtifactName = ParsedPerfFilename | ParsedClaimFilename;

/**
 * The single shared parser for perf JSONL and claim filenames. Used by
 * extraction/counting/retention/delete so their algorithms cannot drift.
 *
 * Returns `null` for any name that does not match the expected pattern —
 * this is the external-input tolerance boundary (files on disk are external).
 */
export function parseArtifactName(name: string): ParsedArtifactName | null {
  const perfMatch = name.match(PERF_FILE_RE);
  if (perfMatch) {
    return { kind: 'perf', dayKey: perfMatch[1], runUuid: perfMatch[2] };
  }
  const claimMatch = name.match(CLAIM_FILE_RE);
  if (claimMatch) {
    return { kind: 'claim', runUuid: claimMatch[1] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Owned-artifact predicates
// ---------------------------------------------------------------------------

/**
 * Returns true if the name matches a perf JSONL file (`perf-YYYYMMDD-*.jsonl`).
 */
export function isPerfJsonl(name: string): boolean {
  return PERF_FILE_RE.test(name);
}

/**
 * Returns true if the name matches a claim file (`*.claim`).
 *
 * Uses {@link CLAIM_FILE_RE} (the same regex as {@link parseArtifactName}) so
 * `isClaimFile` and `parseArtifactName` can never disagree on edge cases like
 * `.claim` (no run-UUID prefix), matching how {@link isPerfJsonl} already
 * delegates to {@link PERF_FILE_RE}.
 */
export function isClaimFile(name: string): boolean {
  return CLAIM_FILE_RE.test(name);
}

/**
 * Returns true if the name is an owned perf artifact (JSONL or claim).
 * This is the single source of truth shared by retention and delete.
 * Unrelated files in the dedicated directory are never counted/deleted.
 */
export function isOwnedArtifact(name: string): boolean {
  return isPerfJsonl(name) || isClaimFile(name);
}

/**
 * Extracts the UTC YYYYMMDD day key from a perf JSONL filename, or null if
 * the name does not match the expected pattern.
 */
export function parseDayKeyFromName(name: string): string | null {
  const parsed = parseArtifactName(name);
  return parsed?.kind === 'perf' ? parsed.dayKey : null;
}

/**
 * Extracts the run UUID from a perf JSONL or claim filename, or null if the
 * name does not match the expected pattern. Tolerant of any string value —
 * files on disk are external input.
 */
export function extractRunUuid(name: string): string | null {
  const parsed = parseArtifactName(name);
  return parsed?.runUuid ?? null;
}

/** Extracts a UTC YYYYMMDD day key from an epoch-millis timestamp. */
export function utcDayKey(now: number): string {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Determines whether a perf JSONL file is protected as a live writer:
 * its day-key is the current UTC day AND its mtime is within the maintenance
 * interval (or materially in the future).
 *
 * Shared by retention eviction and delete — both must protect the active
 * writer.
 */
export function isLiveWriterFile(
  name: string,
  mtimeMs: number,
  now: number,
  maintenanceIntervalMs: number,
): boolean {
  const dayKey = parseDayKeyFromName(name);
  if (dayKey === null) return false;
  if (dayKey !== utcDayKey(now)) return false;
  return now - mtimeMs <= maintenanceIntervalMs;
}

/**
 * Determines whether a claim file is non-stale (fresh or future-dated).
 * A claim is non-stale while (now - mtime) ≤ claimLeaseMs. A future-dated
 * claim (negative delta) is also non-stale until it ages past the lease.
 *
 * Shared by retention eviction and delete — both must respect live claims.
 */
export function isNonStaleClaim(
  mtimeMs: number,
  now: number,
  claimLeaseMs: number,
): boolean {
  return now - mtimeMs <= claimLeaseMs;
}

// ---------------------------------------------------------------------------
// Centralized claim→run→JSONL protection (A — retention + delete share this)
// ---------------------------------------------------------------------------

/** A stated claim artifact with its run UUID and mtime for protection logic. */
export interface ClaimProtectionInput {
  readonly runUuid: string | null;
  readonly mtimeMs: number;
}

/**
 * Collects canonical run IDs from fresh/future claims. A claim is fresh if
 * `now - mtime ≤ claimLeaseMs` (future mtimes are also fresh — negative
 * delta).
 *
 * This is the centralized claim→run protection used by both retention
 * eviction and delete so their algorithms cannot drift (A).
 */
export function collectFreshClaimRunUuids(
  claims: readonly ClaimProtectionInput[],
  now: number,
  claimLeaseMs: number,
): Set<string> {
  const uuids = new Set<string>();
  for (const claim of claims) {
    if (
      claim.runUuid !== null &&
      isNonStaleClaim(claim.mtimeMs, now, claimLeaseMs)
    ) {
      uuids.add(claim.runUuid);
    }
  }
  return uuids;
}

/**
 * Determines whether a perf JSONL file is protected from eviction/deletion
 * based on centralized claim→run→JSONL protection logic (A).
 *
 * A JSONL file is protected if ANY of:
 *   1. It is a live writer (today's day-key + mtime within maintenance window).
 *   2. Its run UUID has a fresh/future claim (in `protectedRunUuids`).
 *   3. Its run UUID matches the owner's own run UUID (always protect own run).
 *
 * This is shared by retention eviction and delete so their protection logic
 * cannot diverge.
 *
 * @param protectedRunUuids Run UUIDs with fresh/future claims (from
 *   {@link collectFreshClaimRunUuids}). For delete, this is the only
 *   claim-based protection (no own-run override).
 * @param ownRunUuid The retention owner's own run UUID. Retention always
 *   protects its own run; pass `null` for delete (no owner override).
 */
export function isPerfJsonlProtected(
  name: string,
  mtimeMs: number,
  now: number,
  maintenanceIntervalMs: number,
  protectedRunUuids: ReadonlySet<string>,
  ownRunUuid: string | null,
): boolean {
  if (isLiveWriterFile(name, mtimeMs, now, maintenanceIntervalMs)) {
    return true;
  }
  const runUuid = extractRunUuid(name);
  if (runUuid !== null) {
    if (ownRunUuid !== null && runUuid === ownRunUuid) return true;
    if (protectedRunUuids.has(runUuid)) return true;
  }
  return false;
}
