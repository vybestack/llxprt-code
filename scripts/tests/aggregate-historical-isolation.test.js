/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { loadHistoricalModule, writeAttempt } from './aggregate-helpers.js';

/**
 * Issue #2605 (per-run exception isolation): Historical retrieval is best
 * effort: a single run that throws during processing (e.g. an unexpected
 * filesystem error, a cardinality validator bug, or any uncaught exception)
 * must NOT abort processing of the remaining in-window runs. The fetcher must
 * isolate each run so one run's exception is logged as a warning and the loop
 * continues to subsequent runs. This ensures a single pathological run cannot
 * erase ALL historical trend data.
 */
describe('aggregate_evals: per-run exception isolation in historical fetch', () => {
  it('continues processing subsequent runs when one run throws', async () => {
    const mod = await loadHistoricalModule();

    // Run A throws during download (simulates an unexpected exception, not a
    // clean omitted result). Run B is valid and must still be included.
    const runA = { databaseId: 5000, createdAt: '2026-07-19T02:00:00Z' };
    const runB = { databaseId: 5001, createdAt: '2026-07-18T02:00:00Z' };

    // The paginator calls listRunsPage which returns the runs; fetchHistoricalData
    // iterates them and calls processHistoricalRun for each. We inject a
    // listRunsPage that returns both runs, and rely on processHistoricalRun's
    // download callback: run A's callback THROWS, run B's callback writes a
    // valid artifact tree.
    const downloadThrowing = () => {
      throw new Error('unexpected filesystem explosion');
    };
    const downloadValid = (_runId, dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      return { status: 0, stdout: '', stderr: '' };
    };

    // fetchHistoricalData accepts an injectable listRunsPage. We return both
    // runs in-window. But processHistoricalRun uses its OWN default downloader.
    // To inject per-run download behavior, we must call processHistoricalRun
    // directly OR refactor. Since the finding is about the LOOP isolation, we
    // test fetchHistoricalData by making one run's download THROW.
    //
    // However fetchHistoricalData does NOT accept a downloadRun override. We
    // verify the isolation at the loop level by exercising processHistoricalRun
    // directly and confirming the loop behavior via fetchHistoricalData with a
    // throwing listRunsPage scenario is NOT the same (that would abort before
    // any run is processed).
    //
    // The real contract: processHistoricalRun must never throw (it catches
    // internally), OR fetchHistoricalData must catch per-run exceptions. We
    // test that fetchHistoricalData catches a throw from processHistoricalRun.

    // Simulate: listRunsPage returns two runs. We cannot inject
    // processHistoricalRun's downloader into fetchHistoricalData directly.
    // Instead, verify the contract at the loop level: a run that causes
    // processHistoricalRun to throw must not abort the loop.
    //
    // Since processHistoricalRun currently catches its own errors, the risk is
    // an UNCAUGHT throw (e.g. from the download callback escaping the try). We
    // verify processHistoricalRun catches a throwing downloader:
    const resultA = mod.processHistoricalRun(runA, downloadThrowing);
    expect(resultA.omitted).toBe(true);

    const resultB = mod.processHistoricalRun(runB, downloadValid);
    expect(resultB.omitted).toBe(false);
    expect(resultB.stats.size).toBeGreaterThan(0);
  });

  it('processHistoricalRun catches a throwing download callback (does not propagate)', async () => {
    const mod = await loadHistoricalModule();
    const throwingDownload = () => {
      throw new Error('download exploded');
    };
    // Must not throw — the exception must be caught and the run omitted.
    expect(() =>
      mod.processHistoricalRun(
        { databaseId: 4242, createdAt: '2026-07-19T02:00:00Z' },
        throwingDownload,
      ),
    ).not.toThrow();
  });

  it('fetchHistoricalData includes a valid run even when a prior run throws', async () => {
    const mod = await loadHistoricalModule();

    // Two in-window runs. Run A's processor THROWS (simulating an uncaught
    // exception escaping processHistoricalRun's internal catch); run B is
    // valid and MUST still be included. This proves the loop isolates per-run
    // exceptions: one bad run cannot abort the remaining runs.
    const runA = { databaseId: 99001, createdAt: '2026-07-19T02:00:00Z' };
    const runB = { databaseId: 99002, createdAt: '2026-07-19T02:00:00Z' };

    const listRunsPage = () => ({
      runs: [runA, runB],
      rawCount: 2,
      totalCount: 2,
    });

    // The injected processor throws for run A, returns a valid result for run B.
    const validStats = new Map([
      ['save_memory', { pass: 1, fail: 0, total: 1 }],
    ]);
    const processRun = (run) => {
      if (run.databaseId === runA.databaseId) {
        throw new Error('unexpected filesystem explosion');
      }
      return {
        runId: String(run.databaseId),
        stats: validStats,
        omitted: false,
      };
    };

    const result = mod.fetchHistoricalData(listRunsPage, processRun);
    // Does not throw, returns a Map.
    expect(result).toBeInstanceOf(Map);
    // Run B (the valid later run) SURVIVES despite run A throwing.
    expect(result.size).toBe(1);
    expect(result.has(String(runB.databaseId))).toBe(true);
    // Run A is NOT in the map (it threw and was skipped).
    expect(result.has(String(runA.databaseId))).toBe(false);
  });
});
