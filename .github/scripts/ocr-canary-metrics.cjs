/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* global module */

// --- BEGIN OCR CANARY METRICS SNIPPET ---
function buildCanaryMetrics(input) {
  const errors = [];
  const meta =
    input &&
    input.metadata &&
    typeof input.metadata === 'object' &&
    !Array.isArray(input.metadata)
      ? input.metadata
      : {};
  const requiredStrings = [
    'runUrl',
    'runId',
    'prNumber',
    'trustedBaseSha',
    'mergeBaseSha',
    'headSha',
    'expectedOcrVersion',
    'actualOcrVersion',
    'workflowSha',
    'endpointResolutionSource',
    'normalizedModel',
    'protocol',
    'language',
    'ruleJsonSha256',
    'providerUrlSha256',
    'configuredOcrSettingsSha256',
    'ocrConfigFileSha256',
    'monitorSha256',
    'audience',
    'format',
    'canonicalConfigFingerprint',
  ];
  for (const key of requiredStrings) {
    if (typeof meta[key] !== 'string' || meta[key].length === 0) {
      errors.push(`metadata ${key} is required`);
    }
  }
  for (const key of [
    'trustedBaseSha',
    'mergeBaseSha',
    'headSha',
    'workflowSha',
  ]) {
    if (typeof meta[key] === 'string' && !/^[a-fA-F0-9]{40}$/.test(meta[key])) {
      errors.push(`metadata ${key} must be an exact 40-character Git SHA`);
    }
  }
  if (meta.trustedBaseSha !== meta.mergeBaseSha) {
    errors.push(
      'trusted checkout base SHA must equal merge-base SHA for comparable canaries',
    );
  }
  for (const key of [
    'ruleJsonSha256',
    'providerUrlSha256',
    'configuredOcrSettingsSha256',
    'ocrConfigFileSha256',
    'monitorSha256',
    'canonicalConfigFingerprint',
  ]) {
    if (typeof meta[key] === 'string' && !/^[a-f0-9]{64}$/.test(meta[key])) {
      errors.push(`metadata ${key} must be a SHA-256 value`);
    }
  }
  if (meta.actualOcrVersion !== meta.expectedOcrVersion) {
    errors.push('actual OCR version does not match the expected OCR pin');
  }
  if (meta.endpointResolutionSource !== 'environment') {
    errors.push('effective endpoint resolution source must be environment');
  }
  if (meta.protocol !== 'openai' && meta.protocol !== 'anthropic') {
    errors.push('effective endpoint protocol is invalid');
  }
  const concurrency = Number(meta.concurrency);
  if (![2, 3, 4].includes(concurrency)) {
    errors.push('concurrency must be 2, 3, or 4');
  }
  const reviewTimeoutMinutes = Number(meta.reviewTimeoutMinutes);
  if (!Number.isInteger(reviewTimeoutMinutes) || reviewTimeoutMinutes <= 0) {
    errors.push('resolved review timeout must be a positive integer');
  }
  if (typeof meta.useAnthropic !== 'boolean') {
    errors.push('useAnthropic must be boolean');
  }
  if (typeof meta.backgroundEnabled !== 'boolean') {
    errors.push('backgroundEnabled must be boolean');
  } else if (meta.backgroundEnabled) {
    if (!/^[a-f0-9]{64}$/.test(meta.backgroundContextSha256 || '')) {
      errors.push('enabled background context requires a SHA-256 value');
    }
  } else if (meta.backgroundContextSha256 !== null) {
    errors.push('disabled background context hash must be null');
  }

  const exitCodeText =
    input && typeof input.exitCodeText === 'string' ? input.exitCodeText : '';
  const parsedExitCode = /^-?[0-9]+$/.test(exitCodeText.trim())
    ? Number(exitCodeText.trim())
    : null;
  const exactZeroExit = /^0\n?$/.test(exitCodeText);
  if (!exactZeroExit) {
    errors.push('OCR exit code must be exactly zero');
  }

  const timingInput = input && input.commandTiming;
  let commandWallSeconds = null;
  if (
    timingInput &&
    typeof timingInput === 'object' &&
    !Array.isArray(timingInput)
  ) {
    commandWallSeconds = timingInput.command_wall_seconds;
    if (
      timingInput.schema_version !== 1 ||
      typeof commandWallSeconds !== 'number' ||
      !Number.isFinite(commandWallSeconds) ||
      commandWallSeconds < 0
    ) {
      errors.push('OCR command wall timing is invalid');
    }
    if (
      !Number.isInteger(timingInput.exit_code) ||
      timingInput.exit_code !== parsedExitCode
    ) {
      errors.push(
        'OCR command timing exit code disagrees with review exit code',
      );
    }
  } else {
    errors.push('OCR command timing is missing');
  }

  const transportInput = input && input.transportTelemetry;
  let transport = null;
  if (
    transportInput &&
    typeof transportInput === 'object' &&
    !Array.isArray(transportInput)
  ) {
    const distribution = {};
    if (
      transportInput.responses_by_status &&
      typeof transportInput.responses_by_status === 'object' &&
      !Array.isArray(transportInput.responses_by_status)
    ) {
      for (const [status, count] of Object.entries(
        transportInput.responses_by_status,
      )) {
        if (
          /^[1-5][0-9]{2}$/.test(status) &&
          Number.isInteger(count) &&
          count >= 0
        ) {
          distribution[status] = count;
        } else {
          errors.push('transport status distribution is invalid');
        }
      }
    } else {
      errors.push('transport status distribution is missing');
    }
    transport = {
      schema_version: transportInput.schema_version,
      monitor_sha256: transportInput.monitor_sha256,
      bind_address: transportInput.bind_address,
      target_protocol: transportInput.target_protocol,
      shutdown_signal: transportInput.shutdown_signal,
      shutdown_complete: transportInput.shutdown_complete,
      total_requests: transportInput.total_requests,
      upstream_errors: transportInput.upstream_errors,
      responses_by_status: distribution,
      http_429_responses: transportInput.http_429_responses,
      retry_events: transportInput.retry_events,
      retry_count_header_missing: transportInput.retry_count_header_missing,
      retry_count_header_malformed: transportInput.retry_count_header_malformed,
    };
    const counters = [
      transport.total_requests,
      transport.upstream_errors,
      transport.http_429_responses,
      transport.retry_events,
      transport.retry_count_header_missing,
      transport.retry_count_header_malformed,
    ];
    if (counters.some((value) => !Number.isInteger(value) || value < 0)) {
      errors.push('transport counters are invalid');
    }
    if (
      transport.schema_version !== 1 ||
      transport.bind_address !== '127.0.0.1' ||
      (transport.target_protocol !== 'http:' &&
        transport.target_protocol !== 'https:') ||
      transport.shutdown_signal !== 'SIGTERM' ||
      transport.shutdown_complete !== true ||
      transport.monitor_sha256 !== meta.monitorSha256
    ) {
      errors.push(
        'transport monitor startup, shutdown, or provenance is invalid',
      );
    }
    if (transport.total_requests === 0) {
      errors.push('transport must observe positive monitored traffic');
    }
    if (
      transport.retry_count_header_missing !== 0 ||
      transport.retry_count_header_malformed !== 0
    ) {
      errors.push('transport retry-count headers are missing or malformed');
    }
    if ((distribution['429'] || 0) !== transport.http_429_responses) {
      errors.push('transport 429 count disagrees with status distribution');
    }
    const responseCount = Object.values(distribution).reduce(
      (total, count) => total + count,
      0,
    );
    if (
      Number.isInteger(transport.total_requests) &&
      Number.isInteger(transport.upstream_errors) &&
      responseCount + transport.upstream_errors !== transport.total_requests
    ) {
      errors.push(
        'transport request count disagrees with response and error aggregates',
      );
    }
  } else {
    errors.push('transport telemetry is missing');
  }

  const trimmedResult =
    input && typeof input.resultText === 'string'
      ? input.resultText.trim()
      : '';
  let parsed = null;
  if (trimmedResult.length === 0) {
    errors.push('OCR result is empty');
  } else {
    try {
      parsed = JSON.parse(trimmedResult);
    } catch {
      errors.push('OCR result is not valid JSON');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (
      trimmedResult.length > 0 &&
      errors.every((error) => error !== 'OCR result is not valid JSON')
    ) {
      errors.push('OCR result must be an object');
    }
    parsed = null;
  }
  const status =
    parsed && typeof parsed.status === 'string' ? parsed.status : null;
  if (status !== 'success') {
    errors.push('OCR result status must be success');
  }
  let warningCount = null;
  if (parsed) {
    if (parsed.warnings === undefined) {
      warningCount = 0;
    } else if (Array.isArray(parsed.warnings)) {
      warningCount = parsed.warnings.length;
    } else {
      errors.push('OCR result warnings must be an array when present');
    }
  }
  if (warningCount !== null && warningCount !== 0) {
    errors.push('OCR result contains warnings');
  }

  let summaryOutput = null;
  let findingsOutput = null;
  let internalElapsed = null;
  let internalElapsedSeconds = null;
  if (parsed) {
    const summary = parsed.summary;
    const comments = parsed.comments;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
      errors.push('OCR result summary is missing');
    }
    if (!Array.isArray(comments)) {
      errors.push('OCR result comments array is missing');
    }
    if (summary && typeof summary === 'object' && Array.isArray(comments)) {
      if (
        !Number.isInteger(summary.comments) ||
        summary.comments !== comments.length
      ) {
        errors.push('OCR summary comment count does not match comments length');
      }
      const numericValues = [
        summary.files_reviewed,
        summary.total_tokens,
        summary.input_tokens,
        summary.output_tokens,
        summary.cache_read_tokens ?? 0,
        summary.cache_write_tokens ?? 0,
      ];
      if (
        numericValues.some((value) => !Number.isInteger(value) || value < 0)
      ) {
        errors.push('OCR summary counters are invalid');
      }
      const elapsedMatch =
        typeof summary.elapsed === 'string'
          ? /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i.exec(
              summary.elapsed,
            )
          : null;
      if (
        !elapsedMatch ||
        !elapsedMatch.slice(1).some((part) => part !== undefined)
      ) {
        errors.push('OCR summary elapsed is invalid');
      } else {
        internalElapsed = summary.elapsed;
        internalElapsedSeconds =
          Number(elapsedMatch[1] || 0) * 3600 +
          Number(elapsedMatch[2] || 0) * 60 +
          Number(elapsedMatch[3] || 0);
      }
      if (
        numericValues.every((value) => Number.isInteger(value) && value >= 0)
      ) {
        summaryOutput = {
          files_reviewed: summary.files_reviewed,
          tokens: {
            total: summary.total_tokens,
            input: summary.input_tokens,
            output: summary.output_tokens,
            cache_read: summary.cache_read_tokens ?? 0,
            cache_write: summary.cache_write_tokens ?? 0,
          },
        };
      }
      if (
        comments.every(
          (comment) =>
            comment && typeof comment === 'object' && !Array.isArray(comment),
        )
      ) {
        const tally = (field) => {
          const counts = new Map();
          for (const comment of comments) {
            const raw = comment[field];
            const bucket =
              typeof raw === 'string' && raw.length > 0 ? raw : 'unknown';
            counts.set(bucket, (counts.get(bucket) || 0) + 1);
          }
          return Object.fromEntries(counts);
        };
        findingsOutput = {
          total: comments.length,
          by_category: tally('category'),
          by_severity: tally('severity'),
        };
      } else {
        errors.push('OCR comments must contain objects');
      }
    }
  }

  return {
    schema_version: 1,
    valid: errors.length === 0,
    validation_errors: errors,
    run: { url: meta.runUrl || null, id: meta.runId || null },
    pull_request: meta.prNumber || null,
    trusted_checkout_base_sha: meta.trustedBaseSha || null,
    merge_base_sha: meta.mergeBaseSha || null,
    head_sha: meta.headSha || null,
    concurrency: Number.isInteger(concurrency) ? concurrency : null,
    result: {
      status,
      warning_count: warningCount,
      exit_code: parsedExitCode,
    },
    timing: {
      command_wall_seconds: commandWallSeconds,
      ocr_internal_elapsed: internalElapsed,
      ocr_internal_elapsed_seconds: internalElapsedSeconds,
    },
    provenance: {
      expected_ocr_version: meta.expectedOcrVersion || null,
      actual_ocr_version: meta.actualOcrVersion || null,
      workflow_sha: meta.workflowSha || null,
      effective_endpoint: {
        resolution_source: meta.endpointResolutionSource || null,
        normalized_model: meta.normalizedModel || null,
        protocol: meta.protocol || null,
        provider_url_sha256: meta.providerUrlSha256 || null,
        language: meta.language || null,
      },
      configured_ocr_settings_sha256: meta.configuredOcrSettingsSha256 || null,
      ocr_config_file_sha256: meta.ocrConfigFileSha256 || null,
      use_anthropic:
        typeof meta.useAnthropic === 'boolean' ? meta.useAnthropic : null,
      review_timeout_minutes: Number.isInteger(reviewTimeoutMinutes)
        ? reviewTimeoutMinutes
        : null,
      rule_json_sha256: meta.ruleJsonSha256 || null,
      background_enabled:
        typeof meta.backgroundEnabled === 'boolean'
          ? meta.backgroundEnabled
          : null,
      background_context_sha256: meta.backgroundContextSha256 ?? null,
      monitor_sha256: meta.monitorSha256 || null,
      audience: meta.audience || null,
      format: meta.format || null,
      canonical_config_fingerprint: meta.canonicalConfigFingerprint || null,
    },
    summary: summaryOutput,
    findings: findingsOutput,
    transport,
  };
}
function parseOcrVersionOutput(output) {
  const lines = output.split('\n');
  const firstLine = lines[0].endsWith('\r') ? lines[0].slice(0, -1) : lines[0];
  const match =
    /^open-code-review v([0-9]+[.][0-9]+[.][0-9]+)(?: [(][a-fA-F0-9]+[)] [A-Za-z0-9._-]+[/][A-Za-z0-9._-]+)?$/.exec(
      firstLine,
    );
  const hasAdditionalVersionHeader = lines
    .slice(1)
    .some((line) => line.startsWith('open-code-review v'));
  if (!match || hasAdditionalVersionHeader) {
    throw new Error(
      'OCR version output must begin with exactly one valid open-code-review vX.Y.Z first line',
    );
  }
  return match[1];
}
// --- END OCR CANARY METRICS SNIPPET ---

module.exports = {
  buildCanaryMetrics,
  parseOcrVersionOutput,
};
