/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import {
  asExecError,
  asRecord,
  asRecordArray,
  asString,
  asVmFunction,
} from './typed-test-helpers.ts';

// Phase 3 (issue #2649): Tests for the OCR benchmark harness script.
// These tests verify the script's CLI interface, output format, and
// experiment recording structure without running an actual OCR review
// (which requires live provider credentials and git history).

const BENCH_SCRIPT = join(process.cwd(), 'scripts', 'ocr-benchmark.ts');

describe('scripts/ocr-benchmark.ts — Phase 3 benchmark harness (#2649)', () => {
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
    } catch (err: unknown) {
      const execErr = asExecError(err);
      exitCode = execErr.status || 1;
      stderr = String(execErr.stderr || '');
    }
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Usage:');
    expect(stderr).toContain('--from');
    expect(stderr).toContain('--to');
  });

  it('aborts when OCR_LLM_MODEL is not set (controlled-variable requirement)', () => {
    let exitCode = 0;
    let stderr = '';
    const envWithoutModel = { ...process.env };
    delete envWithoutModel.OCR_LLM_MODEL;
    try {
      execFileSync('node', [BENCH_SCRIPT, '--from', 'abc', '--to', 'def'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: envWithoutModel,
        timeout: 5000,
      });
    } catch (err: unknown) {
      const execErr = asExecError(err);
      exitCode = execErr.status || 1;
      stderr = String(execErr.stderr || '');
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
    } catch (err: unknown) {
      const execErr = asExecError(err);
      exitCode = execErr.status || 1;
      stderr = String(execErr.stderr || '');
    }
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Invalid concurrency');
  });

  it('rejects invalid --timeout values (non-numeric, zero, negative)', () => {
    for (const badTimeout of ['abc', '0', '-5']) {
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
            '--timeout',
            badTimeout,
          ],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, OCR_LLM_MODEL: 'test-model' },
            timeout: 5000,
          },
        );
      } catch (err: unknown) {
        const execErr = asExecError(err);
        exitCode = execErr.status || 1;
        stderr = String(execErr.stderr || '');
      }
      expect(exitCode, `timeout=${badTimeout}`).toBe(1);
      expect(stderr, `timeout=${badTimeout}`).toContain(
        'Invalid --timeout value',
      );
    }
  });

  it('rejects identical from/to refs to avoid empty-range waste', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('fromResolved === toResolved');
    expect(source).toContain('same commit');
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
    } catch (err: unknown) {
      const execErr = asExecError(err);
      exitCode = execErr.status || 1;
      stderr = String(execErr.stderr || '');
    }
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Duplicate');
  });

  it('defaults to concurrency 2,4,8 when not specified', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    expect(source).toContain('concurrencyValues');
    expect(source).toContain('2, 4, 8');
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
    // Instead of a fragile regex on source formatting, verify the
    // experiments array push contains all required field names by
    // checking the broader experiment recording block.
    const experimentsIdx = source.indexOf('experiments.push(');
    expect(experimentsIdx).toBeGreaterThan(-1);
    // Extract a generous window around the push call to cover multiline
    // object literals regardless of formatting.
    const pushBlock = source.substring(experimentsIdx, experimentsIdx + 2000);
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
      // (shorthand property). Accept either form. Escape the field name for
      // regex safety even though current field names are alphanumeric.
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const asFull = pushBlock.includes(`${field}:`);
      const asShorthand = new RegExp(`\\b${escaped}\\b,`).test(pushBlock);
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
    expect(source).toContain('--diff-filter=ACMRTUXB');
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

  it('distinguishes empty, malformed, and unsupported OCR output envelopes (behavioral)', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    // Extract the parseOcrOutput function and run it against real inputs so
    // the test proves actual parsing behavior, not just string presence.
    const fnStart = source.indexOf('function parseOcrOutput(');
    expect(fnStart).toBeGreaterThan(-1);
    const bodyStart = source.indexOf('{', fnStart);
    let depth = 0;
    let fnEnd = -1;
    for (let i = bodyStart; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          fnEnd = i + 1;
          break;
        }
      }
    }
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnSrc = source.slice(fnStart, fnEnd);
    // Strip TypeScript type annotations for vm execution. The function source
    // contains `: string` param type and `: unknown` in the map callback.
    const jsSrc = fnSrc
      .replace(
        /function\s+parseOcrOutput\s*\(\s*stdout\s*:\s*string\s*\)/,
        'function parseOcrOutput(stdout)',
      )
      .replace(/\(\s*w\s*:\s*unknown\s*\)/g, '(w)');
    const sandbox: Record<string, unknown> = vm.createContext({});
    vm.runInContext(jsSrc, sandbox);
    const parseOcrOutput = asVmFunction(sandbox['parseOcrOutput']);

    // Empty input → parseStatus 'empty'
    expect(asString(asRecord(parseOcrOutput(''))['parseStatus'])).toBe('empty');

    // Malformed JSON → parseStatus 'malformed'
    expect(asString(asRecord(parseOcrOutput('not json'))['parseStatus'])).toBe(
      'malformed',
    );

    // Unsupported envelope (object without comments) → 'unsupported-envelope'
    expect(
      asString(
        asRecord(parseOcrOutput(JSON.stringify({ status: 'success' })))[
          'parseStatus'
        ],
      ),
    ).toBe('unsupported-envelope');

    // Valid bare array → 'ok' with findings
    const arrResult = asRecord(
      parseOcrOutput(JSON.stringify([{ path: 'a.ts', content: 'x' }])),
    );
    expect(asString(arrResult['parseStatus'])).toBe('ok');
    expect(asRecordArray(arrResult['findings'])).toHaveLength(1);

    // Valid envelope with comments → 'ok'
    const envResult = asRecord(
      parseOcrOutput(
        JSON.stringify({
          summary: {
            total_tokens: 100,
            files_reviewed: { completed: 3, selected: 5 },
          },
          comments: [{ path: 'b.ts' }],
        }),
      ),
    );
    expect(asString(envResult['parseStatus'])).toBe('ok');
    expect(asRecordArray(envResult['findings'])).toHaveLength(1);
    expect(asRecord(envResult['tokens'])['total']).toBe(100);
    expect(envResult['completedFiles']).toBe(3);
    expect(envResult['selectedFiles']).toBe(5);
  });

  it('parses stderr/stdout on non-zero exit codes (not just on success)', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    // The catch block must capture e.stdout and e.stderr, not just message.
    expect(source).toContain('e.stdout');
    expect(source).toContain('e.stderr');
    expect(source).toContain('e.status');
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

  it('redacts secrets in OCR warnings before persisting (security)', () => {
    const source = readFileSync(BENCH_SCRIPT, 'utf8');
    // Warnings from the OCR output envelope must pass through redact()
    // before being recorded in experiment results. The implementation spans
    // multiple lines, so use [\s\S] to match across newlines.
    expect(source).toMatch(/warnings[\s\S]*?map[\s\S]*?redact/);
  });
});
