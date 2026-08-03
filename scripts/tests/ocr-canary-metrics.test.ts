/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  REPRESENTATIVE_RESULT,
  REPRESENTATIVE_TELEMETRY,
  REPRESENTATIVE_TIMING,
  buildInput,
  completeMetadata,
  runBuild,
} from './ocr-concurrency-canary-2673-helpers.ts';

const requireFromModule = createRequire(import.meta.url);
const mod = requireFromModule(
  '../../.github/scripts/ocr-canary-metrics.cjs',
) as {
  buildCanaryMetrics: (input: unknown) => Record<string, unknown>;
  parseOcrVersionOutput: (output: unknown) => string;
};

describe('ocr-canary-metrics.cjs — buildCanaryMetrics fully-valid input', () => {
  it('returns valid: true with empty validation_errors for valid input', () => {
    const result = runBuild(buildInput());
    expect(result['valid']).toBe(true);
    expect(result['validation_errors']).toEqual([]);
  });

  it('returns schema_version 1', () => {
    const result = runBuild(buildInput());
    expect(result['schema_version']).toBe(1);
  });

  it('populates run provenance from metadata', () => {
    const result = runBuild(buildInput());
    const run = result['run'] as Record<string, unknown>;
    const meta = completeMetadata();
    expect(run['url']).toBe(meta.runUrl);
    expect(run['id']).toBe(meta.runId);
  });

  it('populates pull_request and sha provenance', () => {
    const result = runBuild(buildInput());
    expect(result['pull_request']).toBe('2610');
    expect(result['trusted_checkout_base_sha']).toBe('a'.repeat(40));
    expect(result['merge_base_sha']).toBe('a'.repeat(40));
    expect(result['head_sha']).toBe('b'.repeat(40));
  });

  it('populates concurrency from metadata', () => {
    const result = runBuild(buildInput());
    expect(result['concurrency']).toBe(3);
  });

  it('populates result status, warning count, and exit code', () => {
    const result = runBuild(buildInput());
    const res = result['result'] as Record<string, unknown>;
    expect(res['status']).toBe('success');
    expect(res['warning_count']).toBe(0);
    expect(res['exit_code']).toBe(0);
  });

  it('populates timing with command wall seconds and internal elapsed', () => {
    const result = runBuild(buildInput());
    const timing = result['timing'] as Record<string, unknown>;
    expect(timing['command_wall_seconds']).toBe(25.25);
    expect(timing['ocr_internal_elapsed']).toBe('25s');
    expect(timing['ocr_internal_elapsed_seconds']).toBe(25);
  });

  it('populates provenance fields from metadata', () => {
    const result = runBuild(buildInput());
    const provenance = result['provenance'] as Record<string, unknown>;
    expect(provenance['expected_ocr_version']).toBe('1.7.16');
    expect(provenance['actual_ocr_version']).toBe('1.7.16');
    expect(provenance['workflow_sha']).toBe('c'.repeat(40));
    const endpoint = provenance['effective_endpoint'] as Record<
      string,
      unknown
    >;
    expect(endpoint['resolution_source']).toBe('environment');
    expect(endpoint['normalized_model']).toBe('stepfun/step-3.5-flash');
    expect(endpoint['protocol']).toBe('openai');
    expect(provenance['use_anthropic']).toBe(false);
    expect(provenance['review_timeout_minutes']).toBe(30);
    expect(provenance['audience']).toBe('agent');
    expect(provenance['format']).toBe('json');
  });

  it('populates summary output with token counts and files reviewed', () => {
    const result = runBuild(buildInput());
    const summary = result['summary'] as Record<string, unknown>;
    expect(summary['files_reviewed']).toBe(2);
    const tokens = summary['tokens'] as Record<string, unknown>;
    expect(tokens['total']).toBe(5000);
    expect(tokens['input']).toBe(4000);
    expect(tokens['output']).toBe(1000);
    expect(tokens['cache_read']).toBe(2000);
    expect(tokens['cache_write']).toBe(300);
  });

  it('populates findings with tallies by category and severity', () => {
    const result = runBuild(buildInput());
    const findings = result['findings'] as Record<string, unknown>;
    expect(findings['total']).toBe(3);
    const byCategory = findings['by_category'] as Record<string, number>;
    expect(byCategory['security']).toBe(1);
    expect(byCategory['unknown']).toBe(2);
    const bySeverity = findings['by_severity'] as Record<string, number>;
    expect(bySeverity['critical']).toBe(1);
    expect(bySeverity['undocumented-severity']).toBe(1);
    expect(bySeverity['unknown']).toBe(1);
  });

  it('populates transport telemetry fields', () => {
    const result = runBuild(buildInput());
    const transport = result['transport'] as Record<string, unknown>;
    expect(transport['schema_version']).toBe(1);
    expect(transport['monitor_sha256']).toBe('1'.repeat(64));
    expect(transport['bind_address']).toBe('127.0.0.1');
    expect(transport['target_protocol']).toBe('https:');
    expect(transport['shutdown_signal']).toBe('SIGTERM');
    expect(transport['shutdown_complete']).toBe(true);
    expect(transport['total_requests']).toBe(3);
    expect(transport['upstream_errors']).toBe(0);
    expect(transport['http_429_responses']).toBe(1);
    expect(transport['retry_events']).toBe(1);
    const distribution = transport['responses_by_status'] as Record<
      string,
      number
    >;
    expect(distribution['200']).toBe(2);
    expect(distribution['429']).toBe(1);
  });
});

describe('ocr-canary-metrics.cjs — buildCanaryMetrics validation rules', () => {
  it('reports metadata runUrl is required when missing', () => {
    const result = runBuild(
      buildInput({ metadata: completeMetadata({ runUrl: '' }) }),
    );
    expect(result['valid']).toBe(false);
    expect(result['validation_errors']).toContain(
      'metadata runUrl is required',
    );
  });

  it.each([
    'runId',
    'prNumber',
    'normalizedModel',
    'language',
    'audience',
    'format',
  ])('reports metadata %s is required', (field) => {
    const result = runBuild(
      buildInput({ metadata: completeMetadata({ [field]: '' }) }),
    );
    expect(result['validation_errors']).toContain(
      `metadata ${field} is required`,
    );
  });

  it('reports SHA must be 40-char for trustedBaseSha', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({
          trustedBaseSha: 'short',
          mergeBaseSha: 'short',
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'metadata trustedBaseSha must be an exact 40-character Git SHA',
    );
    expect(result['validation_errors']).toContain(
      'metadata mergeBaseSha must be an exact 40-character Git SHA',
    );
  });

  it('reports trustedBaseSha must equal mergeBaseSha', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({
          trustedBaseSha: 'a'.repeat(40),
          mergeBaseSha: 'b'.repeat(40),
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'trusted checkout base SHA must equal merge-base SHA for comparable canaries',
    );
  });

  it('reports SHA-256 fields must be 64-char hex', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({ ruleJsonSha256: 'short' }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'metadata ruleJsonSha256 must be a SHA-256 value',
    );
  });

  it('reports version mismatch', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({
          expectedOcrVersion: '1.7.16',
          actualOcrVersion: '1.8.0',
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'actual OCR version does not match the expected OCR pin',
    );
  });

  it('reports endpoint resolution source must be environment', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({ endpointResolutionSource: 'config' }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'effective endpoint resolution source must be environment',
    );
  });

  it('reports protocol must be openai or anthropic', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({ protocol: 'grpc' }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'effective endpoint protocol is invalid',
    );
  });

  it.each(['1', '5', '6', '0'])('reports concurrency %s is invalid', (val) => {
    const result = runBuild(
      buildInput({ metadata: completeMetadata({ concurrency: val }) }),
    );
    expect(result['validation_errors']).toContain(
      'concurrency must be 2, 3, or 4',
    );
  });

  it.each(['2', '3', '4'])('accepts concurrency %s', (val) => {
    const result = runBuild(
      buildInput({ metadata: completeMetadata({ concurrency: val }) }),
    );
    expect(result['validation_errors']).not.toContain(
      'concurrency must be 2, 3, or 4',
    );
  });

  it('reports review timeout must be positive integer', () => {
    const result = runBuild(
      buildInput({ metadata: completeMetadata({ reviewTimeoutMinutes: '0' }) }),
    );
    expect(result['validation_errors']).toContain(
      'resolved review timeout must be a positive integer',
    );
  });

  it('reports useAnthropic must be boolean', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({
          useAnthropic: 'yes' as unknown as boolean,
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'useAnthropic must be boolean',
    );
  });

  it('reports backgroundEnabled must be boolean', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({
          backgroundEnabled: 'yes' as unknown as boolean,
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'backgroundEnabled must be boolean',
    );
  });

  it('reports enabled background requires SHA-256 context hash', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({
          backgroundEnabled: true,
          backgroundContextSha256: 'not-a-hash',
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'enabled background context requires a SHA-256 value',
    );
  });

  it('reports disabled background context hash must be null', () => {
    const result = runBuild(
      buildInput({
        metadata: completeMetadata({
          backgroundEnabled: false,
          backgroundContextSha256: 'a'.repeat(64),
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'disabled background context hash must be null',
    );
  });

  it('reports OCR exit code must be exactly zero', () => {
    const result = runBuild(buildInput({ exitCodeText: '1\n' }));
    expect(result['validation_errors']).toContain(
      'OCR exit code must be exactly zero',
    );
  });

  it('reports OCR exit code must be exactly zero for "0" without newline', () => {
    const result = runBuild(buildInput({ exitCodeText: '1' }));
    expect(result['validation_errors']).toContain(
      'OCR exit code must be exactly zero',
    );
  });

  it('reports OCR command wall timing is invalid', () => {
    const result = runBuild(
      buildInput({
        commandTiming: {
          ...REPRESENTATIVE_TIMING,
          command_wall_seconds: -1,
        },
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR command wall timing is invalid',
    );
  });

  it('reports OCR command timing is missing', () => {
    const result = runBuild(
      buildInput({
        commandTiming: undefined as unknown as typeof REPRESENTATIVE_TIMING,
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR command timing is missing',
    );
  });

  it('reports OCR command timing exit code disagrees', () => {
    const result = runBuild(
      buildInput({
        commandTiming: { ...REPRESENTATIVE_TIMING, exit_code: 1 },
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR command timing exit code disagrees with review exit code',
    );
  });

  it('reports transport counters are invalid', () => {
    const result = runBuild(
      buildInput({
        transportTelemetry: {
          ...REPRESENTATIVE_TELEMETRY,
          total_requests: -1,
        },
      }),
    );
    expect(result['validation_errors']).toContain(
      'transport counters are invalid',
    );
  });

  it('reports transport status distribution is invalid', () => {
    const result = runBuild(
      buildInput({
        transportTelemetry: {
          ...REPRESENTATIVE_TELEMETRY,
          responses_by_status: { bad: 1 },
        },
      }),
    );
    expect(result['validation_errors']).toContain(
      'transport status distribution is invalid',
    );
  });

  it('reports transport 429 count disagrees with status distribution', () => {
    const result = runBuild(
      buildInput({
        transportTelemetry: {
          ...REPRESENTATIVE_TELEMETRY,
          http_429_responses: 99,
        },
      }),
    );
    expect(result['validation_errors']).toContain(
      'transport 429 count disagrees with status distribution',
    );
  });

  it('reports transport request count disagrees with aggregates', () => {
    const result = runBuild(
      buildInput({
        transportTelemetry: {
          ...REPRESENTATIVE_TELEMETRY,
          total_requests: 100,
        },
      }),
    );
    expect(result['validation_errors']).toContain(
      'transport request count disagrees with response and error aggregates',
    );
  });

  it('reports transport must observe positive monitored traffic', () => {
    const result = runBuild(
      buildInput({
        transportTelemetry: {
          ...REPRESENTATIVE_TELEMETRY,
          total_requests: 0,
          upstream_errors: 0,
          responses_by_status: {},
          http_429_responses: 0,
        },
      }),
    );
    expect(result['validation_errors']).toContain(
      'transport must observe positive monitored traffic',
    );
  });

  it('reports transport monitor startup/shutdown/provenance is invalid', () => {
    const result = runBuild(
      buildInput({
        transportTelemetry: {
          ...REPRESENTATIVE_TELEMETRY,
          shutdown_complete: false,
        },
      }),
    );
    expect(result['validation_errors']).toContain(
      'transport monitor startup, shutdown, or provenance is invalid',
    );
  });

  it('reports transport telemetry is missing', () => {
    const result = runBuild(
      buildInput({
        transportTelemetry:
          undefined as unknown as typeof REPRESENTATIVE_TELEMETRY,
      }),
    );
    expect(result['validation_errors']).toContain(
      'transport telemetry is missing',
    );
  });

  it('reports OCR result is empty', () => {
    const result = runBuild(buildInput({ resultText: '' }));
    expect(result['validation_errors']).toContain('OCR result is empty');
  });

  it('reports OCR result is not valid JSON', () => {
    const result = runBuild(buildInput({ resultText: 'not json' }));
    expect(result['validation_errors']).toContain(
      'OCR result is not valid JSON',
    );
  });

  it('reports OCR result status must be success', () => {
    const result = runBuild(
      buildInput({
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          status: 'error',
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR result status must be success',
    );
  });

  it('reports OCR result warnings must be an array when present', () => {
    const result = runBuild(
      buildInput({
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          warnings: 'not-array',
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR result warnings must be an array when present',
    );
  });

  it('reports OCR result contains warnings', () => {
    const result = runBuild(
      buildInput({
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          warnings: ['some warning'],
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR result contains warnings',
    );
  });

  it('reports OCR summary comment count does not match comments length', () => {
    const result = runBuild(
      buildInput({
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          summary: { ...REPRESENTATIVE_RESULT.summary, comments: 99 },
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR summary comment count does not match comments length',
    );
  });

  it('reports OCR summary counters are invalid', () => {
    const result = runBuild(
      buildInput({
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          summary: { ...REPRESENTATIVE_RESULT.summary, total_tokens: -1 },
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR summary counters are invalid',
    );
  });

  it('reports OCR summary elapsed is invalid', () => {
    const result = runBuild(
      buildInput({
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          summary: { ...REPRESENTATIVE_RESULT.summary, elapsed: 'garbage' },
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR summary elapsed is invalid',
    );
  });

  it('reports OCR comments must contain objects', () => {
    const result = runBuild(
      buildInput({
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          comments: ['not-an-object', 42],
        }),
      }),
    );
    expect(result['validation_errors']).toContain(
      'OCR comments must contain objects',
    );
  });
});

describe('ocr-canary-metrics.cjs — elapsed parsing variants', () => {
  it.each([
    ['1h', 3600],
    ['1m', 60],
    ['1h30m', 5400],
    ['1h2m3s', 3723],
    ['90.5s', 90.5],
  ])('parses elapsed "%s" to %s seconds', (elapsed, expectedSeconds) => {
    const result = runBuild(
      buildInput({
        resultText: JSON.stringify({
          ...REPRESENTATIVE_RESULT,
          summary: { ...REPRESENTATIVE_RESULT.summary, elapsed },
        }),
      }),
    );
    const timing = result['timing'] as Record<string, unknown>;
    expect(timing['ocr_internal_elapsed']).toBe(elapsed);
    expect(timing['ocr_internal_elapsed_seconds']).toBe(expectedSeconds);
  });
});

describe('ocr-canary-metrics.cjs — parseOcrVersionOutput', () => {
  it('parses a valid version line', () => {
    const output =
      'open-code-review v1.7.16 (a0b49d5b) linux/amd64\nsome more lines\n';
    expect(mod.parseOcrVersionOutput(output)).toBe('1.7.16');
  });

  it('parses a bare version line without metadata', () => {
    expect(mod.parseOcrVersionOutput('open-code-review v1.8.4\n')).toBe(
      '1.8.4',
    );
  });

  it('throws for an invalid first line', () => {
    expect(() => mod.parseOcrVersionOutput('garbage\n')).toThrow(
      /must begin with exactly one valid open-code-review vX.Y.Z first line/,
    );
  });

  it('throws for a duplicate version header on a later line', () => {
    const output =
      'open-code-review v1.7.16\nopen-code-review v1.8.0\nsome text\n';
    expect(() => mod.parseOcrVersionOutput(output)).toThrow(
      /must begin with exactly one valid open-code-review vX.Y.Z first line/,
    );
  });

  it('handles CRLF line endings on the first line', () => {
    expect(mod.parseOcrVersionOutput('open-code-review v1.7.16\r\n')).toBe(
      '1.7.16',
    );
  });
});
