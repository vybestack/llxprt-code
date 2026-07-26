/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const SCHEMA_VERSION = 1;
export const SCHEMA_NAME = 'ocr-telemetry';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const RECORD_KEYS = [
  'schema',
  'schema_name',
  'run_id',
  'run_attempt',
  'pr_number',
  'sha',
  'generated_at',
  'ocr',
  'wall_clock_seconds',
  'cli_elapsed_seconds',
  'files_previewed',
  'files_reviewed',
  'file_read_failures',
  'file_read_failure_count',
  'per_file_review_failures',
  'per_file_review_failure_count',
  'total_findings',
  'findings',
  'inline_posted',
  'already_resolved',
  'already_posted_or_skipped_dedup',
  'comments_skipped',
  'comments_failed',
  'comments_routed_summary',
  'comments_total',
  'infrastructure_failure',
  'policy_failure',
  'completeness',
  'publication_state',
  'reviewed_range_manifest',
  'tokens',
  'telemetry_state',
  'post_state',
  'artifact_state',
  'hash_state',
  'marker_state',
  'errors',
];

const LIFECYCLE_VALUES = {
  completeness: new Set(['complete', 'partial', 'failed']),
  publication_state: new Set([
    'complete',
    'partial',
    'ambiguous',
    'failed',
    'unavailable',
  ]),
  telemetry_state: new Set(['complete', 'degraded', 'failed']),
  post_state: new Set([
    'posted',
    'partial',
    'noop',
    'failed',
    'policy-failed',
    'missing',
  ]),
  artifact_state: new Set(['prepared', 'failed']),
  hash_state: new Set(['prepared', 'failed', 'unavailable']),
};

export function isFiniteNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isFiniteNonnegativeNumber(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, name) {
  if (!isPlainObject(value)) {
    return `${name} must be a plain object`;
  }
  const actual = Reflect.ownKeys(value);
  if (!actual.every((key) => typeof key === 'string')) {
    return `${name} must be a plain object`;
  }
  const missing = expected.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0) {
    const noun = missing.length === 1 ? 'field' : 'fields';
    return `${name} is incomplete; missing ${noun}: ${missing.join(', ')}`;
  }
  if (unexpected.length > 0) {
    return `${name} contains unknown fields: ${unexpected.join(', ')}`;
  }
  return null;
}

export function isOwnNumericDistribution(value) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every(
    (key) =>
      typeof key === 'string' &&
      !UNSAFE_KEYS.has(key) &&
      isFiniteNonnegativeInteger(value[key]),
  );
}

function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}

function nullableCountError(value, name) {
  return value === null || isFiniteNonnegativeInteger(value)
    ? null
    : `${name} must be a safe nonnegative integer or null`;
}

function nullableStringError(value, name) {
  return value === null || (typeof value === 'string' && value.length > 0)
    ? null
    : `${name} must be a nonempty string or null`;
}

function enumError(value, name, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value === 'string' && LIFECYCLE_VALUES[name].has(value)) {
    return null;
  }
  const nullableSuffix = nullable ? ', or null' : '';
  return `${name} must be one of ${[...LIFECYCLE_VALUES[name]].join(', ')}${nullableSuffix}`;
}

function isCalendarExactIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const februaryDays = leap ? 29 : 28;
  const days = [31, februaryDays, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > days[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 23 || offsetMinute > 59) return false;
  return Number.isFinite(Date.parse(value));
}

function validateIdentity(record) {
  if (record.schema !== SCHEMA_VERSION)
    return `schema must be ${SCHEMA_VERSION}`;
  if (record.schema_name !== SCHEMA_NAME) {
    return `schema_name must be "${SCHEMA_NAME}"`;
  }
  const runIdError = nullableStringError(record.run_id, 'run_id');
  if (runIdError) return runIdError;
  if (
    record.run_attempt !== null &&
    (typeof record.run_attempt !== 'string' ||
      !/^[1-9]\d*$/.test(record.run_attempt) ||
      !Number.isSafeInteger(Number(record.run_attempt)))
  ) {
    return 'run_attempt must be a positive safe integer string or null';
  }
  if (
    record.pr_number !== null &&
    (!isFiniteNonnegativeInteger(record.pr_number) || record.pr_number === 0)
  ) {
    return 'pr_number must be a positive safe integer or null';
  }
  if (record.sha !== null && !/^[0-9a-f]{40}$/.test(record.sha)) {
    return 'sha must be a 40-char lowercase hex string or null';
  }
  return isCalendarExactIsoTimestamp(record.generated_at)
    ? null
    : 'generated_at must be a calendar-valid ISO-8601 timestamp';
}

function validateOcr(ocr) {
  const shapeError = exactKeys(ocr, ['version', 'model', 'concurrency'], 'ocr');
  if (shapeError) return shapeError;
  return (
    nullableStringError(ocr.version, 'ocr.version') ||
    nullableStringError(ocr.model, 'ocr.model') ||
    nullableCountError(ocr.concurrency, 'ocr.concurrency')
  );
}

const FAILURE_LIST_FIELDS = [
  ['file_read_failures', 'file_read_failure_count'],
  ['per_file_review_failures', 'per_file_review_failure_count'],
];

function validateFailureList(list, count, listName, countName) {
  if (list === null || count === null) {
    return list === null && count === null
      ? null
      : `${listName} and ${countName} must both be null when unavailable`;
  }
  if (!isStringArray(list))
    return `${listName} must be an array of nonempty strings or null`;
  if (!isFiniteNonnegativeInteger(count)) {
    return `${countName} must be a safe nonnegative integer or null`;
  }
  return list.length === count
    ? null
    : `${countName} must equal ${listName}.length`;
}

function validateFailureLists(record) {
  for (const [listName, countName] of FAILURE_LIST_FIELDS) {
    const error = validateFailureList(
      record[listName],
      record[countName],
      listName,
      countName,
    );
    if (error) return error;
  }
  return null;
}

function validateMetrics(record) {
  const ocrError = validateOcr(record.ocr);
  if (ocrError) return ocrError;
  for (const field of ['wall_clock_seconds', 'cli_elapsed_seconds']) {
    if (record[field] !== null && !isFiniteNonnegativeNumber(record[field])) {
      return `${field} must be a safe finite nonnegative number or null`;
    }
  }
  for (const field of [
    'files_previewed',
    'files_reviewed',
    'inline_posted',
    'already_resolved',
    'already_posted_or_skipped_dedup',
    'comments_skipped',
    'comments_failed',
    'comments_routed_summary',
    'comments_total',
  ]) {
    const error = nullableCountError(record[field], field);
    if (error) return error;
  }
  return validateFailureLists(record);
}

function validateFindings(record) {
  if (record.total_findings === null || record.findings === null) {
    return record.total_findings === null && record.findings === null
      ? null
      : 'total_findings and findings must both be null when unavailable';
  }
  if (!isFiniteNonnegativeInteger(record.total_findings)) {
    return 'total_findings must be a safe nonnegative integer or null';
  }
  const shapeError = exactKeys(
    record.findings,
    ['by_category', 'by_severity', 'by_category_severity'],
    'findings',
  );
  if (shapeError) return shapeError;
  if (!isOwnNumericDistribution(record.findings.by_category)) {
    return 'findings.by_category must be a safe own-key integer distribution';
  }
  if (!isOwnNumericDistribution(record.findings.by_severity)) {
    return 'findings.by_severity must be a safe own-key integer distribution';
  }
  if (!isPlainObject(record.findings.by_category_severity)) {
    return 'findings.by_category_severity must be a plain object';
  }
  for (const [category, severities] of Object.entries(
    record.findings.by_category_severity,
  )) {
    if (UNSAFE_KEYS.has(category) || !isOwnNumericDistribution(severities)) {
      return 'findings.by_category_severity must be a safe own-key nested distribution';
    }
  }
  return null;
}

function validateManifest(manifest) {
  const shapeError = exactKeys(
    manifest,
    ['selected_files', 'completed_files', 'failed_files'],
    'reviewed_range_manifest',
  );
  if (shapeError) return shapeError;
  for (const field of ['selected_files', 'completed_files', 'failed_files']) {
    if (!isFiniteNonnegativeInteger(manifest[field])) {
      return `reviewed_range_manifest.${field} must be a safe nonnegative integer`;
    }
  }
  return manifest.completed_files + manifest.failed_files <=
    manifest.selected_files
    ? null
    : 'reviewed_range_manifest completed_files + failed_files must not exceed selected_files';
}

function validateTokens(tokens) {
  const fields = ['input', 'output', 'cache_read', 'cache_write', 'total'];
  const shapeError = exactKeys(tokens, fields, 'tokens');
  if (shapeError) return shapeError;
  for (const field of fields) {
    if (!isFiniteNonnegativeInteger(tokens[field])) {
      return `tokens.${field} must be a safe nonnegative integer`;
    }
  }
  const expected = tokens.input + tokens.output;
  return Number.isSafeInteger(expected) && tokens.total === expected
    ? null
    : 'tokens.total must equal input + output';
}

function validateLifecycle(record) {
  if (typeof record.infrastructure_failure !== 'boolean') {
    return 'infrastructure_failure must be a boolean';
  }
  if (typeof record.policy_failure !== 'boolean') {
    return 'policy_failure must be a boolean';
  }
  for (const [field, nullable] of [
    ['completeness', true],
    ['publication_state', true],
    ['telemetry_state', false],
    ['post_state', true],
    ['artifact_state', false],
    ['hash_state', false],
  ]) {
    const error = enumError(record[field], field, nullable);
    if (error) return error;
  }
  const markerError = exactKeys(
    record.marker_state,
    ['infrastructure_failure', 'policy_failure'],
    'marker_state',
  );
  if (markerError) return markerError;
  return typeof record.marker_state.infrastructure_failure === 'boolean' &&
    typeof record.marker_state.policy_failure === 'boolean'
    ? null
    : 'marker_state values must be booleans';
}

function validateOptionalStructures(record) {
  if (record.reviewed_range_manifest !== null) {
    const error = validateManifest(record.reviewed_range_manifest);
    if (error) return error;
  }
  if (record.tokens !== null) {
    const error = validateTokens(record.tokens);
    if (error) return error;
  }
  return Array.isArray(record.errors) &&
    record.errors.every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
    ? null
    : 'errors must be an array of nonempty strings';
}

function safeSum(distribution) {
  let total = 0;
  for (const key of Reflect.ownKeys(distribution)) {
    total += distribution[key];
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function validateLifecycleReconciliation(record) {
  if (
    record.marker_state.infrastructure_failure !==
      record.infrastructure_failure ||
    record.marker_state.policy_failure !== record.policy_failure
  ) {
    return 'marker_state must match final failure classifications';
  }
  if (
    record.errors.length > 0 &&
    (!record.infrastructure_failure || record.telemetry_state === 'complete')
  ) {
    return 'errors require infrastructure_failure and degraded/failed telemetry_state';
  }
  if (record.infrastructure_failure && record.telemetry_state === 'complete') {
    return 'infrastructure_failure cannot have complete telemetry_state';
  }
  const hasFailedState =
    ['failed', 'policy-failed'].includes(record.post_state) ||
    record.artifact_state === 'failed' ||
    record.hash_state === 'failed';
  if (hasFailedState && !record.infrastructure_failure) {
    return 'failed post_state/artifact_state/hash_state requires infrastructure_failure';
  }
  return null;
}

function validateCountReconciliation(record) {
  if (
    record.reviewed_range_manifest !== null &&
    record.files_previewed !== null &&
    record.files_previewed !== record.reviewed_range_manifest.selected_files
  ) {
    return 'files_previewed must equal reviewed_range_manifest.selected_files';
  }
  for (const field of [
    'files_reviewed',
    'file_read_failure_count',
    'per_file_review_failure_count',
  ]) {
    if (
      record.files_previewed !== null &&
      record[field] !== null &&
      record[field] > record.files_previewed
    ) {
      return `${field} must not exceed files_previewed`;
    }
  }
  if (record.comments_total === null) return null;
  for (const field of [
    'inline_posted',
    'already_resolved',
    'already_posted_or_skipped_dedup',
    'comments_skipped',
    'comments_failed',
    'comments_routed_summary',
  ]) {
    if (record[field] !== null && record[field] > record.comments_total) {
      return `${field} must not exceed comments_total`;
    }
  }
  return null;
}

function equalKeyArrays(left, right) {
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

function validateCrossCoverage(categories, severities, cross) {
  const categoryKeys = Object.keys(categories).sort();
  const severityKeys = Object.keys(severities).sort();
  if (!equalKeyArrays(categoryKeys, Object.keys(cross).sort())) {
    return 'cross category coverage must exactly match findings.by_category';
  }
  for (const category of categoryKeys) {
    if (!equalKeyArrays(severityKeys, Object.keys(cross[category]).sort())) {
      return `cross severity ${category} must exactly match findings.by_severity`;
    }
  }
  return null;
}

function validateCrossTotals(record) {
  const {
    by_category: categories,
    by_severity: severities,
    by_category_severity: cross,
  } = record.findings;
  const coverageError = validateCrossCoverage(categories, severities, cross);
  if (coverageError) return coverageError;
  const categorySum = safeSum(categories);
  const severitySum = safeSum(severities);
  if (categorySum === null) {
    return 'findings.by_category sum exceeds safe integer range';
  }
  if (severitySum === null) {
    return 'findings.by_severity sum exceeds safe integer range';
  }
  if (categorySum !== record.total_findings) {
    return `findings.by_category sum (${categorySum}) must equal total_findings (${record.total_findings})`;
  }
  if (severitySum !== record.total_findings) {
    return `findings.by_severity sum (${severitySum}) must equal total_findings (${record.total_findings})`;
  }
  const severityKeys = Object.keys(severities);
  const severityCrossTotals = Object.fromEntries(
    severityKeys.map((key) => [key, 0]),
  );
  for (const category of Object.keys(categories)) {
    const crossCategorySum = safeSum(cross[category]);
    if (crossCategorySum === null) {
      return 'findings.by_category_severity sum exceeds safe integer range';
    }
    if (crossCategorySum !== categories[category]) {
      return `cross category ${category} must equal by_category`;
    }
    for (const severity of severityKeys) {
      severityCrossTotals[severity] += cross[category][severity];
      if (!Number.isSafeInteger(severityCrossTotals[severity])) {
        return 'findings.by_category_severity sum exceeds safe integer range';
      }
    }
  }
  for (const severity of severityKeys) {
    if (severityCrossTotals[severity] !== severities[severity]) {
      return `cross severity ${severity} must equal by_severity`;
    }
  }
  return null;
}

export function validateReconciliation(record) {
  const basicError =
    validateFailureLists(record) ||
    validateLifecycleReconciliation(record) ||
    validateCountReconciliation(record);
  if (basicError || record.total_findings === null) return basicError;
  return validateCrossTotals(record);
}

export function validateTelemetryRecord(record) {
  if (
    isPlainObject(record) &&
    Object.keys(record).some((key) => UNSAFE_KEYS.has(key))
  ) {
    return 'record must not contain unsafe __proto__/constructor/prototype keys';
  }
  const shapeError = exactKeys(record, RECORD_KEYS, 'record');
  if (shapeError) return shapeError;
  for (const validator of [
    validateIdentity,
    validateMetrics,
    validateFindings,
    validateLifecycle,
    validateOptionalStructures,
  ]) {
    const error = validator(record);
    if (error) return error;
  }
  return validateReconciliation(record);
}

export function sumDistribution(distribution) {
  if (!isOwnNumericDistribution(distribution)) return 0;
  return safeSum(distribution) ?? 0;
}
