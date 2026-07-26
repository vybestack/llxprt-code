/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Phase 3 (issue #2649): Tests for the OCR benchmark harness script.
// These tests verify the script's CLI interface, output format, and
// experiment recording structure without running an actual OCR review
// (which requires live provider credentials and git history).

const BENCH_SCRIPT = join(process.cwd(), 'scripts', 'ocr-benchmark.mjs');

describe('scripts/ocr-benchmark.mjs — Phase 3 benchmark harness (#2649)', () => {
  it('the script file exists', () => {
    expect(existsSync(BENCH_SCRIPT)).toBe(true);
  });

  it('requires --from and --to arguments', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('node', [BENCH_SCRIPT, '--from', 'abc'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, OCR_LLM_MODEL: 'test-model' },
        timeout: 5000,
      });
    } catch (err) {
      exitCode = err.status || 1;
      stderr = err.stderr || '';
    }
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Usage:');
    expect(stderr).toContain('--from');
    expect(stderr).toContain('--to');
  });

  it('aborts when OCR_LLM_MODEL is not set (controlled-variable requirement)', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('node', [BENCH_SCRIPT, '--from', 'abc', '--to', 'def'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, OCR_LLM_MODEL: '' },
        timeout: 5000,
      });
    } catch (err) {
      exitCode = err.status || 1;
      stderr = err.stderr || '';
    }
    expect(exitCode).toBe(1);
    expect(stderr).toContain('OCR_LLM_MODEL');
  });

  it('accepts --concurrency as a comma-separated list', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('--concurrency');
    expect(source).toContain("split(',')");
    expect(source).toContain('concurrencyValues');
  });

  it('rejects invalid concurrency values (non-positive, non-integer)', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(
        'node',
        [
          BENCH_SCRIPT,
          '--from',
          'abc',
          '--to',
          'def',
          '--concurrency',
          '0,abc,-1',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, OCR_LLM_MODEL: 'test-model' },
          timeout: 5000,
        },
      );
    } catch (err) {
      exitCode = err.status || 1;
      stderr = err.stderr || '';
    }
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid concurrency');
  });

  it('rejects duplicate concurrency values', () => {
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(
        'node',
        [
          BENCH_SCRIPT,
          '--from',
          'abc',
          '--to',
          'def',
          '--concurrency',
          '2,2,4',
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, OCR_LLM_MODEL: 'test-model' },
          timeout: 5000,
        },
      );
    } catch (err) {
      exitCode = err.status || 1;
      stderr = err.stderr || '';
    }
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Duplicate');
  });

  it('defaults to concurrency 2,4,8 when not specified', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toMatch(/concurrencyValues\.push\(2,\s*4,\s*8\)/);
  });

  it('resolves git refs to immutable commit IDs before experiments', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('resolveRef');
    expect(source).toContain("git', ['rev-parse'");
    expect(source).toContain('fromResolved');
    expect(source).toContain('toResolved');
  });

  it('records experiment metadata fields required by issue #2649', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    const pushBlockMatch = source.match(/experiments\.push\(\{([\s\S]*?)\}\);/);
    expect(pushBlockMatch).toBeTruthy();
    const pushBlock = pushBlockMatch[1];
    const requiredFields = [
      'label',
      'ocr_version',
      'ocr_model',
      'rules_hash',
      'concurrency',
      'from_sha',
      'to_sha',
      'cumulative_files',
      'cumulative_lines',
      'finding_count',
      'completed_files',
      'selected_files',
      'elapsed_ms',
      'timed_out',
      'parse_status',
      'tokens',
      'warnings',
      'exit_code',
      'stderr',
      'error',
    ];
    for (const field of requiredFields) {
      // Fields can appear as either `field:` (full property) or `field,`
      // (shorthand property). Accept either form.
      const asFull = pushBlock.includes(`${field}:`);
      const asShorthand = new RegExp(`\\b${field}\\b,`).test(pushBlock);
      expect(asFull || asShorthand).toBe(true);
    }
  });

  it('produces a results file with a schema version', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('schema: 1');
    expect(source).toContain('writeFileSync(outputFile');
    expect(source).toContain('ocr-benchmark-results.json');
  });

  it('computes git diff stats including additions and deletions', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('gitDiffStat');
    expect(source).toContain('--name-only');
    expect(source).toContain('--diff-filter=d');
    expect(source).toContain('--numstat');
    expect(source).toContain('additions');
    expect(source).toContain('deletions');
  });

  it('runs each concurrency value as a separate experiment', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('for (const concurrency of concurrencyValues)');
    expect(source).toContain('experiments.push(');
  });

  it('respects the --label flag for experiment grouping', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain("getArg('label')");
    expect(source).toContain("'unspecified'");
  });

  it('respects the --output flag for results file path', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain("getArg('output')");
  });

  it('uses NO_COLOR=1 for deterministic plain-text output', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain("NO_COLOR: '1'");
  });

  it('captures OCR version and requires a model for controlled experiments', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain("execFileSync('ocr', ['version']");
    expect(source).toContain('OCR_LLM_MODEL');
  });

  it('computes a rules hash for rule-change detection across experiments', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('rules_hash');
    expect(source).toContain('createHash');
    expect(source).toContain('rule.json');
  });

  it('distinguishes empty, malformed, and unsupported OCR output envelopes', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('parseStatus');
    expect(source).toContain("'empty'");
    expect(source).toContain("'malformed'");
    expect(source).toContain("'unsupported-envelope'");
    expect(source).toContain("'ok'");
  });

  it('parses stderr/stdout on non-zero exit codes (not just on success)', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    // The catch block must capture err.stdout and err.stderr, not just message.
    expect(source).toContain('err.stdout');
    expect(source).toContain('err.stderr');
    expect(source).toContain('err.status');
  });

  it('records timeout state explicitly', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('timedOut');
    expect(source).toContain('SIGTERM');
  });

  it('redacts secrets in error messages and stderr before persisting', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('function redact(');
    expect(source).toContain('OCR_LLM_TOKEN');
    expect(source).toContain('OCR_LLM_URL');
    expect(source).toContain('[REDACTED]');
  });

  it('records per-experiment timestamp for chronological analysis', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('new Date().toISOString()');
  });

  it('parses OCR JSON output envelope for tokens and file counts', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('parsed.comments');
    expect(source).toContain('summary');
    expect(source).toContain('files_reviewed');
    expect(source).toContain('completed');
    expect(source).toContain('selected');
  });
});
