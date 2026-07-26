/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aggregateTelemetry,
  discoverTelemetryRecords,
  validateTelemetryRecord,
} from '../aggregate-ocr-telemetry.js';

function record(overrides = {}) {
  return {
    schema: 1,
    schema_name: 'ocr-telemetry',
    run_id: '1',
    run_attempt: '1',
    pr_number: 100,
    sha: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
    generated_at: '2026-07-01T00:00:00.000Z',
    ocr: { version: '1.7.16', model: 'm', concurrency: 2 },
    wall_clock_seconds: 100,
    cli_elapsed_seconds: 100,
    files_previewed: 5,
    files_reviewed: 5,
    file_read_failures: null,
    file_read_failure_count: null,
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
    inline_posted: 2,
    already_resolved: null,
    already_posted_or_skipped_dedup: 0,
    comments_skipped: 0,
    comments_failed: 0,
    comments_routed_summary: 0,
    comments_total: 2,
    infrastructure_failure: false,
    policy_failure: false,
    completeness: 'complete',
    publication_state: 'complete',
    reviewed_range_manifest: {
      selected_files: 5,
      completed_files: 5,
      failed_files: 0,
    },
    tokens: {
      input: 100,
      output: 50,
      cache_read: 0,
      cache_write: 0,
      total: 150,
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

describe('validateTelemetryRecord (re-exported from shared schema)', () => {
  it('returns null for a valid record', () => {
    expect(validateTelemetryRecord(record())).toBeNull();
  });
  it('rejects a __proto__ own key', () => {
    const evil = JSON.parse(
      '{"__proto__":{"x":1},"schema_name":"ocr-telemetry"}',
    );
    expect(validateTelemetryRecord(evil)).toMatch(
      /plain object|unsafe|__proto__/i,
    );
  });
});

describe('aggregateTelemetry — core stats', () => {
  it('computes average findings per run', () => {
    const result = aggregateTelemetry([
      record({ run_id: '1', total_findings: 2 }),
      record({
        run_id: '2',
        total_findings: 4,
        findings: {
          by_category: { bug: 2, style: 2 },
          by_severity: { high: 2, low: 2 },
          by_category_severity: {
            bug: { high: 2, low: 0 },
            style: { high: 0, low: 2 },
          },
        },
      }),
    ]);
    expect(result.average_findings_per_run).toBeCloseTo(3, 5);
    expect(result.total_findings).toBe(6);
    expect(result.runs).toBe(2);
  });
  it('rejects records with __proto__ keys (fail-closed prototype safety)', () => {
    // A record carrying a __proto__ category key is malformed and must be
    // rejected by the strict shared validator rather than aggregated.
    const evil = record({
      run_id: '1',
      findings: {
        by_category: JSON.parse('{"__proto__":1,"bug":1}'),
        by_severity: { high: 1 },
        by_category_severity: { bug: { high: 1 } },
      },
      total_findings: 1,
    });
    expect(() => aggregateTelemetry([evil])).toThrow(
      /malformed|prototype|own/i,
    );
    // The aggregate must not have polluted Object.prototype.
    expect({}.polluted).toBeUndefined();
  });
});

describe('aggregateTelemetry — unavailable metrics', () => {
  it('keeps unavailable aggregate metrics null instead of inventing zeros', () => {
    const failed = record({
      total_findings: null,
      findings: null,
      files_previewed: null,
      files_reviewed: null,
      per_file_review_failures: null,
      per_file_review_failure_count: null,
      inline_posted: null,
      infrastructure_failure: true,
      marker_state: {
        infrastructure_failure: true,
        policy_failure: false,
      },
      telemetry_state: 'degraded',
      errors: ['OCR artifacts unavailable'],
    });
    const result = aggregateTelemetry([failed]);
    expect(result.total_findings).toBeNull();
    expect(result.average_findings_per_run).toBeNull();
    expect(result.total_files_previewed).toBeNull();
  });
});

describe('aggregateTelemetry — deterministic sort and run_attempt', () => {
  it('sorts by (generated_at, run_id, run_attempt) transitively', () => {
    const records = [
      record({
        run_id: '30',
        run_attempt: '1',
        generated_at: '2026-07-03T00:00:00.000Z',
      }),
      record({
        run_id: '2',
        run_attempt: '1',
        generated_at: '2026-07-01T00:00:00.000Z',
      }),
      record({
        run_id: '10',
        run_attempt: '1',
        generated_at: '2026-07-02T00:00:00.000Z',
      }),
    ];
    const result = aggregateTelemetry(records);
    expect(result.findings_trend.map((t) => t.run_id)).toEqual([
      '2',
      '10',
      '30',
    ]);
  });
  it('breaks generated_at ties by run_id then run_attempt', () => {
    const records = [
      record({
        run_id: '5',
        run_attempt: '2',
        generated_at: '2026-07-01T00:00:00.000Z',
      }),
      record({
        run_id: '5',
        run_attempt: '1',
        generated_at: '2026-07-01T00:00:00.000Z',
      }),
    ];
    const result = aggregateTelemetry(records);
    expect(result.findings_trend.map((t) => t.run_attempt)).toEqual(['1', '2']);
  });
  it('includes run_attempt in every time series entry', () => {
    const result = aggregateTelemetry([
      record({ run_id: '1', run_attempt: '1' }),
    ]);
    expect(result.findings_trend[0].run_attempt).toBe('1');
    expect(result.inline_volume[0].run_attempt).toBe('1');
    expect(result.category_trend[0].run_attempt).toBe('1');
    expect(result.severity_trend[0].run_attempt).toBe('1');
  });
});

describe('aggregateTelemetry — duplicate (run_id, run_attempt) policy', () => {
  it('rejects duplicate (run_id, run_attempt) records', () => {
    const records = [
      record({ run_id: '1', run_attempt: '1' }),
      record({ run_id: '1', run_attempt: '1' }),
    ];
    expect(() => aggregateTelemetry(records)).toThrow(
      /duplicate|run_id|run_attempt/i,
    );
  });
});

describe('aggregateTelemetry — file_read_failure_rate null semantics', () => {
  it('computes a real 0% rate when evidence shows zero failures and nonzero preview', () => {
    const result = aggregateTelemetry([
      record({
        run_id: '1',
        files_previewed: 5,
        file_read_failures: [],
        file_read_failure_count: 0,
        per_file_review_failure_count: 3,
        per_file_review_failures: ['a.ts', 'b.ts', 'c.ts'],
      }),
    ]);
    // 0 failures / 5 previewed is a real 0% rate, not unavailable.
    expect(result.file_read_failure_rate).toBe(0);
  });
  it('does not claim a rate when read-specific evidence is unavailable', () => {
    const result = aggregateTelemetry([
      record({
        run_id: '1',
        files_previewed: 5,
        file_read_failures: null,
        file_read_failure_count: null,
        per_file_review_failures: ['logic.ts'],
        per_file_review_failure_count: 1,
      }),
    ]);
    expect(result.file_read_failure_rate).toBeNull();
  });
  it('does not claim a 0% rate when denominator is zero', () => {
    const result = aggregateTelemetry([
      record({
        run_id: '1',
        files_previewed: 0,
        files_reviewed: 0,
        reviewed_range_manifest: {
          selected_files: 0,
          completed_files: 0,
          failed_files: 0,
        },
        file_read_failures: [],
        file_read_failure_count: 0,
      }),
    ]);
    expect(result.file_read_failure_rate).toBeNull();
  });
});

describe('aggregateTelemetry — trends', () => {
  it('produces category per-run trend ordered series', () => {
    const records = [
      record({
        run_id: '1',
        generated_at: '2026-07-01T00:00:00.000Z',
        findings: {
          by_category: { bug: 2, style: 1 },
          by_severity: { high: 2, low: 1 },
          by_category_severity: {
            bug: { high: 2, low: 0 },
            style: { high: 0, low: 1 },
          },
        },
        total_findings: 3,
      }),
      record({
        run_id: '2',
        generated_at: '2026-07-02T00:00:00.000Z',
        findings: {
          by_category: { bug: 1, maintainability: 2 },
          by_severity: { high: 1, medium: 2 },
          by_category_severity: {
            bug: { high: 1, medium: 0 },
            maintainability: { high: 0, medium: 2 },
          },
        },
        total_findings: 3,
      }),
      record({
        run_id: '3',
        generated_at: '2026-07-03T00:00:00.000Z',
        findings: {
          by_category: { bug: 0, style: 0, test: 4 },
          by_severity: { high: 0, low: 4 },
          by_category_severity: {
            bug: { high: 0, low: 0 },
            style: { high: 0, low: 0 },
            test: { high: 0, low: 4 },
          },
        },
        total_findings: 4,
      }),
    ];
    const result = aggregateTelemetry(records);
    expect(result.category_trend).toHaveLength(3);
    expect(result.severity_trend).toHaveLength(3);
    // first entry is run 1
    expect(result.category_trend[0].run_id).toBe('1');
    expect(result.category_trend[0].categories.bug).toBe(2);
    expect(result.category_trend[2].run_id).toBe('3');
    expect(result.category_trend[2].categories.test).toBe(4);
    expect(result.severity_trend[2].severities.low).toBe(4);
  });
  it('renders a compact trend view in markdown', () => {
    const records = [
      record({
        run_id: '1',
        generated_at: '2026-07-01T00:00:00.000Z',
        findings: {
          by_category: { bug: 1 },
          by_severity: { high: 1 },
          by_category_severity: { bug: { high: 1 } },
        },
        total_findings: 1,
      }),
      record({
        run_id: '2',
        generated_at: '2026-07-02T00:00:00.000Z',
        findings: {
          by_category: { bug: 2 },
          by_severity: { low: 2 },
          by_category_severity: { bug: { low: 2 } },
        },
        total_findings: 2,
      }),
    ];
    const result = aggregateTelemetry(records);
    expect(result.markdown).toMatch(/trend/i);
    expect(result.markdown).toContain('bug');
  });
});

describe('aggregateTelemetry — fail-closed', () => {
  it('throws on a malformed record', () => {
    expect(() =>
      aggregateTelemetry([record(), { schema_name: 'other' }]),
    ).toThrow(/malformed/i);
  });
  it('throws for an empty record set', () => {
    expect(() => aggregateTelemetry([])).toThrow(/empty|no records/i);
  });
});

describe('discoverTelemetryRecords — recursive discovery', () => {
  let tmpDir;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-telemetry-agg-'));
    const nested = path.join(tmpDir, 'artifacts', 'run-1', 'ocr-review-output');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, 'ocr-telemetry.json'),
      JSON.stringify(record({ run_id: '1' })),
    );
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
  it('recursively discovers ocr-telemetry.json records', () => {
    const records = discoverTelemetryRecords(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0].run_id).toBe('1');
  });
  it('fails fast on a malformed discovered record', () => {
    const bad = path.join(tmpDir, 'bad-run');
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(
      path.join(bad, 'ocr-telemetry.json'),
      JSON.stringify({ schema_name: 'wrong' }),
    );
    expect(() => discoverTelemetryRecords(tmpDir)).toThrow(/malformed/i);
    fs.rmSync(path.join(bad, 'ocr-telemetry.json'), { force: true });
  });
  it('identifies the path of malformed JSON', () => {
    const bad = path.join(tmpDir, 'invalid-json');
    const telemetryPath = path.join(bad, 'ocr-telemetry.json');
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(telemetryPath, '{invalid');
    expect(() => discoverTelemetryRecords(tmpDir)).toThrow(telemetryPath);
    fs.rmSync(telemetryPath, { force: true });
  });
  it('identifies a directory that cannot be discovered', () => {
    const missing = path.join(tmpDir, 'missing');
    expect(() => discoverTelemetryRecords(missing)).toThrow(missing);
  });
});

describe('aggregate-ocr-telemetry.js CLI — contract', () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
  const AGG_SCRIPT = path.join(
    REPO_ROOT,
    'scripts',
    'aggregate-ocr-telemetry.js',
  );

  function runCli(args, cwd) {
    return spawnSync(process.execPath, [AGG_SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
  }

  let tmpDir;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-agg-cli-'));
    const nested = path.join(tmpDir, 'run-1');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(
      path.join(nested, 'ocr-telemetry.json'),
      JSON.stringify(record({ run_id: '1' })),
    );
    const nested2 = path.join(tmpDir, 'run-2');
    fs.mkdirSync(nested2, { recursive: true });
    fs.writeFileSync(
      path.join(nested2, 'ocr-telemetry.json'),
      JSON.stringify(
        record({ run_id: '2', generated_at: '2026-07-02T00:00:00.000Z' }),
      ),
    );
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints help and exits nonzero when no args', () => {
    const result = runCli([]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/usage/i);
  });
  it('prints JSON to stdout by default with a format flag', () => {
    const result = runCli([tmpDir, '--format', 'json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.runs).toBe(2);
  });
  it('writes markdown to an explicit --output path', () => {
    const outPath = path.join(tmpDir, 'out.md');
    const result = runCli([
      tmpDir,
      '--format',
      'markdown',
      '--output',
      outPath,
    ]);
    expect(result.status).toBe(0);
    const written = fs.readFileSync(outPath, 'utf8');
    expect(written).toMatch(/^## OCR Telemetry/);
    expect(() => JSON.parse(written)).toThrow();
  });

  describe('aggregateTelemetry — mixed evidence and epoch ordering', () => {
    it('sorts timestamps by parsed epoch across different offsets', () => {
      const result = aggregateTelemetry([
        record({
          run_id: '2',
          generated_at: '2026-07-01T00:30:00.000Z',
        }),
        record({
          run_id: '1',
          generated_at: '2026-07-01T02:00:00.000+02:00',
        }),
      ]);
      expect(result.findings_trend.map((entry) => entry.run_id)).toEqual([
        '1',
        '2',
      ]);
    });

    it('preserves null trends and reports available/total denominators', () => {
      const unavailable = record({
        run_id: '2',
        total_findings: null,
        findings: null,
        inline_posted: null,
        infrastructure_failure: true,
        telemetry_state: 'degraded',
        marker_state: {
          infrastructure_failure: true,
          policy_failure: false,
        },
        errors: ['findings unavailable'],
      });
      const result = aggregateTelemetry([record(), unavailable]);
      expect(result.inline_volume[1].inline_posted).toBeNull();
      expect(result.category_trend[1].categories).toBeNull();
      expect(result.severity_trend[1].severities).toBeNull();
      expect(result.findings_trend[1].total_findings).toBeNull();
      expect(result.findings_available_runs).toBe(1);
      expect(result.findings_total_runs).toBe(2);
      expect(result.markdown).toContain('1/2 runs available');
    });

    it('reports wall-clock concurrency sample counts and the file-read label', () => {
      const result = aggregateTelemetry([
        record({ run_id: '1', wall_clock_seconds: 10 }),
        record({ run_id: '2', wall_clock_seconds: 20 }),
      ]);
      expect(result.average_wall_clock_by_concurrency['2']).toEqual({
        average_seconds: 15,
        samples: 2,
      });
      expect(result.markdown).toContain('file-read failure rate');
      expect(result.markdown).not.toContain('per-file review failure rate');
    });
  });
});
