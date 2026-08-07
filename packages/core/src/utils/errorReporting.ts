/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';

const MAX_REPORT_STRING_CHARS = 4_096;
const MAX_REPORT_CONTEXT_ENTRIES = 8;
const MAX_REPORT_BYTES = 131_072;
const MAX_REPORT_FILES = 20;
const MAX_REPORT_TOTAL_BYTES = 1_048_576;
const REPORT_DEDUPE_WINDOW_MS = 60_000;
const MAX_TRACKED_FINGERPRINTS = 64;
const FINGERPRINT_ALGORITHM = 'sha256';
const FINGERPRINT_FIELD_SEPARATOR = '\u0000';
const REPORT_FILE_PATTERN = /^llxprt-client-error-.*\.json$/;

interface RecentReportEntry {
  windowStartMs: number;
  suppressedCount: number;
  lastReportPath: string;
}

interface RotationCohort {
  activeCallers: number;
  protectedPaths: Set<string>;
}

const recentReports = new Map<string, RecentReportEntry>();
const rotationCohorts = new Map<string, RotationCohort>();

function reportToStderr(message: string, ...extras: unknown[]): void {
  const parts = [message, ...extras];
  try {
    const output = parts.map((part) => formatPart(part)).join(' ') + '\n';
    process.stderr.write(output);
  } catch {
    // Swallow formatting/write failures to avoid masking the original error
  }
}

function formatPart(part: unknown): string {
  if (part instanceof Error) {
    return part.stack ?? `${part.name}: ${part.message}`;
  }
  if (typeof part === 'object' && part !== null) {
    try {
      return JSON.stringify(part);
    } catch {
      return String(part);
    }
  }
  return String(part);
}

interface ErrorReportData {
  error: { message: string; stack?: string } | { message: string };
  context?: unknown;
  additionalInfo?: Record<string, unknown>;
}

/** Normalises an unknown error value into a structured { message, stack? } object. */
function normaliseError(error: Error | unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return { message: String((error as { message: unknown }).message) };
  }
  return { message: String(error) };
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-1.2
 * @pseudocode lines 010-014
 */
function clampString(value: string): string {
  if (value.length <= MAX_REPORT_STRING_CHARS) {
    return value;
  }
  return (
    value.slice(0, MAX_REPORT_STRING_CHARS) +
    ` [truncated: ${value.length} chars]`
  );
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-1.2, REQ-3113-2
 * @pseudocode lines 020-029
 */
function stringifyClamped(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === 'string' ? clampString(value) : value,
  );
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-1.2, REQ-3113-1.3, REQ-3113-1.4
 * @pseudocode lines 040-061
 */
function serializeBoundedReport(
  errorToReport: { message: string; stack?: string },
  context?: unknown[] | Record<string, unknown>,
): string {
  const base: ErrorReportData = { error: errorToReport };
  if (context) {
    base.context = context;
  }

  let text = stringifyClamped(base);
  if (Buffer.byteLength(text, 'utf8') <= MAX_REPORT_BYTES) {
    return text;
  }

  if (Array.isArray(context)) {
    const kept = context.slice(-MAX_REPORT_CONTEXT_ENTRIES);
    const omitted = context.length - kept.length;
    text = stringifyClamped({
      error: errorToReport,
      context: kept,
      contextTruncated: { omittedEntries: omitted },
    });
    if (Buffer.byteLength(text, 'utf8') <= MAX_REPORT_BYTES) {
      return text;
    }
  }

  return stringifyClamped({
    error: errorToReport,
    contextOmitted: {
      reason: 'payload-exceeded-limit',
      serializedBytes: Buffer.byteLength(text, 'utf8'),
      limitBytes: MAX_REPORT_BYTES,
    },
  });
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-4
 * @pseudocode lines 070-079
 */
function buildFingerprint(
  type: string,
  baseMessage: string,
  message: string,
): string {
  const digest = createHash(FINGERPRINT_ALGORITHM);
  for (const component of [type, baseMessage, message]) {
    const bytes = Buffer.from(component, 'utf8');
    digest.update(String(bytes.length));
    digest.update(FINGERPRINT_FIELD_SEPARATOR);
    digest.update(bytes);
    digest.update(FINGERPRINT_FIELD_SEPARATOR);
  }
  return digest.digest('hex');
}

interface DuplicateResult {
  suppressed: boolean;
  count?: number;
  lastReportPath?: string;
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-4
 * @pseudocode lines 080-093
 */
function consumeDuplicate(fingerprint: string, nowMs: number): DuplicateResult {
  const entry = recentReports.get(fingerprint);
  if (entry === undefined) {
    return { suppressed: false };
  }
  if (nowMs - entry.windowStartMs >= REPORT_DEDUPE_WINDOW_MS) {
    recentReports.delete(fingerprint);
    return { suppressed: false };
  }
  entry.suppressedCount = entry.suppressedCount + 1;
  return {
    suppressed: true,
    count: entry.suppressedCount,
    lastReportPath: entry.lastReportPath,
  };
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-4
 * @pseudocode lines 100-111
 */
function rememberReport(
  fingerprint: string,
  nowMs: number,
  reportPath: string,
): void {
  for (const [key, entry] of recentReports) {
    if (nowMs - entry.windowStartMs >= REPORT_DEDUPE_WINDOW_MS) {
      recentReports.delete(key);
    }
  }
  while (recentReports.size >= MAX_TRACKED_FINGERPRINTS) {
    let oldestKey: string | undefined;
    let oldestMs = Infinity;
    for (const [key, entry] of recentReports) {
      if (entry.windowStartMs < oldestMs) {
        oldestMs = entry.windowStartMs;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      recentReports.delete(oldestKey);
    }
  }
  recentReports.set(fingerprint, {
    windowStartMs: nowMs,
    suppressedCount: 0,
    lastReportPath: reportPath,
  });
}

interface ReportFileEntry {
  path: string;
  size: number;
  mtimeMs: number;
  name: string;
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-3
 * @pseudocode lines 120-135
 */
async function collectReportFiles(
  reportingDir: string,
): Promise<ReportFileEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(reportingDir);
  } catch {
    // A missing or unreadable reporting directory makes rotation a no-op.
    return [];
  }
  const matching = names.filter((name) => REPORT_FILE_PATTERN.test(name));
  const matched: ReportFileEntry[] = [];
  for (const name of matching) {
    const full = path.join(reportingDir, name);
    let info: Stats;
    try {
      info = await fs.stat(full);
    } catch {
      // A report may vanish or become unreadable after the directory scan.
      continue;
    }
    if (info.isFile()) {
      matched.push({
        path: full,
        size: info.size,
        mtimeMs: info.mtimeMs,
        name,
      });
    }
  }
  return matched;
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-3
 * @pseudocode lines 145-148
 */
function compareReportAge(a: ReportFileEntry, b: ReportFileEntry): number {
  const byTime = a.mtimeMs - b.mtimeMs;
  if (byTime !== 0) return byTime;
  return a.name < b.name ? -1 : 1;
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-3
 * @pseudocode lines 140-161
 */
async function rotateReports(
  reportingDir: string,
  protectedPaths: ReadonlySet<string>,
): Promise<void> {
  const entries = await collectReportFiles(reportingDir);
  let count = entries.length;
  let total = entries.reduce((sum, e) => sum + e.size, 0);
  const candidates = entries
    .filter((e) => !protectedPaths.has(e.path))
    .sort(compareReportAge);

  while (
    candidates.length > 0 &&
    (count > MAX_REPORT_FILES || total > MAX_REPORT_TOTAL_BYTES)
  ) {
    const victim = candidates[0];
    candidates.splice(0, 1);
    try {
      await fs.unlink(victim.path);
    } catch {
      // Rotation is best-effort because files can change between stat and unlink.
    }
    count -= 1;
    total -= victim.size;
  }
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-3
 * @pseudocode lines 140-161
 */
function joinRotationCohort(
  reportingDir: string,
  reportPath: string,
): RotationCohort {
  let cohort = rotationCohorts.get(reportingDir);
  if (cohort === undefined) {
    cohort = { activeCallers: 0, protectedPaths: new Set<string>() };
    rotationCohorts.set(reportingDir, cohort);
  }
  cohort.activeCallers += 1;
  cohort.protectedPaths.add(reportPath);
  return cohort;
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-3
 * @pseudocode lines 140-161
 */
function leaveRotationCohort(
  reportingDir: string,
  cohort: RotationCohort,
): void {
  cohort.activeCallers -= 1;
  if (
    cohort.activeCallers === 0 &&
    rotationCohorts.get(reportingDir) === cohort
  ) {
    rotationCohorts.delete(reportingDir);
  }
}

/**
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-2, REQ-3113-5
 * @pseudocode lines 170-182
 */
async function writeMinimalReport(
  errorToReport: { message: string; stack?: string },
  baseMessage: string,
  reportPath: string,
): Promise<boolean> {
  try {
    const content = stringifyClamped({ error: errorToReport });
    await fs.writeFile(reportPath, content);
    reportToStderr(
      `${baseMessage} Partial report (excluding context) available at: ${reportPath}`,
    );
    return true;
  } catch (minimalWriteError) {
    reportToStderr(
      `${baseMessage} Failed to write even a minimal error report:`,
      minimalWriteError,
    );
    return false;
  }
}

/**
 * Generates an error report, writes it to a temporary file, and logs information to console.error.
 * @param error The error object.
 * @param context The relevant context (e.g., chat history, request contents).
 * @param type A string to identify the type of error (e.g., 'startChat', 'generateJson-api').
 * @param baseMessage The initial message to log to console.error before the report path.
 * @plan PLAN-20260807-ISSUE3113.P05
 * @requirement REQ-3113-1.2, REQ-3113-1.3, REQ-3113-1.4, REQ-3113-2, REQ-3113-3, REQ-3113-4, REQ-3113-5
 * @pseudocode lines 190-240
 */
export async function reportError(
  error: Error | unknown,
  baseMessage: string,
  context?: unknown[] | Record<string, unknown>,
  type = 'general',
  reportingDir = os.tmpdir(),
): Promise<void> {
  const errorToReport = normaliseError(error);
  const fingerprint = buildFingerprint(
    type,
    baseMessage,
    errorToReport.message,
  );
  const nowMs = Date.now();
  const duplicate = consumeDuplicate(fingerprint, nowMs);
  if (duplicate.suppressed) {
    reportToStderr(
      `${baseMessage} Duplicate error report suppressed (${duplicate.count} within ${REPORT_DEDUPE_WINDOW_MS / 1000}s). Previous report: ${duplicate.lastReportPath}`,
    );
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFileName = `llxprt-client-error-${type}-${timestamp}.json`;
  const reportPath = path.join(reportingDir, reportFileName);

  let stringifiedReportContent: string;
  try {
    stringifiedReportContent = serializeBoundedReport(errorToReport, context);
  } catch (stringifyError) {
    reportToStderr(
      `${baseMessage} Could not stringify report content (likely due to context):`,
      stringifyError,
    );
    reportToStderr('Original error that triggered report generation:', error);
    if (context !== undefined) {
      reportToStderr(
        'Original context could not be stringified or included in report.',
      );
    }
    const cohort = joinRotationCohort(reportingDir, reportPath);
    try {
      const written = await writeMinimalReport(
        errorToReport,
        baseMessage,
        reportPath,
      );
      if (written) {
        rememberReport(fingerprint, nowMs, reportPath);
        await rotateReports(reportingDir, cohort.protectedPaths);
      }
    } finally {
      leaveRotationCohort(reportingDir, cohort);
    }
    return;
  }

  const cohort = joinRotationCohort(reportingDir, reportPath);
  try {
    await fs.writeFile(reportPath, stringifiedReportContent);
  } catch (writeError) {
    reportToStderr(
      `${baseMessage} Additionally, failed to write detailed error report:`,
      writeError,
    );
    reportToStderr('Original error that triggered report generation:', error);
    if (context !== undefined) {
      logContextFallback(context);
    }
    leaveRotationCohort(reportingDir, cohort);
    return;
  }

  try {
    reportToStderr(`${baseMessage} Full report available at: ${reportPath}`);
    rememberReport(fingerprint, nowMs, reportPath);
    await rotateReports(reportingDir, cohort.protectedPaths);
  } finally {
    leaveRotationCohort(reportingDir, cohort);
  }
}

function logContextFallback(context: unknown): void {
  const contextText = formatContextFallback(context);
  if (contextText === undefined) {
    reportToStderr('Original context could not be logged or stringified.');
    return;
  }
  reportToStderr('Original context:', contextText);
}

function formatContextFallback(context: unknown): string | undefined {
  try {
    return JSON.stringify(context).substring(0, 1000);
  } catch {
    try {
      return String(context).substring(0, 1000);
    } catch {
      return undefined;
    }
  }
}
