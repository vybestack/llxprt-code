/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  fixtureReport,
  useTempArtifactsDir,
  runScript,
  loadAggregateModule,
} from './aggregate-helpers.js';

/**
 * Issue #2605 (follow-up): A semantically malformed CURRENT report must fail
 * the aggregation closed (nonzero exit) rather than being silently skipped,
 * because the prior behavior could mask broken result collection. Malformed
 * means: missing/unknown assertion status, missing test name, wrong schema,
 * or a mix of valid and malformed reports. Skipped/pending-only reports carry
 * no usable pass/fail signal and must also fail closed.
 */
describe('aggregate_evals: malformed current reports fail closed', () => {
  it('exits nonzero when an assertion has no status', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({
          testResults: [
            { assertionResults: [{ title: 'should save memory' }] },
          ],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/missing a status|Aggregation aborted/i);
    });
  });

  it('exits nonzero when an assertion has an unrecognized status', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({
          testResults: [
            {
              assertionResults: [
                { title: 'should save memory', status: 'bogus' },
              ],
            },
          ],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/unrecognized status|Aggregation aborted/i);
    });
  });

  it('exits nonzero when an assertion has no title or fullName', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({
          testResults: [{ assertionResults: [{ status: 'passed' }] }],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /missing a nonempty title\/fullName|Aggregation aborted/i,
      );
    });
  });

  // Data-driven: testResults malformations that all hit the
  // !Array.isArray(report.testResults) guard. Each variant hits the same
  // production branch but must be explicitly verified.
  for (const { label, value } of [
    { label: 'not an array (string)', value: 'not-an-array' },
    { label: 'missing (absent key)', value: undefined },
    { label: 'null', value: null },
  ]) {
    it(`exits nonzero when testResults is ${label}`, () => {
      useTempArtifactsDir((dir) => {
        const reportDir = path.join(dir, 'eval-logs-1', 'logs');
        fs.mkdirSync(reportDir, { recursive: true });
        const report = value === undefined ? {} : { testResults: value };
        fs.writeFileSync(
          path.join(reportDir, 'report.json'),
          JSON.stringify(report),
        );

        const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
          '--expected-attempts',
          '[1]',
        ]);

        expect(result.exitCode, result.stdout).not.toBe(0);
        expect(result.stderr).toMatch(
          /testResults is not an array|Invalid report format|Aggregation aborted/i,
        );
      });
    });
  }

  // Data-driven: assertionResults malformations within a valid testResults
  // array. The issue header names "wrong schema" as a malformation category;
  // these variants hit the !Array.isArray(testResult.assertionResults) guard
  // in the production validator and must each fail closed.
  for (const { label, value } of [
    { label: 'undefined (missing key)', value: undefined },
    { label: 'null', value: null },
    { label: 'a string (not an array)', value: 'not-an-array' },
  ]) {
    it(`exits nonzero when assertionResults is ${label}`, () => {
      useTempArtifactsDir((dir) => {
        const reportDir = path.join(dir, 'eval-logs-1', 'logs');
        fs.mkdirSync(reportDir, { recursive: true });
        const testResult =
          value === undefined ? {} : { assertionResults: value };
        fs.writeFileSync(
          path.join(reportDir, 'report.json'),
          JSON.stringify({ testResults: [testResult] }),
        );

        const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
          '--expected-attempts',
          '[1]',
        ]);

        expect(result.exitCode, result.stdout).not.toBe(0);
        // Assert the exact validation branch: a testResult missing an
        // assertionResults array, not a broad alternative.
        expect(result.stderr).toMatch(/missing an assertionResults array/i);
      });
    });
  }

  it('exits nonzero when a valid report is mixed with a malformed one', () => {
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
        JSON.stringify({
          testResults: [
            { assertionResults: [{ title: 'x', status: 'bogus' }] },
          ],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/unrecognized status|Aggregation aborted/i);
    });
  });

  it('exits nonzero when the only assertions are skipped/pending (no usable pass/fail)', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({
          testResults: [
            {
              assertionResults: [
                { title: 'skipped one', status: 'skipped' },
                { title: 'pending one', status: 'pending' },
              ],
            },
          ],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /no usable passed\/failed assertions|Aggregation aborted/i,
      );
    });
  });
});

describe('aggregate_evals: valid mixtures aggregate correctly', () => {
  it('counts passed, failed, and skipped assertions without corrupting the pass-rate denominator', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({
          testResults: [
            {
              assertionResults: [
                { title: 'should save memory', status: 'passed' },
                { title: 'should save memory', status: 'passed' },
                { title: 'should save memory', status: 'failed' },
                { title: 'should save memory', status: 'skipped' },
              ],
            },
          ],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('66.7% (2/3 tests passed)');
    });
  });

  it('aggregates a clean mix of valid pass and fail reports across runs', () => {
    useTempArtifactsDir((dir) => {
      const runA = path.join(dir, 'eval-logs-1', 'logs');
      const runB = path.join(dir, 'eval-logs-2', 'logs');
      fs.mkdirSync(runA, { recursive: true });
      fs.mkdirSync(runB, { recursive: true });
      fs.writeFileSync(
        path.join(runA, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 2, fail: 0 })),
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
      expect(result.stdout).toContain('66.7% (2/3 tests passed)');
    });
  });
});

/**
 * Issue #2605 (per-report strictness): Strictness must apply PER REPORT, not
 * just across the aggregate. A single valid report must not mask a second
 * CURRENT report that is unusable or failed-without-assertions. Each current
 * report must independently be structurally valid, free of unrepresented
 * suite/report failures, and contribute at least one usable passed/failed
 * assertion. Non-denominator statuses (skipped/pending) are excluded from the
 * denominator when a report ALSO has usable assertions.
 */
describe('aggregate_evals: per-report strictness (valid + unusable report)', () => {
  function writeReports(validDir, unusableDir, unusableReport) {
    fs.mkdirSync(validDir, { recursive: true });
    fs.mkdirSync(unusableDir, { recursive: true });
    fs.writeFileSync(
      path.join(validDir, 'report.json'),
      JSON.stringify(fixtureReport({ pass: 1, fail: 0 })),
    );
    fs.writeFileSync(
      path.join(unusableDir, 'report.json'),
      JSON.stringify(unusableReport),
    );
  }

  it('fails when a valid report is mixed with one that has empty testResults', () => {
    useTempArtifactsDir((dir) => {
      writeReports(
        path.join(dir, 'eval-logs-1', 'logs'),
        path.join(dir, 'eval-logs-2', 'logs'),
        { testResults: [] },
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      // Empty testResults yields no usable pass/fail signal: assert the exact
      // validation branch rather than a broad alternative that could match an
      // unrelated failure.
      expect(result.stderr).toMatch(/no usable passed\/failed assertions/i);
    });
  });

  it('fails when a valid report is mixed with one that has a testResult with empty assertionResults', () => {
    useTempArtifactsDir((dir) => {
      writeReports(
        path.join(dir, 'eval-logs-1', 'logs'),
        path.join(dir, 'eval-logs-2', 'logs'),
        { testResults: [{ assertionResults: [] }] },
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/no usable passed\/failed assertions/i);
    });
  });

  it('fails when a valid report is mixed with one whose only assertions are skipped/pending/todo', () => {
    useTempArtifactsDir((dir) => {
      writeReports(
        path.join(dir, 'eval-logs-1', 'logs'),
        path.join(dir, 'eval-logs-2', 'logs'),
        {
          testResults: [
            {
              assertionResults: [
                { title: 'only skipped', status: 'skipped' },
                { title: 'only pending', status: 'pending' },
                { title: 'only Todo', status: 'todo' },
              ],
            },
          ],
        },
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/no usable passed\/failed assertions/i);
    });
  });

  it('fails when a valid report is mixed with one that has a suite-level failure (failed testResult status) but no failed assertions', () => {
    useTempArtifactsDir((dir) => {
      writeReports(
        path.join(dir, 'eval-logs-1', 'logs'),
        path.join(dir, 'eval-logs-2', 'logs'),
        {
          numFailedTestSuites: 1,
          success: false,
          testResults: [
            {
              name: '/repo/evals/broken.eval.ts',
              status: 'failed',
              message: 'Error: Test suite failed to collect',
              assertionResults: [
                {
                  title: 'placeholder',
                  fullName: 'placeholder',
                  status: 'passed',
                },
              ],
            },
          ],
        },
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      // Assert the exact suite-status validation branch: a 'failed' testResult
      // status must be backed by at least one failed assertion.
      expect(result.stderr).toMatch(
        /marked failed but has no failed assertions/i,
      );
    });
  });

  it('fails when a valid report is mixed with one whose report.success is false but no assertions are failed', () => {
    useTempArtifactsDir((dir) => {
      writeReports(
        path.join(dir, 'eval-logs-1', 'logs'),
        path.join(dir, 'eval-logs-2', 'logs'),
        {
          success: false,
          testResults: [
            {
              assertionResults: [
                {
                  title: 'orphan pass',
                  fullName: 'orphan pass',
                  status: 'passed',
                },
              ],
            },
          ],
        },
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      // Assert the exact report-level validation branch.
      expect(result.stderr).toMatch(
        /success is false but no assertions are failed/i,
      );
    });
  });

  it('fails when a valid report is mixed with one that has failed-suite counters without corresponding failed assertions', () => {
    useTempArtifactsDir((dir) => {
      writeReports(
        path.join(dir, 'eval-logs-1', 'logs'),
        path.join(dir, 'eval-logs-2', 'logs'),
        {
          numFailedTestSuites: 1,
          numFailedTests: 2,
          testResults: [
            {
              assertionResults: [
                {
                  title: 'claims passed',
                  fullName: 'claims passed',
                  status: 'passed',
                },
              ],
            },
          ],
        },
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,2]',
      ]);

      expect(result.exitCode, result.stdout).not.toBe(0);
      // Assert the exact report-level counter validation branch: failed
      // counters must be backed by failed assertions.
      expect(result.stderr).toMatch(
        /numFailedTestSuites is \d+ but no assertions are failed/i,
      );
    });
  });
});

/**
 * Issue #2605 (per-report strictness guardrails): A normal valid Vitest report
 * must still aggregate successfully even when it omits optional top-level
 * counters (numTotalTests, numFailedTestSuites, success). The strict checks
 * must not reject reports merely because optional fields are absent.
 */
describe('aggregate_evals: per-report strictness (ordinary valid reports)', () => {
  it('aggregates a valid report that omits all optional top-level counters', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({
          testResults: [
            {
              assertionResults: [
                {
                  title: 'should save memory',
                  fullName: 'should save memory',
                  status: 'passed',
                },
              ],
            },
          ],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('100.0% (1/1 tests passed)');
    });
  });

  it('aggregates a report where a skipped assertion coexists with usable ones (denominator preserved)', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({
          testResults: [
            {
              assertionResults: [
                {
                  title: 'should save memory',
                  fullName: 'should save memory',
                  status: 'passed',
                },
                {
                  title: 'flaky one',
                  fullName: 'flaky one',
                  status: 'skipped',
                },
              ],
            },
          ],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('100.0% (1/1 tests passed)');
    });
  });

  it('aggregates a report whose report.success=true with a passed assertion (consistent success)', () => {
    useTempArtifactsDir((dir) => {
      const reportDir = path.join(dir, 'eval-logs-1', 'logs');
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'report.json'),
        JSON.stringify({
          success: true,
          testResults: [
            {
              assertionResults: [
                {
                  title: 'should save memory',
                  fullName: 'should save memory',
                  status: 'passed',
                },
              ],
            },
          ],
        }),
      );

      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('100.0% (1/1 tests passed)');
    });
  });
});

/**
 * Issue #2605 (fail-closed on unexpected parser exceptions): aggregateReports
 * must never crash the script with an uncaught exception. An unexpected throw
 * from a per-report parse must be recorded as a fatal error and fail the
 * aggregation closed (exit-code-1 contract), rather than bypass it. Normal
 * schema diagnostics are returned (not thrown) by the parser and must still be
 * accumulated; only UNEXPECTED exceptions take this catch path.
 */
describe('aggregateReports: unexpected parser exceptions fail closed', () => {
  it('records a fatal error and returns valid=false when the parser throws, instead of crashing', async () => {
    const mod = await loadAggregateModule();
    const aggregateReports =
      /** @type {(reports: string[], parseReport?: (p: string) => object) => {valid: boolean, errors: string[], usableAssertions: number}} */ (
        mod.aggregateReports
      );
    expect(
      typeof aggregateReports,
      'aggregate_evals.js must export aggregateReports',
    ).toBe('function');

    const throwingParser = () => {
      throw new Error('unexpected internal boom');
    };
    const result = aggregateReports(['fake/report.json'], throwingParser);

    // The aggregation must fail closed, not crash.
    expect(result.valid).toBe(false);
    expect(result.usableAssertions).toBe(0);
    expect(result.errors.some((e) => /Fatal error parsing/.test(e))).toBe(true);
    // The original error message is surfaced for diagnosis.
    expect(result.errors.some((e) => /unexpected internal boom/.test(e))).toBe(
      true,
    );
  });

  it('still accumulates normal strict diagnostics from a non-throwing parser', async () => {
    const mod = await loadAggregateModule();
    const aggregateReports =
      /** @type {(reports: string[], parseReport?: (p: string) => object) => {valid: boolean, errors: string[], usableAssertions: number}} */ (
        mod.aggregateReports
      );
    const fakeParser = () => ({
      valid: false,
      stats: new Map(),
      errors: [
        'fake/report.json: report has no usable passed/failed assertions',
      ],
      usableAssertions: 0,
    });
    const result = aggregateReports(['fake/report.json'], fakeParser);

    expect(result.valid).toBe(false);
    // Normal diagnostics are preserved (not swallowed by the exception guard).
    expect(result.errors).toContain(
      'fake/report.json: report has no usable passed/failed assertions',
    );
  });

  it('handles a non-Error throw value without crashing', async () => {
    const mod = await loadAggregateModule();
    const aggregateReports =
      /** @type {(reports: string[], parseReport?: (p: string) => object) => {valid: boolean, errors: string[], usableAssertions: number}} */ (
        mod.aggregateReports
      );
    // A non-Error throw (e.g. a string) must be formatted safely.
    const throwingParser = () => {
      throw 'a string error';
    };
    const result = aggregateReports(['fake/report.json'], throwingParser);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /Fatal error parsing/.test(e))).toBe(true);
    expect(result.errors.some((e) => /a string error/.test(e))).toBe(true);
  });
});
