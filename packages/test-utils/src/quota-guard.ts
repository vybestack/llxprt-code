/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const SENTINEL_FILENAME = 'quota-guard-tripped.json';
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
    label: 'quota exceeded',
    regex: /\bquota\s+(?:exceeded|exhausted|limit)\b/i,
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
 * so it relies on this rather than {@link isGuardActive}.
 */
function getSentinelPath(): string | null {
  const dir = getStateDir();
  if (dir === null) {
    return null;
  }
  return join(dir, SENTINEL_FILENAME);
}

function isGuardActive(): boolean {
  if (getStateDir() === null) {
    return false;
  }
  return process.env['LLXPRT_QUOTA_GUARD_DISABLED'] !== 'true';
}

interface QuotaGuardTrip {
  readonly reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isQuotaGuardTrip(value: unknown): value is QuotaGuardTrip {
  return isRecord(value) && typeof value['reason'] === 'string';
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
 * Idempotent: the first reason wins and subsequent trips are ignored.
 */
export function tripQuotaGuard(reason: string): void {
  if (!isGuardActive()) {
    return;
  }
  const sentinelPath = getSentinelPath();
  if (sentinelPath === null) {
    return;
  }
  if (existsSync(sentinelPath)) {
    return;
  }
  try {
    writeFileSync(
      sentinelPath,
      JSON.stringify({ reason, timestamp: new Date().toISOString() }),
    );
  } catch {
    // Best-effort persistence; never fail the run because of sentinel I/O.
  }

  emitGitHubAnnotations(reason);
}

/**
 * Reads the cross-process sentinel, returning the recorded trip reason or
 * `null` when the guard is inactive, unset, unreadable, or malformed.
 */
export function getQuotaGuardTrip(): { reason: string } | null {
  if (!isGuardActive()) {
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
