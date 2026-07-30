/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Longitudinal aggregation of OCR telemetry records (issue #2676).
 *
 * Executable CLI-style ESM module with importable pure functions. Discovers
 * ocr-telemetry.json records under an artifacts root, validates each against
 * the STRICT shared schema/validator (used by both producer and aggregator),
 * rejects malformed records rather than defaulting missing values to zero,
 * and aggregates them into longitudinal statistics with per-run trends.
 *
 * Security: uses null-prototype accumulators everywhere untrusted
 * category/severity/concurrency keys flow, so __proto__/constructor/prototype
 * cannot pollute Object.prototype. Rejects arrays masquerading as objects,
 * primitives, non-finite/negative/unsafe values, invalid timestamps, and
 * duplicate (run_id, run_attempt) records.
 *
 * CLI contract: positional <artifacts-root>, optional --format {json|markdown},
 * optional --output <path>. When --output is given the formatted output is
 * written to that file; otherwise it goes to stdout. --format selects the
 * output format (not an output path).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import {
  validateTelemetryRecord,
  isPlainObject,
} from './ocr-telemetry-schema.ts';

export { validateTelemetryRecord, isPlainObject };

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DECIMAL_DIGITS_PATTERN = /^\d+$/;
const LEADING_ZERO_PATTERN = /^0+(?=\d)/;

/**
 * Minimal structural type for OCR telemetry records used within this module.
 * The shared runtime validator in `ocr-telemetry-schema.ts` enforces the
 * authoritative strict contract; this type keeps property access typed
 * without widening to `any` or falling back to assertions.
 */
type OCRTelemetryRecord = Record<string, unknown> & {
  run_id: string;
  run_attempt: string;
  findings: Record<string, unknown> | null;
  generated_at?: string;
  inline_posted: number | null;
  total_findings: number | null;
  wall_clock_seconds: number | null;
  files_previewed: number | null;
  file_read_failure_count: number | null;
  per_file_review_failure_count: number | null;
  ocr?: Record<string, unknown>;
};

/**
 * Runtime/type guard that narrows a generic record to an OCR telemetry
 * record shape. The shared validator checks the authoritative contract; this
 * guard is only used to keep local property access typed after validation.
 */
function isTelemetryRecord(
  record: Record<string, unknown>,
): record is OCRTelemetryRecord {
  if (typeof record.run_id !== 'string') return false;
  if (typeof record.run_attempt !== 'string') return false;
  if (
    record.generated_at !== undefined &&
    typeof record.generated_at !== 'string'
  )
    return false;
  if (record.findings !== null && !isPlainObject(record.findings)) return false;
  if (record.inline_posted !== null && typeof record.inline_posted !== 'number')
    return false;
  if (
    record.total_findings !== null &&
    typeof record.total_findings !== 'number'
  )
    return false;
  if (
    record.wall_clock_seconds !== null &&
    typeof record.wall_clock_seconds !== 'number'
  )
    return false;
  if (
    record.files_previewed !== null &&
    typeof record.files_previewed !== 'number'
  )
    return false;
  if (
    record.file_read_failure_count !== null &&
    typeof record.file_read_failure_count !== 'number'
  )
    return false;
  if (
    record.per_file_review_failure_count !== null &&
    typeof record.per_file_review_failure_count !== 'number'
  )
    return false;
  if (record.ocr !== undefined && !isPlainObject(record.ocr)) return false;
  return true;
}

/**
 * Compare two records for deterministic time-series ordering using a single
 * transitive tuple: (generated_at, run_id, run_attempt). run_id and
 * run_attempt are compared numeric-aware for stable ordering.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareByTime(a: OCRTelemetryRecord, b: OCRTelemetryRecord) {
  const epochDifference =
    Date.parse(String(a.generated_at)) - Date.parse(String(b.generated_at));
  if (epochDifference !== 0) {
    return epochDifference;
  }
  const rid = numericStringCompare(a.run_id, b.run_id);
  if (rid !== 0) {
    return rid;
  }
  return numericStringCompare(String(a.run_attempt), String(b.run_attempt));
}

function numericStringCompare(a: unknown, b: unknown) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (DECIMAL_DIGITS_PATTERN.test(left) && DECIMAL_DIGITS_PATTERN.test(right)) {
    const normalizedLeft = left.replace(LEADING_ZERO_PATTERN, '');
    const normalizedRight = right.replace(LEADING_ZERO_PATTERN, '');
    return (
      normalizedLeft.length - normalizedRight.length ||
      normalizedLeft.localeCompare(normalizedRight) ||
      left.localeCompare(right)
    );
  }
  return left.localeCompare(right);
}

function mean(values: Array<number | null>) {
  const available = values.filter(
    (value): value is number => typeof value === 'number',
  );
  if (available.length === 0) {
    return null;
  }
  const sum = available.reduce((total, value) => total + value, 0);
  return sum / available.length;
}

export type TimeSeriesEntry = {
  run_id: string;
  run_attempt: string;
  generated_at?: string;
};

export type FindingsTrendEntry = TimeSeriesEntry & {
  total_findings: number | null;
};

export type DistributionTrendEntry = TimeSeriesEntry & {
  categories: Record<string, number> | null;
  severities: Record<string, number> | null;
};

export type InlineVolumeEntry = TimeSeriesEntry & {
  inline_posted: number | null;
};

export type AggregationResult = {
  runs: number;
  total_findings: number | null;
  average_findings_per_run: number | null;
  findings_available_runs: number;
  findings_total_runs: number;
  categories: Record<string, number>;
  severities: Record<string, number>;
  top_categories: Array<{ name: string; count: number }>;
  top_severities: Array<{ name: string; count: number }>;
  average_wall_clock_by_concurrency: Record<
    string,
    { average_seconds: number | null; samples: number }
  >;
  file_read_failure_rate: number | null;
  total_per_file_review_failures: number | null;
  total_files_previewed: number | null;
  total_files_reviewed: number | null;
  inline_volume: InlineVolumeEntry[];
  findings_trend: FindingsTrendEntry[];
  category_trend: DistributionTrendEntry[];
  severity_trend: DistributionTrendEntry[];
  markdown?: string;
};

/**
 * Aggregate validated telemetry records into longitudinal statistics. Each
 * record is validated (fail-closed) + reconciliation-checked before
 * aggregation. Rejects duplicate (run_id, run_attempt) records.
 * @param {Array<object>} records
 * @returns {object}
 */
export function aggregateTelemetry(
  records: Array<Record<string, unknown>>,
): AggregationResult {
  if (!Array.isArray(records)) {
    throw new Error('records must be an array');
  }
  if (records.length === 0) {
    throw new Error('no records to aggregate');
  }
  const sorted = sortAndValidate(records);
  detectDuplicates(sorted);
  const categories = aggregateKeys(sorted, 'by_category');
  const severities = aggregateKeys(sorted, 'by_severity');
  const totalFindingsValues: Array<number | null> = [];
  for (const record of sorted) {
    const value = record.total_findings;
    if (typeof value === 'number') {
      totalFindingsValues.push(value);
    } else {
      totalFindingsValues.push(null);
    }
  }
  const stats: AggregationResult = {
    runs: sorted.length,
    total_findings: sumField(sorted, 'total_findings'),
    average_findings_per_run: mean(totalFindingsValues),
    findings_available_runs: sorted.filter(
      (record) => typeof record.total_findings === 'number',
    ).length,
    findings_total_runs: sorted.length,
    categories,
    severities,
    top_categories: rankKeys(categories),
    top_severities: rankKeys(severities),
    average_wall_clock_by_concurrency: wallClockByConcurrency(sorted),
    file_read_failure_rate: fileReadFailureRate(sorted),
    total_per_file_review_failures: sumField(
      sorted,
      'per_file_review_failure_count',
    ),
    total_files_previewed: sumField(sorted, 'files_previewed'),
    total_files_reviewed: sumField(sorted, 'files_reviewed'),
    inline_volume: buildInlineVolume(sorted),
    findings_trend: buildFindingsTrend(sorted),
    category_trend: buildCategoryTrend(sorted),
    severity_trend: buildSeverityTrend(sorted),
  };
  return { ...stats, markdown: renderAggregationMarkdown(stats) };
}

function sortAndValidate(
  records: Array<Record<string, unknown>>,
): OCRTelemetryRecord[] {
  const validated: OCRTelemetryRecord[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const error = validateTelemetryRecord(record);
    if (error) {
      throw new Error(`malformed telemetry record at index ${index}: ${error}`);
    }
    if (!isTelemetryRecord(record)) {
      throw new Error(
        `malformed telemetry record at index ${index}: missing required fields`,
      );
    }
    validated.push(record);
  }
  return validated.sort(compareByTime);
}

function detectDuplicates(sorted: OCRTelemetryRecord[]) {
  const seen = new Set<string>();
  for (const record of sorted) {
    const runId = String(record.run_id);
    const runAttempt = String(record.run_attempt);
    const key = `${runId}\u0000${runAttempt}`;
    if (seen.has(key)) {
      throw new Error(
        `duplicate (run_id=${runId}, run_attempt=${runAttempt}) records are not allowed without an explicit retry policy`,
      );
    }
    seen.add(key);
  }
}

function buildInlineVolume(sorted: OCRTelemetryRecord[]): InlineVolumeEntry[] {
  return sorted.map((record) => {
    const entry: InlineVolumeEntry = {
      run_id: String(record.run_id),
      run_attempt: String(record.run_attempt),
      inline_posted: record.inline_posted,
    };
    if (typeof record.generated_at === 'string') {
      entry.generated_at = record.generated_at;
    }
    return entry;
  });
}

function buildFindingsTrend(
  sorted: OCRTelemetryRecord[],
): FindingsTrendEntry[] {
  return sorted.map((record) => {
    const entry: FindingsTrendEntry = {
      run_id: String(record.run_id),
      run_attempt: String(record.run_attempt),
      total_findings: record.total_findings,
    };
    if (typeof record.generated_at === 'string') {
      entry.generated_at = record.generated_at;
    }
    return entry;
  });
}

function buildCategoryTrend(
  sorted: OCRTelemetryRecord[],
): DistributionTrendEntry[] {
  return sorted.map((record) =>
    distributionTrendEntry(record, 'by_category', 'categories'),
  );
}

function buildSeverityTrend(
  sorted: OCRTelemetryRecord[],
): DistributionTrendEntry[] {
  return sorted.map((record) =>
    distributionTrendEntry(record, 'by_severity', 'severities'),
  );
}

function sumField(records: OCRTelemetryRecord[], field: string) {
  const available = records
    .map((record) => record[field])
    .filter(
      (value: unknown): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );
  if (available.length === 0) return null;
  let total = 0;
  for (const value of available) {
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new Error(`${field} aggregate exceeds the safe integer range`);
    }
  }
  return total;
}

/**
 * Aggregate a per-record distribution field into a prototype-safe total map.
 * @param {Array<object>} records
 * @param {string} distributionField
 * @returns {Record<string, number>}
 */
function aggregateKeys(
  records: OCRTelemetryRecord[],
  distributionField: string,
) {
  const counts = Object.create(null);
  for (const record of records) {
    const distribution = isPlainObject(record.findings)
      ? record.findings[distributionField]
      : null;
    if (!isPlainObject(distribution)) {
      continue;
    }
    for (const key of Object.keys(distribution)) {
      if (UNSAFE_KEYS.has(key)) {
        continue;
      }
      const value = distribution[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        counts[key] = (counts[key] ?? 0) + value;
      }
    }
  }
  return counts;
}

function rankKeys(counts: Record<string, number>) {
  return Object.keys(counts)
    .filter((key) => !UNSAFE_KEYS.has(key))
    .map((name) => ({ name, count: counts[name] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function wallClockByConcurrency(records: OCRTelemetryRecord[]) {
  const groups: Record<string, Array<number | null>> = Object.create(null);
  for (const record of records) {
    const ocr = record.ocr;
    let concurrency = 'unknown';
    if (typeof ocr === 'object' && ocr !== null) {
      const ocrConcurrency = ocr.concurrency;
      if (typeof ocrConcurrency === 'number') {
        concurrency = String(ocrConcurrency);
      }
    }
    const wallClock = record.wall_clock_seconds;
    if (wallClock !== null && !UNSAFE_KEYS.has(concurrency)) {
      if (groups[concurrency] === undefined) {
        groups[concurrency] = [];
      }
      groups[concurrency].push(wallClock);
    }
  }
  const result: Record<
    string,
    { average_seconds: number | null; samples: number }
  > = Object.create(null);
  for (const concurrency of Object.keys(groups)) {
    const samples = groups[concurrency].filter(
      (value): value is number => typeof value === 'number',
    );
    result[concurrency] = {
      average_seconds: mean(samples),
      samples: samples.length,
    };
  }
  return result;
}

/**
 * Compute the file-read failure rate. Returns null when the numerator or
 * denominator is unavailable — never claims a 0% rate when evidence is
 * unavailable or the denominator is zero.
 * @param {Array<object>} records
 * @returns {number|null}
 */
function fileReadFailureRate(records: OCRTelemetryRecord[]) {
  if (
    records.some(
      (record) =>
        record.files_previewed === null ||
        record.file_read_failure_count === null,
    )
  ) {
    return null;
  }
  const totalPreviewed = sumField(records, 'files_previewed');
  if (totalPreviewed === null || totalPreviewed === 0) {
    return null;
  }
  const totalFailures = sumField(records, 'file_read_failure_count');
  return totalFailures === null ? null : totalFailures / totalPreviewed;
}

function distributionTrendEntry(
  record: OCRTelemetryRecord,
  sourceField: string,
  outputField: 'categories' | 'severities',
): DistributionTrendEntry {
  const findings = record.findings;
  const sourceValue =
    findings === null ? null : safeCopy(findings[sourceField]);
  const entry: DistributionTrendEntry = {
    run_id: String(record.run_id),
    run_attempt: String(record.run_attempt),
    categories: outputField === 'categories' ? sourceValue : null,
    severities: outputField === 'severities' ? sourceValue : null,
  };
  if (typeof record.generated_at === 'string') {
    entry.generated_at = record.generated_at;
  }
  return entry;
}

function safeCopy(distribution: unknown): Record<string, number> {
  const copy = Object.create(null);
  if (!isPlainObject(distribution)) {
    return copy;
  }
  for (const key of Object.keys(distribution)) {
    if (UNSAFE_KEYS.has(key)) {
      continue;
    }
    const value = distribution[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      copy[key] = value;
    }
  }
  return copy;
}

function renderAggregationMarkdown(stats: AggregationResult) {
  const topCategories = stats.top_categories
    .slice(0, 5)
    .map((category) => `${category.name}: ${category.count}`)
    .join(', ');
  const topSeverities = stats.top_severities
    .slice(0, 5)
    .map((severity) => `${severity.name}: ${severity.count}`)
    .join(', ');
  const concurrency = Object.keys(stats.average_wall_clock_by_concurrency)
    .map((key) => {
      const group = stats.average_wall_clock_by_concurrency[key];
      const averageSeconds =
        group.average_seconds === null
          ? 'n/a'
          : group.average_seconds.toFixed(1);
      return `c=${key}: ${averageSeconds} (${group.samples} samples)`;
    })
    .join(', ');
  const inlineVolume = stats.inline_volume
    .map((entry) => `${entry.run_id}:${entry.inline_posted}`)
    .join(', ');
  const rateLabel =
    stats.file_read_failure_rate === null
      ? 'n/a'
      : `${(stats.file_read_failure_rate * 100).toFixed(2)}%`;
  const categoryTrend = stats.category_trend
    .map((entry) => {
      const categories = entry.categories;
      if (categories === null) return `${entry.run_id}{n/a}`;
      const cats = Object.keys(categories)
        .filter((k) => categories[k] > 0)
        .map((k) => `${k}=${categories[k]}`)
        .join(',');
      return `${entry.run_id}{${cats || '-'}}`;
    })
    .join(' -> ');
  const severityTrend = stats.severity_trend
    .map((entry) => {
      const severities = entry.severities;
      if (severities === null) return `${entry.run_id}{n/a}`;
      const sevs = Object.keys(severities)
        .filter((k) => severities[k] > 0)
        .map((k) => `${k}=${severities[k]}`)
        .join(',');
      return `${entry.run_id}{${sevs || '-'}}`;
    })
    .join(' -> ');
  const averageFindings = stats.average_findings_per_run ?? null;
  return [
    '## OCR Telemetry — longitudinal aggregation',
    '',
    `- runs: ${stats.runs}`,
    `- total findings: ${stats.total_findings} (${stats.findings_available_runs}/${stats.findings_total_runs} runs available)`,
    `- average findings per run: ${averageFindings === null ? 'n/a' : averageFindings.toFixed(2)} (${stats.findings_available_runs}/${stats.findings_total_runs} runs available)`,
    `- top categories: ${topCategories || 'none'}`,
    `- top severities: ${topSeverities || 'none'}`,
    `- average wall-clock by concurrency: ${concurrency || 'none'}`,
    `- file-read failure rate: ${rateLabel}`,
    `- inline volume (run:inline): ${inlineVolume || 'none'}`,
    `- category trend: ${categoryTrend || 'none'}`,
    `- severity trend: ${severityTrend || 'none'}`,
    '',
  ].join('\n');
}

function readJson(path: string): Record<string, unknown> | null {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`unable to read telemetry record at ${path}`, {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isPlainObject(parsed)) {
      throw new Error('telemetry record must be a plain object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`malformed JSON in telemetry record at ${path}`, {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

function isTelemetryEntry(entry: { isFile(): boolean; name: string }): boolean {
  return entry.isFile() && entry.name === 'ocr-telemetry.json';
}

/**
 * Recursively discover ocr-telemetry.json records under a root directory and
 * return them validated. Fails fast (throws) on any malformed record.
 * @param {string} rootPath
 * @returns {Array<Record<string, unknown>>}
 */
export function discoverTelemetryRecords(
  rootPath: string,
): Array<Record<string, unknown>> {
  let entries;
  try {
    entries = readdirSync(rootPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`unable to discover telemetry records under ${rootPath}`, {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
  const records: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      records.push(...discoverTelemetryRecords(fullPath));
    } else if (isTelemetryEntry(entry)) {
      const record = readJson(fullPath);
      if (record === null) {
        throw new Error(`malformed telemetry record: ${fullPath} is empty`);
      }
      const error = validateTelemetryRecord(record);
      if (error) {
        throw new Error(`malformed telemetry record at ${fullPath}: ${error}`);
      }
      records.push(record);
    }
  }
  return records;
}

type ParseResult = {
  format: string;
  help: boolean;
  outputPath?: string;
  rootPath?: string;
};

/**
 * Parse CLI args into { rootPath, format, outputPath }.
 * @param {Array<string>} argv
 * @returns {{rootPath?:string, format:string, outputPath?:string, help:boolean}}
 */
function parseArgs(argv: string[]): ParseResult {
  const result: ParseResult = { format: 'json', help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--format') {
      const next = argv[i + 1];
      if (next === 'json' || next === 'markdown') {
        result.format = next;
        i += 1;
      } else {
        throw new Error('--format requires a value of "json" or "markdown"');
      }
    } else if (arg === '--output') {
      const next = argv[i + 1];
      if (
        typeof next === 'string' &&
        next.length > 0 &&
        !next.startsWith('--')
      ) {
        result.outputPath = next;
        i += 1;
      } else {
        throw new Error('--output requires a file path');
      }
    } else if (!arg.startsWith('--') && result.rootPath === undefined) {
      result.rootPath = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return result;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: aggregate-ocr-telemetry.ts <artifacts-root> [options]',
      '',
      'Options:',
      '  --format <json|markdown>  Output format (default: json)',
      '  --output <path>           Write formatted output to a file (default: stdout)',
      '  -h, --help                Show this help',
      '',
    ].join('\n'),
  );
}

function main() {
  let parsed: ParseResult;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (parseError) {
    const message =
      parseError instanceof Error ? parseError.message : String(parseError);
    process.stderr.write(`${message}\n`);
    printHelp();
    process.exitCode = 2;
    return;
  }
  if (parsed.help || !parsed.rootPath) {
    printHelp();
    process.exitCode = parsed.help ? 0 : 1;
    return;
  }
  const records = discoverTelemetryRecords(parsed.rootPath);
  const result = aggregateTelemetry(records);
  const output =
    parsed.format === 'markdown'
      ? (result.markdown ?? renderAggregationMarkdown(result))
      : `${JSON.stringify(result, null, 2)}\n`;
  if (parsed.outputPath) {
    writeFileSync(resolve(parsed.outputPath), output);
  } else {
    process.stdout.write(output);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
