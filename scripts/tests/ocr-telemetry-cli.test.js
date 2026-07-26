/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  validateTelemetryRecord,
  validateReconciliation,
} from '../ocr-telemetry-schema.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const TELEMETRY_SCRIPT = path.join(REPO_ROOT, 'scripts', 'ocr-telemetry.js');
const AGGREGATOR_SCRIPT = path.join(
  REPO_ROOT,
  'scripts',
  'aggregate-ocr-telemetry.js',
);

const temporaryDirectories = new Set();

function makeTmpDir() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ocr-telemetry-cli-'),
  );
  temporaryDirectories.add(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function writeJson(dir, name, obj) {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(obj, null, 2)}\n`);
}

function writeText(dir, name, text) {
  fs.writeFileSync(path.join(dir, name), text);
}

function runCli(cwd, env = {}) {
  return spawnSync(process.execPath, [TELEMETRY_SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    },
  });
}

function readEmittedTelemetry(dir) {
  const raw = fs.readFileSync(path.join(dir, 'ocr-telemetry.json'), 'utf8');
  return JSON.parse(raw);
}

function baseEnv(overrides = {}) {
  return {
    OCR_RUN_ID: '987654',
    OCR_RUN_ATTEMPT: '1',
    OCR_PR_NUMBER: '2676',
    OCR_SHA: 'abc123def456789012345678901234567890abcd',
    OCR_GENERATED_AT: '2026-07-25T23:09:35.000Z',
    OCR_INFRASTRUCTURE_FAILURE: 'false',
    OCR_POLICY_FAILURE: 'false',
    OCR_INLINE_POSTED: '2',
    OCR_ALREADY_POSTED_OR_SKIPPED_DEDUP: '1',
    OCR_COMMENTS_SKIPPED: '1',
    OCR_COMMENTS_FAILED: '0',
    OCR_COMMENTS_TOTAL: '4',
    OCR_WALL_CLOCK_SECONDS: '2791',
    OCR_FILES_REVIEWED: '3',
    OCR_PER_FILE_REVIEW_FAILURES: 'x.ts',
    OCR_POST_STATE: 'posted',
    OCR_POST_OUTCOME: 'success',
    OCR_ARTIFACT_STATE: 'prepared',
    OCR_HASH_STATE: 'prepared',
    OCR_PREVIEW_ATTEMPTED: 'true',
    OCR_PREVIEW_SUCCEEDED: 'true',
    OCR_COMMENTS_ROUTED_SUMMARY: '1',
    ...overrides,
  };
}

function successArtifacts(dir) {
  writeJson(dir, 'ocr-metadata.json', {
    schema: 1,
    ocr: {
      version: '1.7.16',
      model: 'test-model',
      concurrency: 2,
      elapsed: '46m31s',
      tokens: {
        input: 300,
        output: 100,
        cache_read: 50,
        cache_write: 25,
        total: 400,
      },
    },
    terminal: {
      completeness_state: 'complete',
      publication_state: 'complete',
    },
  });
  writeJson(dir, 'ocr-reviewed-range-manifest.json', {
    selected_files: ['a.ts', 'b.ts', 'c.ts'],
    completed_files: ['a.ts', 'b.ts', 'c.ts'],
    failed_files: [],
    completeness: 'complete',
  });
  writeJson(dir, 'ocr-routing-decisions.json', [
    { category: 'bug', severity: 'high', destination: 'inline' },
    { category: 'style', severity: 'low', destination: 'summary' },
  ]);
}

describe('ocr-telemetry.js CLI — real behavioral runs', () => {
  it('normal success: emits nonempty schema-valid telemetry with summary', () => {
    const run = makeTmpDir();
    successArtifacts(run);
    const summaryPath = path.join(run, 'summary.md');
    const result = runCli(run, {
      ...baseEnv(),
      GITHUB_STEP_SUMMARY: summaryPath,
    });
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.schema_name).toBe('ocr-telemetry');
    expect(telemetry.total_findings).toBe(2);
    expect(telemetry.wall_clock_seconds).toBe(2791);
    expect(telemetry.cli_elapsed_seconds).toBe(46 * 60 + 31);
    expect(telemetry.files_reviewed).toBe(3);
    expect(telemetry.files_previewed).toBe(3);
    expect(telemetry.already_resolved).toBeNull();
    expect(telemetry.already_posted_or_skipped_dedup).toBe(1);
    expect(telemetry.per_file_review_failures).toEqual(['x.ts']);
    expect(telemetry.file_read_failures).toBeNull();
    expect(validateTelemetryRecord(telemetry)).toBeNull();
    expect(validateReconciliation(telemetry)).toBeNull();
    const summary = fs.readFileSync(summaryPath, 'utf8');
    expect(summary).toContain('OCR Telemetry');
  });

  it('no-changed-tests / noop: emits valid telemetry with zero findings', () => {
    const run = makeTmpDir();
    writeJson(run, 'ocr-metadata.json', {
      ocr: {
        version: '1.7.16',
        model: 'm',
        concurrency: 2,
        elapsed: '0s',
        tokens: {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_write: 0,
          total: 0,
        },
      },
      terminal: {
        completeness_state: 'complete',
        publication_state: 'complete',
      },
    });
    writeJson(run, 'ocr-reviewed-range-manifest.json', {
      selected_files: [],
      completed_files: [],
      failed_files: [],
      completeness: 'complete',
    });
    writeJson(run, 'ocr-routing-decisions.json', []);
    const result = runCli(
      run,
      baseEnv({
        OCR_FILES_REVIEWED: '0',
        OCR_WALL_CLOCK_SECONDS: '0',
        OCR_INLINE_POSTED: '0',
        OCR_COMMENTS_TOTAL: '0',
        OCR_COMMENTS_ROUTED_SUMMARY: '0',
        OCR_ALREADY_POSTED_OR_SKIPPED_DEDUP: '0',
        OCR_COMMENTS_SKIPPED: '0',
        OCR_PER_FILE_REVIEW_FAILURES: '',
      }),
    );
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.total_findings).toBe(0);
    expect(telemetry.files_reviewed).toBe(0);
    expect(telemetry.files_previewed).toBe(0);
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });

  it('OCR nonzero exit (infrastructure failure): emits valid degraded record', () => {
    const run = makeTmpDir();
    // metadata may be missing/partial; manifest may be empty placeholder
    writeJson(run, 'ocr-reviewed-range-manifest.json', {
      selected_files: [],
      completed_files: [],
      failed_files: [],
      completeness: 'partial',
    });
    // routing-decisions and metadata are empty placeholders
    const result = runCli(
      run,
      baseEnv({
        OCR_INFRASTRUCTURE_FAILURE: 'true',
        OCR_FILES_REVIEWED: '0',
        OCR_WALL_CLOCK_SECONDS: '5',
        OCR_INLINE_POSTED: '0',
        OCR_COMMENTS_TOTAL: '0',
        OCR_COMMENTS_ROUTED_SUMMARY: '0',
        OCR_ALREADY_POSTED_OR_SKIPPED_DEDUP: '',
        OCR_COMMENTS_SKIPPED: '0',
        OCR_PER_FILE_REVIEW_FAILURES: '',
        OCR_POST_STATE: 'failed',
        OCR_POST_OUTCOME: 'failure',
        OCR_ARTIFACT_STATE: 'failed',
        OCR_HASH_STATE: 'unavailable',
      }),
    );
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.infrastructure_failure).toBe(true);
    expect(telemetry.post_state).toBe('failed');
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });

  it('Post failure / missing outputs: still emits valid record with post_state', () => {
    const run = makeTmpDir();
    successArtifacts(run);
    const result = runCli(
      run,
      baseEnv({
        OCR_POST_STATE: 'failed',
        OCR_POST_OUTCOME: 'failure',
        OCR_ARTIFACT_STATE: 'failed',
        OCR_HASH_STATE: 'unavailable',
        OCR_INLINE_POSTED: '',
        OCR_COMMENTS_FAILED: '2',
        OCR_COMMENTS_TOTAL: '',
      }),
    );
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.post_state).toBe('failed');
    expect(telemetry.inline_posted).toBeNull();
    expect(telemetry.comments_total).toBeNull();
    expect(telemetry.errors).toContain(
      'Post OCR results outputs were unavailable',
    );
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });

  it('corrupt ocr-metadata.json: emits valid record, does not throw', () => {
    const run = makeTmpDir();
    writeText(run, 'ocr-metadata.json', '{not valid json');
    writeJson(run, 'ocr-reviewed-range-manifest.json', {
      selected_files: ['a.ts'],
      completed_files: [],
      failed_files: [],
      completeness: 'partial',
    });
    writeJson(run, 'ocr-routing-decisions.json', []);
    const result = runCli(
      run,
      baseEnv({ OCR_FILES_REVIEWED: '0', OCR_WALL_CLOCK_SECONDS: '3' }),
    );
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });

  it('zero-byte artifacts: emits valid record', () => {
    const run = makeTmpDir();
    writeText(run, 'ocr-metadata.json', '');
    writeText(run, 'ocr-reviewed-range-manifest.json', '');
    writeText(run, 'ocr-routing-decisions.json', '');
    const result = runCli(
      run,
      baseEnv({
        OCR_INFRASTRUCTURE_FAILURE: 'true',
        OCR_FILES_REVIEWED: '',
        OCR_WALL_CLOCK_SECONDS: '1',
        OCR_INLINE_POSTED: '',
        OCR_COMMENTS_TOTAL: '',
        OCR_ALREADY_POSTED_OR_SKIPPED_DEDUP: '',
        OCR_COMMENTS_SKIPPED: '',
        OCR_PER_FILE_REVIEW_FAILURES: '',
        OCR_POST_STATE: 'failed',
        OCR_POST_OUTCOME: 'failure',
        OCR_ARTIFACT_STATE: 'failed',
        OCR_HASH_STATE: 'unavailable',
      }),
    );
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.total_findings).toBeNull();
    expect(telemetry.findings).toBeNull();
    expect(telemetry.files_previewed).toBeNull();
    expect(telemetry.files_reviewed).toBeNull();
    expect(telemetry.infrastructure_failure).toBe(true);
    expect(telemetry.errors.length).toBeGreaterThan(0);
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });

  it('missing PR/SHA (null sha): emits valid record with sha null', () => {
    const run = makeTmpDir();
    successArtifacts(run);
    const result = runCli(run, baseEnv({ OCR_SHA: '', OCR_PR_NUMBER: '2676' }));
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.sha).toBeNull();
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });

  it('missing workflow context emits a schema-valid record with truthful nulls', () => {
    const run = makeTmpDir();
    const result = runCli(run, {
      OCR_GENERATED_AT: '2026-07-25T23:09:35.000Z',
      OCR_INFRASTRUCTURE_FAILURE: 'true',
      OCR_TELEMETRY_STATE: 'failed',
      OCR_ARTIFACT_STATE: 'failed',
    });
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.run_id).toBeNull();
    expect(telemetry.run_attempt).toBeNull();
    expect(telemetry.pr_number).toBeNull();
    expect(telemetry.total_findings).toBeNull();
    expect(telemetry.errors).toContain('OCR metadata artifact was unavailable');
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });

  it('derives read failures only from explicit read-specific evidence', () => {
    const run = makeTmpDir();
    successArtifacts(run);
    const result = runCli(
      run,
      baseEnv({
        OCR_FILE_READ_FAILURES: 'unreadable.ts',
        OCR_PER_FILE_REVIEW_FAILURES: 'unreadable.ts\nlogic.ts',
      }),
    );
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.file_read_failures).toEqual(['unreadable.ts']);
    expect(telemetry.file_read_failure_count).toBe(1);
    expect(telemetry.per_file_review_failures).toEqual([
      'unreadable.ts',
      'logic.ts',
    ]);
  });

  it('writes schema-valid telemetry atomically on success', () => {
    const run = makeTmpDir();
    successArtifacts(run);
    const result = runCli(run, baseEnv());
    expect(result.status).toBe(0);
    const telemetryPath = path.join(run, 'ocr-telemetry.json');
    const stat = fs.statSync(telemetryPath);
    expect(stat.size).toBeGreaterThan(0);
    const raw = fs.readFileSync(telemetryPath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(
      fs.readdirSync(run).filter((name) => name.includes('.writing-')),
    ).toEqual([]);
  });

  it('removes the temporary telemetry file when atomic rename fails', () => {
    const run = makeTmpDir();
    successArtifacts(run);
    fs.mkdirSync(path.join(run, 'ocr-telemetry.json'));

    const result = runCli(run, baseEnv());

    expect(result.status).not.toBeNull();
    expect(result.status).not.toBe(0);
    expect(
      fs.readdirSync(run).filter((name) => name.includes('.writing-')),
    ).toEqual([]);
  });

  it('producer output aggregates end-to-end through the real aggregator CLI', () => {
    const run = makeTmpDir();
    successArtifacts(run);
    expect(runCli(run, baseEnv()).status).toBe(0);
    const result = spawnSync(process.execPath, [AGGREGATOR_SCRIPT, run], {
      cwd: run,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    expect(result.status).toBe(0);
    const aggregation = JSON.parse(result.stdout);
    expect(aggregation.runs).toBe(1);
    expect(aggregation.total_findings).toBe(2);
  });

  it('passes OCR_FILES_REVIEWED through to telemetry', () => {
    const run = makeTmpDir();
    successArtifacts(run);
    const result = runCli(run, baseEnv({ OCR_FILES_REVIEWED: '3' }));
    expect(result.status).toBe(0);
    const telemetry = readEmittedTelemetry(run);
    expect(telemetry.files_reviewed).toBe(3);
    expect(validateTelemetryRecord(telemetry)).toBeNull();
  });

  it('redacts escaped and embedded secret substrings atomically', () => {
    const run = makeTmpDir();
    const secret = 'secret"token\\path';
    successArtifacts(run);
    expect(runCli(run, baseEnv()).status).toBe(0);
    const telemetryPath = path.join(run, 'ocr-telemetry.json');
    const telemetry = readEmittedTelemetry(run);
    telemetry.ocr.model = `https://model.test/?credential=${secret}&mode=diagnostic`;
    fs.writeFileSync(telemetryPath, `${JSON.stringify(telemetry, null, 2)}\n`);

    const result = spawnSync(
      process.execPath,
      [TELEMETRY_SCRIPT, '--redact', 'ocr-telemetry.json'],
      {
        cwd: run,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          OCR_LLM_TOKEN: secret,
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const raw = fs.readFileSync(telemetryPath, 'utf8');
    const redacted = JSON.parse(raw);
    expect(redacted.ocr.model).toBe(
      'https://model.test/?credential=[REDACTED]&mode=diagnostic',
    );
    expect(validateTelemetryRecord(redacted)).toBeNull();
    expect(
      fs.readdirSync(run).filter((name) => name.includes('.redacting-')),
    ).toEqual([]);
  });
});
