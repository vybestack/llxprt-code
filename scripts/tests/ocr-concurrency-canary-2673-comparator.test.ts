/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  asNumberRecord,
  asRecordMap,
  asVmFunction,
} from './typed-test-helpers.ts';
import {
  CANARY_2673_EXPECTED_TARGET,
  REQUIRED_CONCURRENCIES,
  buildComparison,
  isComparisonResult,
  wallTimeSpeedup,
} from '../lib/ocr-concurrency-canary-2673-comparator.ts';

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

function makeArtifact(concurrency: number, commandWallSeconds: number) {
  return {
    schema_version: 1,
    valid: true,
    validation_errors: [],
    run: {
      url: `https://github.com/vybestack/llxprt-code/actions/runs/${concurrency}`,
      id: String(concurrency),
    },
    pull_request: CANARY_2673_EXPECTED_TARGET.pull_request,
    trusted_checkout_base_sha: 'be8f36c6e1c7f7d3a90a5955e7eab80906d695d6',
    merge_base_sha: 'be8f36c6e1c7f7d3a90a5955e7eab80906d695d6',
    head_sha: CANARY_2673_EXPECTED_TARGET.head_sha,
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

type Artifact = Omit<
  ReturnType<typeof makeArtifact>,
  'pull_request' | 'head_sha' | 'transport'
> & {
  pull_request: string;
  head_sha: string;
  transport: Omit<
    ReturnType<typeof makeArtifact>['transport'],
    'responses_by_status'
  > & {
    responses_by_status: Record<number, number>;
  };
};

function changeArtifact(index: number, change: (artifact: Artifact) => void) {
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

  it('accepts only the explicit comparator result contract', () => {
    expect(isComparisonResult({ valid: true, errors: [] })).toBe(true);
    expect(isComparisonResult({ valid: 'true', errors: [] })).toBe(false);
    expect(isComparisonResult({ valid: false, errors: 'invalid' })).toBe(false);
    expect(isComparisonResult({ valid: false, errors: [1] })).toBe(false);
  });

  it('accepts complete, comparable evidence and computes speedups', () => {
    const result = buildComparison(makeArtifacts());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    const evidence = result.evidence ?? {};
    expect(evidence['pull_request']).toBe(
      CANARY_2673_EXPECTED_TARGET.pull_request,
    );
    expect(evidence['head_sha']).toBe(CANARY_2673_EXPECTED_TARGET.head_sha);
    expect(evidence['provenance_equal']).toBe(true);
    const speedups = asNumberRecord(evidence['speedups'] ?? {});
    expect(speedups['c3_vs_c2']).toBeCloseTo(0.4297886601839534, 12);
    expect(speedups['c4_vs_c2']).toBeCloseTo(0.5578744529417086, 12);
    expect(speedups['c4_vs_c3']).toBeCloseTo(0.22462863120027815, 12);
    const concurrencies = asRecordMap(evidence['concurrencies'] ?? {});
    expect(concurrencies['2']['total_requests']).toBe(100);
  });

  it('reports equal provenance independently of non-provenance failures', () => {
    const result = buildComparison(
      changeArtifact(
        1,
        (artifact: { transport: { http_429_responses: number } }) => {
          artifact.transport.http_429_responses = 1;
        },
      ),
    );
    expect(result.valid).toBe(false);
    expect((result.evidence ?? {})['provenance_equal']).toBe(true);
  });

  it('reports unequal provenance when a provenance field differs', () => {
    const result = buildComparison(
      changeArtifact(
        1,
        (artifact: { provenance: { actual_ocr_version: string } }) => {
          artifact.provenance.actual_ocr_version = '1.7.15';
        },
      ),
    );
    expect(result.valid).toBe(false);
    expect((result.evidence ?? {})['provenance_equal']).toBe(false);
  });

  it.each<[string, unknown, RegExp]>([
    ['non-array input', {}, /must be an array/i],
    ['wrong artifact count', [], /expected exactly 3/i],
  ])('rejects %s', (_name, input, expected) => {
    const result = buildComparison(input);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });

  it('identifies the index of a primitive artifact', () => {
    const result = buildComparison([
      null,
      makeArtifact(3, 70),
      makeArtifact(4, 60),
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('artifact[0] must be a JSON object');
  });

  it('rejects an artifact marked invalid', () => {
    const result = buildComparison(
      changeArtifact(
        0,
        (artifact: { valid: boolean; validation_errors: string[] }) => {
          artifact.valid = false;
          artifact.validation_errors = ['invalid evidence'];
        },
      ),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/not valid evidence/i);
  });

  it.each([
    [
      'duplicate concurrency',
      (artifact: { concurrency: number }) => (artifact.concurrency = 2),
      /duplicate/i,
    ],
    [
      'invalid concurrency',
      (artifact: { concurrency: number }) => (artifact.concurrency = 9),
      /invalid concurrency/i,
    ],
  ])('rejects %s', (_name, change, expected) => {
    const result = buildComparison(changeArtifact(2, change));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });

  it('rejects artifacts that agree on the wrong pull request', () => {
    const artifacts: Artifact[] = makeArtifacts();
    for (const artifact of artifacts) artifact.pull_request = '9999';
    const result = buildComparison(artifacts);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/pull_request target mismatch/i);
  });

  it('rejects artifacts that agree on the wrong head SHA', () => {
    const artifacts: Artifact[] = makeArtifacts();
    for (const artifact of artifacts) artifact.head_sha = 'd'.repeat(40);
    const result = buildComparison(artifacts);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/head_sha target mismatch/i);
  });

  it.each([
    [
      'trusted base',
      (artifact: { trusted_checkout_base_sha: string }) =>
        (artifact.trusted_checkout_base_sha = 'x'.repeat(40)),
      /trusted_checkout_base_sha mismatch/i,
    ],
    [
      'merge base',
      (artifact: { merge_base_sha: string }) =>
        (artifact.merge_base_sha = 'x'.repeat(40)),
      /merge_base_sha mismatch/i,
    ],
    [
      'workflow SHA',
      (artifact: { provenance: { workflow_sha: string } }) =>
        (artifact.provenance.workflow_sha = 'z'.repeat(40)),
      /workflow_sha mismatch/i,
    ],
    [
      'OCR version',
      (artifact: { provenance: { actual_ocr_version: string } }) =>
        (artifact.provenance.actual_ocr_version = '1.7.15'),
      /actual_ocr_version mismatch/i,
    ],
    [
      'model',
      (artifact: {
        provenance: { effective_endpoint: { normalized_model: string } };
      }) =>
        (artifact.provenance.effective_endpoint.normalized_model =
          'wrong-model'),
      /normalized_model mismatch/i,
    ],
    [
      'config fingerprint',
      (artifact: { provenance: { canonical_config_fingerprint: string } }) =>
        (artifact.provenance.canonical_config_fingerprint = 'f'.repeat(64)),
      /canonical_config_fingerprint mismatch/i,
    ],
    [
      'monitor hash',
      (artifact: { provenance: { monitor_sha256: string } }) =>
        (artifact.provenance.monitor_sha256 = 'm'.repeat(64)),
      /monitor_sha256 mismatch/i,
    ],
    [
      'rule hash',
      (artifact: { provenance: { rule_json_sha256: string } }) =>
        (artifact.provenance.rule_json_sha256 = 'r'.repeat(64)),
      /rule_json_sha256 mismatch/i,
    ],
    [
      'configured settings hash',
      (artifact: { provenance: { configured_ocr_settings_sha256: string } }) =>
        (artifact.provenance.configured_ocr_settings_sha256 = 's'.repeat(64)),
      /configured_ocr_settings_sha256 mismatch/i,
    ],
    [
      'config file hash',
      (artifact: { provenance: { ocr_config_file_sha256: string } }) =>
        (artifact.provenance.ocr_config_file_sha256 = 'c'.repeat(64)),
      /ocr_config_file_sha256 mismatch/i,
    ],
    [
      'review timeout',
      (artifact: { provenance: { review_timeout_minutes: number } }) =>
        (artifact.provenance.review_timeout_minutes = 20),
      /review_timeout_minutes mismatch/i,
    ],
    [
      'background setting',
      (artifact: { provenance: { background_enabled: boolean } }) =>
        (artifact.provenance.background_enabled = false),
      /background_enabled mismatch/i,
    ],
  ])('rejects a %s mismatch in any canary', (_name, change, expected) => {
    const result = buildComparison(changeArtifact(2, change));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });

  it.each([
    [
      'string use_anthropic provenance',
      (artifact: { provenance: { use_anthropic: string } }) =>
        (artifact.provenance.use_anthropic = 'false'),
      /use_anthropic must be a boolean/i,
    ],
    [
      'zero review timeout provenance',
      (artifact: { provenance: { review_timeout_minutes: number } }) =>
        (artifact.provenance.review_timeout_minutes = 0),
      /review_timeout_minutes must be a positive integer/i,
    ],
    [
      'fractional review timeout provenance',
      (artifact: { provenance: { review_timeout_minutes: number } }) =>
        (artifact.provenance.review_timeout_minutes = 1.5),
      /review_timeout_minutes must be a positive integer/i,
    ],
    [
      'string background_enabled provenance',
      (artifact: { provenance: { background_enabled: string } }) =>
        (artifact.provenance.background_enabled = 'true'),
      /background_enabled must be a boolean/i,
    ],
    [
      'malformed enabled background hash provenance',
      (artifact: { provenance: { background_context_sha256: string } }) =>
        (artifact.provenance.background_context_sha256 = 'bad'),
      /background_context_sha256 must be a 64-character lowercase hexadecimal string/i,
    ],
    [
      'non-null disabled background hash provenance',
      (artifact: {
        provenance: {
          background_enabled: boolean;
          background_context_sha256: string;
        };
      }) => {
        artifact.provenance.background_enabled = false;
        artifact.provenance.background_context_sha256 = 'e'.repeat(64);
      },
      /background_context_sha256 must be null when background is disabled/i,
    ],
  ])('rejects matching malformed %s', (_name, change, expected) => {
    const artifacts: Artifact[] = makeArtifacts();
    for (const artifact of artifacts) asVmFunction(change)(artifact);
    const result = buildComparison(artifacts);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
    expect((result.evidence ?? {})['provenance_equal']).toBe(false);
  });

  it.each<[string, (artifact: Artifact) => void, RegExp]>([
    [
      'non-success result',
      (artifact: Artifact) => (artifact.result.status = 'failed'),
      /status is not success/i,
    ],
    [
      'warning result',
      (artifact: Artifact) => (artifact.result.warning_count = 1),
      /warning_count is not zero/i,
    ],
    [
      'zero traffic',
      (artifact: Artifact) => {
        artifact.transport.total_requests = 0;
        artifact.transport.responses_by_status = {};
      },
      /total_requests must be a positive integer/i,
    ],
    [
      'upstream error',
      (artifact: Artifact) => (artifact.transport.upstream_errors = 1),
      /upstream_errors must be zero/i,
    ],
    [
      'incomplete shutdown',
      (artifact: Artifact) => (artifact.transport.shutdown_complete = false),
      /shutdown_complete must be true/i,
    ],
    [
      'HTTP 429',
      (artifact: Artifact) => (artifact.transport.http_429_responses = 1),
      /http_429_responses must be zero/i,
    ],
    [
      'retry event',
      (artifact: Artifact) => (artifact.transport.retry_events = 1),
      /retry_events must be zero/i,
    ],
    [
      'missing retry header',
      (artifact: Artifact) =>
        (artifact.transport.retry_count_header_missing = 1),
      /retry_count_header_missing must be zero/i,
    ],
    [
      'malformed retry header',
      (artifact: Artifact) =>
        (artifact.transport.retry_count_header_malformed = 1),
      /retry_count_header_malformed must be zero/i,
    ],
    [
      'bad request accounting',
      (artifact: Artifact) =>
        (artifact.transport.responses_by_status[200] = 99),
      /request accounting mismatch/i,
    ],
  ])('rejects %s', (_name, change, expected) => {
    const result = buildComparison(changeArtifact(1, change));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(expected);
  });

  it('reports every malformed response status entry', () => {
    const result = buildComparison(
      changeArtifact(1, (artifact: Artifact) => {
        artifact.transport.responses_by_status = {
          20: 1,
          200: -1,
        };
      }),
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/responses_by_status\.20 must be/i),
        expect.stringMatching(/responses_by_status\.200 must be/i),
      ]),
    );
  });
});

describe('issue 2673 comparison constants', () => {
  it('requires exactly concurrency levels 2, 3, and 4', () => {
    expect(REQUIRED_CONCURRENCIES).toEqual([2, 3, 4]);
  });

  it('pins the experiment target independently of artifact contents', () => {
    expect(CANARY_2673_EXPECTED_TARGET).toEqual({
      pull_request: '2610',
      head_sha: 'cdd6a6cbd7169894d2ad67c7cb8fc5520d86d4d8',
    });
  });
});
