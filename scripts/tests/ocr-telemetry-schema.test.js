/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  SCHEMA_NAME,
  validateTelemetryRecord,
  validateReconciliation,
  isFiniteNonnegativeInteger,
  isFiniteNonnegativeNumber,
  isOwnNumericDistribution,
} from '../ocr-telemetry-schema.js';

function validRecord(overrides = {}) {
  return {
    schema: SCHEMA_VERSION,
    schema_name: SCHEMA_NAME,
    run_id: '111',
    run_attempt: '1',
    pr_number: 2676,
    sha: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
    generated_at: '2026-07-25T23:09:35.000Z',
    ocr: { version: '1.7.16', model: 'm', concurrency: 2 },
    wall_clock_seconds: 100,
    cli_elapsed_seconds: 95,
    files_previewed: 7,
    files_reviewed: 7,
    file_read_failures: [],
    file_read_failure_count: 0,
    per_file_review_failures: [],
    per_file_review_failure_count: 0,
    total_findings: 2,
    findings: {
      by_category: { bug: 1, style: 1 },
      by_severity: { high: 1, low: 1 },
      by_category_severity: {
        bug: { high: 1, low: 0 },
        style: { high: 0, low: 1 },
      },
    },
    inline_posted: 1,
    already_resolved: null,
    already_posted_or_skipped_dedup: 1,
    comments_skipped: 1,
    comments_failed: 0,
    comments_routed_summary: 0,
    comments_total: 2,
    infrastructure_failure: false,
    policy_failure: false,
    completeness: 'complete',
    publication_state: 'complete',
    reviewed_range_manifest: {
      selected_files: 7,
      completed_files: 7,
      failed_files: 0,
    },
    tokens: {
      input: 10,
      output: 5,
      cache_read: 0,
      cache_write: 0,
      total: 15,
    },
    telemetry_state: 'complete',
    post_state: 'posted',
    artifact_state: 'prepared',
    hash_state: 'prepared',
    marker_state: {
      infrastructure_failure: false,
      policy_failure: false,
    },
    errors: [],
    ...overrides,
  };
}

describe('isFiniteNonnegativeInteger', () => {
  it('accepts a nonnegative integer', () => {
    expect(isFiniteNonnegativeInteger(0)).toBe(true);
    expect(isFiniteNonnegativeInteger(42)).toBe(true);
  });
  it('rejects negative, fractional, nonfinite, non-number', () => {
    expect(isFiniteNonnegativeInteger(-1)).toBe(false);
    expect(isFiniteNonnegativeInteger(1.5)).toBe(false);
    expect(isFiniteNonnegativeInteger(Infinity)).toBe(false);
    expect(isFiniteNonnegativeInteger(NaN)).toBe(false);
    expect(isFiniteNonnegativeInteger('1')).toBe(false);
    expect(isFiniteNonnegativeInteger(null)).toBe(false);
  });
});

describe('isFiniteNonnegativeNumber', () => {
  it('accepts a nonnegative finite number', () => {
    expect(isFiniteNonnegativeNumber(0)).toBe(true);
    expect(isFiniteNonnegativeNumber(1.5)).toBe(true);
  });
  it('rejects negative, nonfinite, non-number', () => {
    expect(isFiniteNonnegativeNumber(-0.1)).toBe(false);
    expect(isFiniteNonnegativeNumber(Infinity)).toBe(false);
    expect(isFiniteNonnegativeNumber(NaN)).toBe(false);
    expect(isFiniteNonnegativeNumber('x')).toBe(false);
    expect(isFiniteNonnegativeNumber(null)).toBe(false);
    expect(isFiniteNonnegativeNumber(undefined)).toBe(false);
  });
});

describe('isOwnNumericDistribution', () => {
  it('rejects unsafe integers and numbers', () => {
    expect(
      isOwnNumericDistribution({ count: Number.MAX_SAFE_INTEGER + 1 }),
    ).toBe(false);
    expect(isOwnNumericDistribution({ count: Number.MAX_VALUE })).toBe(false);
  });
  it('accepts a plain object of nonnegative integers', () => {
    expect(isOwnNumericDistribution({ a: 1, b: 2 })).toBe(true);
  });
  it('rejects arrays masquerading as objects', () => {
    expect(isOwnNumericDistribution([1, 2])).toBe(false);
  });
  it('rejects __proto__/constructor/prototype keys', () => {
    expect(isOwnNumericDistribution({ __proto__: { x: 1 } })).toBe(false);
    expect(isOwnNumericDistribution({ constructor: 1 })).toBe(false);
    expect(isOwnNumericDistribution({ prototype: 1 })).toBe(false);
  });
  it('rejects non-integer values', () => {
    expect(isOwnNumericDistribution({ a: 1.5 })).toBe(false);
    expect(isOwnNumericDistribution({ a: 'x' })).toBe(false);
  });
  it('rejects invalid non-enumerable own values', () => {
    const distribution = { visible: 1 };
    Object.defineProperty(distribution, 'hidden', { value: -1 });
    expect(isOwnNumericDistribution(distribution)).toBe(false);
  });
});

describe('validateTelemetryRecord — core shape', () => {
  it('returns null for a valid record', () => {
    expect(validateTelemetryRecord(validRecord())).toBeNull();
  });
  it('rejects null', () => {
    expect(validateTelemetryRecord(null)).toMatch(/object/i);
  });
  it('rejects incomplete records and unknown fields', () => {
    const missing = validRecord();
    delete missing.errors;
    expect(validateTelemetryRecord(missing)).toMatch(
      /errors|required|complete/i,
    );
    expect(validateTelemetryRecord(validRecord({ unexpected: true }))).toMatch(
      /unexpected|unknown|complete/i,
    );
  });
  it('rejects non-enumerable unknown own fields', () => {
    const record = validRecord();
    Object.defineProperty(record, 'unexpected', { value: true });
    expect(validateTelemetryRecord(record)).toMatch(/unexpected|unknown/i);
  });
  it('accepts a complete failure record with unavailable metrics as null', () => {
    const failure = validRecord({
      run_id: null,
      run_attempt: null,
      pr_number: null,
      sha: null,
      ocr: { version: null, model: null, concurrency: null },
      wall_clock_seconds: null,
      cli_elapsed_seconds: null,
      files_previewed: null,
      files_reviewed: null,
      file_read_failures: null,
      file_read_failure_count: null,
      per_file_review_failures: null,
      per_file_review_failure_count: null,
      total_findings: null,
      findings: null,
      inline_posted: null,
      already_resolved: null,
      already_posted_or_skipped_dedup: null,
      comments_skipped: null,
      comments_failed: null,
      comments_routed_summary: null,
      comments_total: null,
      infrastructure_failure: true,
      completeness: null,
      publication_state: null,
      reviewed_range_manifest: null,
      tokens: null,
      telemetry_state: 'failed',
      post_state: null,
      artifact_state: 'failed',
      hash_state: 'failed',
      marker_state: {
        infrastructure_failure: true,
        policy_failure: false,
      },
      errors: ['OCR metadata artifact was unavailable'],
    });
    expect(validateTelemetryRecord(failure)).toBeNull();
    expect(validateReconciliation(failure)).toBeNull();
  });
  it('rejects arrays masquerading as records', () => {
    expect(validateTelemetryRecord([1, 2, 3])).toMatch(/plain object/i);
  });
  it('rejects a record with a __proto__ own property (prototype pollution)', () => {
    const evil = JSON.parse(
      '{"__proto__":{"polluted":1},"schema_name":"ocr-telemetry"}',
    );
    expect(validateTelemetryRecord(evil)).toMatch(
      /plain object|__proto__|prototype/i,
    );
  });
  it('rejects wrong schema_name', () => {
    expect(
      validateTelemetryRecord(validRecord({ schema_name: 'other' })),
    ).toMatch(/schema_name/i);
  });
  it('rejects unsupported schema version', () => {
    expect(validateTelemetryRecord(validRecord({ schema: 99 }))).toMatch(
      /schema/i,
    );
  });
  it('rejects empty run_id', () => {
    expect(validateTelemetryRecord(validRecord({ run_id: '' }))).toMatch(
      /run_id/i,
    );
  });
  it('rejects non-positive pr_number', () => {
    expect(validateTelemetryRecord(validRecord({ pr_number: 0 }))).toMatch(
      /pr_number/i,
    );
  });
  it('accepts a valid run_attempt integer string', () => {
    expect(
      validateTelemetryRecord(validRecord({ run_attempt: '3' })),
    ).toBeNull();
  });
  it('rejects a malformed run_attempt', () => {
    expect(
      validateTelemetryRecord(validRecord({ run_attempt: 'abc' })),
    ).toMatch(/run_attempt/i);
  });
  it('rejects a numeric run_attempt instead of coercing it', () => {
    expect(validateTelemetryRecord(validRecord({ run_attempt: 3 }))).toMatch(
      /run_attempt/i,
    );
  });
  it('rejects a sha that is not a 40-char hex when present', () => {
    expect(validateTelemetryRecord(validRecord({ sha: 'nothex' }))).toMatch(
      /sha/i,
    );
  });
  it('accepts null sha (unavailable)', () => {
    expect(validateTelemetryRecord(validRecord({ sha: null }))).toBeNull();
  });
  it('rejects a malformed generated_at', () => {
    expect(
      validateTelemetryRecord(validRecord({ generated_at: 'not-a-date' })),
    ).toMatch(/generated_at/i);
  });
  it('rejects negative wall_clock_seconds', () => {
    expect(
      validateTelemetryRecord(validRecord({ wall_clock_seconds: -1 })),
    ).toMatch(/wall_clock_seconds/i);
  });
  it('accepts null wall_clock_seconds', () => {
    expect(
      validateTelemetryRecord(validRecord({ wall_clock_seconds: null })),
    ).toBeNull();
  });
  it('rejects Infinity wall_clock_seconds', () => {
    expect(
      validateTelemetryRecord(validRecord({ wall_clock_seconds: Infinity })),
    ).toMatch(/wall_clock_seconds/i);
  });
  it('rejects non-boolean infrastructure_failure', () => {
    expect(
      validateTelemetryRecord(validRecord({ infrastructure_failure: 'true' })),
    ).toMatch(/infrastructure_failure/i);
  });
  it('rejects non-array file_read_failures', () => {
    expect(
      validateTelemetryRecord(validRecord({ file_read_failures: 'x' })),
    ).toMatch(/file_read_failures/i);
  });
  it('rejects non-string entries in file_read_failures', () => {
    expect(
      validateTelemetryRecord(
        validRecord({ file_read_failures: [1, 2], file_read_failure_count: 2 }),
      ),
    ).toMatch(/file_read_failures/i);
  });
  it('accepts null file_read_failures (unavailable)', () => {
    expect(
      validateTelemetryRecord(
        validRecord({
          file_read_failures: null,
          file_read_failure_count: null,
        }),
      ),
    ).toBeNull();
  });
  it('rejects findings with non-numeric distribution values', () => {
    expect(
      validateTelemetryRecord(
        validRecord({
          findings: {
            by_category: { bug: 'x' },
            by_severity: { high: 1 },
            by_category_severity: { bug: { high: 1 } },
          },
        }),
      ),
    ).toMatch(/findings/i);
  });
  it('rejects negative counts in distributions', () => {
    expect(
      validateTelemetryRecord(
        validRecord({
          findings: {
            by_category: { bug: -1 },
            by_severity: { high: 1 },
            by_category_severity: { bug: { high: 1 } },
          },
        }),
      ),
    ).toMatch(/findings/i);
  });
});

describe('validateTelemetryRecord — adversarial prototype pollution', () => {
  it('rejects __proto__ as a category key (JSON-parsed attack)', () => {
    const record = validRecord();
    record.findings.by_category = JSON.parse('{"__proto__":1}');
    record.findings.by_severity = { high: 1 };
    record.findings.by_category_severity = { bug: { high: 1 } };
    expect(validateTelemetryRecord(record)).toMatch(/prototype|__proto__|own/i);
  });
  it('rejects constructor as a severity key', () => {
    const record = validRecord();
    record.findings.by_category = { bug: 1 };
    record.findings.by_severity = { constructor: 1 };
    record.findings.by_category_severity = { bug: { high: 1 } };
    expect(validateTelemetryRecord(record)).toMatch(
      /prototype|constructor|own/i,
    );
  });
  it('rejects prototype as a cross-distribution outer key', () => {
    const record = validRecord();
    record.findings.by_category_severity = { prototype: { high: 1 } };
    expect(validateTelemetryRecord(record)).toMatch(/prototype|own/i);
  });
});

describe('validateReconciliation — invariants', () => {
  it('returns null when category sum equals total_findings', () => {
    expect(validateReconciliation(validRecord())).toBeNull();
  });
  it('fails when category sum differs from total_findings', () => {
    const record = validRecord();
    record.findings.by_category = { bug: 1, style: 1, extra: 1 };
    expect(validateReconciliation(record)).toMatch(/category|total/i);
  });
  it('fails when severity sum differs from total_findings', () => {
    const record = validRecord();
    record.findings.by_severity = { high: 5 };
    expect(validateReconciliation(record)).toMatch(/severity|total/i);
  });
  it('fails when cross sum differs from total_findings', () => {
    const record = validRecord();
    record.findings.by_category_severity = { bug: { high: 1 } };
    expect(validateReconciliation(record)).toMatch(/cross|category_severity/i);
  });
  it('fails when per-category total differs from by_category', () => {
    const record = validRecord();
    record.findings.by_category_severity = {
      bug: { high: 1, low: 5 },
      style: { low: 1 },
    };
    expect(validateReconciliation(record)).toMatch(/cross|category_severity/i);
  });
  it('fails when file_read_failure_count != file_read_failures.length', () => {
    const record = validRecord({
      file_read_failures: ['a', 'b'],
      file_read_failure_count: 1,
    });
    expect(validateReconciliation(record)).toMatch(/file_read_failure_count/i);
  });
  it('accepts null file_read_failures with null count', () => {
    expect(
      validateReconciliation(
        validRecord({
          file_read_failures: null,
          file_read_failure_count: null,
        }),
      ),
    ).toBeNull();
  });
  it('rejects delimiter-collision category coverage adversaries', () => {
    const record = validRecord({
      findings: {
        by_category: { a: 1, 'b\\u0000c': 1 },
        by_severity: { high: 2 },
        by_category_severity: {
          'a\\u0000b': { high: 1 },
          c: { high: 1 },
        },
      },
    });
    expect(validateTelemetryRecord(record)).toMatch(/cross category coverage/i);
  });
});

describe('validateTelemetryRecord — strict lifecycle and reconciliation', () => {
  it('rejects calendar-impossible timestamps', () => {
    expect(
      validateTelemetryRecord(
        validRecord({ generated_at: '2026-02-30T12:00:00.000Z' }),
      ),
    ).toMatch(/generated_at/i);
  });

  it('rejects extra zero-only cross keys in either direction', () => {
    const extraCategory = validRecord();
    extraCategory.findings.by_category_severity.extra = { high: 0, low: 0 };
    expect(validateTelemetryRecord(extraCategory)).toMatch(/cross category/i);

    const extraSeverity = validRecord();
    extraSeverity.findings.by_category_severity.bug.medium = 0;
    expect(validateTelemetryRecord(extraSeverity)).toMatch(/cross severity/i);
  });

  it('rejects token totals that omit cache usage', () => {
    expect(
      validateTelemetryRecord(
        validRecord({
          tokens: {
            input: 10,
            output: 5,
            cache_read: 3,
            cache_write: 2,
            total: 15,
          },
        }),
      ),
    ).toMatch(/tokens\.total/i);
  });

  it.each([
    ['telemetry_state', 'arbitrary'],
    ['post_state', 'arbitrary'],
    ['artifact_state', 'uploaded'],
    ['hash_state', 'arbitrary'],
  ])('rejects arbitrary %s values', (field, value) => {
    expect(validateTelemetryRecord(validRecord({ [field]: value }))).toMatch(
      new RegExp(field),
    );
  });

  it('rejects errors with successful lifecycle classifications', () => {
    expect(
      validateTelemetryRecord(validRecord({ errors: ['unexpected failure'] })),
    ).toMatch(/errors|infrastructure/i);
  });

  it('rejects failed artifact/hash/Post states without infrastructure failure', () => {
    expect(
      validateTelemetryRecord(validRecord({ hash_state: 'failed' })),
    ).toMatch(/infrastructure/i);
  });

  it('rejects contradictory manifest and preview counts', () => {
    expect(
      validateTelemetryRecord(
        validRecord({
          files_previewed: 2,
          files_reviewed: 2,
          reviewed_range_manifest: {
            selected_files: 2,
            completed_files: 2,
            failed_files: 1,
          },
        }),
      ),
    ).toMatch(/manifest|selected/i);
  });

  it('rejects failure counts above attempted files', () => {
    expect(
      validateTelemetryRecord(
        validRecord({
          files_previewed: 1,
          files_reviewed: 1,
          file_read_failures: ['a.ts', 'b.ts'],
          file_read_failure_count: 2,
          reviewed_range_manifest: {
            selected_files: 1,
            completed_files: 1,
            failed_files: 0,
          },
        }),
      ),
    ).toMatch(/file_read_failure_count|files_previewed/i);
  });

  it('rejects publication counters above comments_total', () => {
    expect(validateTelemetryRecord(validRecord({ inline_posted: 3 }))).toMatch(
      /inline_posted|comments_total/i,
    );
  });
});
