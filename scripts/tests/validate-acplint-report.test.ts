/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterAll } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

/**
 * The validator appends its summary to GITHUB_STEP_SUMMARY whenever that variable is
 * set. Under GitHub Actions the runner sets it, so an inherited environment would make
 * every spawn here append to the real job summary, including the oversized-summary
 * case below. Each spawn therefore starts from an environment with that variable
 * removed, and the tests that exercise it set it back explicitly.
 */
function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['GITHUB_STEP_SUMMARY'];
  return env;
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
      env: baseEnv(),
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
      env: baseEnv(),
    },
  );
  return normalizeResult(result);
}

function runValidatorWithEnv(
  reportJson: string,
  status: number,
  envOverrides: Record<string, string>,
  removeKeys: readonly string[] = [],
): RunResult {
  const dir = makeTmpDir();
  const reportPath = join(dir, 'report.json');
  writeFileSync(reportPath, reportJson, 'utf8');
  const env = baseEnv();
  for (const key of removeKeys) {
    delete env[key];
  }
  const result = spawnSync(
    process.execPath,
    [validatorScript, reportPath, String(status)],
    {
      encoding: 'utf8',
      timeout: 15_000,
      cwd: repoRoot,
      env: { ...env, ...envOverrides },
    },
  );
  return normalizeResult(result);
}

function runValidatorArgv(
  args: readonly string[],
  envOverrides: Record<string, string> = {},
): RunResult {
  const result = spawnSync(process.execPath, [validatorScript, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    cwd: repoRoot,
    env: { ...baseEnv(), ...envOverrides },
  });
  return normalizeResult(result);
}

/**
 * The exact three finding strings the selected deterministic categories produce on the
 * pinned acplint. The U+26A0 WARNING SIGN and U+2014 EM DASH characters are
 * written escaped so the source stays ASCII and byte-equal to the report text.
 */
const ALLOWED_FINDINGS = [
  '\u26A0 No agent_thought_chunk notifications received at all',
  "\u26A0 No available_commands_update notifications received \u2014 agent doesn't advertise commands/hooks",
  "\u26A0 No usage_update notifications received \u2014 agent doesn't report usage",
];

const AGENT_INFO_FINDING =
  '\u26A0 No agentInfo in initialize response \u2014 agents should identify themselves';

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
    agent_info: { name: 'llxprt-code', version: '0.0.0-test' },
    findings: [],
    results: allSelectedRows(),
    summary: buildSummary(),
  });
}

function partialReport(): string {
  return JSON.stringify({
    conformance_level: 'Partial Conformance',
    agent_info: { name: 'llxprt-code', version: '0.0.0-test' },
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

describe('acplint findings gate and summary (issue #3095)', () => {
  it('accepts a report whose findings are exactly the three allowlisted strings', () => {
    const report = JSON.parse(fullPassReport());
    report.findings = [...ALLOWED_FINDINGS];
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('acplint report validated successfully');
  });

  it('accepts a report with an empty findings array', () => {
    const result = runValidator(fullPassReport(), 0);
    expect(result.status).toBe(0);
  });

  it('accepts a report with a strict subset of the allowlist', () => {
    const report = JSON.parse(fullPassReport());
    report.findings = [ALLOWED_FINDINGS[0], ALLOWED_FINDINGS[2]];
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(0);
  });

  it('rejects a report containing the agentInfo finding and names it', () => {
    const report = JSON.parse(fullPassReport());
    report.findings = [AGENT_INFO_FINDING];
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected acplint finding');
    expect(result.stderr).toContain('No agentInfo in initialize response');
  });

  it('rejects a report containing an arbitrary unknown finding', () => {
    const report = JSON.parse(fullPassReport());
    report.findings = [ALLOWED_FINDINGS[0], 'unknown finding text'];
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown finding text');
  });

  it('rejects agent_info {}', () => {
    const report = JSON.parse(fullPassReport());
    report.agent_info = {};
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'agent_info.name must be a non-empty string',
    );
  });

  it('still emits the full summary when the agent never identified itself', () => {
    const report = JSON.parse(fullPassReport());
    report.agent_info = {};
    report.findings = [ALLOWED_FINDINGS[0]];
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Agent identification: not reported');
    expect(result.stdout).toContain('[known]');
    expect(result.stdout).toContain('schema_validation | 4 | 0 | 0 | 0');
    expect(result.stdout).not.toContain('unavailable');
  });

  it('rejects agent_info with an empty-string name', () => {
    const report = JSON.parse(fullPassReport());
    report.agent_info = { name: '', version: '0.0.0-test' };
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects agent_info with an empty-string version', () => {
    const report = JSON.parse(fullPassReport());
    report.agent_info = { name: 'llxprt-code', version: '' };
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects agent_info whose name is a non-string', () => {
    const report = JSON.parse(fullPassReport());
    report.agent_info = { name: 42, version: '0.0.0-test' };
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('rejects agent_info whose version is a non-string', () => {
    const report = JSON.parse(fullPassReport());
    report.agent_info = { name: 'llxprt-code', version: 42 };
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
  });

  it('accepts agent_info carrying extra unknown keys alongside name and version', () => {
    const report = JSON.parse(fullPassReport());
    report.agent_info = {
      name: 'llxprt-code',
      version: '0.0.0-test',
      custom_field: { nested: true },
    };
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(0);
  });

  it('emits a summary to stdout on success', () => {
    const result = runValidator(fullPassReport(), 0);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('## ACP conformance report');
  });

  it('emits a summary to stdout when the report file is unreadable', () => {
    const result = runValidatorMissingFile(0);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('## ACP conformance report');
    expect(result.stdout).toContain('unavailable');
    expect(result.stdout).toContain('failed to read report file');
  });

  it('emits a summary to stdout on malformed JSON', () => {
    const result = runValidator('{ not valid json', 0);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('## ACP conformance report');
    expect(result.stdout).toContain('unavailable');
  });

  it('emits a summary to stdout on a rejected report', () => {
    const result = runValidator(fullPassReport(), 1);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('## ACP conformance report');
  });

  it('summary includes the raw status, conformance level, agent info, counts, findings, and result messages', () => {
    const report = JSON.parse(fullPassReport());
    report.findings = [ALLOWED_FINDINGS[0], 'some unexpected finding'];
    const row = report.results.find(
      (r: ResultRow) => r.name === 'delete_session',
    );
    row.message = 'some result message text';
    const result = runValidator(JSON.stringify(report), 0);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Raw acplint status: `0`');
    expect(result.stdout).toContain('Full Conformance');
    expect(result.stdout).toContain('name=`llxprt-code` version=`0.0.0-test`');
    expect(result.stdout).toContain('[known]');
    expect(result.stdout).toContain('[UNEXPECTED]');
    expect(result.stdout).toContain('some result message text');
    expect(result.stdout).toContain('schema_validation | 4 | 0 | 0 | 0');
  });

  it('appends the same summary to GITHUB_STEP_SUMMARY preserving existing content', () => {
    const dir = makeTmpDir();
    const summaryPath = join(dir, 'step-summary.md');
    const preexisting = 'preexisting summary line\n';
    writeFileSync(summaryPath, preexisting, 'utf8');
    const result = runValidatorWithEnv(fullPassReport(), 0, {
      GITHUB_STEP_SUMMARY: summaryPath,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('acplint report validated successfully');
    const summaryMarkdown = result.stdout
      .slice(0, result.stdout.indexOf('acplint report validated successfully'))
      .replace(/\n$/, '');
    const content = readFileSync(summaryPath, 'utf8');
    expect(content).toBe(`${preexisting}${summaryMarkdown}\n`);
  });

  it('emits the unavailable summary to GITHUB_STEP_SUMMARY on an unreadable report', () => {
    const dir = makeTmpDir();
    const summaryPath = join(dir, 'step-summary.md');
    writeFileSync(summaryPath, 'preexisting\n', 'utf8');
    const missingPath = join(dir, 'missing.json');
    const result = spawnSync(
      process.execPath,
      [validatorScript, missingPath, '0'],
      {
        encoding: 'utf8',
        timeout: 15_000,
        cwd: repoRoot,
        env: { ...baseEnv(), GITHUB_STEP_SUMMARY: summaryPath },
      },
    );
    expect(result.status).toBe(1);
    const content = readFileSync(summaryPath, 'utf8');
    expect(content).toContain('preexisting');
    expect(content).toContain('unavailable');
  });

  it('writes nothing to a summary file and still succeeds when GITHUB_STEP_SUMMARY is empty', () => {
    const result = runValidatorWithEnv(fullPassReport(), 0, {
      GITHUB_STEP_SUMMARY: '',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('acplint report validated successfully');
  });

  it('succeeds when GITHUB_STEP_SUMMARY is unset', () => {
    const result = runValidatorWithEnv(fullPassReport(), 0, {}, [
      'GITHUB_STEP_SUMMARY',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('acplint report validated successfully');
  });

  it('emits an unavailable summary naming the invalid invocation on wrong argument count', () => {
    const result = runValidatorArgv([]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('## ACP conformance report');
    expect(result.stdout).toContain('unavailable');
    expect(result.stdout).toContain('invalid invocation');
  });

  it('emits an unavailable summary naming the invalid status on a non-numeric status', () => {
    const result = runValidatorArgv(['whatever.json', 'abc']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('## ACP conformance report');
    expect(result.stdout).toContain('unavailable');
    expect(result.stdout).toContain('invalid status');
    expect(result.stdout).toContain('abc');
  });

  it('reaches GITHUB_STEP_SUMMARY on the wrong-argument-count rejection', () => {
    const dir = makeTmpDir();
    const summaryPath = join(dir, 'step-summary.md');
    writeFileSync(summaryPath, 'preexisting\n', 'utf8');
    const result = runValidatorArgv([], {
      GITHUB_STEP_SUMMARY: summaryPath,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('invalid invocation');
    const content = readFileSync(summaryPath, 'utf8');
    expect(content).toContain('## ACP conformance report');
    expect(content).toContain('invalid invocation');
  });

  it('reaches GITHUB_STEP_SUMMARY on the non-numeric-status rejection', () => {
    const dir = makeTmpDir();
    const summaryPath = join(dir, 'step-summary.md');
    writeFileSync(summaryPath, 'preexisting\n', 'utf8');
    const result = runValidatorArgv(['whatever.json', 'zz'], {
      GITHUB_STEP_SUMMARY: summaryPath,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('invalid status');
    const content = readFileSync(summaryPath, 'utf8');
    expect(content).toContain('## ACP conformance report');
    expect(content).toContain('invalid status');
  });

  it('does not truncate a summary larger than the 64 KB pipe buffer', () => {
    const bigMessage = 'x'.repeat(2 * 1024 * 1024);
    const report = JSON.parse(fullPassReport());
    report.findings = [ALLOWED_FINDINGS[0], 'some unexpected finding'];
    const row = report.results.find(
      (r: ResultRow) => r.name === 'delete_session',
    );
    row.message = bigMessage;
    const dir = makeTmpDir();
    const reportPath = join(dir, 'report.json');
    writeFileSync(reportPath, JSON.stringify(report), 'utf8');
    const result = spawnSync(
      process.execPath,
      [validatorScript, reportPath, '0'],
      {
        encoding: 'utf8',
        timeout: 15_000,
        cwd: repoRoot,
        maxBuffer: 16 * 1024 * 1024,
        env: baseEnv(),
      },
    );
    expect(result.status).toBe(1);
    const lastSummaryLine =
      '- `session_lifecycle/delete_session`: ' + bigMessage;
    expect(result.stdout.includes(lastSummaryLine)).toBe(true);
  });
});
