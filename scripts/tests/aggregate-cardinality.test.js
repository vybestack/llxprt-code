/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  fixtureReport,
  useTempArtifactsDir,
  runScript,
  writeAttempt,
} from './aggregate-helpers.js';

/**
 * Issue #2605 (cardinality/artifact identity): The dedicated Evals Nightly
 * workflow expects exactly eval-logs-1/2/3 (matrix [1,2,3]). The aggregator
 * must validate the expected cardinality and artifact identities explicitly,
 * failing for missing, duplicate, or unexpected current artifacts/reports.
 *
 * Cardinality is validated against the DIRECT TOP-LEVEL downloaded artifact
 * directories under the artifacts dir: each expected `eval-logs-N` must be
 * present exactly once with one report.json, and any extra top-level directory
 * (even one with no report) must be rejected. This mirrors how the
 * `download-artifact` action lays out one directory per artifact at the top
 * level of the download path.
 */
describe('aggregate_evals: cardinality/artifact identity validation', () => {
  it('aggregates when exactly the expected attempts are present (default 1,2,3)', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('Eval Results Summary');
    });
  });

  it('fails when an expected attempt is missing (only 2 of expected 3)', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/missing|cardinality|expected/i);
    });
  });

  it('fails when an unexpected attempt is present (extra artifact)', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      writeAttempt(dir, 4);

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/unexpected|cardinality|expected/i);
    });
  });

  it('fails when a single attempt has duplicate report.json files', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      const dupDir = path.join(dir, 'eval-logs-1', 'logs', 'nested');
      fs.mkdirSync(dupDir, { recursive: true });
      fs.writeFileSync(
        path.join(dupDir, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 1 })),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/duplicate|multiple|cardinality/i);
    });
  });

  it('honors --expected-attempts CLI flag to run a smaller set explicitly', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('Eval Results Summary');
    });
  });

  it('fails when a smaller expected set is given but an attempt is missing', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/missing|cardinality|expected/i);
    });
  });

  it('honors AGGREGATE_EXPECTED_ATTEMPTS env var to run a smaller set', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 5);
      writeAttempt(dir, 6);

      const result = runScript(dir, {
        AGGREGATE_SKIP_HISTORICAL: '1',
        AGGREGATE_EXPECTED_ATTEMPTS: '[5,6]',
      });

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('Eval Results Summary');
    });
  });

  it('rejects a malformed AGGREGATE_EXPECTED_ATTEMPTS env var value', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);

      const result = runScript(dir, {
        AGGREGATE_SKIP_HISTORICAL: '1',
        AGGREGATE_EXPECTED_ATTEMPTS: 'not-json',
      });

      expect(result.exitCode, result.stdout).not.toBe(0);
    });
  });

  it('CLI flag takes precedence over env var', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);

      const result = runScript(
        dir,
        { AGGREGATE_SKIP_HISTORICAL: '1', AGGREGATE_EXPECTED_ATTEMPTS: '[1]' },
        ['--expected-attempts', '[1,2]'],
      );

      expect(result.exitCode, result.stdout).toBe(0);
    });
  });
});

/**
 * Issue #2605 (top-level artifact cardinality): The aggregator must inspect
 * the DIRECT top-level directories under the artifacts root (which is how the
 * GitHub `download-artifact` action lays out one directory per artifact). Any
 * extra top-level directory that is not an expected eval-logs-N must be
 * rejected even when it carries no report, so a stray/extra artifact cannot be
 * silently ignored. There are NO name exemptions: dot-directories (.github,
 * .git) and stray artifact names are all rejected.
 */
describe('aggregate_evals: top-level artifact directory cardinality', () => {
  it('rejects an extra top-level artifact directory even when it has no report', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      // An extra top-level directory (a stray "eval-logs-4" log-only artifact)
      // with no report.json. Cardinality must fail closed rather than ignore it.
      fs.mkdirSync(path.join(dir, 'eval-logs-4', 'logs'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'eval-logs-4', 'logs', 'should_save_memory.log'),
        '[]',
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /unexpected|cardinality|eval-logs-4|extra/i,
      );
    });
  });

  it('rejects a top-level artifact directory whose name is not an expected eval-logs-N', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      // A stray artifact directory that is not an eval-logs-N directory at all.
      fs.mkdirSync(path.join(dir, 'stray-artifact'), { recursive: true });

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/unexpected|cardinality|stray/i);
    });
  });

  it('rejects a .github top-level directory (no name exemptions)', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      // A leftover checkout directory must NOT be exempted.
      fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/unexpected|\.github/i);
    });
  });

  it('rejects a dot-directory top-level entry (no dot-name exemptions)', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      // Any dot-directory must be rejected; there are no exemptions for
      // dot-prefixed names.
      fs.mkdirSync(path.join(dir, '.cache'), { recursive: true });

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/unexpected|\.cache/i);
    });
  });

  it('rejects a top-level file (must be a directory)', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      fs.writeFileSync(path.join(dir, 'stray-file.txt'), 'oops');

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/unexpected|stray-file/i);
    });
  });

  it('rejects a symlinked top-level artifact directory named eval-logs-N (no symlink bypass)', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      // A symlink named eval-logs-4 pointing OUTSIDE the artifacts root. With
      // statSync (which follows symlinks) this would be classified as a valid
      // attempt directory and bypass the top-level cardinality check. lstatSync
      // must reject it as an unexpected symlink.
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-outside-'));
      try {
        fs.symlinkSync(outside, path.join(dir, 'eval-logs-4'));

        const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

        expect(result.exitCode, result.stdout).not.toBe(0);
        expect(result.stderr).toMatch(/unexpected|eval-logs-4|cardinality/i);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it('requires exactly one report per expected top-level artifact directory', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      // Attempt 3 has its expected top-level dir but no report.json inside.
      fs.mkdirSync(path.join(dir, 'eval-logs-3', 'logs'), { recursive: true });

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/missing|cardinality|attempt 3/i);
    });
  });
});

/**
 * Final review finding (canonical artifact attempt names): Artifact attempt
 * directory names and report paths must use the CANONICAL form `eval-logs-N`
 * (no zero-padding). A noncanonical zero-padded name like `eval-logs-01` or
 * `eval-logs-001` must be REJECTED by canonical string validation, because it
 * is not an expected eval-logs-N directory and indicates drift/corruption in
 * artifact naming. Numeric equivalence must NOT rescue a noncanonical name.
 */
describe('aggregate_evals: reject noncanonical zero-padded artifact names', () => {
  it('rejects a zero-padded eval-logs-01 directory as an unexpected top-level entry', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      fs.mkdirSync(path.join(dir, 'eval-logs-01', 'logs'), { recursive: true });

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/eval-logs-01|unexpected|cardinality/i);
    });
  });

  it('rejects a three-digit zero-padded eval-logs-001 directory', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      fs.mkdirSync(path.join(dir, 'eval-logs-001', 'logs'), {
        recursive: true,
      });

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/eval-logs-001|unexpected|cardinality/i);
    });
  });

  it('rejects when ALL expected directories are replaced with zero-padded equivalents', () => {
    useTempArtifactsDir((dir) => {
      for (const padded of ['01', '02', '03']) {
        const reportDir = path.join(dir, `eval-logs-${padded}`, 'logs');
        fs.mkdirSync(reportDir, { recursive: true });
        fs.writeFileSync(
          path.join(reportDir, 'report.json'),
          JSON.stringify(fixtureReport({ pass: 1 })),
        );
      }

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' });

      expect(result.exitCode, result.stdout).not.toBe(0);
    });
  });

  it('extractAttemptFromPath does NOT match zero-padded segment', async () => {
    const { loadAggregateModule } = await import('./aggregate-helpers.js');
    const mod = await loadAggregateModule();
    expect(
      mod.extractAttemptFromPath('/tmp/eval-logs-01/logs/report.json'),
    ).toBe(null);
    expect(
      mod.extractAttemptFromPath('/tmp/eval-logs-001/logs/report.json'),
    ).toBe(null);
    expect(
      mod.extractAttemptFromPath('/tmp/eval-logs-1/logs/report.json'),
    ).toBe(1);
  });
});
