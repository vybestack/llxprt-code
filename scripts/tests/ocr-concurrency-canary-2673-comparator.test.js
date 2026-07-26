/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildComparison,
  EXPECTED_TARGET,
  REQUIRED_CONCURRENCIES,
  wallTimeSpeedup,
} from './ocr-concurrency-canary-2673-comparator.js';

const BASE_PROVENANCE = Object.freeze({
  expected_ocr_version: '1.7.16',
  actual_ocr_version: '1.7.16',
  workflow_sha: '620f1bacf2228eb0789c43c2a38c71068e1afc52',
  effective_endpoint: {
    resolution_source: 'environment',
    normalized_model: 'step-3.7-flash',
    protocol: 'openai',
    provider_url_sha256: '9'.repeat(64),
    language: 'English',
  },
  configured_ocr_settings_sha256: 'a'.repeat(64),
  ocr_config_file_sha256: 'b'.repeat(64),
  use_anthropic: false,
  review_timeout_minutes: 30,
  rule_json_sha256: '7'.repeat(64),
  background_enabled: true,
  background_context_sha256: 'e'.repeat(64),
  monitor_sha256: '5'.repeat(64),
  audience: 'agent',
  format: 'json',
  canonical_config_fingerprint: '0'.repeat(64),
});

function makeArtifact(concurrency, commandWallSeconds) {
  return {
    schema_version: 1,
    valid: true,
    validation_errors: [],
    run: {
      url: `https://github.com/vybestack/llxprt-code/actions/runs/${concurrency}`,
      id: String(concurrency),
    },
    pull_request: EXPECTED_TARGET.pullRequest,
    trusted_checkout_base_sha: 'be8f36c6e1c7f7d3a90a5955e7eab80906d695d6',
    merge_base_sha: 'be8f36c6e1c7f7d3a90a5955e7eab80906d695d6',
    head_sha: EXPECTED_TARGET.headSha,
    concurrency,
    result: { status: 'success', warning_count: 0, exit_code: 0 },
    timing: {
      command_wall_seconds: commandWallSeconds,
      ocr_internal_elapsed_seconds: Math.round(commandWallSeconds),
    },
    provenance: JSON.parse(JSON.stringify(BASE_PROVENANCE)),
    summary: {
      files_reviewed: 63,
      tokens: { total: 3_000_000 + concurrency },
    },
    findings: { total: 60 + concurrency },
    transport: {
      schema_version: 1,
      monitor_sha256: BASE_PROVENANCE.monitor_sha256,
      bind_address: '127.0.0.1',
      target_protocol: 'https:',
      shutdown_signal: 'SIGTERM',
      shutdown_complete: true,
      total_requests: 100,
      upstream_errors: 0,
      responses_by_status: { 200: 100 },
      http_429_responses: 0,
      retry_events: 0,
      retry_count_header_missing: 0,
      retry_count_header_malformed: 0,
    },
  };
}

function makeArtifacts() {
  return [
    makeArtifact(2, 2616.549257183),
    makeArtifact(3, 1491.986057633),
    makeArtifact(4, 1156.843271737),
  ];
}

function changeArtifact(index, change) {
  const artifacts = makeArtifacts();
  change(artifacts[index]);
  return artifacts;
}

describe('ocr-concurrency-canary-2673-comparator', () => {
  it('computes fractional wall-time speedup', () => {
    expect(wallTimeSpeedup(100, 60)).toBeCloseTo(0.4, 10);
  });

  it('returns null for invalid speedup inputs', () => {
    expect(wallTimeSpeedup(0, 50)).toBeNull();
    expect(wallTimeSpeedup(Number.NaN, 50)).toBeNull();
    expect(wallTimeSpeedup(100, -1)).toBeNull();
  });

  it('accepts complete, comparable evidence and computes speedups', () => {
    const result = buildComparison(makeArtifacts());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.evidence.pull_request).toBe(EXPECTED_TARGET.pullRequest);
    expect(result.evidence.head_sha).toBe(EXPECTED_TARGET.headSha);
    expect(result.evidence.speedups.c3_vs_c2).toBeGreaterThan(0.3);
    expect(result.evidence.speedups.c4_vs_c3).toBeGreaterThan(0);
    expect(result.evidence.concurrencies[2].positive_requests).toBe(100);
  });

  it.each([
    ['non-array input', {}, /must be an array/i],
    ['wrong artifact count', [], /expected exactly 3/i],
  ])('rejects %s', (_name, input, expected) => {
    const result = buildComparison(input);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });

  it('rejects an artifact marked invalid', () => {
    const result = buildComparison(
      changeArtifact(0, (artifact) => {
        artifact.valid = false;
        artifact.validation_errors = ['invalid evidence'];
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not valid evidence/i);
  });

  it.each([
    [
      'duplicate concurrency',
      (artifact) => (artifact.concurrency = 2),
      /duplicate/i,
    ],
    [
      'invalid concurrency',
      (artifact) => (artifact.concurrency = 9),
      /invalid concurrency/i,
    ],
  ])('rejects %s', (_name, change, expected) => {
    const result = buildComparison(changeArtifact(2, change));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });

  it('rejects artifacts that agree on the wrong pull request', () => {
    const artifacts = makeArtifacts();
    for (const artifact of artifacts) artifact.pull_request = '9999';
    const result = buildComparison(artifacts);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/pull_request target mismatch/i);
  });

  it('rejects artifacts that agree on the wrong head SHA', () => {
    const artifacts = makeArtifacts();
    for (const artifact of artifacts) artifact.head_sha = 'd'.repeat(40);
    const result = buildComparison(artifacts);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/head_sha target mismatch/i);
  });

  it.each([
    [
      'trusted base',
      (artifact) => (artifact.trusted_checkout_base_sha = 'x'.repeat(40)),
      /trusted_checkout_base_sha mismatch/i,
    ],
    [
      'merge base',
      (artifact) => (artifact.merge_base_sha = 'x'.repeat(40)),
      /merge_base_sha mismatch/i,
    ],
    [
      'workflow SHA',
      (artifact) => (artifact.provenance.workflow_sha = 'z'.repeat(40)),
      /workflow_sha mismatch/i,
    ],
    [
      'OCR version',
      (artifact) => (artifact.provenance.actual_ocr_version = '1.7.15'),
      /actual_ocr_version mismatch/i,
    ],
    [
      'model',
      (artifact) =>
        (artifact.provenance.effective_endpoint.normalized_model =
          'wrong-model'),
      /normalized_model mismatch/i,
    ],
    [
      'config fingerprint',
      (artifact) =>
        (artifact.provenance.canonical_config_fingerprint = 'f'.repeat(64)),
      /canonical_config_fingerprint mismatch/i,
    ],
    [
      'monitor hash',
      (artifact) => (artifact.provenance.monitor_sha256 = 'm'.repeat(64)),
      /monitor_sha256 mismatch/i,
    ],
    [
      'rule hash',
      (artifact) => (artifact.provenance.rule_json_sha256 = 'r'.repeat(64)),
      /rule_json_sha256 mismatch/i,
    ],
    [
      'configured settings hash',
      (artifact) =>
        (artifact.provenance.configured_ocr_settings_sha256 = 's'.repeat(64)),
      /configured_ocr_settings_sha256 mismatch/i,
    ],
    [
      'config file hash',
      (artifact) =>
        (artifact.provenance.ocr_config_file_sha256 = 'c'.repeat(64)),
      /ocr_config_file_sha256 mismatch/i,
    ],
    [
      'review timeout',
      (artifact) => (artifact.provenance.review_timeout_minutes = 20),
      /review_timeout_minutes mismatch/i,
    ],
    [
      'background setting',
      (artifact) => (artifact.provenance.background_enabled = false),
      /background_enabled mismatch/i,
    ],
  ])('rejects a %s mismatch in any canary', (_name, change, expected) => {
    const result = buildComparison(changeArtifact(2, change));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });

  it.each([
    [
      'non-success result',
      (artifact) => (artifact.result.status = 'failed'),
      /status is not success/i,
    ],
    [
      'warning result',
      (artifact) => (artifact.result.warning_count = 1),
      /warning_count is not zero/i,
    ],
    [
      'zero traffic',
      (artifact) => {
        artifact.transport.total_requests = 0;
        artifact.transport.responses_by_status = {};
      },
      /total_requests must be a positive integer/i,
    ],
    [
      'upstream error',
      (artifact) => (artifact.transport.upstream_errors = 1),
      /upstream_errors must be zero/i,
    ],
    [
      'incomplete shutdown',
      (artifact) => (artifact.transport.shutdown_complete = false),
      /shutdown_complete must be true/i,
    ],
    [
      'HTTP 429',
      (artifact) => (artifact.transport.http_429_responses = 1),
      /http_429_responses must be zero/i,
    ],
    [
      'retry event',
      (artifact) => (artifact.transport.retry_events = 1),
      /retry_events must be zero/i,
    ],
    [
      'missing retry header',
      (artifact) => (artifact.transport.retry_count_header_missing = 1),
      /retry_count_header_missing must be zero/i,
    ],
    [
      'malformed retry header',
      (artifact) => (artifact.transport.retry_count_header_malformed = 1),
      /retry_count_header_malformed must be zero/i,
    ],
    [
      'bad request accounting',
      (artifact) => (artifact.transport.responses_by_status[200] = 99),
      /request accounting mismatch/i,
    ],
  ])('rejects %s', (_name, change, expected) => {
    const result = buildComparison(changeArtifact(1, change));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });
});

describe('issue 2673 comparison constants', () => {
  it('requires exactly concurrencies 2, 3, and 4', () => {
    expect(REQUIRED_CONCURRENCIES).toEqual([2, 3, 4]);
  });

  it('pins the experiment target independently of artifact contents', () => {
    expect(EXPECTED_TARGET).toEqual({
      pullRequest: '2610',
      headSha: 'cdd6a6cbd7169894d2ad67c7cb8fc5520d86d4d8',
    });
  });
});
