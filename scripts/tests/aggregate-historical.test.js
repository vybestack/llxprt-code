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
  envelope,
  fakeEnvelopeRunner,
} from './aggregate-helpers.js';

/**
 * Issue #2605 (historical lookback alignment): The historical fetcher claims
 * alignment with the 7-day artifact retention window but previously only
 * limited by a run COUNT (7 recent runs). Older runs whose artifacts have
 * expired would produce empty downloads. The age filter
 * (`isWithinRetentionWindow`) must actually exclude runs older than the
 * retention window using the `createdAt` field.
 */
describe('aggregate_evals: historical retention age filtering', () => {
  async function loadFn() {
    const mod = await loadAggregateModule();
    const fn = mod.isWithinRetentionWindow;
    expect(typeof fn, 'must export isWithinRetentionWindow').toBe('function');
    return fn;
  }

  it('includes a run created within the 7-day retention window', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('2026-07-17T02:00:00Z', now)).toBe(true);
  });

  it('includes a run created exactly at the 7-day boundary', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('2026-07-13T02:00:00Z', now)).toBe(true);
  });

  it('excludes a run created just beyond the 7-day window', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('2026-07-12T02:00:00Z', now)).toBe(false);
  });

  it('excludes a run created well beyond the window (expired artifacts)', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('2026-06-20T02:00:00Z', now)).toBe(false);
  });

  it('rejects an unparseable createdAt rather than treating it as in-window', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('not-a-date', now)).toBe(false);
  });

  it('honors a custom retention window', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('2026-07-17T02:00:00Z', now, 2)).toBe(false);
  });

  it('does NOT exclude a run merely because it is older than 7 runs (age is the gate, not count)', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('2026-07-15T02:00:00Z', now)).toBe(true);
  });
});

/**
 * Issue #2605 (reject future createdAt): A run whose createdAt is in the future
 * relative to `now` cannot have its artifact expiration assessed by run age
 * alone (artifact expiration is driven by the artifact's own created-at/expire
 * timestamp, not the workflow run's). A future-dated run is treated as
 * suspicious/invalid and excluded from the retention window so it cannot pull
 * in a run whose artifacts may not yet exist or be downloadable.
 */
describe('aggregate_evals: future createdAt is rejected', () => {
  async function loadFn() {
    const mod = await loadAggregateModule();
    return mod.isWithinRetentionWindow;
  }

  it('rejects a run whose createdAt is a few days in the future', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('2026-07-23T02:00:00Z', now)).toBe(false);
  });

  it('rejects a run whose createdAt is far in the future', async () => {
    const isWithinRetentionWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    expect(isWithinRetentionWindow('2026-08-20T02:00:00Z', now)).toBe(false);
  });
});

/**
 * Issue #2605 (historical pagination): Historical retrieval must fetch enough
 * runs to include ALL completed runs within the 7-day cutoff, not a hard
 * --limit 7 or a single fixed --limit 100. The run-selection logic (filter by
 * retention window) must handle more than 100 in-window runs.
 */
describe('aggregate_evals: historical run selection logic', () => {
  it('exports selectRunsInWindow for unit testing', async () => {
    const mod = await loadAggregateModule();
    expect(typeof mod.selectRunsInWindow).toBe('function');
  });

  it('includes all in-window runs when there are more than seven', async () => {
    const { selectRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const runs = Array.from({ length: 10 }, (_, i) => ({
      databaseId: 1000 + i,
      createdAt: new Date(
        Date.parse('2026-07-19T02:00:00Z') - i * 12 * 60 * 60 * 1000,
      ).toISOString(),
      conclusion: 'success',
    }));
    const selected = selectRunsInWindow(runs, now, 7);
    expect(selected.length).toBe(10);
  });

  it('includes all in-window runs when there are more than one hundred', async () => {
    const { selectRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    // 150 runs spread across ~5 days (every 50 minutes), all within the 7-day
    // window. This proves the selection logic is not bounded by a fixed page
    // size of 100.
    const runs = Array.from({ length: 150 }, (_, i) => ({
      databaseId: 2000 + i,
      createdAt: new Date(
        Date.parse('2026-07-19T02:00:00Z') - i * 50 * 60 * 1000,
      ).toISOString(),
      conclusion: 'success',
    }));
    const selected = selectRunsInWindow(runs, now, 7);
    expect(selected.length).toBe(150);
  });

  it('excludes runs beyond the retention window', async () => {
    const { selectRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const runs = [
      {
        databaseId: 1,
        createdAt: '2026-07-19T02:00:00Z',
        conclusion: 'success',
      },
      {
        databaseId: 2,
        createdAt: '2026-07-10T02:00:00Z',
        conclusion: 'success',
      },
    ];
    const selected = selectRunsInWindow(runs, now, 7);
    expect(selected.map((r) => r.databaseId)).toEqual([1]);
  });

  it('rejects runs with an unparseable createdAt', async () => {
    const { selectRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const runs = [
      { databaseId: 1, createdAt: 'not-a-date', conclusion: 'success' },
      {
        databaseId: 2,
        createdAt: '2026-07-19T02:00:00Z',
        conclusion: 'success',
      },
    ];
    const selected = selectRunsInWindow(runs, now, 7);
    expect(selected.map((r) => r.databaseId)).toEqual([2]);
  });

  it('rejects runs with a future createdAt', async () => {
    const { selectRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const runs = [
      {
        databaseId: 1,
        createdAt: '2026-07-25T02:00:00Z',
        conclusion: 'success',
      },
      {
        databaseId: 2,
        createdAt: '2026-07-19T02:00:00Z',
        conclusion: 'success',
      },
    ];
    const selected = selectRunsInWindow(runs, now, 7);
    expect(selected.map((r) => r.databaseId)).toEqual([2]);
  });
});

/**
 * Issue #2605 (historical pagination injectable): listWorkflowRunsInWindow
 * paginates through completed runs via an injectable listRunsPage callback,
 * accumulating all in-window runs across pages. It stops when a page contains
 * a run older than the window (newest-first), when a short page is returned,
 * or when an empty page is returned. This proves multiple pages and more than
 * 100 in-window runs are consumed without invoking the real `gh` CLI.
 */
describe('aggregate_evals: listWorkflowRunsInWindow pagination', () => {
  async function loadFn() {
    const mod = await loadAggregateModule();
    const fn = mod.listWorkflowRunsInWindow;
    expect(typeof fn, 'must export listWorkflowRunsInWindow').toBe('function');
    return fn;
  }

  it('consumes multiple pages until a short page is returned', async () => {
    const listWorkflowRunsInWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    // Two full pages of 100 in-window runs each, then a short third page of 5.
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        return Array.from({ length: 100 }, (_, i) => ({
          databaseId: 100 + i,
          createdAt: new Date(
            Date.parse('2026-07-19T02:00:00Z') - i * 30 * 60 * 1000,
          ).toISOString(),
        }));
      }
      if (page === 2) {
        return Array.from({ length: 100 }, (_, i) => ({
          databaseId: 200 + i,
          createdAt: new Date(
            Date.parse('2026-07-18T02:00:00Z') - i * 30 * 60 * 1000,
          ).toISOString(),
        }));
      }
      if (page === 3) {
        return Array.from({ length: 5 }, (_, i) => ({
          databaseId: 300 + i,
          createdAt: new Date(
            Date.parse('2026-07-17T02:00:00Z') - i * 30 * 60 * 1000,
          ).toISOString(),
        }));
      }
      return [];
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    // All three pages were consumed (the short third page stops pagination).
    expect(calls).toEqual([1, 2, 3]);
    // 100 + 100 + 5 = 205 in-window runs.
    expect(selected.length).toBe(205);
  });

  it('stops pagination once a page contains an out-of-window run', async () => {
    const listWorkflowRunsInWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        // First 3 in-window, then an out-of-window run (10 days old).
        return [
          {
            databaseId: 1,
            createdAt: '2026-07-19T02:00:00Z',
            conclusion: 'success',
          },
          {
            databaseId: 2,
            createdAt: '2026-07-18T02:00:00Z',
            conclusion: 'success',
          },
          {
            databaseId: 3,
            createdAt: '2026-07-17T02:00:00Z',
            conclusion: 'success',
          },
          {
            databaseId: 4,
            createdAt: '2026-07-10T02:00:00Z',
            conclusion: 'success',
          },
          ...Array.from({ length: 96 }, (_, i) => ({
            databaseId: 100 + i,
            createdAt: '2026-07-09T02:00:00Z',
            conclusion: 'success',
          })),
        ];
      }
      return [];
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    // Only page 1 consumed because it contained an out-of-window run.
    expect(calls).toEqual([1]);
    expect(selected.map((r) => r.databaseId)).toEqual([1, 2, 3]);
  });

  it('handles an empty first page gracefully', async () => {
    const listWorkflowRunsInWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const selected = listWorkflowRunsInWindow(
      (page) => {
        calls.push(page);
        return [];
      },
      now,
      7,
    );
    expect(calls).toEqual([1]);
    expect(selected.length).toBe(0);
  });

  it('handles a lister that returns a non-array gracefully', async () => {
    const listWorkflowRunsInWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const selected = listWorkflowRunsInWindow(
      () => /** @type {unknown} */ (null),
      now,
      7,
    );
    expect(selected.length).toBe(0);
  });

  it('accumulates more than 100 in-window runs across two pages', async () => {
    const listWorkflowRunsInWindow = await loadFn();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        return Array.from({ length: 100 }, (_, i) => ({
          databaseId: 100 + i,
          createdAt: new Date(
            Date.parse('2026-07-19T02:00:00Z') - i * 30 * 60 * 1000,
          ).toISOString(),
        }));
      }
      if (page === 2) {
        // 75 in-window runs then an out-of-window run to stop pagination.
        return [
          ...Array.from({ length: 75 }, (_, i) => ({
            databaseId: 200 + i,
            createdAt: new Date(
              Date.parse('2026-07-18T02:00:00Z') - i * 30 * 60 * 1000,
            ).toISOString(),
          })),
          {
            databaseId: 999,
            createdAt: '2026-07-10T02:00:00Z',
            conclusion: 'success',
          },
        ];
      }
      return [];
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    // 100 + 75 = 175 in-window runs consumed across two pages.
    expect(calls).toEqual([1, 2]);
    expect(selected.length).toBe(175);
  });
});

/**
 * Issue #2605 (workflow-specific endpoint): The production `buildRunListArgs`
 * must call the workflow-specific REST endpoint
 * `repos/:owner/:name/actions/workflows/:workflow_id/runs`, NOT the
 * repository-wide `actions/runs` endpoint with an unsupported `workflow` query
 * field (the repository-wide endpoint ignores `workflow` and returns runs for
 * all workflows). Tests prove the command builder targets the workflow-specific
 * path and omits the unsupported `workflow=` field, while still emitting the
 * supported `page`, `per_page`, and `status` query params.
 *
 * It must NOT pass `--jq`: a jq projection against the top-level envelope
 * object reads fields (`.id`, `.conclusion`, ...) that only exist inside each
 * `workflow_runs` entry, so it would emit nulls. The whole JSON envelope must
 * be parsed in JS instead (see the envelope-parsing tests below).
 */
describe('aggregate_evals: buildRunListArgs targets workflow-specific endpoint', () => {
  it('targets the workflow-specific runs path (actions/workflows/evals-nightly.yml/runs)', async () => {
    const { buildRunListArgs } = await loadHistoricalModule();
    const args = buildRunListArgs(1);
    const pathArg = args.find(
      (a) =>
        typeof a === 'string' &&
        a.includes('actions/workflows/') &&
        a.includes('/runs'),
    );
    expect(
      pathArg,
      'must target the workflow-specific runs endpoint',
    ).toBeDefined();
    expect(pathArg).toMatch(/actions\/workflows\/evals-nightly\.yml\/runs$/);
  });

  it('does NOT target the bare repository-wide actions/runs endpoint', async () => {
    const { buildRunListArgs } = await loadHistoricalModule();
    const args = buildRunListArgs(1);
    const pathArgs = args.filter(
      (a) => typeof a === 'string' && /actions\/runs/.test(a),
    );
    // The repository-wide endpoint is `actions/runs` WITHOUT a workflows
    // segment. The workflow-specific endpoint is `actions/workflows/.../runs`.
    for (const candidate of pathArgs) {
      expect(candidate).toMatch(/workflows/);
    }
  });

  it('does NOT emit an unsupported workflow= field for the repository-wide endpoint', async () => {
    const { buildRunListArgs } = await loadHistoricalModule();
    const args = buildRunListArgs(1);
    expect(
      args.some((a) => typeof a === 'string' && /^workflow=/.test(a)),
      'must not emit an unsupported workflow= field',
    ).toBe(false);
  });

  it('does NOT emit a --jq projection (the whole JSON envelope is parsed in JS)', async () => {
    const { buildRunListArgs } = await loadHistoricalModule();
    const args = buildRunListArgs(1);
    expect(
      args.some((a) => a === '--jq'),
      'must not emit --jq; the envelope is parsed in JS',
    ).toBe(false);
  });

  it('keeps supported page, per_page, and status=completed params', async () => {
    const { buildRunListArgs } = await loadHistoricalModule();
    const args = buildRunListArgs(7);
    expect(args).toContain('page=7');
    expect(args).toContain('per_page=100');
    expect(args).toContain('status=completed');
  });
});

/**
 * Issue #2605 (production adapter parses the REAL GitHub envelope): The workflow
 * runs endpoint returns a JSON envelope `{ total_count, workflow_runs: [...] }`
 * where each entry has REST fields `id`, `conclusion`, `head_sha`, and
 * `created_at`. The production `listRunsPageWithGh` must parse that envelope
 * and map each entry to the normalized shape (`databaseId`, `conclusion`,
 * `headSha`, `createdAt`) the retention/pagination logic consumes. A previous
 * `--jq` projection read the top-level envelope object and emitted nulls; the
 * fix parses the whole envelope in JS. These tests exercise the production
 * adapter through an injectable process runner against REALISTIC envelope
 * stdout (multiple records, multiple pages, malformed bodies) WITHOUT spawning
 * the real `gh` CLI.
 */
describe('aggregate_evals: listRunsPageWithGh parses the real workflow_runs envelope', () => {
  it('maps multiple records from a realistic envelope via an injectable runner', async () => {
    const mod = await loadHistoricalModule();
    const stdout = envelope([
      {
        id: 111,
        conclusion: 'success',
        head_sha: 'abc1',
        created_at: '2026-07-19T02:00:00Z',
      },
      {
        id: 112,
        conclusion: 'failure',
        head_sha: 'def2',
        created_at: '2026-07-18T02:00:00Z',
      },
      {
        id: 113,
        conclusion: 'success',
        head_sha: 'ghi3',
        created_at: '2026-07-17T02:00:00Z',
      },
    ]);

    const invocations = [];
    const fakeRunner = (cmd, args) => {
      invocations.push({ cmd, args });
      return { status: 0, stdout, stderr: '' };
    };

    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(invocations).toHaveLength(1);
    expect(result.runs).toHaveLength(3);
    expect(result.runs.map((r) => r.databaseId)).toEqual([111, 112, 113]);
    expect(result.runs[1].conclusion).toBe('failure');
    expect(result.runs[0].headSha).toBe('abc1');
    expect(result.runs[0].createdAt).toBe('2026-07-19T02:00:00Z');
    expect(result.rawCount).toBe(3);
    expect(result.totalCount).toBe(3);
  });

  it('does NOT return nulls from a top-level jq-style projection (regression)', async () => {
    const mod = await loadHistoricalModule();
    // A regression guard: if a jq-style projection against the top-level
    // envelope were reintroduced, databaseId/conclusion/headSha/createdAt would
    // all be null/undefined. With envelope parsing they are real values.
    const stdout = envelope([
      {
        id: 4242,
        conclusion: 'success',
        head_sha: 'sha-1',
        created_at: '2026-07-19T02:00:00Z',
      },
    ]);
    const fakeRunner = () => ({ status: 0, stdout, stderr: '' });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    const [run] = result.runs;
    expect(run).toBeDefined();
    expect(run.databaseId).toBe(4242);
    expect(run.conclusion).toBe('success');
    expect(run.headSha).toBe('sha-1');
    expect(run.createdAt).toBe('2026-07-19T02:00:00Z');
  });

  it('returns an empty result (not throw) when gh fails', async () => {
    const mod = await loadHistoricalModule();
    const fakeRunner = () => ({
      status: 1,
      stdout: '',
      stderr: 'gh: command failed',
    });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result.runs).toEqual([]);
    expect(result.rawCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  it('returns an empty result and warns when the envelope has no workflow_runs', async () => {
    const mod = await loadHistoricalModule();
    const warnings = [];
    const originalError = console.error;
    console.error = (message) => warnings.push(String(message));
    const fakeRunner = () => ({
      status: 0,
      stdout: JSON.stringify({ total_count: 0 }),
      stderr: '',
    });
    try {
      const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
      expect(result.runs).toEqual([]);
      expect(warnings).toContain(
        'Warning: workflow run envelope has no workflow_runs array',
      );
    } finally {
      console.error = originalError;
    }
  });

  it('returns an empty result when stdout is empty', async () => {
    const mod = await loadHistoricalModule();
    const fakeRunner = () => ({ status: 0, stdout: '', stderr: '' });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result.runs).toEqual([]);
  });

  it('skips non-object entries inside workflow_runs without throwing', async () => {
    const mod = await loadHistoricalModule();
    const stdout = JSON.stringify({
      total_count: 4,
      workflow_runs: [
        {
          id: 1,
          conclusion: 'success',
          head_sha: 'a',
          created_at: '2026-07-19T02:00:00Z',
        },
        null,
        'not-an-object',
        {
          id: 2,
          conclusion: 'failure',
          head_sha: 'b',
          created_at: '2026-07-18T02:00:00Z',
        },
      ],
    });
    const fakeRunner = () => ({ status: 0, stdout, stderr: '' });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result.runs.map((r) => r.databaseId)).toEqual([1, 2]);
    // rawCount counts ALL raw entries including null and the string.
    expect(result.rawCount).toBe(4);
  });

  it('returns an empty result for malformed (unparseable) envelope stdout', async () => {
    const mod = await loadHistoricalModule();
    const fakeRunner = () => ({
      status: 0,
      stdout: '{not valid json',
      stderr: '',
    });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result.runs).toEqual([]);
  });

  it('returns an empty result when the envelope is a JSON array, not an object', async () => {
    const mod = await loadHistoricalModule();
    const fakeRunner = () => ({
      status: 0,
      stdout: JSON.stringify([{ id: 1 }]),
      stderr: '',
    });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result.runs).toEqual([]);
  });
});

/**
 * Issue #2605 (multiple pages consumed through the real envelope): The
 * production adapter is used by the paginator, so a multi-page sequence of
 * realistic envelopes must yield the union of all in-window runs. This proves
 * the envelope parser composes correctly with pagination across pages, not just
 * within a single page.
 */
describe('aggregate_evals: paginator consumes multiple realistic envelope pages', () => {
  it('accumulates in-window runs from multiple envelope pages and stops on a short page', async () => {
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
});

/**
 * Issue #2605 (cutoff only on definitely-older timestamp): An invalid or
 * future timestamp must be EXCLUDED from the in-window set but must NOT signal
 * the pagination cutoff, because such a timestamp does not prove the run list
 * has reached older runs. Only a definitely-older (past the retention window)
 * timestamp signals the cutoff. This prevents a single malformed/future run
 * from prematurely truncating historical retrieval.
 */
describe('aggregate_evals: invalid/future timestamps excluded but not cutoff', () => {
  it('does NOT signal cutoff when an out-of-window run is future-dated', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        // A future-dated run (excluded) followed by in-window runs; pagination
        // must NOT stop at the future run because it is not definitely older.
        return [
          {
            databaseId: 1,
            createdAt: '2026-07-25T02:00:00Z',
            conclusion: 'success',
          },
          {
            databaseId: 2,
            createdAt: '2026-07-19T02:00:00Z',
            conclusion: 'success',
          },
          {
            databaseId: 3,
            createdAt: '2026-07-18T02:00:00Z',
            conclusion: 'success',
          },
          ...Array.from({ length: 97 }, (_, i) => ({
            databaseId: 100 + i,
            createdAt: '2026-07-17T02:00:00Z',
            conclusion: 'success',
          })),
        ];
      }
      if (page === 2) {
        // Page 2 has an older run that signals the real cutoff.
        return [
          {
            databaseId: 200,
            createdAt: '2026-07-10T02:00:00Z',
            conclusion: 'success',
          },
        ];
      }
      return [];
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    // Page 2 was consumed (future run did not stop pagination).
    expect(calls).toEqual([1, 2]);
    // The future run (id 1) was excluded; in-window runs 2,3,100-196 kept.
    expect(selected.map((r) => r.databaseId)).not.toContain(1);
    expect(selected.length).toBe(99);
  });

  it('does NOT signal cutoff when an out-of-window run has an unparseable timestamp', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        return [
          {
            databaseId: 1,
            createdAt: 'not-a-date',
            conclusion: 'success',
          },
          {
            databaseId: 2,
            createdAt: '2026-07-19T02:00:00Z',
            conclusion: 'success',
          },
          ...Array.from({ length: 98 }, (_, i) => ({
            databaseId: 100 + i,
            createdAt: '2026-07-17T02:00:00Z',
            conclusion: 'success',
          })),
        ];
      }
      if (page === 2) {
        return [
          {
            databaseId: 200,
            createdAt: '2026-07-10T02:00:00Z',
            conclusion: 'success',
          },
        ];
      }
      return [];
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    expect(calls).toEqual([1, 2]);
    expect(selected.map((r) => r.databaseId)).not.toContain(1);
    expect(selected.length).toBe(99);
  });

  it('signals cutoff only on a definitely-older timestamp', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const calls = [];
    const listRunsPage = (page) => {
      calls.push(page);
      if (page === 1) {
        return [
          {
            databaseId: 1,
            createdAt: '2026-07-19T02:00:00Z',
            conclusion: 'success',
          },
          {
            databaseId: 2,
            createdAt: '2026-07-10T02:00:00Z',
            conclusion: 'success',
          },
          ...Array.from({ length: 98 }, (_, i) => ({
            databaseId: 100 + i,
            createdAt: '2026-07-09T02:00:00Z',
            conclusion: 'success',
          })),
        ];
      }
      return [];
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    // Only page 1 consumed: the definitely-older run (id 2) signals cutoff.
    expect(calls).toEqual([1]);
    expect(selected.map((r) => r.databaseId)).toEqual([1]);
  });
});

/**
 * Issue #2605 (dedupe run IDs across pages): The REST API is ordered
 * newest-first, but a run straddling a page boundary could theoretically be
 * returned on two pages. The accumulator must dedupe by databaseId so a run is
 * not processed twice.
 */
describe('aggregate_evals: dedupes run IDs across pages', () => {
  it('does not duplicate a run that appears on two pages', async () => {
    const { listWorkflowRunsInWindow } = await loadAggregateModule();
    const now = Date.parse('2026-07-20T02:00:00Z');
    const listRunsPage = (page) => {
      if (page === 1) {
        return Array.from({ length: 100 }, (_, i) => ({
          databaseId: 100 + i,
          createdAt: '2026-07-19T02:00:00Z',
          conclusion: 'success',
        }));
      }
      if (page === 2) {
        // Run 199 straddles the boundary (appears on both pages).
        return [
          {
            databaseId: 199,
            createdAt: '2026-07-19T02:00:00Z',
            conclusion: 'success',
          },
          ...Array.from({ length: 74 }, (_, i) => ({
            databaseId: 200 + i,
            createdAt: '2026-07-18T02:00:00Z',
            conclusion: 'success',
          })),
          {
            databaseId: 999,
            createdAt: '2026-07-10T02:00:00Z',
            conclusion: 'success',
          },
        ];
      }
      return [];
    };

    const selected = listWorkflowRunsInWindow(listRunsPage, now, 7);
    const ids = selected.map((r) => r.databaseId);
    // Run 199 appears only once despite being on both pages.
    expect(ids.filter((id) => id === 199).length).toBe(1);
  });
});
