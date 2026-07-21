/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  fixtureReport,
  useTempArtifactsDir,
  runScript,
  SCRIPT,
} from './aggregate-helpers.js';

/**
 * Issue #2605: Aggregation must fail loudly when result data is absent or
 * unusable instead of printing "No reports found." and exiting 0, which hid
 * broken result collection in the dedicated Evals Nightly workflow.
 */
describe('aggregate_evals: missing or unusable reports', () => {
  it('exits nonzero when no report.json exists anywhere under the artifacts dir', () => {
    useTempArtifactsDir((dir) => {
      fs.mkdirSync(path.join(dir, 'eval-logs-1', 'logs'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'eval-logs-1', 'logs', 'should_save_memory.log'),
        '[]',
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stdout).toContain('No reports found');
    });
  });

  it('exits nonzero when reports exist but contain no usable assertion data', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({ testResults: [] }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/no usable assertions|Aggregation aborted/);
    });
  });

  it('exits nonzero when report.json is malformed JSON', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'report.json'), '{not valid json');

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/Could not parse|Aggregation aborted/);
    });
  });

  it('exits nonzero when report.json lacks the testResults array', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({ numTotalTests: 5 }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/testResults|Aggregation aborted/);
    });
  });
});

describe('aggregate_evals: valid pass/fail reports', () => {
  it('exits zero and reports the overall pass rate for a fully passing run', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 1, fail: 0 })),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('Eval Results Summary');
      expect(result.stdout).toContain('100.0% (1/1 tests passed)');
      expect(result.stdout).toContain('**100%**');
    });
  });

  it('reports a mixed pass/fail matrix without exiting nonzero on aggregation itself', () => {
    useTempArtifactsDir((dir) => {
      const runA = path.join(dir, 'eval-logs-1', 'logs');
      const runB = path.join(dir, 'eval-logs-2', 'logs');
      fs.mkdirSync(runA, { recursive: true });
      fs.mkdirSync(runB, { recursive: true });
      fs.writeFileSync(
        path.join(runA, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 1, fail: 0 })),
      );
      fs.writeFileSync(
        path.join(runB, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 0, fail: 1 })),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('50.0% (1/2 tests passed)');
    });
  });
});

describe('aggregate_evals: edge cases', () => {
  it('defaults the artifacts directory to the current working directory', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 1, fail: 0 })),
      );

      let result;
      try {
        const stdout = execFileSync(
          'node',
          [SCRIPT, '.', '--expected-attempts', '[1]'],
          {
            cwd: dir,
            encoding: 'utf8',
            env: { ...process.env, AGGREGATE_SKIP_HISTORICAL: '1' },
          },
        );
        result = { stdout, exitCode: 0 };
      } catch (error) {
        // Safe unknown narrowing: execFileSync exceptions carry the child's
        // stdout/stderr under encoding: 'utf8'. The previous `error instanceof
        // Error ? '' : ...` inverted condition always discarded stdout because
        // execFileSync always throws an Error on non-zero exit.
        const stdout =
          error !== null &&
          typeof error === 'object' &&
          typeof error.stdout === 'string'
            ? error.stdout
            : '';
        result = {
          stdout,
          exitCode:
            error !== null &&
            typeof error === 'object' &&
            typeof error.status === 'number'
              ? error.status
              : 1,
        };
      }

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('100.0% (1/1 tests passed)');
    });
  });

  it('can skip historical fetch via env opt-out (no gh dependency)', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 1, fail: 0 })),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).not.toContain('Run ');
    });
  });
});
