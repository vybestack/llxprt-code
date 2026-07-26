/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SCHEMA_NAME,
  SCHEMA_VERSION,
  isPlainObject,
  validateTelemetryRecord,
} from './ocr-telemetry-schema.js';
import {
  loadTelemetryInput,
  redactTelemetryFile,
  validateTelemetryFile,
  writeTelemetryArtifacts,
} from './ocr-telemetry-io.js';

const ELAPSED_UNIT_SECONDS = new Map([
  ['h', 3600],
  ['m', 60],
  ['s', 1],
  ['ms', 0.001],
]);
const ELAPSED_ORDER = new Map([
  ['h', 0],
  ['m', 1],
  ['s', 2],
  ['ms', 3],
]);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function elapsedToSeconds(elapsed) {
  if (
    typeof elapsed !== 'string' ||
    elapsed.length === 0 ||
    /\s/.test(elapsed)
  ) {
    return null;
  }
  let cursor = 0;
  let previousOrder = -1;
  let total = 0;
  while (cursor < elapsed.length) {
    const token = /^(\d+(?:\.\d+)?)(ms|h|m|s)/.exec(elapsed.slice(cursor));
    if (!token) return null;
    const order = ELAPSED_ORDER.get(token[2]);
    if (order === undefined || order <= previousOrder) return null;
    const value = Number(token[1]);
    if (!Number.isFinite(value)) return null;
    total += value * ELAPSED_UNIT_SECONDS.get(token[2]);
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) return null;
    previousOrder = order;
    cursor += token[0].length;
  }
  return total;
}

function validDistributionKey(value) {
  return (
    typeof value === 'string' && value.length > 0 && !UNSAFE_KEYS.has(value)
  );
}

function validDecision(decision) {
  if (!isPlainObject(decision)) return false;
  return (
    validDistributionKey(decision.category) &&
    validDistributionKey(decision.severity)
  );
}

export function crossDistribution(decisions) {
  if (!Array.isArray(decisions) || !decisions.every(validDecision)) {
    throw new Error(
      'routing decisions must be plain objects with category/severity strings',
    );
  }
  const categories = [
    ...new Set(decisions.map((decision) => decision.category)),
  ];
  const severities = [
    ...new Set(decisions.map((decision) => decision.severity)),
  ];
  const cross = Object.create(null);
  for (const category of categories) {
    cross[category] = Object.create(null);
    for (const severity of severities) cross[category][severity] = 0;
  }
  for (const decision of decisions) {
    cross[decision.category][decision.severity] += 1;
  }
  return cross;
}

export function byCategory(cross) {
  const counts = Object.create(null);
  for (const [category, severities] of Object.entries(cross)) {
    counts[category] = Object.values(severities).reduce(
      (sum, count) => sum + count,
      0,
    );
  }
  return counts;
}

export function bySeverity(cross) {
  const severities = new Set(
    Object.values(cross).flatMap((row) => Object.keys(row)),
  );
  const counts = Object.create(null);
  for (const severity of severities) {
    counts[severity] = Object.values(cross).reduce(
      (sum, row) => sum + row[severity],
      0,
    );
  }
  return counts;
}

function nullableString(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value;
}

function nullableCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function nullableNumber(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }
  return value;
}

function stringList(value) {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    return null;
  }
  return value;
}

function listCount(value) {
  const list = stringList(value);
  return list === null ? null : list.length;
}

export function normalizeTokens(tokens) {
  if (!isPlainObject(tokens)) return null;
  const fields = ['input', 'output', 'cache_read', 'cache_write', 'total'];
  const normalized = Object.fromEntries(
    fields.map((field) => [field, nullableCount(tokens[field])]),
  );
  return Object.values(normalized).some((value) => value === null)
    ? null
    : normalized;
}

function normalizeRunAttempt(value) {
  const text = nullableString(value);
  return text && /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text))
    ? text
    : null;
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string') return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf())
    ? parsed.toISOString()
    : new Date().toISOString();
}

function terminalValue(primary, secondary) {
  return nullableString(primary) ?? nullableString(secondary);
}

function artifactErrors(input) {
  const errors = Array.isArray(input.errors) ? [...input.errors] : [];
  if (!isPlainObject(input.metadata))
    errors.push('OCR metadata artifact was unavailable');
  if (!isPlainObject(input.manifest)) {
    errors.push('OCR reviewed-range manifest was unavailable');
  }
  if (!Array.isArray(input.routingDecisions)) {
    errors.push('OCR routing decisions artifact was unavailable');
  } else if (!input.routingDecisions.every(validDecision)) {
    errors.push('OCR routing decisions artifact was malformed');
  }
  const context = isPlainObject(input.context) ? input.context : {};
  if (context.previewAttempted === true && context.previewSucceeded !== true) {
    errors.push('OCR preview did not complete successfully');
  }
  if (nullableString(context.postOutcome) !== 'success') {
    errors.push('Post OCR results step did not succeed');
  }
  if (
    nullableString(context.postState) === 'failed' &&
    (nullableCount(context.inlinePosted) === null ||
      nullableCount(context.commentsTotal) === null)
  ) {
    errors.push('Post OCR results outputs were unavailable');
  }
  if (nullableString(context.sourceRedactionState) === 'failed') {
    errors.push('OCR source artifact redaction failed');
  }
  if (nullableString(context.hashState) === 'failed') {
    errors.push('OCR manifest hash preparation failed');
  }
  return [...new Set(errors)];
}

function ocrValues(metadata) {
  const ocr = isPlainObject(metadata?.ocr) ? metadata.ocr : {};
  return {
    version: nullableString(ocr.version),
    model: nullableString(ocr.model),
    concurrency: nullableCount(ocr.concurrency),
  };
}

function manifestValues(manifest) {
  if (!isPlainObject(manifest)) return null;
  const selectedFiles = listCount(manifest.selected_files);
  const completedFiles = listCount(manifest.completed_files);
  const failedFiles = listCount(manifest.failed_files);
  if ([selectedFiles, completedFiles, failedFiles].includes(null)) return null;
  return {
    selected_files: selectedFiles,
    completed_files: completedFiles,
    failed_files: failedFiles,
  };
}

function findingValues(routingDecisions) {
  if (
    !Array.isArray(routingDecisions) ||
    !routingDecisions.every(validDecision)
  ) {
    return { total: null, distributions: null };
  }
  const cross = crossDistribution(routingDecisions);
  return {
    total: routingDecisions.length,
    distributions: {
      by_category: byCategory(cross),
      by_severity: bySeverity(cross),
      by_category_severity: cross,
    },
  };
}

function failureList(value) {
  const list = stringList(value);
  return { list, count: list === null ? null : list.length };
}

function resolveTelemetryState(context, errors, infrastructureFailure) {
  const requested = nullableString(context.telemetryState);
  if (errors.length > 0) return requested === 'failed' ? 'failed' : 'degraded';
  if (requested !== null) return requested;
  return infrastructureFailure ? 'degraded' : 'complete';
}

function resolveFilesEvidence(context, manifestSummary, errors) {
  let filesPreviewed = null;
  if (context.previewSucceeded === true) {
    filesPreviewed = manifestSummary?.selected_files ?? null;
  }
  const candidate = nullableCount(context.filesReviewed);
  if (
    filesPreviewed !== null &&
    candidate !== null &&
    candidate > filesPreviewed
  ) {
    errors.push('OCR files_reviewed exceeded the successful preview scope');
    return { filesPreviewed, filesReviewed: null };
  }
  return { filesPreviewed, filesReviewed: candidate };
}

function identityFields(context) {
  const normalizedPrNumber = nullableCount(context.prNumber);
  return {
    run_id: nullableString(context.runId),
    run_attempt: normalizeRunAttempt(context.runAttempt),
    pr_number:
      normalizedPrNumber !== null && normalizedPrNumber > 0
        ? normalizedPrNumber
        : null,
    sha: nullableString(context.sha),
    generated_at: normalizeTimestamp(context.generatedAt),
  };
}

function lifecycleFailed(context, errors, postState, artifactState, hashState) {
  if (errors.length > 0 || Boolean(context.infrastructureFailure)) return true;
  if (['failed', 'policy-failed', 'missing'].includes(postState)) return true;
  return artifactState === 'failed' || hashState === 'failed';
}

function publicationFields(context) {
  return {
    inline_posted: nullableCount(context.inlinePosted),
    already_resolved: nullableCount(context.alreadyResolved),
    already_posted_or_skipped_dedup: nullableCount(
      context.alreadyPostedOrSkippedDedup,
    ),
    comments_skipped: nullableCount(context.commentsSkipped),
    comments_failed: nullableCount(context.commentsFailed),
    comments_routed_summary: nullableCount(context.commentsRoutedSummary),
    comments_total: nullableCount(context.commentsTotal),
  };
}

function buildRecord(input) {
  const metadata = isPlainObject(input.metadata) ? input.metadata : null;
  const manifest = isPlainObject(input.manifest) ? input.manifest : null;
  const context = isPlainObject(input.context) ? input.context : {};
  const errors = artifactErrors(input);
  const manifestSummary = manifestValues(manifest);
  const findings = findingValues(input.routingDecisions);
  const readFailures = failureList(context.fileReadFailures);
  const reviewFailures = failureList(context.perFileReviewFailures);
  const postState = nullableString(context.postState) ?? 'missing';
  const hashState = nullableString(context.hashState) ?? 'unavailable';
  const artifactState = nullableString(context.artifactState) ?? 'failed';
  const files = resolveFilesEvidence(context, manifestSummary, errors);
  const infrastructureFailure = lifecycleFailed(
    context,
    errors,
    postState,
    artifactState,
    hashState,
  );
  const telemetryState = resolveTelemetryState(
    context,
    errors,
    infrastructureFailure,
  );
  return {
    schema: SCHEMA_VERSION,
    schema_name: SCHEMA_NAME,
    ...identityFields(context),
    ocr: ocrValues(metadata),
    wall_clock_seconds: nullableNumber(context.wallClockSeconds),
    cli_elapsed_seconds: elapsedToSeconds(metadata?.ocr?.elapsed),
    files_previewed: files.filesPreviewed,
    files_reviewed: files.filesReviewed,
    file_read_failures: readFailures.list,
    file_read_failure_count: readFailures.count,
    per_file_review_failures: reviewFailures.list,
    per_file_review_failure_count: reviewFailures.count,
    total_findings: findings.total,
    findings: findings.distributions,
    ...publicationFields(context),
    infrastructure_failure: infrastructureFailure,
    policy_failure: Boolean(context.policyFailure),
    completeness: terminalValue(
      manifest?.completeness,
      metadata?.terminal?.completeness_state,
    ),
    publication_state: terminalValue(
      null,
      metadata?.terminal?.publication_state,
    ),
    reviewed_range_manifest: manifestSummary,
    tokens: normalizeTokens(metadata?.ocr?.tokens),
    telemetry_state: telemetryState,
    post_state: postState,
    artifact_state: artifactState,
    hash_state: hashState,
    marker_state: {
      infrastructure_failure: infrastructureFailure,
      policy_failure: Boolean(context.policyFailure),
    },
    errors,
  };
}

export function validateTelemetryInput(input) {
  if (!isPlainObject(input)) return 'telemetry input must be a plain object';
  if (!isPlainObject(input.metadata)) return 'metadata must be an object';
  if (!isPlainObject(input.metadata.ocr)) return 'metadata.ocr is required';
  if (!isPlainObject(input.manifest)) return 'manifest must be an object';
  if (!Array.isArray(input.routingDecisions))
    return 'routingDecisions must be an array';
  if (!input.routingDecisions.every(validDecision)) {
    return 'routingDecisions entries must be plain objects with category/severity strings';
  }
  if (!isPlainObject(input.context)) return 'context must be an object';
  if (!nullableString(input.context.runId)) return 'context.run_id is required';
  if (!nullableCount(input.context.prNumber) || input.context.prNumber <= 0) {
    return 'context.pr_number must be a positive integer';
  }
  return null;
}

export function buildTelemetry(input) {
  const inputError = validateTelemetryInput(input);
  if (inputError) throw new Error(`Invalid telemetry input: ${inputError}`);
  const record = buildRecord(input);
  const validationError = validateTelemetryRecord(record);
  if (validationError)
    throw new Error(`Invalid telemetry record: ${validationError}`);
  return record;
}

export function buildGuaranteedTelemetry(input, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const context = isPlainObject(source.context) ? source.context : {};
  const sourceErrors = Array.isArray(source.errors) ? source.errors : [];
  const optionErrors =
    options.error === undefined
      ? []
      : [String(options.error?.message ?? options.error)];
  const errors = [...sourceErrors, ...optionErrors].filter(
    (error) => typeof error === 'string' && error.trim().length > 0,
  );
  const candidate = buildRecord({ ...source, errors });
  const candidateError = validateTelemetryRecord(candidate);
  if (!candidateError) {
    return candidate;
  }

  const sha = nullableString(context.sha);
  const fallback = buildRecord({
    metadata: null,
    manifest: null,
    routingDecisions: null,
    errors: [...errors, candidateError, 'Telemetry fallback emitted'],
    context: {
      runId: nullableString(context.runId) ?? 'unavailable',
      runAttempt: normalizeRunAttempt(context.runAttempt),
      prNumber: nullableCount(context.prNumber),
      sha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null,
      generatedAt: normalizeTimestamp(context.generatedAt),
      infrastructureFailure: true,
      policyFailure: Boolean(context.policyFailure),
      telemetryState: 'failed',
      postState: 'failed',
      artifactState: 'failed',
      hashState: 'failed',
      postOutcome: 'failed',
      previewAttempted: false,
    },
  });
  const fallbackError = validateTelemetryRecord(fallback);
  if (fallbackError) {
    throw new Error(`Telemetry fallback is invalid: ${fallbackError}`);
  }
  return fallback;
}

function display(value) {
  return value === null ? 'n/a' : String(value);
}

function markdownCodeValue(value) {
  return display(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('`', '&#96;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;');
}

function distributionText(distribution) {
  return distribution
    ? Object.entries(distribution)
        .map(([name, count]) => `${name}: ${count}`)
        .join(', ') || 'none'
    : 'n/a';
}

function crossText(findings) {
  if (!findings) return 'n/a';
  return Object.entries(findings.by_category_severity)
    .flatMap(([category, severities]) =>
      Object.entries(severities).map(
        ([severity, count]) => `${category}×${severity}: ${count}`,
      ),
    )
    .join(', ');
}

export function renderTelemetryMarkdown(telemetry) {
  const tokenText = telemetry.tokens
    ? `${telemetry.tokens.total} total (${telemetry.tokens.input} input, ${telemetry.tokens.output} output, ${telemetry.tokens.cache_read} cache read, ${telemetry.tokens.cache_write} cache write)`
    : 'n/a';
  return [
    '## OCR Telemetry',
    '',
    `PR #${display(telemetry.pr_number)} · run \`${markdownCodeValue(telemetry.run_id)}\` · sha \`${markdownCodeValue(telemetry.sha?.slice(0, 8) ?? null)}\``,
    '',
    '| metric | value |',
    '| --- | --- |',
    `| total findings | ${display(telemetry.total_findings)} |`,
    `| files previewed / reviewed | ${display(telemetry.files_previewed)} / ${display(telemetry.files_reviewed)} |`,
    `| file-read / per-file failures | ${display(telemetry.file_read_failure_count)} / ${display(telemetry.per_file_review_failure_count)} |`,
    `| already resolved | ${display(telemetry.already_resolved)} |`,
    `| publication inline / summary / skipped / failed / total | ${display(telemetry.inline_posted)} / ${display(telemetry.comments_routed_summary)} / ${display(telemetry.comments_skipped)} / ${display(telemetry.comments_failed)} / ${display(telemetry.comments_total)} |`,
    `| publication state | ${display(telemetry.publication_state)} |`,
    `| tokens | ${tokenText} |`,
    `| wall-clock / CLI elapsed (s) | ${display(telemetry.wall_clock_seconds)} / ${display(telemetry.cli_elapsed_seconds)} |`,
    `| lifecycle telemetry / post / artifact / hash | ${telemetry.telemetry_state} / ${display(telemetry.post_state)} / ${telemetry.artifact_state} / ${telemetry.hash_state} |`,
    `| infrastructure / policy failure | ${telemetry.infrastructure_failure} / ${telemetry.policy_failure} |`,
    `| unavailable/error count | ${telemetry.errors.length} |`,
    '',
    `categories — ${distributionText(telemetry.findings?.by_category)}`,
    `severities — ${distributionText(telemetry.findings?.by_severity)}`,
    `category×severity — ${crossText(telemetry.findings)}`,
    '',
  ].join('\n');
}

function main() {
  const [command, value] = process.argv.slice(2);
  if (command === '--validate') {
    validateTelemetryFile(resolve(value ?? 'ocr-telemetry.json'));
    return;
  }
  if (command === '--redact') {
    redactTelemetryFile(resolve(value ?? 'ocr-telemetry.json'), [
      process.env.OCR_LLM_TOKEN,
      process.env.OCR_LLM_URL,
    ]);
    return;
  }
  const input = loadTelemetryInput();
  if (command === '--failure') {
    input.errors.push(value || 'Telemetry production failed');
    input.context.infrastructureFailure = true;
    input.context.telemetryState = 'failed';
  } else if (command !== undefined) {
    throw new Error(`Unknown argument: ${command}`);
  }
  const telemetry = buildGuaranteedTelemetry(input);
  writeTelemetryArtifacts(telemetry, renderTelemetryMarkdown(telemetry));
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

export { validateTelemetryRecord };
