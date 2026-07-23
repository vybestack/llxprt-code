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
  loadHistoricalModule,
  writeAttempt,
} from './aggregate-helpers.js';

/**
 * Run processHistoricalRun against an in-memory artifact tree. The helper
 * writes the tree into the temp dir created by processHistoricalRun itself
 * (via the downloadRun callback), so cardinality validation exercises the
 * REAL filesystem cardinality module. Shared by every describe block below so
 * the download/processing setup is never duplicated.
 */
async function processTree(runId, buildTree) {
  const mod = await loadHistoricalModule();
  const downloadRun = (_actualRunId, dir) => {
    // Mirror what `gh run download` produces: one top-level dir per artifact.
    buildTree(dir);
    return { status: 0, stdout: '', stderr: '' };
  };
  return mod.processHistoricalRun({ databaseId: runId }, downloadRun);
}

/**
 * Issue #2605 finding (historical pass rates — strict per-run inclusion):
 * Before a historical run is INCLUDED in historical stats, its downloaded
 * artifact tree must be validated against the expected matrix attempts
 * [1,2,3] using the REAL cardinality module (validateTopLevelArtifactDirs +
 * validateCardinality + extractAttemptFromPath), require EXACTLY one report
 * per attempt, and require each report to be structurally/semantically usable
 * for complete stats.
 *
 * A historical run that is incomplete/malformed MUST be OMITTED in its
 * ENTIRETY with a concise warning — never retaining partial stats. Historical
 * reports use the SAME strict parser (parseCurrentReport) as current reports,
 * so a single malformed report omits the whole run.
 *
 * processHistoricalRun accepts an injectable `downloadRun` callback (so tests
 * can simulate `gh run download` writing a real on-disk artifact tree) and
 * injects into a temp dir. It returns {runId, stats, omitted, reason} so the
 * fetcher can decide whether to keep the run.
 */
describe('aggregate_evals: historical run artifact-tree validation', () => {
  it('includes a complete run with exactly eval-logs-1/2/3 and one report each', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1);
      writeAttempt(runDir, 2);
      writeAttempt(runDir, 3);
    });
    expect(result.omitted, JSON.stringify(result)).toBe(false);
    expect(result.stats.size).toBeGreaterThan(0);
  });

  it('OMITS the entire run when an expected attempt is missing (2 of 3)', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1);
      writeAttempt(runDir, 2);
      // eval-logs-3 missing
    });
    expect(result.omitted).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/cardinality|missing|expected|attempt/i);
  });

  it('OMITS the entire run when an artifact is missing the report.json (empty artifact dir)', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1);
      writeAttempt(runDir, 2);
      fs.mkdirSync(path.join(runDir, 'eval-logs-3', 'logs'), {
        recursive: true,
      });
    });
    expect(result.omitted).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/cardinality|missing|report/i);
  });

  it('OMITS the entire run when one report is malformed (no partial stats retained)', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 5, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 5, fail: 0 }));
      // attempt 3's report is structurally malformed.
      const malformedDir = path.join(runDir, 'eval-logs-3', 'logs');
      fs.mkdirSync(malformedDir, { recursive: true });
      fs.writeFileSync(
        path.join(malformedDir, 'report.json'),
        JSON.stringify({ testResults: 'not-an-array' }),
      );
    });
    expect(result.omitted).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/malformed|report|invalid/i);
  });

  it('OMITS the entire run when an attempt has a duplicate report.json', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1);
      writeAttempt(runDir, 2);
      writeAttempt(runDir, 3);
      // Duplicate report inside eval-logs-2.
      const nested = path.join(runDir, 'eval-logs-2', 'logs', 'nested');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(
        path.join(nested, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 1 })),
      );
    });
    expect(result.omitted).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/cardinality|duplicate/i);
  });

  it('OMITS the entire run when an unexpected attempt (4) is present', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1);
      writeAttempt(runDir, 2);
      writeAttempt(runDir, 3);
      writeAttempt(runDir, 4);
    });
    expect(result.omitted).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/cardinality|unexpected|attempt/i);
  });

  it('OMITS the entire run when a report has no usable assertions (skipped-only)', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 5, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 5, fail: 0 }));
      writeAttempt(runDir, 3, {
        testResults: [
          {
            assertionResults: [{ title: 'skip', status: 'skipped' }],
          },
        ],
      });
    });
    expect(result.omitted).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/usable|assertion|malformed|invalid/i);
  });

  it('OMITS the run when `gh run download` fails (status nonzero)', async () => {
    const mod = await loadHistoricalModule();
    const downloadRun = () => ({ status: 2, stdout: '', stderr: 'boom' });
    const result = mod.processHistoricalRun({ databaseId: 4242 }, downloadRun);
    expect(result.omitted).toBe(true);
    expect(result.stats.size).toBe(0);
  });

  it('honors a custom expected-attempts for historical validation', async () => {
    const mod = await loadHistoricalModule();
    const downloadRun = (_runId, dir) => {
      fs.mkdirSync(path.join(dir, 'eval-logs-7', 'logs'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'eval-logs-7', 'logs', 'report.json'),
        JSON.stringify(fixtureReport({ pass: 1 })),
      );
      return { status: 0, stdout: '', stderr: '' };
    };
    const result = mod.processHistoricalRun({ databaseId: 4242 }, downloadRun, {
      expectedAttempts: [7],
    });
    expect(result.omitted, JSON.stringify(result)).toBe(false);
    expect(result.stats.size).toBeGreaterThan(0);
  });
});

/**
 * Issue #2605 finding (historical strict per-report parsing): A historical run
 * must apply the SAME strict parsing as a current report (parseCurrentReport)
 * to EACH of its reports. A historical run is OMITTED in its entirety whenever
 * ANY report fails the strict checks. There is no lenient historical parser;
 * historical reports use parseCurrentReport exclusively.
 *
 * Four strict-failure categories must each omit the entire run with no partial
 * stats retained:
 *   1. structurally invalid report (testResults not an array);
 *   2. a report mixing valid assertions with a malformed one (unrecognized
 *      status) — the valid assertions must NOT be retained as partial stats;
 *   3. contradictory counters (numPassedTests exceeds represented passed
 *      assertions);
 *   4. an unrepresented suite/report failure (report.success=false but no
 *      assertions are failed, or numFailedTestSuites>0 with no failed
 *      assertions).
 */
describe('aggregate_evals: historical run applies strict per-report parsing', () => {
  it('OMITS the entire run when one report is structurally invalid (testResults not an array)', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 3, { testResults: 'not-an-array' });
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/malformed|invalid|testResults|format/i);
  });

  it('OMITS the entire run when one report mixes a valid assertion with a malformed one (no partial stats)', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      // attempt 3 mixes a valid passed assertion with a malformed one
      // (unrecognized status). Strict parsing must omit the whole run — no
      // partial stats are retained from the valid assertion.
      writeAttempt(runDir, 3, {
        testResults: [
          {
            assertionResults: [
              { title: 'ok', fullName: 'ok', status: 'passed' },
              { title: 'bad', fullName: 'bad', status: 'bogus' },
            ],
          },
        ],
      });
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/malformed|invalid|unrecognized|status/i);
  });

  it('OMITS the entire run when one report has contradictory counters', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      // attempt 3 has a numPassedTests counter that exceeds the represented
      // passed assertions (truncation/corruption indicator).
      writeAttempt(runDir, 3, {
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
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(
      /numPassedTests|counter|reconcile|represented|exceed/i,
    );
  });

  it('OMITS the entire run when one report has an unrepresented report-level failure', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      // attempt 3 claims report.success=false but no assertions are failed:
      // an unrepresented report-level failure.
      writeAttempt(runDir, 3, {
        success: false,
        testResults: [
          {
            assertionResults: [
              { title: 'ok', fullName: 'ok', status: 'passed' },
            ],
          },
        ],
      });
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(
      /unrepresented|failure|success|failed|malformed|invalid/i,
    );
  });

  it('OMITS the entire run when one report has an unrepresented suite-level failure', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      // attempt 3 claims numFailedTestSuites>0 but no assertions are failed:
      // an unrepresented suite-level failure.
      writeAttempt(runDir, 3, {
        numFailedTestSuites: 1,
        testResults: [
          {
            assertionResults: [
              { title: 'ok', fullName: 'ok', status: 'passed' },
            ],
          },
        ],
      });
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(
      /unrepresented|failure|suite|failed|malformed|invalid/i,
    );
  });
});

/**
 * Final review finding (historical whole-run omission for strict schema
 * failures): Historical reports are parsed with the SAME strict parser as
 * current reports (parseCurrentReport). A historical run must be OMITTED in
 * its entirety whenever ANY report fails the strict schema checks added in this
 * cycle:
 *   - numTotalTests present but not exactly equal to the represented
 *     assertions (even when component counters are absent);
 *   - testResult.status is an unrecognized Vitest value;
 *   - testResult.status='passed' with a failed assertion (contradiction).
 */
describe('aggregate_evals: historical whole-run omission for strict schema failures', () => {
  it('OMITS the entire run when a report has numTotalTests not equal to represented assertions', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 3, {
        numTotalTests: 5,
        testResults: [
          {
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/numTotalTests|represent|exceed/i);
  });

  it('OMITS the entire run when a report has an unrecognized testResult.status', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 3, {
        testResults: [
          {
            name: '/repo/evals/bad.eval.ts',
            status: 'bogus',
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(
      /testResult.*status|status.*bogus|unrecognized/i,
    );
  });

  it('OMITS the entire run when a report has testResult.status=passed but a failed assertion', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 3, {
        testResults: [
          {
            name: '/repo/evals/liar.eval.ts',
            status: 'passed',
            assertionResults: [{ title: 't', fullName: 't', status: 'failed' }],
          },
        ],
      });
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/passed.*failed assertion|contradict/i);
  });

  it('OMITS the entire run when a report has a non-string testResult.status (numeric)', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 2, fixtureReport({ pass: 1, fail: 0 }));
      writeAttempt(runDir, 3, {
        testResults: [
          {
            name: '/repo/evals/numeric.eval.ts',
            status: 1,
            assertionResults: [{ title: 't', fullName: 't', status: 'passed' }],
          },
        ],
      });
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(
      /testResult.*status.*string|status.*must be a string/i,
    );
  });
});

/**
 * Final review finding (historical canonical artifact names): A historical
 * run's artifact tree must use the CANONICAL `eval-logs-N` directory names. A
 * noncanonical zero-padded name (eval-logs-01, eval-logs-001) must be rejected
 * by canonical string validation so numerical equivalence cannot rescue a
 * noncanonical name. The entire run must be OMITTED.
 */
describe('aggregate_evals: historical run rejects noncanonical zero-padded artifact names', () => {
  it('OMITS the entire run when an artifact is named eval-logs-01 (zero-padded)', async () => {
    const result = await processTree(4242, (runDir) => {
      writeAttempt(runDir, 1);
      writeAttempt(runDir, 2);
      writeAttempt(runDir, 3);
      const paddedDir = path.join(runDir, 'eval-logs-01', 'logs');
      fs.mkdirSync(paddedDir, { recursive: true });
      fs.writeFileSync(
        path.join(paddedDir, 'report.json'),
        JSON.stringify(fixtureReport({ pass: 1 })),
      );
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    expect(result.reason).toMatch(/eval-logs-01|unexpected|cardinality/i);
  });

  it('OMITS the entire run when artifacts use three-digit zero-padded names', async () => {
    const result = await processTree(4242, (runDir) => {
      for (const padded of ['001', '002', '003']) {
        const paddedDir = path.join(runDir, `eval-logs-${padded}`, 'logs');
        fs.mkdirSync(paddedDir, { recursive: true });
        fs.writeFileSync(
          path.join(paddedDir, 'report.json'),
          JSON.stringify(fixtureReport({ pass: 1 })),
        );
      }
    });
    expect(result.omitted, JSON.stringify(result)).toBe(true);
    expect(result.stats.size).toBe(0);
    // Assert the reason so this is a true regression test for artifact-name
    // validation (not just "missing expected attempts 1/2/3").
    expect(result.reason).toMatch(/eval-logs-00[123]|unexpected|cardinality/i);
  });
});
