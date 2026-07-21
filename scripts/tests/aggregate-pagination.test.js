/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  loadAggregateModule,
  loadHistoricalModule,
  runEntry,
  pageEnvelope,
  normalizedRun,
  fakeEnvelopeRunner,
} from './aggregate-helpers.js';

/**
 * Issue #2605 finding (pagination termination on raw count, not filtered
 * length): The adapter `listRunsPageWithGh` must return normalized runs PLUS
 * rawCount (number of entries in the raw workflow_runs array) and totalCount
 * (the envelope total_count). The paginator must terminate on the RAW API
 * count (rawCount or totalCount), NOT the filtered/normalized length.
 *
 * Regression: with 100 raw entries of which ONE is invalid, the normalized
 * runs array has length 99. The old paginator treated `runs.length < 100` as a
 * short page and STOPPED, never consuming page 2 even though total_count=101
 * proves more pages exist. Page 2 (containing real in-window runs) was dropped,
 * silently truncating historical retrieval. The paginator must consume page 2.
 *
 * These tests use the NEW adapter contract: listRunsPage returns
 * `{runs, rawCount, totalCount}`.
 */
describe('aggregate_evals: paginator terminates on raw count, not filtered length', () => {
  // Build a raw page of `total` entries with one invalid record (bad id) so
  // normalized length is total-1 while rawCount is total. Built on the shared
  // runEntry so the invalid-slot entry mirrors the real REST shape.
  function pageWithOneInvalid(total, firstId, daysAgo, totalCount) {
    const validEntries = [];
    for (let i = 0; i < total; i++) {
      if (i === 0) {
        // skip: this slot is the invalid raw entry
        continue;
      }
      validEntries.push(runEntry(firstId + i, daysAgo));
    }
    return {
      runs: validEntries.map(normalizedRun),
      rawCount: total,
      totalCount,
    };
  }

  it('consumes page 2 when page 1 has 100 raw entries (99 valid) and total_count=101', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        // 100 raw, 1 invalid => 99 normalized. total_count says 101 exist.
        return pageWithOneInvalid(100, 100, 1, 101);
      }
      if (page === 2) {
        // Page 2: 1 valid in-window run (the 101st). rawCount=1 < 100 stops.
        return {
          runs: [normalizedRun(runEntry(9999, 2))],
          rawCount: 1,
          totalCount: 101,
        };
      }
      return { runs: [], rawCount: 0, totalCount: 101 };
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    // Page 2 WAS consumed despite page 1 yielding only 99 normalized runs.
    expect(calls).toEqual([1, 2]);
    // All 99 valid page-1 runs + the 1 page-2 run = 100 in-window runs.
    expect(selected.length).toBe(100);
    expect(selected.map((r) => r.databaseId)).toContain(9999);
  });

  it('does NOT consume a phantom page 2 when total_count equals the raw page count', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        // 100 raw, 1 invalid => 99 normalized, but total_count=100 means the
        // full raw page was the last full page; there is no page 2.
        return pageWithOneInvalid(100, 100, 1, 100);
      }
      return { runs: [], rawCount: 0, totalCount: 100 };
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    expect(calls).toEqual([1]);
    expect(selected.length).toBe(99);
  });

  it('stops on a short RAW page even when the filtered length is much smaller', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        // 50 raw entries, 49 invalid => 1 normalized run. rawCount=50 < 100
        // stops correctly because the RAW page is short.
        return {
          runs: [
            {
              databaseId: 5000,
              createdAt: '2026-07-19T02:00:00Z',
              conclusion: 'success',
              headSha: 'sha-0',
            },
          ],
          rawCount: 50,
          totalCount: 50,
        };
      }
      return { runs: [], rawCount: 0, totalCount: 50 };
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    expect(calls).toEqual([1]);
    expect(selected.length).toBe(1);
  });

  it('preserves the out-of-window cutoff signal alongside raw-count termination', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        // 100 raw entries; first 98 in-window, then older runs (cutoff), all
        // valid. rawCount=100 so without the cutoff page 2 would be fetched.
        const inWindow = Array.from({ length: 98 }, (_, i) => ({
          databaseId: 100 + i,
          createdAt: '2026-07-19T02:00:00Z',
          conclusion: 'success',
          headSha: `sha-${100 + i}`,
        }));
        const older = Array.from({ length: 2 }, (_, i) => ({
          databaseId: 900 + i,
          createdAt: '2026-07-10T02:00:00Z',
          conclusion: 'success',
          headSha: `sha-${900 + i}`,
        }));
        return {
          runs: [...inWindow, ...older],
          rawCount: 100,
          totalCount: 200,
        };
      }
      return { runs: [], rawCount: 0, totalCount: 200 };
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    // Cutoff on the older run stops after page 1 (page 2 NOT consumed).
    expect(calls).toEqual([1]);
    expect(selected.length).toBe(98);
    // The older out-of-window runs (databaseId 900, 901) must be excluded.
    expect(selected.map((r) => r.databaseId)).not.toContain(900);
    expect(selected.map((r) => r.databaseId)).not.toContain(901);
  });

  it('preserves dedupe across pages with the raw-count contract', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        const runs = Array.from({ length: 100 }, (_, i) => ({
          databaseId: 100 + i,
          createdAt: '2026-07-19T02:00:00Z',
          conclusion: 'success',
          headSha: `sha-${100 + i}`,
        }));
        return { runs, rawCount: 100, totalCount: 175 };
      }
      if (page === 2) {
        // Run 199 straddles the boundary (appears on both pages).
        const straddler = {
          databaseId: 199,
          createdAt: '2026-07-19T02:00:00Z',
          conclusion: 'success',
          headSha: 'sha-199',
        };
        const fresh = Array.from({ length: 74 }, (_, i) => ({
          databaseId: 200 + i,
          createdAt: '2026-07-18T02:00:00Z',
          conclusion: 'success',
          headSha: `sha-${200 + i}`,
        }));
        const older = {
          databaseId: 999,
          createdAt: '2026-07-10T02:00:00Z',
          conclusion: 'success',
          headSha: 'sha-999',
        };
        return {
          runs: [straddler, ...fresh, older],
          rawCount: 76,
          totalCount: 175,
        };
      }
      return { runs: [], rawCount: 0, totalCount: 175 };
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    const ids = selected.map((r) => r.databaseId);
    // Total unique in-window count: 100 from page 1 + 74 fresh from page 2 =
    // 174. The straddler (199) is deduped so it is not double-counted.
    expect(selected.length).toBe(174);
    // Run 199 appears only once despite being on both pages.
    expect(ids.filter((id) => id === 199).length).toBe(1);
    // The out-of-window run (databaseId 999, createdAt 2026-07-10) must be
    // excluded.
    expect(ids).not.toContain(999);
  });
});

/**
 * Issue #2605 finding (adapter returns rawCount and totalCount): The production
 * adapter `listRunsPageWithGh` must return an object `{runs, rawCount,
 * totalCount}` so the paginator can terminate on the raw API count rather than
 * the filtered length. rawCount is the number of entries in the raw
 * workflow_runs array; totalCount is the envelope total_count.
 */
describe('aggregate_evals: listRunsPageWithGh returns rawCount and totalCount', () => {
  it('returns {runs, rawCount, totalCount} with rawCount counting raw entries', async () => {
    const mod = await loadHistoricalModule();
    const stdout = JSON.stringify({
      total_count: 101,
      workflow_runs: [
        {
          id: 1,
          conclusion: 'success',
          head_sha: 'a',
          created_at: '2026-07-19T02:00:00Z',
        },
        { id: 'bad', conclusion: 'success', head_sha: 'b', created_at: 'x' },
        {
          id: 3,
          conclusion: 'success',
          head_sha: 'c',
          created_at: '2026-07-18T02:00:00Z',
        },
      ],
    });
    const fakeRunner = () => ({ status: 0, stdout, stderr: '' });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result).toBeDefined();
    expect(Array.isArray(result.runs)).toBe(true);
    expect(result.runs.map((r) => r.databaseId)).toEqual([1, 3]);
    // rawCount counts ALL raw entries (including the invalid one).
    expect(result.rawCount).toBe(3);
    expect(result.totalCount).toBe(101);
  });

  it('returns rawCount=0 and totalCount from the envelope on an empty page', async () => {
    const mod = await loadHistoricalModule();
    const stdout = JSON.stringify({ total_count: 50, workflow_runs: [] });
    const fakeRunner = () => ({ status: 0, stdout, stderr: '' });
    const result = mod.listRunsPageWithGh(2, { runSync: fakeRunner });
    expect(result.runs).toEqual([]);
    expect(result.rawCount).toBe(0);
    expect(result.totalCount).toBe(50);
  });

  it('returns rawCount=0 and totalCount=0 when gh fails', async () => {
    const mod = await loadHistoricalModule();
    const fakeRunner = () => ({ status: 1, stdout: '', stderr: 'err' });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result.runs).toEqual([]);
    expect(result.rawCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  it('returns rawCount=0 and totalCount=0 for malformed (unparseable) stdout', async () => {
    const mod = await loadHistoricalModule();
    const fakeRunner = () => ({
      status: 0,
      stdout: '{not valid json',
      stderr: '',
    });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result.runs).toEqual([]);
    expect(result.rawCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  it('preserves the invalid-entry warning when an entry is skipped', async () => {
    const mod = await loadHistoricalModule();
    const stdout = JSON.stringify({
      total_count: 2,
      workflow_runs: [
        { id: 'bad', conclusion: 'success', head_sha: 'b', created_at: 'x' },
        {
          id: 2,
          conclusion: 'success',
          head_sha: 'c',
          created_at: '2026-07-18T02:00:00Z',
        },
      ],
    });
    const warnings = [];
    const origError = console.error;
    console.error = (msg) => warnings.push(msg);
    try {
      const fakeRunner = () => ({ status: 0, stdout, stderr: '' });
      const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
      expect(result.runs.map((r) => r.databaseId)).toEqual([2]);
      expect(result.rawCount).toBe(2);
      expect(
        warnings.some((w) =>
          String(w).match(/skipped an invalid workflow_runs entry/),
        ),
      ).toBe(true);
    } finally {
      console.error = origError;
    }
  });
});

/**
 * Issue #2605 finding (paginator composes with the new adapter contract across
 * multiple realistic envelope pages): The production adapter is used by the
 * paginator, so a multi-page sequence of realistic envelopes must yield the
 * union of all in-window runs under the `{runs, rawCount, totalCount}`
 * contract. This proves the envelope parser composes correctly with pagination
 * across pages, including when one page has an invalid entry.
 */
describe('aggregate_evals: paginator consumes multiple envelope pages via adapter', () => {
  it('accumulates in-window runs from multiple envelope pages and stops on a short raw page', async () => {
    const { listWorkflowRunsInWindow, listRunsPageWithGh } =
      await loadHistoricalModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    // Each page's envelope carries the GRAND total_count (205), not the
    // per-page length, mirroring the real GitHub REST envelope.
    const pages = [
      pageEnvelope(
        Array.from({ length: 100 }, (_, i) => runEntry(100 + i, 1)),
        205,
      ),
      pageEnvelope(
        Array.from({ length: 100 }, (_, i) => runEntry(200 + i, 2)),
        205,
      ),
      // A short third page stops pagination.
      pageEnvelope(
        Array.from({ length: 5 }, (_, i) => runEntry(300 + i, 3)),
        205,
      ),
    ];
    // listRunsPageWithGh is the production adapter; here it is wired to the
    // paginator by injecting a fake process runner that returns envelope pages.
    const runner = fakeEnvelopeRunner(pages);
    const listRunsPage = (page) =>
      listRunsPageWithGh(page, { runSync: runner.runSync });

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    expect(runner.calls()).toBe(3);
    expect(selected.length).toBe(205);
  });

  it('consumes page 2 when page 1 envelope has 100 raw entries with 1 invalid and total_count=101', async () => {
    const { listWorkflowRunsInWindow, listRunsPageWithGh } =
      await loadHistoricalModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    // Page 1: 100 raw entries, 1 invalid (id='bad'), 99 valid + in-window.
    const page1Entries = Array.from({ length: 99 }, (_, i) =>
      runEntry(100 + i, 1),
    );
    page1Entries.unshift({
      id: 'bad',
      conclusion: 'success',
      head_sha: 'bad',
      created_at: 'not-a-date',
    });
    // Page 2: 1 valid in-window run (the 101st).
    const page2Entries = [runEntry(9999, 2)];
    const pages = [
      pageEnvelope(page1Entries, 101),
      pageEnvelope(page2Entries, 101),
    ];
    const runner = fakeEnvelopeRunner(pages);
    const listRunsPage = (page) =>
      listRunsPageWithGh(page, { runSync: runner.runSync });

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    // Page 2 WAS consumed (99 valid + 1 from page 2 = 100).
    expect(runner.calls()).toBe(2);
    expect(selected.length).toBe(100);
    expect(selected.map((r) => r.databaseId)).toContain(9999);
  });
});
