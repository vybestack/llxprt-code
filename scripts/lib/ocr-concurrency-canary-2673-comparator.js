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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isComparisonResult(value) {
  return (
    isObject(value) &&
    typeof value.valid === 'boolean' &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === 'string')
  );
}

function assertIsObject(value, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be a JSON object`);
    return false;
  }
  return true;
}

function assertEqual(actual, expected, label, errors) {
  if (actual !== expected) {
    errors.push(
      `${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function assertNonEmptyString(value, label, errors) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function isPositiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function wallTimeSpeedup(baseline, candidate) {
  if (!isPositiveFiniteNumber(baseline) || !isPositiveFiniteNumber(candidate)) {
    return null;
  }
  return (baseline - candidate) / baseline;
}

function validateArtifactShapes(artifacts, errors) {
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

function recordConcurrency(artifact, index, byConcurrency, errors) {
  const concurrency = artifact.concurrency;
  if (!REQUIRED_CONCURRENCIES.includes(concurrency)) {
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

function buildConcurrencyMap(artifacts, errors) {
  const byConcurrency = new Map();
  for (const [index, artifact] of artifacts.entries()) {
    recordConcurrency(artifact, index, byConcurrency, errors);
  }
  for (const expected of REQUIRED_CONCURRENCIES) {
    if (!byConcurrency.has(expected)) {
      errors.push(`missing artifact for concurrency ${expected}`);
    }
  }
  return byConcurrency;
}

function compareStringField(c2, c3, c4, field, errors) {
  const value = c2.provenance?.[field];
  assertNonEmptyString(value, `provenance.${field}`, errors);
  assertEqual(c3.provenance?.[field], value, `provenance.${field}`, errors);
  assertEqual(c4.provenance?.[field], value, `provenance.${field}`, errors);
}

function compareEndpointField(c2, c3, c4, field, errors) {
  const value = c2.provenance?.effective_endpoint?.[field];
  const label = `provenance.effective_endpoint.${field}`;
  assertNonEmptyString(value, label, errors);
  assertEqual(c3.provenance?.effective_endpoint?.[field], value, label, errors);
  assertEqual(c4.provenance?.effective_endpoint?.[field], value, label, errors);
}

function assertBoolean(value, label, errors) {
  if (typeof value !== 'boolean') {
    errors.push(`${label} must be a boolean`);
  }
}

function validateBackgroundProvenance(provenance, errors) {
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

function validateValueFields(provenance, errors) {
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

function compareValueFields(c2, c3, c4, errors) {
  validateValueFields(c2.provenance, errors);
  for (const field of [
    'use_anthropic',
    'review_timeout_minutes',
    'background_enabled',
    'background_context_sha256',
  ]) {
    const value = c2.provenance?.[field];
    assertEqual(c3.provenance?.[field], value, `provenance.${field}`, errors);
    assertEqual(c4.provenance?.[field], value, `provenance.${field}`, errors);
  }
}

function compareProvenance(c2, c3, c4, errors) {
  for (const field of PROVENANCE_STRING_FIELDS) {
    compareStringField(c2, c3, c4, field, errors);
  }
  for (const field of ENDPOINT_STRING_FIELDS) {
    compareEndpointField(c2, c3, c4, field, errors);
  }
  compareValueFields(c2, c3, c4, errors);
}

function responseCount(transport, label, errors) {
  if (!assertIsObject(transport?.responses_by_status, label, errors)) {
    return null;
  }
  let total = 0;
  let valid = true;
  for (const [status, count] of Object.entries(transport.responses_by_status)) {
    if (!/^\d{3}$/.test(status) || !Number.isInteger(count) || count < 0) {
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

function validateTransport(label, artifact, errors) {
  const transport = artifact.transport;
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
  assertEqual(
    transport.monitor_sha256,
    artifact.provenance?.monitor_sha256,
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

function validateRunEvidence(label, artifact, errors) {
  if (artifact.result?.status !== 'success') {
    errors.push(`${label} result status is not success`);
  }
  if (artifact.result?.exit_code !== 0) {
    errors.push(`${label} result exit_code is not zero`);
  }
  if (artifact.result?.warning_count !== 0) {
    errors.push(`${label} result warning_count is not zero`);
  }
  if (!isPositiveFiniteNumber(artifact.timing?.command_wall_seconds)) {
    errors.push(
      `${label} timing.command_wall_seconds must be a positive finite number`,
    );
  }
  if (!isPositiveInteger(artifact.summary?.files_reviewed)) {
    errors.push(`${label} summary.files_reviewed must be a positive integer`);
  }
  if (
    artifact.provenance?.expected_ocr_version !==
    artifact.provenance?.actual_ocr_version
  ) {
    errors.push(`${label} expected and actual OCR versions differ`);
  }
  validateTransport(label, artifact, errors);
}

function validateTarget(c2, c3, c4, errors) {
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

function compareReviewRange(c2, c3, c4, errors) {
  for (const field of ['trusted_checkout_base_sha', 'merge_base_sha']) {
    const value = c2[field];
    assertNonEmptyString(value, field, errors);
    assertEqual(c3[field], value, field, errors);
    assertEqual(c4[field], value, field, errors);
  }
}

function concurrencyEvidence(artifact) {
  return {
    run_url: artifact.run?.url,
    command_wall_seconds: artifact.timing?.command_wall_seconds,
    ocr_internal_elapsed_seconds: artifact.timing?.ocr_internal_elapsed_seconds,
    total_tokens: artifact.summary?.tokens?.total,
    findings_total: artifact.findings?.total,
    total_requests: artifact.transport?.total_requests,
  };
}

function buildSpeedups(c2, c3, c4) {
  return {
    c3_vs_c2: wallTimeSpeedup(
      c2.timing?.command_wall_seconds,
      c3.timing?.command_wall_seconds,
    ),
    c4_vs_c2: wallTimeSpeedup(
      c2.timing?.command_wall_seconds,
      c4.timing?.command_wall_seconds,
    ),
    c4_vs_c3: wallTimeSpeedup(
      c3.timing?.command_wall_seconds,
      c4.timing?.command_wall_seconds,
    ),
  };
}

function buildComparison(artifacts) {
  const errors = [];
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
  buildComparison,
  CANARY_2673_EXPECTED_TARGET,
  isComparisonResult,
  REQUIRED_CONCURRENCIES,
  wallTimeSpeedup,
};
