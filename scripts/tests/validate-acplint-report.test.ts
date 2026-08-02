/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const validatorScript = join(repoRoot, 'scripts', 'validate-acplint-report.ts');

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'acplint-validator-'));
  tmpDirs.push(dir);
  return dir;
}

interface RunResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error: Error | null;
  readonly stdout: string;
  readonly stderr: string;
}

function normalizeResult(result: {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  stdout: string;
  stderr: string;
}): RunResult {
  if (result.error !== undefined) {
    throw new Error(`spawn failed: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.signal !== null) {
    throw new Error(`process killed by signal ${result.signal}`);
  }
  return {
    status: result.status,
    signal: result.signal,
    error: result.error ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runValidator(reportJson: string, status: number): RunResult {
  return runValidatorRawStatus(reportJson, String(status));
}

function runValidatorRawStatus(
  reportJson: string,
  rawStatus: string,
): RunResult {
  const dir = makeTmpDir();
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, reportJson, 'utf8');
  const result = spawnSync(
    process.execPath,
    [validatorScript, reportPath, rawStatus],
    {
      encoding: 'utf8',
      timeout: 15_000,
      cwd: repoRoot,
    },
  );
  return normalizeResult(result);
}

function runValidatorMissingFile(status: number): RunResult {
  const dir = makeTmpDir();
  const reportPath = join(dir, 'nonexistent.json');
  const result = spawnSync(
    process.execPath,
    [validatorScript, reportPath, String(status)],
    {
      encoding: 'utf8',
      timeout: 15_000,
      cwd: repoRoot,
    },
  );
  return normalizeResult(result);
}

interface ResultRow {
  name: string;
  category: string;
  status: string;
  duration_ms: number;
  message: string | null;
  details: unknown;
}

function makeResult(name: string, category: string, status: string): ResultRow {
  return {
    name,
    category,
    status,
    duration_ms: 0,
    message: null,
    details: null,
  };
}

const INITIALIZATION_ROWS: readonly ResultRow[] = [
  makeResult('initialize_v1', 'initialization', 'PASS'),
  makeResult('protocol_version_returned', 'initialization', 'PASS'),
  makeResult('agent_capabilities_present', 'initialization', 'PASS'),
  makeResult('agent_info_present', 'initialization', 'PASS'),
  makeResult('agent_capabilities_schema_valid', 'initialization', 'PASS'),
];

const SESSION_LIFECYCLE_ROWS: readonly ResultRow[] = [
  makeResult('new_session', 'session_lifecycle', 'PASS'),
  makeResult('list_sessions', 'session_lifecycle', 'PASS'),
  makeResult('load_session', 'session_lifecycle', 'PASS'),
  makeResult('resume_session', 'session_lifecycle', 'PASS'),
  makeResult('close_session', 'session_lifecycle', 'PASS'),
  makeResult('delete_session', 'session_lifecycle', 'PASS'),
  makeResult('fork_session', 'session_lifecycle', 'PASS'),
];

const SCHEMA_VALIDATION_ROWS: readonly ResultRow[] = [
  makeResult('schema_initialize', 'schema_validation', 'PASS'),
  makeResult('schema_session_new', 'schema_validation', 'PASS'),
  makeResult('schema_session_list', 'schema_validation', 'PASS'),
  makeResult('coverage_methods_exercised', 'schema_validation', 'PASS'),
];

function buildSummary(): Record<
  string,
  {
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
    pass_rate: number;
  }
> {
  return {
    initialization: {
      passed: 5,
      failed: 0,
      skipped: 0,
      errored: 0,
      pass_rate: 1.0,
    },
    session_lifecycle: {
      passed: 7,
      failed: 0,
      skipped: 0,
      errored: 0,
      pass_rate: 1.0,
    },
    schema_validation: {
      passed: 4,
      failed: 0,
      skipped: 0,
      errored: 0,
      pass_rate: 1.0,
    },
  };
}

function buildPartialSummary(): Record<
  string,
  {
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
    pass_rate: number;
  }
> {
  return {
    initialization: {
      passed: 5,
      failed: 0,
      skipped: 0,
      errored: 0,
      pass_rate: 1.0,
    },
    session_lifecycle: {
      passed: 6,
      failed: 0,
      skipped: 1,
      errored: 0,
      pass_rate: 6 / 7,
    },
    schema_validation: {
      passed: 4,
      failed: 0,
      skipped: 0,
      errored: 0,
      pass_rate: 1.0,
    },
  };
}

function allSelectedRows(): ResultRow[] {
  return [
    ...INITIALIZATION_ROWS,
    ...SESSION_LIFECYCLE_ROWS,
    ...SCHEMA_VALIDATION_ROWS,
  ];
}

function partialSelectedRows(): ResultRow[] {
  return allSelectedRows().map((row) =>
    row.name === 'fork_session' ? { ...row, status: 'SKIP' } : row,
  );
}

function fullPassReport(): string {
  return JSON.stringify({
    conformance_level: 'Full Conformance',
    agent_info: {},
    findings: [],
    results: allSelectedRows(),
    summary: buildSummary(),
  });
}

function partialReport(): string {
  return JSON.stringify({
    conformance_level: 'Partial Conformance',
    agent_info: {},
    findings: [],
    results: partialSelectedRows(),
    summary: buildPartialSummary(),
  });
}

describe('acplint report validator (issue #2564)', () => {
  it('accepts a valid Full report with status 0', () => {
    const result = runValidator(fullPassReport(), 0);
    expect(result.error).toBeNull();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('acplint report validated successfully');
  });

  it('accepts a valid Partial report with status 1', () => {
    const result = runValidator(partialReport(), 1);
    expect(result.error).toBeNull();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('acplint report validated successfully');
  });

  it('rejects Full report with status 1 (status/level mismatch)', () => {
    const result = runValidator(fullPassReport(), 1);
    expect(result.status).toBe(1);
  });

  it('rejects Partial report with status 0 (status/level mismatch)', () => {
    const result = runValidator(partialReport(), 0);
    expect(result.status).toBe(1);
  });

  it('rejects status 2', () => {
    const result = runValidator(fullPassReport(), 2);
    expect(result.status).toBe(1);
  });

  it('rejects unexpected high status (42)', () => {
    const result = runValidator(fullPassReport(), 42);
    expect(result.status).toBe(1);
  });

  it('rejects malformed JSON', () => {
    const result = runValidator('{ not valid json', 0);
    expect(result.status).toBe(1);
  });

  it('rejects an empty file', () => {
    const result = runValidator('', 0);
    expect(result.status).toBe(1);
  });

  it('rejects a report missing conformance_level', () => {
    const report = JSON.parse(fullPassReport());
    delete report.conformance_level;
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a report missing results array', () => {
    const report = JSON.parse(fullPassReport());
    delete report.results;
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects Non-Conformant level', () => {
    const report = JSON.parse(fullPassReport());
    report.conformance_level = 'Non-Conformant';
    const result = runValidator(JSON.stringify(report), 1);
    expect(result.status).toBe(1);
  });

  it('rejects an unrecognized conformance level', () => {
    const report = JSON.parse(fullPassReport());
    report.conformance_level = 'Mostly Conformant';
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report missing a required initialization result row', () => {
    const report = JSON.parse(fullPassReport());
    report.results = report.results.filter(
      (r: ResultRow) => r.name !== 'initialize_v1',
    );
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report missing a required session_lifecycle result row', () => {
    const report = JSON.parse(fullPassReport());
    report.results = report.results.filter(
      (r: ResultRow) => r.name !== 'delete_session',
    );
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report missing a required schema_validation result row', () => {
    const report = JSON.parse(fullPassReport());
    report.results = report.results.filter(
      (r: ResultRow) => r.name !== 'schema_initialize',
    );
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report with a FAIL in a selected category', () => {
    const report = JSON.parse(fullPassReport());
    const row = report.results.find(
      (r: ResultRow) => r.name === 'delete_session',
    );
    row.status = 'FAIL';
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report with an ERROR in a selected category', () => {
    const report = JSON.parse(fullPassReport());
    const row = report.results.find((r: ResultRow) => r.name === 'new_session');
    row.status = 'ERROR';
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report with an empty results array', () => {
    const report = JSON.parse(fullPassReport());
    report.results = [];
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report with results missing the status field', () => {
    const report = JSON.parse(fullPassReport());
    const row = report.results[0];
    delete row.status;
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Partial report where ALL selected results are FAIL', () => {
    const report = JSON.parse(partialReport());
    for (const row of report.results) {
      row.status = 'FAIL';
    }
    const result = runValidator(JSON.stringify(report), 1);
    expect(result.status).toBe(1);
  });

  it('rejects a summary whose counts do not match its result rows', () => {
    const report = JSON.parse(fullPassReport());
    report.summary.session_lifecycle.passed = 6;
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report containing a selected SKIP', () => {
    const report = JSON.parse(partialReport());
    report.conformance_level = 'Full Conformance';
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects duplicate rows in the same selected category (adjacent)', () => {
    const report = JSON.parse(fullPassReport());
    const dup = { ...report.results[0] };
    report.results.splice(1, 0, dup);
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects duplicate rows in the same selected category (non-adjacent)', () => {
    const report = JSON.parse(fullPassReport());
    const dup = { ...report.results[0] };
    report.results.push(dup);
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects an unknown result row status in a selected category', () => {
    const report = JSON.parse(fullPassReport());
    const row = report.results.find(
      (r: ResultRow) => r.name === 'delete_session',
    );
    row.status = 'UNKNOWN';
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a lowercase status in a selected category', () => {
    const report = JSON.parse(fullPassReport());
    const row = report.results.find(
      (r: ResultRow) => r.name === 'delete_session',
    );
    row.status = 'pass';
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects an empty status string in a selected category', () => {
    const report = JSON.parse(fullPassReport());
    const row = report.results.find(
      (r: ResultRow) => r.name === 'delete_session',
    );
    row.status = '';
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a non-numeric status argument', () => {
    const result = runValidatorRawStatus(fullPassReport(), 'abc');
    expect(result.status).toBe(1);
  });

  it('rejects a partially-numeric status (0garbage)', () => {
    const result = runValidatorRawStatus(fullPassReport(), '0garbage');
    expect(result.status).toBe(1);
  });

  it('rejects a decimal status (1.0)', () => {
    const result = runValidatorRawStatus(fullPassReport(), '1.0');
    expect(result.status).toBe(1);
  });

  it('rejects a whitespace-padded status', () => {
    const result = runValidatorRawStatus(fullPassReport(), ' 0 ');
    expect(result.status).toBe(1);
  });

  it('rejects a signed status (+0)', () => {
    const result = runValidatorRawStatus(fullPassReport(), '+0');
    expect(result.status).toBe(1);
  });

  it('rejects an empty status argument', () => {
    const result = runValidatorRawStatus(fullPassReport(), '');
    expect(result.status).toBe(1);
  });

  it('rejects a Full report with an extra category row in results', () => {
    const report = JSON.parse(fullPassReport());
    report.results.push(makeResult('extra_check', 'permissions', 'PASS'));
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a Full report with an unexpected row in a selected category', () => {
    const report = JSON.parse(fullPassReport());
    report.results.push(
      makeResult('bogus_session', 'session_lifecycle', 'PASS'),
    );
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a report with a missing summary category key', () => {
    const report = JSON.parse(fullPassReport());
    delete report.summary.schema_validation;
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects a report with an extra summary category key', () => {
    const report = JSON.parse(fullPassReport());
    report.summary.permissions = {
      passed: 1,
      failed: 0,
      skipped: 0,
      errored: 0,
      pass_rate: 1.0,
    };
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects when the report file does not exist', () => {
    const result = runValidatorMissingFile(0);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('failed to read report file');
  });
});
