/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { loadAggregateModule, envelope } from './aggregate-helpers.js';

/**
 * Issue #2605 (Low external API): Run entries from the GitHub REST API must be
 * validated BEFORE normalization so only entries with usable identifiers reach
 * downloads.
 */
async function loadHistoricalModule() {
  const url = pathToFileURL(
    join(import.meta.dirname, '..', 'aggregate-evals-historical.js'),
  ).href;
  return import(url);
}

describe('aggregate_evals: normalizeRunEntry validates run entries', () => {
  async function loadFn() {
    const mod = await loadAggregateModule();
    const fn = mod.normalizeRunEntry;
    expect(typeof fn, 'must export normalizeRunEntry').toBe('function');
    return fn;
  }

  function validEntry(overrides = {}) {
    return {
      id: 12345,
      conclusion: 'success',
      head_sha: 'abc123def456',
      created_at: '2026-07-19T02:00:00Z',
      ...overrides,
    };
  }

  it('normalizes a fully valid entry', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry())).toEqual({
      databaseId: 12345,
      conclusion: 'success',
      headSha: 'abc123def456',
      createdAt: '2026-07-19T02:00:00Z',
    });
  });

  it('accepts a null conclusion', async () => {
    const normalizeRunEntry = await loadFn();
    const result = normalizeRunEntry(validEntry({ conclusion: null }));
    expect(result).not.toBeNull();
    expect(result.conclusion).toBeNull();
  });

  it('rejects a missing id', async () => {
    const normalizeRunEntry = await loadFn();
    const entry = validEntry();
    delete entry.id;
    expect(normalizeRunEntry(entry)).toBeNull();
  });

  it('rejects a non-number id', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry({ id: '12345' }))).toBeNull();
  });

  it('rejects a non-integer id', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry({ id: 1.5 }))).toBeNull();
  });

  it('rejects a zero id', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry({ id: 0 }))).toBeNull();
  });

  it('rejects a negative id', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry({ id: -1 }))).toBeNull();
  });

  it('rejects an unsafe integer id', async () => {
    const normalizeRunEntry = await loadFn();
    expect(
      normalizeRunEntry(validEntry({ id: Number.MAX_SAFE_INTEGER + 1 })),
    ).toBeNull();
  });

  it('rejects a missing created_at', async () => {
    const normalizeRunEntry = await loadFn();
    const entry = validEntry();
    delete entry.created_at;
    expect(normalizeRunEntry(entry)).toBeNull();
  });

  it('rejects a non-string created_at', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry({ created_at: 123456789 }))).toBeNull();
  });

  it('rejects an unparseable created_at', async () => {
    const normalizeRunEntry = await loadFn();
    expect(
      normalizeRunEntry(validEntry({ created_at: 'not-a-date' })),
    ).toBeNull();
  });

  // Nonfuture classification happens downstream in the retention-window filter.
  it('accepts a future created_at (parseability only is checked here)', async () => {
    const normalizeRunEntry = await loadFn();
    const result = normalizeRunEntry(
      validEntry({ created_at: '2099-01-01T00:00:00Z' }),
    );
    expect(result).not.toBeNull();
    expect(result.createdAt).toBe('2099-01-01T00:00:00Z');
  });

  it('rejects a non-string, non-null conclusion', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry({ conclusion: 42 }))).toBeNull();
  });

  it('rejects an array conclusion', async () => {
    const normalizeRunEntry = await loadFn();
    expect(
      normalizeRunEntry(validEntry({ conclusion: ['success'] })),
    ).toBeNull();
  });

  it('rejects a missing head_sha', async () => {
    const normalizeRunEntry = await loadFn();
    const entry = validEntry();
    delete entry.head_sha;
    expect(normalizeRunEntry(entry)).toBeNull();
  });

  it('rejects a non-string head_sha', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry({ head_sha: 12345 }))).toBeNull();
  });

  it('rejects an empty head_sha', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(validEntry({ head_sha: '' }))).toBeNull();
  });

  it('rejects null', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(null)).toBeNull();
  });

  it('rejects an array', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry([1, 2, 3])).toBeNull();
  });

  it('rejects a primitive', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry(42)).toBeNull();
  });

  it('rejects a string', async () => {
    const normalizeRunEntry = await loadFn();
    expect(normalizeRunEntry('not-an-object')).toBeNull();
  });
});

describe('aggregate_evals: listRunsPageWithGh skips invalid entries', () => {
  it('returns only valid entries when the envelope mixes valid and invalid', async () => {
    const mod = await loadHistoricalModule();
    const stdout = envelope([
      {
        id: 1,
        conclusion: 'success',
        head_sha: 'a',
        created_at: '2026-07-19T02:00:00Z',
      },
      {
        id: 'not-a-number',
        conclusion: 'success',
        head_sha: 'b',
        created_at: '2026-07-18T02:00:00Z',
      },
      {
        id: 3,
        conclusion: null,
        head_sha: 'c',
        created_at: '2026-07-17T02:00:00Z',
      },
      {
        id: 4,
        conclusion: 'failure',
        head_sha: '',
        created_at: '2026-07-16T02:00:00Z',
      },
      { id: 5, conclusion: 'failure', head_sha: 'e', created_at: 'not-a-date' },
      {
        id: 6,
        conclusion: 'success',
        head_sha: 'f',
        created_at: '2026-07-15T02:00:00Z',
      },
    ]);
    const fakeRunner = () => ({ status: 0, stdout, stderr: '' });
    const result = mod.listRunsPageWithGh(1, { runSync: fakeRunner });
    expect(result.runs.map((r) => r.databaseId)).toEqual([1, 3, 6]);
    // rawCount counts ALL raw entries (6), including the 3 invalid ones.
    expect(result.rawCount).toBe(6);
  });
});
