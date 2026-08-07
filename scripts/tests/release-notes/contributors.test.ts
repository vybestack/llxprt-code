/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  extractPrNumbers,
  isExcludedContributor,
  MAINTAINER_LOGIN,
  computeContributors,
} from '../../release-notes/contributors.js';
import type {
  EnrichedRef,
  GhPort,
  RawCommit,
} from '../../release-notes/types.js';

function makeCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    hash: 'abc',
    subject: 'feat: thing',
    author: 'dev',
    isMerge: false,
    parents: [],
    ...overrides,
  };
}

function makeEnriched(overrides: Partial<EnrichedRef> = {}): EnrichedRef {
  return {
    number: 1,
    title: 'Title',
    body: '',
    labels: [],
    labelsTruncated: false,
    author: 'someone',
    isPr: true,
    userImpact: null,
    ...overrides,
  };
}

function fakeGh(refs: readonly EnrichedRef[]): GhPort {
  return {
    async fetchRefs() {
      return new Map(refs.map((r) => [r.number, r]));
    },
  };
}

describe('extractPrNumbers', () => {
  it('extracts from classic merge subjects', () => {
    const commits = [
      makeCommit({ subject: 'Merge pull request #42 from feature/branch' }),
    ];
    expect(extractPrNumbers(commits)).toEqual([42]);
  });

  it('extracts from terminal squash markers', () => {
    const commits = [
      makeCommit({ subject: 'feat: add streaming support (#100)' }),
    ];
    expect(extractPrNumbers(commits)).toEqual([100]);
  });

  it('extracts from both classic merge and squash in the same set', () => {
    const commits = [
      makeCommit({ subject: 'Merge pull request #42 from feature/branch' }),
      makeCommit({ subject: 'feat: add thing (#100)' }),
    ];
    expect(extractPrNumbers(commits)).toEqual([42, 100]);
  });

  it('deduplicates the same PR referenced multiple times', () => {
    const commits = [
      makeCommit({ subject: 'Merge pull request #42 from feature/branch' }),
      makeCommit({ subject: 'fix: followup (#42)' }),
    ];
    expect(extractPrNumbers(commits)).toEqual([42]);
  });

  it('also captures Fixes/Closes references', () => {
    const commits = [makeCommit({ subject: 'fix: crash Fixes #7' })];
    expect(extractPrNumbers(commits)).toEqual([7]);
  });

  it('returns empty when no PR references', () => {
    const commits = [makeCommit({ subject: 'feat: standalone' })];
    expect(extractPrNumbers(commits)).toEqual([]);
  });
});

describe('isExcludedContributor', () => {
  it('excludes the maintainer', () => {
    expect(isExcludedContributor(MAINTAINER_LOGIN)).toBe(true);
  });

  it('excludes empty/deleted authors', () => {
    expect(isExcludedContributor('')).toBe(true);
    expect(isExcludedContributor('   ')).toBe(true);
  });

  it('excludes bots with [bot] suffix', () => {
    expect(isExcludedContributor('dependabot[bot]')).toBe(true);
    expect(isExcludedContributor('github-actions[bot]')).toBe(true);
  });

  it('keeps regular contributors', () => {
    expect(isExcludedContributor('alice')).toBe(false);
    expect(isExcludedContributor('bobby')).toBe(false);
  });
});

describe('computeContributors', () => {
  it('combines classic merge and squash PR contributors', async () => {
    const commits = [
      makeCommit({ subject: 'Merge pull request #10 from feature' }),
      makeCommit({ subject: 'feat: thing (#20)' }),
    ];
    const gh = fakeGh([
      makeEnriched({ number: 10, author: 'alice', isPr: true }),
      makeEnriched({ number: 20, author: 'bob', isPr: true }),
    ]);
    expect(await computeContributors(gh, commits)).toEqual(['alice', 'bob']);
  });

  it('deduplicates duplicate PR numbers', async () => {
    const commits = [
      makeCommit({ subject: 'Merge pull request #10 from feature' }),
      makeCommit({ subject: 'fix: followup (#10)' }),
    ];
    const gh = fakeGh([
      makeEnriched({ number: 10, author: 'alice', isPr: true }),
    ]);
    expect(await computeContributors(gh, commits)).toEqual(['alice']);
  });

  it('filters bots with [bot] suffix', async () => {
    const commits = [makeCommit({ subject: 'feat: thing (#20)' })];
    const gh = fakeGh([
      makeEnriched({ number: 20, author: 'dependabot[bot]', isPr: true }),
    ]);
    expect(await computeContributors(gh, commits)).toEqual([]);
  });

  it('filters the maintainer', async () => {
    const commits = [makeCommit({ subject: 'feat: thing (#20)' })];
    const gh = fakeGh([
      makeEnriched({ number: 20, author: 'acoliver', isPr: true }),
    ]);
    expect(await computeContributors(gh, commits)).toEqual([]);
  });

  it('filters empty/deleted authors', async () => {
    const commits = [makeCommit({ subject: 'feat: thing (#20)' })];
    const gh = fakeGh([makeEnriched({ number: 20, author: '', isPr: true })]);
    expect(await computeContributors(gh, commits)).toEqual([]);
  });

  it('skips non-PR refs (issues) even when enriched', async () => {
    const commits = [makeCommit({ subject: 'fix: crash Fixes #7' })];
    const gh = fakeGh([
      makeEnriched({ number: 7, author: 'ghost', isPr: false }),
    ]);
    expect(await computeContributors(gh, commits)).toEqual([]);
  });

  it('handles missing GitHub data (ref not returned) gracefully', async () => {
    const commits = [makeCommit({ subject: 'feat: thing (#20)' })];
    const gh = fakeGh([]);
    expect(await computeContributors(gh, commits)).toEqual([]);
  });

  it('handles partial GitHub data: some refs present, some missing', async () => {
    const commits = [
      makeCommit({ subject: 'Merge pull request #10 from feature' }),
      makeCommit({ subject: 'feat: thing (#20)' }),
      makeCommit({ subject: 'fix: another (#30)' }),
    ];
    const gh = fakeGh([
      makeEnriched({ number: 10, author: 'alice', isPr: true }),
      // #20 missing from GitHub response
      makeEnriched({ number: 30, author: 'carol', isPr: true }),
    ]);
    expect(await computeContributors(gh, commits)).toEqual(['alice', 'carol']);
  });

  it('returns empty for commits with no PR references', async () => {
    const commits = [makeCommit({ subject: 'feat: standalone' })];
    const gh = fakeGh([]);
    expect(await computeContributors(gh, commits)).toEqual([]);
  });

  it('returns a sorted, deduplicated list', async () => {
    const commits = [
      makeCommit({ subject: 'Merge pull request #30 from feature' }),
      makeCommit({ subject: 'Merge pull request #10 from feature' }),
      makeCommit({ subject: 'Merge pull request #20 from feature' }),
    ];
    const gh = fakeGh([
      makeEnriched({ number: 30, author: 'charlie', isPr: true }),
      makeEnriched({ number: 10, author: 'alice', isPr: true }),
      makeEnriched({ number: 20, author: 'bob', isPr: true }),
    ]);
    expect(await computeContributors(gh, commits)).toEqual([
      'alice',
      'bob',
      'charlie',
    ]);
  });

  it('returns an empty list when gh enrichment rejects (degrades gracefully)', async () => {
    const commits = [makeCommit({ subject: 'feat: thing (#20)' })];
    const gh: GhPort = {
      async fetchRefs() {
        throw new Error('gh api graphql failed: token expired');
      },
    };
    expect(await computeContributors(gh, commits)).toEqual([]);
  });
});
