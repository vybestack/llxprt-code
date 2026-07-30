/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const REQUIRED_CONCURRENCIES = [2, 3, 4];
const CANARY_2673_EXPECTED_TARGET = Object.freeze({
  pull_request: '2610',
  head_sha: 'cdd6a6cbd7169894d2ad67c7cb8fc5520d86d4d8',
});

const PROVENANCE_STRING_FIELDS = [
  'expected_ocr_version',
  'actual_ocr_version',
  'workflow_sha',
  'configured_ocr_settings_sha256',
  'ocr_config_file_sha256',
  'rule_json_sha256',
  'canonical_config_fingerprint',
  'monitor_sha256',
  'audience',
  'format',
];

const ENDPOINT_STRING_FIELDS = [
  'resolution_source',
  'normalized_model',
  'protocol',
  'provider_url_sha256',
  'language',
];

interface ComparisonResult {
  valid: boolean;
  errors: string[];
  evidence?: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function isComparisonResult(value: unknown): value is ComparisonResult {
  return (
    isObject(value) &&
    typeof value.valid === 'boolean' &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === 'string')
  );
}

function assertIsObject(
  value: unknown,
  label: string,
  errors: string[],
): value is Record<string, unknown> {
  if (!isObject(value)) {
    errors.push(`${label} must be a JSON object`);
    return false;
  }
  return true;
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  label: string,
  errors: string[],
): void {
  if (actual !== expected) {
    errors.push(
      `${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertNonEmptyString(
  value: unknown,
  label: string,
  errors: string[],
): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function wallTimeSpeedup(
  baseline: unknown,
  candidate: unknown,
): number | null {
  if (!isPositiveFiniteNumber(baseline) || !isPositiveFiniteNumber(candidate)) {
    return null;
  }
  return (baseline - candidate) / baseline;
}

function validateArtifactShapes(artifacts: unknown[], errors: string[]): void {
  for (const [index, artifact] of artifacts.entries()) {
    if (!assertIsObject(artifact, `artifact[${index}]`, errors)) {
      continue;
    }
    if (artifact.valid !== true) {
      errors.push(`artifact[${index}] is not valid evidence`);
    }
    if (!Array.isArray(artifact.validation_errors)) {
      errors.push(`artifact[${index}] validation_errors must be an array`);
    } else if (artifact.validation_errors.length !== 0) {
      errors.push(
        `artifact[${index}] has validation errors: ${artifact.validation_errors.join('; ')}`,
      );
    }
  }
}

function recordConcurrency(
  artifact: Record<string, unknown>,
  index: number,
  byConcurrency: Map<number, Record<string, unknown>>,
  errors: string[],
): void {
  const concurrency = artifact.concurrency;
  if (
    typeof concurrency !== 'number' ||
    !REQUIRED_CONCURRENCIES.includes(concurrency)
  ) {
    errors.push(
      `artifact[${index}] has invalid concurrency ${JSON.stringify(concurrency)}; expected one of ${JSON.stringify(REQUIRED_CONCURRENCIES)}`,
    );
    return;
  }
  if (byConcurrency.has(concurrency)) {
    errors.push(`duplicate artifact for concurrency ${concurrency}`);
    return;
  }
  byConcurrency.set(concurrency, artifact);
}

function buildConcurrencyMap(
  artifacts: unknown[],
  errors: string[],
): Map<number, Record<string, unknown>> {
  const byConcurrency = new Map<number, Record<string, unknown>>();
  for (const [index, artifact] of artifacts.entries()) {
    if (!assertIsObject(artifact, `artifact[${index}]`, errors)) {
      continue;
    }
    recordConcurrency(artifact, index, byConcurrency, errors);
  }
  for (const expected of REQUIRED_CONCURRENCIES) {
    if (!byConcurrency.has(expected)) {
      errors.push(`missing artifact for concurrency ${expected}`);
    }
  }
  return byConcurrency;
}

function compareStringField(
  c2: Record<string, unknown>,
  c3: Record<string, unknown>,
  c4: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const provenance2 = toRecord(c2.provenance);
  const value = provenance2?.[field];
  assertNonEmptyString(value, `provenance.${field}`, errors);
  const provenance3 = toRecord(c3.provenance);
  const provenance4 = toRecord(c4.provenance);
  assertEqual(provenance3?.[field], value, `provenance.${field}`, errors);
  assertEqual(provenance4?.[field], value, `provenance.${field}`, errors);
}

function compareEndpointField(
  c2: Record<string, unknown>,
  c3: Record<string, unknown>,
  c4: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const provenance2 = toRecord(c2.provenance);
  const endpoint2 = toRecord(provenance2?.effective_endpoint);
  const value = endpoint2?.[field];
  const label = `provenance.effective_endpoint.${field}`;
  assertNonEmptyString(value, label, errors);
  const provenance3 = toRecord(c3.provenance);
  const endpoint3 = toRecord(provenance3?.effective_endpoint);
  const provenance4 = toRecord(c4.provenance);
  const endpoint4 = toRecord(provenance4?.effective_endpoint);
  assertEqual(endpoint3?.[field], value, label, errors);
  assertEqual(endpoint4?.[field], value, label, errors);
}

function assertBoolean(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== 'boolean') {
    errors.push(`${label} must be a boolean`);
  }
}

function validateBackgroundProvenance(
  provenance: Record<string, unknown> | undefined,
  errors: string[],
): void {
  const hash = provenance?.background_context_sha256;
  if (provenance?.background_enabled === true) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
      errors.push(
        'provenance.background_context_sha256 must be a 64-character lowercase hexadecimal string when background is enabled',
      );
    }
  } else if (provenance?.background_enabled === false && hash !== null) {
    errors.push(
      'provenance.background_context_sha256 must be null when background is disabled',
    );
  }
}

function validateValueFields(
  provenance: Record<string, unknown> | undefined,
  errors: string[],
): void {
  assertBoolean(provenance?.use_anthropic, 'provenance.use_anthropic', errors);
  if (!isPositiveInteger(provenance?.review_timeout_minutes)) {
    errors.push('provenance.review_timeout_minutes must be a positive integer');
  }
  assertBoolean(
    provenance?.background_enabled,
    'provenance.background_enabled',
    errors,
  );
  validateBackgroundProvenance(provenance, errors);
}

function compareValueFields(
  c2: Record<string, unknown>,
  c3: Record<string, unknown>,
  c4: Record<string, unknown>,
  errors: string[],
): void {
  validateValueFields(toRecord(c2.provenance), errors);
  for (const field of [
    'use_anthropic',
    'review_timeout_minutes',
    'background_enabled',
    'background_context_sha256',
  ]) {
    const provenance2 = toRecord(c2.provenance);
    const provenance3 = toRecord(c3.provenance);
    const provenance4 = toRecord(c4.provenance);
    const value = provenance2?.[field];
    assertEqual(provenance3?.[field], value, `provenance.${field}`, errors);
    assertEqual(provenance4?.[field], value, `provenance.${field}`, errors);
  }
}

function compareProvenance(
  c2: Record<string, unknown>,
  c3: Record<string, unknown>,
  c4: Record<string, unknown>,
  errors: string[],
): void {
  for (const field of PROVENANCE_STRING_FIELDS) {
    compareStringField(c2, c3, c4, field, errors);
  }
  for (const field of ENDPOINT_STRING_FIELDS) {
    compareEndpointField(c2, c3, c4, field, errors);
  }
  compareValueFields(c2, c3, c4, errors);
}

function responseCount(
  transport: Record<string, unknown>,
  label: string,
  errors: string[],
): number | null {
  const responsesByStatus = transport.responses_by_status;
  if (!assertIsObject(responsesByStatus, label, errors)) {
    return null;
  }
  let total = 0;
  let valid = true;
  for (const [status, count] of Object.entries(responsesByStatus)) {
    if (
      typeof count !== 'number' ||
      !/^\d{3}$/.test(status) ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      errors.push(
        `${label}.${status} must be a non-negative integer status count`,
      );
      valid = false;
      continue;
    }
    total += count;
  }
  return valid ? total : null;
}

function validateTransport(
  label: string,
  artifact: Record<string, unknown>,
  errors: string[],
): void {
  const transport = toRecord(artifact.transport);
  if (!assertIsObject(transport, `${label} transport`, errors)) {
    return;
  }
  if (!isPositiveInteger(transport.total_requests)) {
    errors.push(`${label} transport.total_requests must be a positive integer`);
  }
  if (transport.upstream_errors !== 0) {
    errors.push(`${label} transport.upstream_errors must be zero`);
  }
  if (transport.shutdown_complete !== true) {
    errors.push(`${label} transport.shutdown_complete must be true`);
  }
  if (transport.http_429_responses !== 0) {
    errors.push(`${label} transport.http_429_responses must be zero`);
  }
  if (transport.retry_events !== 0) {
    errors.push(`${label} transport.retry_events must be zero`);
  }
  if (transport.retry_count_header_missing !== 0) {
    errors.push(`${label} transport.retry_count_header_missing must be zero`);
  }
  if (transport.retry_count_header_malformed !== 0) {
    errors.push(`${label} transport.retry_count_header_malformed must be zero`);
  }
  const provenance = toRecord(artifact.provenance);
  assertEqual(
    transport.monitor_sha256,
    provenance?.monitor_sha256,
    `${label} transport.monitor_sha256`,
    errors,
  );
  const observedResponses = responseCount(
    transport,
    `${label} transport.responses_by_status`,
    errors,
  );
  if (
    observedResponses !== null &&
    isNonNegativeInteger(transport.upstream_errors) &&
    isNonNegativeInteger(transport.total_requests)
  ) {
    assertEqual(
      observedResponses + transport.upstream_errors,
      transport.total_requests,
      `${label} transport request accounting`,
      errors,
    );
  }
}

function validateRunEvidence(
  label: string,
  artifact: Record<string, unknown>,
  errors: string[],
): void {
  const result = toRecord(artifact.result);
  if (result?.status !== 'success') {
    errors.push(`${label} result status is not success`);
  }
  if (result?.exit_code !== 0) {
    errors.push(`${label} result exit_code is not zero`);
  }
  if (result?.warning_count !== 0) {
    errors.push(`${label} result warning_count is not zero`);
  }
  const timing = toRecord(artifact.timing);
  if (!isPositiveFiniteNumber(timing?.command_wall_seconds)) {
    errors.push(
      `${label} timing.command_wall_seconds must be a positive finite number`,
    );
  }
  const summary = toRecord(artifact.summary);
  if (!isPositiveInteger(summary?.files_reviewed)) {
    errors.push(`${label} summary.files_reviewed must be a positive integer`);
  }
  const provenance = toRecord(artifact.provenance);
  if (provenance?.expected_ocr_version !== provenance?.actual_ocr_version) {
    errors.push(`${label} expected and actual OCR versions differ`);
  }
  validateTransport(label, artifact, errors);
}

function validateTarget(
  c2: Record<string, unknown>,
  c3: Record<string, unknown>,
  c4: Record<string, unknown>,
  errors: string[],
): void {
  assertEqual(
    c2.pull_request,
    CANARY_2673_EXPECTED_TARGET.pull_request,
    'pull_request target',
    errors,
  );
  assertEqual(c3.pull_request, c2.pull_request, 'pull_request', errors);
  assertEqual(c4.pull_request, c2.pull_request, 'pull_request', errors);
  assertEqual(
    c2.head_sha,
    CANARY_2673_EXPECTED_TARGET.head_sha,
    'head_sha target',
    errors,
  );
  assertEqual(c3.head_sha, c2.head_sha, 'head_sha', errors);
  assertEqual(c4.head_sha, c2.head_sha, 'head_sha', errors);
}

function compareReviewRange(
  c2: Record<string, unknown>,
  c3: Record<string, unknown>,
  c4: Record<string, unknown>,
  errors: string[],
): void {
  for (const field of ['trusted_checkout_base_sha', 'merge_base_sha']) {
    const value = c2[field];
    assertNonEmptyString(value, field, errors);
    assertEqual(c3[field], value, field, errors);
    assertEqual(c4[field], value, field, errors);
  }
}

function concurrencyEvidence(
  artifact: Record<string, unknown>,
): Record<string, unknown> {
  const run = toRecord(artifact.run);
  const timing = toRecord(artifact.timing);
  const summary = toRecord(artifact.summary);
  const tokens = toRecord(summary?.tokens);
  const findings = toRecord(artifact.findings);
  const transport = toRecord(artifact.transport);
  return {
    run_url: run?.url,
    command_wall_seconds: timing?.command_wall_seconds,
    ocr_internal_elapsed_seconds: timing?.ocr_internal_elapsed_seconds,
    total_tokens: tokens?.total,
    findings_total: findings?.total,
    total_requests: transport?.total_requests,
  };
}

function buildSpeedups(
  c2: Record<string, unknown>,
  c3: Record<string, unknown>,
  c4: Record<string, unknown>,
): Record<string, number | null> {
  const timing2 = toRecord(c2.timing);
  const timing3 = toRecord(c3.timing);
  const timing4 = toRecord(c4.timing);
  return {
    c3_vs_c2: wallTimeSpeedup(
      timing2?.command_wall_seconds,
      timing3?.command_wall_seconds,
    ),
    c4_vs_c2: wallTimeSpeedup(
      timing2?.command_wall_seconds,
      timing4?.command_wall_seconds,
    ),
    c4_vs_c3: wallTimeSpeedup(
      timing3?.command_wall_seconds,
      timing4?.command_wall_seconds,
    ),
  };
}

export function buildComparison(artifacts: unknown): ComparisonResult {
  const errors: string[] = [];
  if (!Array.isArray(artifacts)) {
    return { valid: false, errors: ['artifacts must be an array'] };
  }
  if (artifacts.length !== REQUIRED_CONCURRENCIES.length) {
    errors.push(
      `expected exactly ${REQUIRED_CONCURRENCIES.length} artifacts, got ${artifacts.length}`,
    );
  }
  validateArtifactShapes(artifacts, errors);
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const byConcurrency = buildConcurrencyMap(artifacts, errors);
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const c2 = byConcurrency.get(2);
  const c3 = byConcurrency.get(3);
  const c4 = byConcurrency.get(4);
  if (c2 === undefined || c3 === undefined || c4 === undefined) {
    return {
      valid: false,
      errors: [...errors, 'required concurrency artifacts are missing'],
    };
  }
  validateTarget(c2, c3, c4, errors);
  compareReviewRange(c2, c3, c4, errors);
  const errorsBeforeProvenance = errors.length;
  compareProvenance(c2, c3, c4, errors);
  const provenanceEqual = errors.length === errorsBeforeProvenance;
  validateRunEvidence('c2', c2, errors);
  validateRunEvidence('c3', c3, errors);
  validateRunEvidence('c4', c4, errors);

  return {
    valid: errors.length === 0,
    errors,
    evidence: {
      pull_request: c2.pull_request,
      head_sha: c2.head_sha,
      trusted_checkout_base_sha: c2.trusted_checkout_base_sha,
      merge_base_sha: c2.merge_base_sha,
      provenance_equal: provenanceEqual,
      concurrencies: {
        2: concurrencyEvidence(c2),
        3: concurrencyEvidence(c3),
        4: concurrencyEvidence(c4),
      },
      speedups: buildSpeedups(c2, c3, c4),
    },
  };
}

export {
  CANARY_2673_EXPECTED_TARGET,
  isComparisonResult,
  REQUIRED_CONCURRENCIES,
};
