/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  linkSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Filename of the cross-process trip sentinel written into
 * `INTEGRATION_TEST_FILE_DIR`.
 *
 * Exported so tests (and any harness code) that need to locate, assert on, or
 * pre-seed the sentinel reference a single source of truth instead of
 * duplicating the literal string, keeping them in lockstep if it ever changes.
 */
export const SENTINEL_FILENAME = 'quota-guard-tripped.json';
const MAX_EXCERPT_LENGTH = 160;

interface QuotaSignalPattern {
  readonly label: string;
  readonly regex: RegExp;
}

const QUOTA_SIGNAL_PATTERNS: readonly QuotaSignalPattern[] = [
  {
    label: 'HTTP 429 status',
    // Matches `status: 429`, `statusCode: 429`, `status_code: 429`, `code: 429`,
    // and `HTTP 429`. The optional `[_ ]?code` suffix covers the camelCase and
    // snake_case field names SDKs emit, while the leading word boundaries keep
    // the contextual guard against unrelated text like "Processed 429 items".
    regex: /(?:\bstatus(?:[_ ]?code)?\b|\bcode\b|\bhttp\b)[\s:=]*429\b/i,
  },
  // Contextual rate-limit error forms ONLY. A bare "rate limit"/"rate limits"
  // is deliberately NOT matched: interactive PTY output echoes user/model text,
  // so a failing test that merely DISCUSSES rate limits must not trip the guard
  // and mask a real regression. An error-context word is required — either the
  // "-ed"/"error" suffix ("rate limited", "rate_limit_error", "rate-limit-error")
  // or a trailing exhaustion verb ("rate limit exceeded/reached/hit").
  {
    label: 'rate limit error',
    regex: /\brate[\s_-]?limit(?:ed|[\s_-]?error)\b/i,
  },
  {
    label: 'rate limit exhausted',
    regex: /\brate[\s_-]?limits?\s+(?:exceeded|reached|hit)\b/i,
  },
  {
    // A bare "quota limit" is deliberately NOT matched: benign config/help text
    // like "Config: quota limit = 60" merely NAMES the limit rather than
    // reporting a wall. The "limit" branch therefore requires a trailing
    // exhaustion verb ("quota limit reached/exceeded/hit"), while "quota
    // exceeded"/"quota exhausted" remain sufficient on their own.
    label: 'quota exceeded',
    regex:
      /\bquota\s+(?:exceeded|exhausted|limit\s+(?:reached|exceeded|hit))\b/i,
  },
  {
    // Classic OpenAI 429 body wording ("You exceeded your current quota, ...")
    // that carries no status/code context. The reversed order ("exceeded ...
    // quota") is not covered by the `quota (exceeded|...)` branch above, yet the
    // "exceeded your ... quota" phrasing is specific enough not to fire on
    // benign text like "quota check passed".
    label: 'exceeded your quota',
    regex: /\bexceeded your (?:current )?quota\b/i,
  },
  { label: 'insufficient quota', regex: /\binsufficient_quota\b/i },
  { label: 'daily quota reached', regex: /reached your daily .{0,60}quota/i },
  { label: 'resource exhausted', regex: /\bRESOURCE_EXHAUSTED\b/i },
  { label: 'too many requests', regex: /\btoo many requests\b/i },
];

/**
 * Scans harness output for a provider quota / rate-limit signal.
 *
 * Returns a short, human-readable description of the first matching signal
 * (including the offending line, trimmed and truncated), or `null` when no
 * quota signal is present.
 */
export function detectQuotaSignal(output: string): string | null {
  for (const { label, regex } of QUOTA_SIGNAL_PATTERNS) {
    if (!regex.test(output)) {
      continue;
    }
    const matchingLine = output.split('\n').find((line) => regex.test(line));
    const source = matchingLine ?? output;
    const excerpt = source.trim().slice(0, MAX_EXCERPT_LENGTH);
    return `matched ${label}: "${excerpt}"`;
  }
  return null;
}

/**
 * Uniform `[QUOTA/RATE-LIMIT]` prefix for quota-guard rejection errors.
 *
 * Both the interactive (PTY) and non-interactive (spawn) failure-classification
 * paths label a detected quota wall with this exact prefix so tests and humans
 * can recognise it regardless of the run mode.
 */
export const QUOTA_ERROR_PREFIX = '[QUOTA/RATE-LIMIT]';

/**
 * Format a quota-guard rejection error message with one stable, human/machine-
 * readable layout.
 *
 * Both {@link InteractiveRun} (interactive-run.ts) and the process-run.ts
 * spawn helpers surface detected quota walls as labelled `Error`s. Without a
 * shared formatter the two paths drifted — interactive produced
 * `[QUOTA/RATE-LIMIT] <context>; <reason>` while process-run produced
 * `[QUOTA/RATE-LIMIT] <reason>\n<context>` — making test assertions and log
 * grepping fragile. This centralises the layout as:
 *
 *   [QUOTA/RATE-LIMIT] <reason>
 *   <context>
 *
 * The reason (the machine-classified quota signal) comes first for at-a-glance
 * triage; the context (the caller's human-readable failure-path description)
 * follows on its own line for full detail.
 *
 * @param reason The classified quota signal string (from {@link detectQuotaSignal}).
 * @param context Human-readable description of the failure path (timeout, exit code, etc.).
 */
export function formatQuotaError(reason: string, context: string): string {
  return `${QUOTA_ERROR_PREFIX} ${reason}\n${context}`;
}

function getStateDir(): string | null {
  const dir = process.env['INTEGRATION_TEST_FILE_DIR'];
  if (dir === undefined || dir === '') {
    return null;
  }
  return dir;
}

/**
 * The guard is only usable for cleanup (clear) when we know where the sentinel
 * lives. `clearQuotaGuard` intentionally works even when the guard is disabled,
 * so it relies on this rather than {@link isQuotaGuardActive}.
 */
function getSentinelPath(): string | null {
  const dir = getStateDir();
  if (dir === null) {
    return null;
  }
  return join(dir, SENTINEL_FILENAME);
}

/**
 * Whether the cross-process quota guard is live for the current process.
 *
 * The guard is active only when a sentinel state directory is configured
 * (`INTEGRATION_TEST_FILE_DIR`) AND it has not been explicitly switched off via
 * `LLXPRT_QUOTA_GUARD_DISABLED=true`. This is the single source of truth for
 * "should quota/rate-limit detection do anything at all": {@link tripQuotaGuard}
 * and {@link getQuotaGuardTrip} both gate on it, and the harness failure-
 * classification paths (interactive-run.ts, process-run.ts) reuse it so the
 * documented disable switch restores ordinary timeout/exit failures instead of
 * relabelling them `[QUOTA/RATE-LIMIT]`. Exported so those callers share exactly
 * this predicate rather than re-deriving the disabled-state logic and drifting.
 */
export function isQuotaGuardActive(): boolean {
  if (getStateDir() === null) {
    return false;
  }
  return process.env['LLXPRT_QUOTA_GUARD_DISABLED'] !== 'true';
}

interface QuotaGuardTrip {
  readonly reason: string;
}

/**
 * Narrow an unknown value to a non-null, non-array object.
 *
 * `typeof [] === 'object'` in JavaScript, so a bare `typeof`/`!== null` check
 * would wrongly admit arrays as `Record<string, unknown>`. The explicit
 * `Array.isArray` exclusion keeps the guard semantically correct so that a
 * malformed sentinel whose top-level JSON is an array (even one that happens to
 * carry a `reason` index) is not mistaken for a {@link QuotaGuardTrip}.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuotaGuardTrip(value: unknown): value is QuotaGuardTrip {
  return isRecord(value) && typeof value['reason'] === 'string';
}

/**
 * Best-effort removal of a staged temp file. A leftover uniquely-named temp is
 * harmless (it can never masquerade as the sentinel), so any failure here is
 * swallowed — the run must never fail because of guard bookkeeping I/O.
 */
function removeTempFile(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Ignore — a stray temp file is harmless and OS/CI-reclaimed.
  }
}

/**
 * Atomically publish the sentinel with first-writer-wins / no-replace
 * semantics, returning `true` only for the process that actually wins the race.
 *
 * The payload is first written *in full* to a uniquely-named temp file in the
 * SAME directory as the sentinel (exclusive `wx` create), then hard-linked to
 * the sentinel path. `linkSync` publishes atomically and fails with `EEXIST`
 * without replacing an existing sentinel, so exactly one writer wins even
 * across concurrent vitest worker processes. Crucially, because the link merely
 * exposes the already-complete temp inode, a reader can never observe a
 * zero-length or partially-written sentinel (the window the previous
 * `writeFileSync(..., 'wx')` left open, which {@link getQuotaGuardTrip} would
 * treat as malformed → `null`, letting a second provider call slip through).
 * The temp file is always cleaned up. A loser (`EEXIST`) and any other I/O
 * failure both return `false`, so only the winner emits the CI annotation.
 */
function publishSentinel(sentinelPath: string, reason: string): boolean {
  const payload = JSON.stringify({
    reason,
    timestamp: new Date().toISOString(),
  });
  const tempPath = join(
    dirname(sentinelPath),
    `${SENTINEL_FILENAME}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(tempPath, payload, { flag: 'wx' });
  } catch {
    // Could not even stage the payload (ENOSPC, EACCES, a missing parent dir,
    // or an astronomically unlikely temp-name collision). Nothing was published
    // and there is no temp file to remove.
    return false;
  }
  try {
    linkSync(tempPath, sentinelPath);
    return true;
  } catch {
    // EEXIST => another worker already published the first reason; any other
    // error => the sentinel was never created. Either way this process is not
    // the winner and must stay silent.
    return false;
  } finally {
    removeTempFile(tempPath);
  }
}

/**
 * Escape a GitHub Actions workflow-command *message* payload.
 *
 * Per the workflow-command spec, the data segment after `::` must have `%`,
 * carriage return and newline percent-encoded; otherwise an embedded newline
 * would prematurely terminate the `::error::` command and the remainder would
 * leak as plain log output (and a literal `%` could corrupt any following
 * encoded sequence). `%` is intentionally replaced first so the `%0D`/`%0A`
 * we introduce are not themselves re-escaped. Property values (e.g. a dynamic
 * `title`) need the additional `:`/`,` escaping, but this guard's title is
 * static, so only the message data is escaped here.
 */
function escapeAnnotationData(data: string): string {
  return data.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function emitGitHubAnnotations(reason: string): void {
  if (process.env['GITHUB_ACTIONS'] !== 'true') {
    return;
  }
  process.stdout.write(
    `::error title=E2E quota guard tripped::${escapeAnnotationData(reason)}\n`,
  );

  const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryPath === undefined || summaryPath === '') {
    return;
  }
  try {
    appendFileSync(
      summaryPath,
      `## E2E aborted: provider quota/rate-limit exhausted\n\n${reason}\n\nRemaining tests were skipped. This is an infrastructure/quota failure, not a code regression.\n`,
    );
  } catch {
    // Best-effort reporting; never fail the run because of summary I/O.
  }
}

/**
 * Records that the harness has hit a provider quota / rate-limit wall.
 *
 * No-op when the guard is inactive (no state dir, or explicitly disabled).
 * Idempotent, and the FIRST reason wins even across concurrent vitest worker
 * processes. Publication is atomic (see {@link publishSentinel}): the payload
 * is written in full to a unique temp file in the sentinel's own directory and
 * then hard-linked into place, so a reader never observes a zero-length or
 * partial sentinel and exactly one writer wins. A plain `existsSync` pre-check
 * would be a TOCTOU race (two workers could both observe "absent" and the LAST
 * write would clobber the first reason); the atomic link closes that window.
 *
 * The CI annotation is emitted ONLY when this process actually wins the
 * publication, i.e. it now owns the sentinel latch. A worker that loses the
 * race (link `EEXIST`) stays silent, and — crucially — so does a worker whose
 * staging or link fails for any OTHER reason (ENOSPC, EACCES, missing parent
 * dir): with no sentinel there is no latch to dedupe against, so emitting would
 * let every worker announce its own wall and flood CI with duplicates. Sentinel
 * I/O is therefore best-effort and never throws; the quota wall is still
 * surfaced by the failing test itself.
 */
export function tripQuotaGuard(reason: string): void {
  if (!isQuotaGuardActive()) {
    return;
  }
  const sentinelPath = getSentinelPath();
  if (sentinelPath === null) {
    return;
  }
  if (publishSentinel(sentinelPath, reason)) {
    // Reached only when THIS process won the atomic publication, i.e. it is the
    // sole owner of the sentinel latch.
    emitGitHubAnnotations(reason);
  }
}

/**
 * Reads the cross-process sentinel, returning the recorded trip reason or
 * `null` when the guard is inactive, unset, unreadable, or malformed.
 */
export function getQuotaGuardTrip(): { reason: string } | null {
  if (!isQuotaGuardActive()) {
    return null;
  }
  const sentinelPath = getSentinelPath();
  if (sentinelPath === null || !existsSync(sentinelPath)) {
    return null;
  }
  const parsed = readSentinel(sentinelPath);
  if (!isQuotaGuardTrip(parsed)) {
    return null;
  }
  return { reason: parsed.reason };
}

function readSentinel(sentinelPath: string): unknown {
  try {
    const raw = readFileSync(sentinelPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Removes the sentinel file, if present. Works even while the guard is
 * disabled so callers can reset state between runs. Errors are swallowed.
 */
export function clearQuotaGuard(): void {
  const sentinelPath = getSentinelPath();
  if (sentinelPath === null) {
    return;
  }
  try {
    if (existsSync(sentinelPath)) {
      rmSync(sentinelPath, { force: true });
    }
  } catch {
    // Best-effort cleanup; never fail the run because of sentinel I/O.
  }
}
