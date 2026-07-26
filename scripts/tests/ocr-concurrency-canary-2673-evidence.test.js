/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OBSERVED_OCR_VERSION_OUTPUT,
  REPRESENTATIVE_RESULT,
  REPRESENTATIVE_TELEMETRY,
  REPRESENTATIVE_TIMING,
  buildInput,
  completeMetadata,
  runBuild,
  runEmbeddedMetricsScript,
} from './ocr-concurrency-canary-2673-helpers.js';

describe('normalized canary evidence', () => {
  it('executes the embedded metrics script against the exact observed OCR version artifact', () => {
    expect(Buffer.byteLength(OBSERVED_OCR_VERSION_OUTPUT)).toBe(123);
    const metrics = runEmbeddedMetricsScript(OBSERVED_OCR_VERSION_OUTPUT);
    expect(metrics.valid).toBe(true);
    expect(metrics.validation_errors).toEqual([]);
    expect(metrics.provenance.actual_ocr_version).toBe('1.7.16');

    const canonicalConfiguration = {
      expected_ocr_version: metrics.provenance.expected_ocr_version,
      actual_ocr_version: metrics.provenance.actual_ocr_version,
      workflow_sha: metrics.provenance.workflow_sha,
      trusted_checkout_base_sha: metrics.trusted_checkout_base_sha,
      merge_base_sha: metrics.merge_base_sha,
      effective_endpoint: metrics.provenance.effective_endpoint,
      configured_ocr_settings_sha256:
        metrics.provenance.configured_ocr_settings_sha256,
      ocr_config_file_sha256: metrics.provenance.ocr_config_file_sha256,
      use_anthropic: metrics.provenance.use_anthropic,
      review_timeout_minutes: metrics.provenance.review_timeout_minutes,
      rule_json_sha256: metrics.provenance.rule_json_sha256,
      background_enabled: metrics.provenance.background_enabled,
      background_context_sha256: metrics.provenance.background_context_sha256,
      monitor_sha256: metrics.provenance.monitor_sha256,
      audience: metrics.provenance.audience,
      format: metrics.provenance.format,
    };
    expect(metrics.provenance.canonical_config_fingerprint).toBe(
      crypto
        .createHash('sha256')
        .update(JSON.stringify(canonicalConfiguration))
        .digest('hex'),
    );
  });

  it.each([
    ['missing output', ''],
    [
      'a decoy version before a later valid-looking header',
      `release 9.9.9\n${OBSERVED_OCR_VERSION_OUTPUT}`,
    ],
    [
      'multiple version headers',
      `${OBSERVED_OCR_VERSION_OUTPUT}open-code-review v9.9.9 (deadbeef) linux/amd64\n`,
    ],
    ['an ambiguous first-line version', 'open-code-review v1.7.16 or v9.9.9\n'],
  ])('writes valid:false sanitized evidence for %s', (_name, versionOutput) => {
    const metrics = runEmbeddedMetricsScript(versionOutput);
    expect(metrics.valid).toBe(false);
    expect(metrics.validation_errors.join(' ')).toMatch(/OCR version output/i);
    expect(metrics.schema_version).toBe(1);
    expect(metrics.transport).toBeTypeOf('object');
    expect(metrics).not.toHaveProperty('raw_result');
  });

  it('records authoritative safe transport aggregates and complete provenance', () => {
    const metrics = runBuild(buildInput());
    expect(metrics.valid).toBe(true);
    expect(metrics.transport).toEqual(REPRESENTATIVE_TELEMETRY);
    expect(metrics.result).toEqual({
      status: 'success',
      warning_count: 0,
      exit_code: 0,
    });
    expect(metrics.timing).toEqual({
      command_wall_seconds: 25.25,
      ocr_internal_elapsed: '25s',
      ocr_internal_elapsed_seconds: 25,
    });
    expect(metrics.trusted_checkout_base_sha).toBe('a'.repeat(40));
    expect(metrics.merge_base_sha).toBe('a'.repeat(40));
    expect(metrics.provenance).toEqual({
      expected_ocr_version: '1.7.16',
      actual_ocr_version: '1.7.16',
      workflow_sha: 'c'.repeat(40),
      effective_endpoint: {
        resolution_source: 'environment',
        normalized_model: 'stepfun/step-3.5-flash',
        protocol: 'openai',
        provider_url_sha256: 'e'.repeat(64),
        language: 'English',
      },
      configured_ocr_settings_sha256: 'f'.repeat(64),
      ocr_config_file_sha256: '3'.repeat(64),
      use_anthropic: false,
      review_timeout_minutes: 30,
      rule_json_sha256: 'd'.repeat(64),
      background_enabled: false,
      background_context_sha256: null,
      monitor_sha256: '1'.repeat(64),
      audience: 'agent',
      format: 'json',
      canonical_config_fingerprint: '2'.repeat(64),
    });
  });

  it('normalizes elapsed/tokens and optional comment dimensions without inventing enums', () => {
    const metrics = runBuild(buildInput());
    expect(metrics.summary).toEqual({
      files_reviewed: 2,
      tokens: {
        total: 5000,
        input: 4000,
        output: 1000,
        cache_read: 2000,
        cache_write: 300,
      },
    });
    expect(metrics.findings).toEqual({
      total: 3,
      by_category: { security: 1, unknown: 2 },
      by_severity: {
        critical: 1,
        'undocumented-severity': 1,
        unknown: 1,
      },
    });
  });

  it.each([
    ['nonzero OCR exit', { exitCodeText: '1\n' }, 'exit code'],
    [
      'completed_with_errors status',
      {
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          status: 'completed_with_errors',
        }),
      },
      'status',
    ],
    [
      'completed_with_warnings status',
      {
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          status: 'completed_with_warnings',
        }),
      },
      'status',
    ],
    [
      'warnings',
      {
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          warnings: ['partial review'],
        }),
      },
      'warning',
    ],
    ['empty result', { resultText: '   ' }, 'empty'],
    ['malformed result', { resultText: '{bad' }, 'valid JSON'],
    [
      'summary/comment mismatch',
      {
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          summary: { ...REPRESENTATIVE_RESULT.summary, comments: 9 },
        }),
      },
      'comment',
    ],
  ])(
    'writes valid:false sanitized evidence for %s',
    (_name, override, error) => {
      const metrics = runBuild(buildInput(override));
      expect(metrics.valid).toBe(false);
      expect(metrics.validation_errors.join(' ')).toMatch(
        new RegExp(error, 'i'),
      );
      expect(metrics.transport).toEqual(REPRESENTATIVE_TELEMETRY);
      expect(metrics).not.toHaveProperty('raw_result');
    },
  );

  it('rejects missing, malformed, nonfinite, and exit-mismatched command timing', () => {
    for (const commandTiming of [
      null,
      { ...REPRESENTATIVE_TIMING, command_wall_seconds: -1 },
      { ...REPRESENTATIVE_TIMING, command_wall_seconds: Number.NaN },
      { ...REPRESENTATIVE_TIMING, exit_code: 9 },
    ]) {
      const metrics = runBuild(buildInput({ commandTiming }));
      expect(metrics.valid).toBe(false);
      expect(metrics.validation_errors.join(' ')).toMatch(/timing|wall|exit/i);
    }
  });

  it('rejects malformed monitor startup/teardown/telemetry evidence', () => {
    for (const transportTelemetry of [
      null,
      { ...REPRESENTATIVE_TELEMETRY, shutdown_complete: false },
      { ...REPRESENTATIVE_TELEMETRY, bind_address: '0.0.0.0' },
      { ...REPRESENTATIVE_TELEMETRY, monitor_sha256: 'wrong' },
      { ...REPRESENTATIVE_TELEMETRY, http_429_responses: -1 },
      { ...REPRESENTATIVE_TELEMETRY, total_requests: 4 },
      {
        ...REPRESENTATIVE_TELEMETRY,
        total_requests: 0,
        responses_by_status: {},
        http_429_responses: 0,
        retry_events: 0,
      },
      { ...REPRESENTATIVE_TELEMETRY, retry_count_header_missing: 1 },
      { ...REPRESENTATIVE_TELEMETRY, retry_count_header_malformed: 1 },
    ]) {
      const metrics = runBuild(buildInput({ transportTelemetry }));
      expect(metrics.valid).toBe(false);
      expect(metrics.validation_errors.join(' ')).toMatch(/transport|monitor/i);
    }
  });

  it('rejects actual OCR version drift and incomplete canonical provenance', () => {
    for (const metadata of [
      completeMetadata({ actualOcrVersion: '1.7.15' }),
      completeMetadata({ workflowSha: '' }),
      completeMetadata({ canonicalConfigFingerprint: '' }),
      completeMetadata({ backgroundEnabled: true }),
      completeMetadata({ trustedBaseSha: 'not-a-sha' }),
      completeMetadata({ mergeBaseSha: 'b'.repeat(40) }),
      completeMetadata({ endpointResolutionSource: 'configuration' }),
    ]) {
      const metrics = runBuild(buildInput({ metadata }));
      expect(metrics.valid).toBe(false);
      expect(metrics.validation_errors.length).toBeGreaterThan(0);
    }
  });
});
