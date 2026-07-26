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
} from './ocr-telemetry-schema.js';

export { validateTelemetryRecord, isPlainObject };

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Compare two records for deterministic time-series ordering using a single
 * transitive tuple: (generated_at, run_id, run_attempt). run_id and
 * run_attempt are compared numeric-aware for stable ordering.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
function compareByTime(a, b) {
  const epochDifference =
    Date.parse(a.generated_at) - Date.parse(b.generated_at);
  if (epochDifference !== 0) {
    return epochDifference;
  }
  const rid = numericStringCompare(a.run_id, b.run_id);
  if (rid !== 0) {
    return rid;
  }
  return numericStringCompare(String(a.run_attempt), String(b.run_attempt));
}

function numericStringCompare(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const normalizedLeft = left.replace(/^0+(?=\d)/, '');
    const normalizedRight = right.replace(/^0+(?=\d)/, '');
    return (
      normalizedLeft.length - normalizedRight.length ||
      normalizedLeft.localeCompare(normalizedRight) ||
      left.localeCompare(right)
    );
  }
  return left.localeCompare(right);
}

function mean(values) {
  const available = values.filter((value) => typeof value === 'number');
  if (available.length === 0) {
    return null;
  }
  const sum = available.reduce((total, value) => total + value, 0);
  return sum / available.length;
}

/**
 * Aggregate validated telemetry records into longitudinal statistics. Each
 * record is validated (fail-closed) + reconciliation-checked before
 * aggregation. Rejects duplicate (run_id, run_attempt) records.
 * @param {Array<object>} records
 * @returns {object}
 */
export function aggregateTelemetry(records) {
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
  const stats = {
    runs: sorted.length,
    total_findings: sumField(sorted, 'total_findings'),
    average_findings_per_run: mean(
      sorted.map((record) => record.total_findings),
    ),
    findings_available_runs: sorted.filter(
      (record) => record.total_findings !== null,
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
    inline_volume: sorted.map(volumeEntry),
    findings_trend: sorted.map(findingsTrendEntry),
    category_trend: sorted.map(categoryTrendEntry),
    severity_trend: sorted.map(severityTrendEntry),
  };
  return { ...stats, markdown: renderAggregationMarkdown(stats) };
}

function sortAndValidate(records) {
  const validated = records.map((record, index) => {
    const error = validateTelemetryRecord(record);
    if (error) {
      throw new Error(`malformed telemetry record at index ${index}: ${error}`);
    }
    return record;
  });
  return [...validated].sort(compareByTime);
}

function detectDuplicates(sorted) {
  const seen = new Set();
  for (const record of sorted) {
    const key = `${record.run_id}\u0000${record.run_attempt}`;
    if (seen.has(key)) {
      throw new Error(
        `duplicate (run_id=${record.run_id}, run_attempt=${record.run_attempt}) records are not allowed without an explicit retry policy`,
      );
    }
    seen.add(key);
  }
}

function sumField(records, field) {
  const available = records
    .map((record) => record[field])
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
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
function aggregateKeys(records, distributionField) {
  const counts = Object.create(null);
  for (const record of records) {
    const distribution = record.findings?.[distributionField];
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

function rankKeys(counts) {
  return Object.keys(counts)
    .filter((key) => !UNSAFE_KEYS.has(key))
    .map((name) => ({ name, count: counts[name] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function wallClockByConcurrency(records) {
  const groups = Object.create(null);
  for (const record of records) {
    const concurrency = String(record.ocr?.concurrency ?? 'unknown');
    if (record.wall_clock_seconds !== null && !UNSAFE_KEYS.has(concurrency)) {
      if (groups[concurrency] === undefined) {
        groups[concurrency] = [];
      }
      groups[concurrency].push(record.wall_clock_seconds);
    }
  }
  const result = Object.create(null);
  for (const concurrency of Object.keys(groups)) {
    result[concurrency] = {
      average_seconds: mean(groups[concurrency]),
      samples: groups[concurrency].length,
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
function fileReadFailureRate(records) {
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
  if (totalPreviewed === 0) {
    return null;
  }
  return sumField(records, 'file_read_failure_count') / totalPreviewed;
}

function volumeEntry(record) {
  const entry = {
    run_id: record.run_id,
    run_attempt: record.run_attempt,
    inline_posted: record.inline_posted,
  };
  if (typeof record.generated_at === 'string') {
    entry.generated_at = record.generated_at;
  }
  return entry;
}

function findingsTrendEntry(record) {
  const entry = {
    run_id: record.run_id,
    run_attempt: record.run_attempt,
    total_findings: record.total_findings,
  };
  if (typeof record.generated_at === 'string') {
    entry.generated_at = record.generated_at;
  }
  return entry;
}

function categoryTrendEntry(record) {
  const entry = {
    run_id: record.run_id,
    run_attempt: record.run_attempt,
    categories:
      record.findings === null ? null : safeCopy(record.findings.by_category),
  };
  if (typeof record.generated_at === 'string') {
    entry.generated_at = record.generated_at;
  }
  return entry;
}

function severityTrendEntry(record) {
  const entry = {
    run_id: record.run_id,
    run_attempt: record.run_attempt,
    severities:
      record.findings === null ? null : safeCopy(record.findings.by_severity),
  };
  if (typeof record.generated_at === 'string') {
    entry.generated_at = record.generated_at;
  }
  return entry;
}

function safeCopy(distribution) {
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

function renderAggregationMarkdown(stats) {
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
      return `c=${key}: ${group.average_seconds.toFixed(1)} (${group.samples} samples)`;
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
      if (entry.categories === null) return `${entry.run_id}{n/a}`;
      const cats = Object.keys(entry.categories)
        .filter((k) => entry.categories[k] > 0)
        .map((k) => `${k}=${entry.categories[k]}`)
        .join(',');
      return `${entry.run_id}{${cats || '-'}}`;
    })
    .join(' -> ');
  const severityTrend = stats.severity_trend
    .map((entry) => {
      if (entry.severities === null) return `${entry.run_id}{n/a}`;
      const sevs = Object.keys(entry.severities)
        .filter((k) => entry.severities[k] > 0)
        .map((k) => `${k}=${entry.severities[k]}`)
        .join(',');
      return `${entry.run_id}{${sevs || '-'}}`;
    })
    .join(' -> ');
  return [
    '## OCR Telemetry — longitudinal aggregation',
    '',
    `- runs: ${stats.runs}`,
    `- total findings: ${stats.total_findings} (${stats.findings_available_runs}/${stats.findings_total_runs} runs available)`,
    `- average findings per run: ${stats.average_findings_per_run === null ? 'n/a' : stats.average_findings_per_run.toFixed(2)} (${stats.findings_available_runs}/${stats.findings_total_runs} runs available)`,
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

function readJson(path) {
  const content = readFileSync(path, 'utf8');
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return JSON.parse(trimmed);
}

function isTelemetryEntry(entry) {
  return entry.isFile() && entry.name === 'ocr-telemetry.json';
}

/**
 * Recursively discover ocr-telemetry.json records under a root directory and
 * return them validated. Fails fast (throws) on any malformed record.
 * @param {string} rootPath
 * @returns {Array<object>}
 */
export function discoverTelemetryRecords(rootPath) {
  const entries = readdirSync(rootPath, { withFileTypes: true });
  const records = [];
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

/**
 * Parse CLI args into { rootPath, format, outputPath }.
 * @param {Array<string>} argv
 * @returns {{rootPath?:string, format:string, outputPath?:string, help:boolean}}
 */
function parseArgs(argv) {
  const result = { format: 'json', help: false };
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
      if (typeof next === 'string' && next.length > 0) {
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
      'Usage: aggregate-ocr-telemetry.js <artifacts-root> [options]',
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
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (parseError) {
    process.stderr.write(`${parseError.message}\n`);
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
      ? result.markdown
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
