/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { loadHistoricalModule, writeAttempt } from './aggregate-helpers.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const recentIso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * MS_PER_DAY).toISOString();

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
  it('omits a run whose downloader throws while retaining a valid run', async () => {
    const mod = await loadHistoricalModule();
    // Both timestamps are within the 7-day retention window (1 and 2 days ago).
    // The day-based recentIso helper is used intentionally; the test only
    // requires that timestamps fall within the window, not a specific hour.
    const runA = { databaseId: 5000, createdAt: recentIso(1) };
    const runB = { databaseId: 5001, createdAt: recentIso(2) };
    const downloadThrowing = () => {
      throw new Error('unexpected filesystem explosion');
    };
    const downloadValid = (_runId: string | number, dir: string) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      return { status: 0, stdout: '', stderr: '' };
    };

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
        { databaseId: 4242, createdAt: recentIso(1) },
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
    //
    // fetchHistoricalData filters by Date.now() internally against the 7-day
    // retention window, so timestamps must be derived from the current time
    // (not fixed past dates that eventually fall outside the window).
    const runA = { databaseId: 99001, createdAt: recentIso(1) };
    const runB = { databaseId: 99002, createdAt: recentIso(2) };

    const listRunsPage = () => ({
      runs: [runA, runB],
      rawCount: 2,
      totalCount: 2,
    });

    // The injected processor throws for run A, returns a valid result for run B.
    const validStats = new Map([
      ['save_memory', { pass: 1, fail: 0, total: 1 }],
    ]);
    const processRun = (run: { databaseId?: number | string }) => {
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
