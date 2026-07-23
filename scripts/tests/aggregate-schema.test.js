/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  fixtureReport,
  useTempArtifactsDir,
  writeReport,
  writeReportRaw,
  runWithOneExpected,
} from './aggregate-helpers.js';

/**
 * Issue #2605 (strict current Vitest JSON schema): When top-level fields are
 * present, enforce boolean success and nonnegative integer counters. Reconcile
 * numPassedTests/numFailedTests/numPendingTests/numTodoTests/numTotalTests so
 * the exact top-level test counters must equal the represented assertion
 * statuses (passed/failed/pending plus the numTodoTests cohort/total) while
 * handling Vitest statuses correctly. Validate suite counters reconcile with
 * one another without equating suites to testResults files. Optional-field
 * compatibility with real Vitest 3.2.6 reports must be preserved.
 */
describe('aggregate_evals: strict current report top-level schema validation', () => {
  it('rejects a non-boolean success field', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        success: 'true',
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/success/i);
    });
  });

  it('rejects a negative numTotalTests counter', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numTotalTests: -1,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numTotalTests|negative|counter/i);
    });
  });

  it('rejects a non-integer numFailedTests counter', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numFailedTests: 1.5,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'failed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numFailedTests|counter/i);
    });
  });

  it('rejects contradictory success=true with failed assertions exceeding counts', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        success: true,
        numTotalTests: 1,
        numPassedTests: 0,
        numFailedTests: 0,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'failed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
    });
  });

  it('rejects counters that do not reconcile (numTotal != passed+failed+pending)', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numTotalTests: 5,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numTotalTests|reconcile|inconsistent/i);
    });
  });

  it('rejects when represented assertion count exceeds numTotalTests', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numTotalTests: 1,
        testResults: [
          {
            assertionResults: [
              { title: 'a', fullName: 'a', status: 'passed' },
              { title: 'b', fullName: 'b', status: 'passed' },
              { title: 'c', fullName: 'c', status: 'passed' },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numTotalTests|exceed|assertion/i);
    });
  });

  it('rejects a report truncated mid-array (testResults not closed)', () => {
    useTempArtifactsDir((dir) => {
      writeReportRaw(
        dir,
        '{"testResults":[{"assertionResults":[{"title":"t","status":"passed"',
      );

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/Could not parse|Aggregation aborted/);
    });
  });

  it('accepts a real-shaped Vitest 3.2.6 report with consistent counters', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numTotalTestSuites: 1,
        numPassedTestSuites: 1,
        numFailedTestSuites: 0,
        numPendingTestSuites: 0,
        numTotalTests: 2,
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 0,
        numTodoTests: 0,
        success: false,
        testResults: [
          {
            name: '/repo/evals/save_memory.eval.ts',
            status: 'failed',
            assertionResults: [
              {
                title: 'should be able to save to memory',
                fullName: 'save_memory should be able to save to memory',
                status: 'passed',
              },
              {
                title: 'should be able to save to memory',
                fullName: 'save_memory should be able to save to memory',
                status: 'failed',
              },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('50.0% (1/2 tests passed)');
    });
  });

  it('still accepts a report that omits all optional top-level counters', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
    });
  });
});

/**
 * Issue #2605 (strict counters reconcile with represented assertions): When the
 * exact top-level test counters are present, they must equal the represented
 * assertion statuses. A counter that is GREATER than the represented assertions
 * indicates truncation/corruption and must be rejected. This is a realistic
 * process-level test: counters greater than represented assertion data must
 * fail closed.
 */
describe('aggregate_evals: counters greater than represented assertions fail closed', () => {
  it('rejects numPassedTests greater than represented passed assertions', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numPassedTests: 5,
        numFailedTests: 0,
        numPendingTests: 0,
        numTotalTests: 5,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numPassedTests|exceed|represent/i);
    });
  });

  it('rejects numFailedTests greater than represented failed assertions', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numPassedTests: 1,
        numFailedTests: 4,
        numPendingTests: 0,
        numTotalTests: 5,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numFailedTests|exceed|represent/i);
    });
  });

  it('rejects numPendingTests greater than represented pending assertions', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 3,
        numTotalTests: 4,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numPendingTests|exceed|represent/i);
    });
  });

  it('rejects numTodoTests greater than represented todo-status assertions', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 2,
        numTotalTests: 3,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numTodoTests|exceed|represent/i);
    });
  });
});

/**
 * Issue #2605 (contradictory totals): When exact top-level test counters are
 * present, they must reconcile among themselves (numTotalTests must equal the
 * sum of passed/failed/pending/numTodoTests cohorts) AND each individual
 * counter must equal the count of represented assertions of that status. A
 * report with self-consistent totals but counters that contradict the
 * represented assertions must still be rejected.
 */
describe('aggregate_evals: contradictory totals fail closed', () => {
  it('rejects totals that reconcile with each other but contradict represented assertions', () => {
    useTempArtifactsDir((dir) => {
      // Totals: 3 total = 2 passed + 1 failed + 0 pending (self-consistent).
      // But the represented assertions are 1 passed + 0 failed. The counters
      // claim failures that the assertion list does not reflect.
      writeReport(dir, {
        numPassedTests: 2,
        numFailedTests: 1,
        numPendingTests: 0,
        numTotalTests: 3,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /numPassedTests|numFailedTests|exceed|represent/i,
      );
    });
  });

  it('rejects numTotalTests that contradicts the component counters', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 0,
        // 3 != 1 + 1 + 0
        numTotalTests: 3,
        testResults: [
          {
            assertionResults: [
              { title: 'a', fullName: 'a', status: 'passed' },
              { title: 'b', fullName: 'b', status: 'failed' },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numTotalTests|reconcile/i);
    });
  });

  it('accepts counters that exactly equal the represented assertion statuses', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 1,
        numTodoTests: 0,
        numTotalTests: 3,
        success: false,
        testResults: [
          {
            assertionResults: [
              { title: 'p', fullName: 'p', status: 'passed' },
              { title: 'f', fullName: 'f', status: 'failed' },
              { title: 'pen', fullName: 'pen', status: 'pending' },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
      // pending is excluded from the pass-rate denominator: 1 / (1+1) = 50%.
      expect(result.stdout).toContain('50.0% (1/2 tests passed)');
    });
  });
});

/**
 * Issue #2605 (suite counters reconcile): Suite-level counters
 * (numTotalTestSuites/numPassedTestSuites/numFailedTestSuites/
 * numPendingTestSuites) must reconcile with one another when present
 * (passed+failed+pending == total suites), but suites must NOT be equated to
 * testResults files because a single testResult file can hold many assertions
 * and the mapping is many-to-one. We validate that suite counters reconcile
 * among themselves while a report with fewer/more testResults entries than
 * suites is still accepted (suites != testResults files).
 */
describe('aggregate_evals: suite counters reconcile among themselves', () => {
  it('rejects suite totals that contradict suite component counters', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numTotalTestSuites: 5,
        numPassedTestSuites: 1,
        numFailedTestSuites: 1,
        numPendingTestSuites: 0,
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 0,
        numTotalTests: 2,
        success: false,
        testResults: [
          {
            assertionResults: [
              { title: 'p', fullName: 'p', status: 'passed' },
              { title: 'f', fullName: 'f', status: 'failed' },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numTotalTestSuites|reconcile/i);
    });
  });

  it('accepts reconciled suite counters without equating suites to testResults files', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        // 2 suites total = 1 passed + 1 failed + 0 pending (reconciled), but
        // only ONE testResults entry exists. Suites must NOT be equated to
        // testResults files, so this reconciled-suites / one-testResult report
        // must be accepted.
        numTotalTestSuites: 2,
        numPassedTestSuites: 1,
        numFailedTestSuites: 1,
        numPendingTestSuites: 0,
        numPassedTests: 1,
        numFailedTests: 1,
        numPendingTests: 0,
        numTotalTests: 2,
        success: false,
        testResults: [
          {
            assertionResults: [
              { title: 'p', fullName: 'p', status: 'passed' },
              { title: 'f', fullName: 'f', status: 'failed' },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
    });
  });
});

/**
 * Issue #2605 (stats key identity): The stats map key must prefer `fullName`
 * over `title` so two assertions that share a short `title` but live in
 * different suites (and therefore have distinct `fullName`s) produce separate
 * rows instead of being collapsed into one. The Vitest JSON reporter derives
 * `fullName` as `[...ancestorTitles, name].join(" ")` (space-joined), so it is
 * the unambiguous identity within a report.
 */
describe('aggregate_evals: stats key prefers fullName over title', () => {
  it('uses fullName as the row key when both title and fullName are present', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            assertionResults: [
              {
                title: 'should pass',
                fullName: 'suiteA should pass',
                status: 'passed',
              },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('suiteA should pass');
    });
  });

  it('falls back to title when fullName is absent or empty', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            assertionResults: [{ title: 'should pass', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('should pass');
    });
  });

  it('produces separate rows for duplicate short titles in different suites', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            assertionResults: [
              {
                title: 'works',
                fullName: 'suiteA works',
                status: 'passed',
              },
              {
                title: 'works',
                fullName: 'suiteB works',
                status: 'passed',
              },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('suiteA works');
      expect(result.stdout).toContain('suiteB works');
    });
  });
});

/**
 * Issue #2605 (Vitest 3.2.6 counter fidelity): Real Vitest reports count
 * `skipped` assertions inside `numPendingTests` (skipped and pending are the
 * same cohort from the reporter's perspective). The represented-counter
 * reconciliation must map skipped+pending assertions to the pending counter
 * so a faithful report with passed+skipped+deferred and consistent counters is
 * accepted, while the denominator still EXCLUDES skipped/pending from
 * pass/fail/total. This is a process-level regression fixture faithful to
 * Vitest 3.2.6 output shape.
 */
describe('aggregate_evals: Vitest 3.2.6 skipped counts in numPendingTests', () => {
  it('accepts a faithful report with passed+skipped+deferred and consistent counters', () => {
    useTempArtifactsDir((dir) => {
      // Vitest 3.2.6: numPendingTests aggregates BOTH pending AND skipped.
      // Here: 1 passed, 2 skipped, 1 deferred => numPendingTests=2, numTodoTests=1.
      writeReport(dir, {
        numTotalTestSuites: 1,
        numPassedTestSuites: 1,
        numFailedTestSuites: 0,
        numPendingTestSuites: 0,
        numTotalTests: 4,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 2,
        numTodoTests: 1,
        success: true,
        testResults: [
          {
            name: '/repo/evals/save_memory.eval.ts',
            status: 'passed',
            assertionResults: [
              {
                title: 'should save memory',
                fullName: 'save_memory should save memory',
                status: 'passed',
              },
              {
                title: 'skipped one',
                fullName: 'save_memory skipped one',
                status: 'skipped',
              },
              {
                title: 'skipped two',
                fullName: 'save_memory skipped two',
                status: 'skipped',
              },
              {
                title: 'todo one',
                fullName: 'save_memory todo one',
                status: 'todo',
              },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
      // skipped/pending/deferred are excluded from the denominator: 1/(1+0) = 100%.
      expect(result.stdout).toContain('100.0% (1/1 tests passed)');
    });
  });

  it('still rejects numPendingTests that exceeds represented skipped+pending', () => {
    useTempArtifactsDir((dir) => {
      // Only 1 skipped represented, but numPendingTests claims 3.
      writeReport(dir, {
        numTotalTests: 2,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 3,
        numTodoTests: 0,
        success: true,
        testResults: [
          {
            assertionResults: [
              {
                title: 'p',
                fullName: 'p',
                status: 'passed',
              },
              {
                title: 's',
                fullName: 's',
                status: 'skipped',
              },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numPendingTests|exceed|represent/i);
    });
  });

  it('accepts a mix of pending and skipped assertions both counted in numPendingTests', () => {
    useTempArtifactsDir((dir) => {
      // 1 passed, 1 pending, 1 skipped => numPendingTests=2.
      writeReport(dir, {
        numTotalTests: 3,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 2,
        numTodoTests: 0,
        success: true,
        testResults: [
          {
            assertionResults: [
              {
                title: 'p',
                fullName: 'p',
                status: 'passed',
              },
              {
                title: 'pen',
                fullName: 'pen',
                status: 'pending',
              },
              {
                title: 'skp',
                fullName: 'skp',
                status: 'skipped',
              },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
      expect(result.stdout).toContain('100.0% (1/1 tests passed)');
    });
  });
});

/**
 * Issue #2605 (Vitest fullName spacing fidelity): The Vitest JSON reporter
 * derives `fullName` as `[...ancestorTitles, name].join(" ")` — SPACE-joined,
 * not ` > `-joined. The ` > ` separator is used by the CLI list output
 * (`getFullName(task, " > ")`), NOT by the JSON report that the aggregator
 * consumes. Fixtures and comments that claim ` > ` spacing misrepresent the
 * real report shape and would mask a regression if the aggregator were
 * (mis)adjusted to expect ` > `.
 *
 * These tests assert the REAL space-joined shape for both the shared fixture
 * helper and the inline schema fixtures, and that the aggregator surfaces the
 * space-joined fullName verbatim.
 */
describe('aggregate_evals: Vitest fullName is space-joined (not " > ")', () => {
  it('fixtureReport produces a space-joined fullName matching the real reporter', () => {
    const report = fixtureReport({ pass: 1 });
    const assertion = report.testResults[0].assertionResults[0];
    // The real Vitest JSON reporter emits
    //   fullName = [...ancestorTitles, name].join(" ")
    // For describe("save_memory") + it("should save memory"),
    // that is "save_memory should save memory" (single spaces).
    expect(assertion.fullName).toBe('save_memory should save memory');
    // And it must NOT use the CLI-only " > " separator.
    expect(assertion.fullName).not.toContain(' > ');
  });

  it('aggregates and surfaces a real space-joined fullName verbatim', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/save_memory.eval.ts',
            assertionResults: [
              {
                title: 'should be able to save to memory',
                fullName: 'save_memory should be able to save to memory',
                status: 'passed',
              },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
      // The space-joined fullName is surfaced verbatim in the summary.
      expect(result.stdout).toContain(
        'save_memory should be able to save to memory',
      );
      // The CLI-only " > " form must NOT appear.
      expect(result.stdout).not.toContain(
        'save_memory > should be able to save to memory',
      );
    });
  });
});

/**
 * Final review finding (strict numTotalTests exact equality): Whenever
 * numTotalTests is present, it must EXACTLY equal the count of represented
 * assertionResults — even when the component counters (numPassedTests,
 * numFailedTests, numPendingTests, numTodoTests) are ABSENT. The prior check
 * only rejected represented > numTotalTests; a numTotalTests that UNDERCOUNTS
 * the represented assertions (truncation/corruption indicator) was accepted.
 */
describe('aggregate_evals: numTotalTests exact equality to represented assertions', () => {
  it('rejects numTotalTests less than represented assertions even when component counters are absent', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numTotalTests: 1,
        testResults: [
          {
            assertionResults: [
              { title: 'a', fullName: 'a', status: 'passed' },
              { title: 'b', fullName: 'b', status: 'passed' },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numTotalTests|represent|exceed/i);
    });
  });

  it('rejects numTotalTests greater than represented assertions even when component counters are absent', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numTotalTests: 5,
        testResults: [
          {
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/numTotalTests|represent|exceed/i);
    });
  });

  it('accepts numTotalTests exactly equal to represented assertions without component counters', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        numTotalTests: 2,
        testResults: [
          {
            assertionResults: [
              { title: 'a', fullName: 'a', status: 'passed' },
              { title: 'b', fullName: 'b', status: 'failed' },
            ],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
    });
  });
});

/**
 * Final review finding (strict testResult.status): The optional
 * testResult.status must be one of the recognized real Vitest values
 * (passed/failed). An unrecognized value must fail closed. A 'failed'
 * testResult.status requires at least one failed assertion within that suite;
 * a 'passed' testResult.status forbids any failed assertion within that suite.
 */
describe('aggregate_evals: testResult.status is validated against recognized Vitest values', () => {
  it('rejects an unrecognized testResult.status value', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/bad.eval.ts',
            status: 'bogus',
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /testResult.*status|status.*bogus|unrecognized/i,
      );
    });
  });

  it('rejects testResult.status=failed when the suite has no failed assertions', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/orphan.eval.ts',
            status: 'failed',
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /failed.*no failed assertion|marked failed/i,
      );
    });
  });

  it('rejects testResult.status=passed when the suite has a failed assertion', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/liar.eval.ts',
            status: 'passed',
            assertionResults: [{ title: 'a', fullName: 'a', status: 'failed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(/passed.*failed assertion|contradict/i);
    });
  });

  it('accepts testResult.status=passed with only passed assertions', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/good.eval.ts',
            status: 'passed',
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
    });
  });

  it('accepts testResult.status=failed with a failed assertion', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/good-fail.eval.ts',
            status: 'failed',
            assertionResults: [{ title: 'a', fullName: 'a', status: 'failed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
    });
  });

  it('still accepts a testResult that OMITS status entirely (real Vitest permits absence)', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/no-status.eval.ts',
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).toBe(0);
    });
  });
});
