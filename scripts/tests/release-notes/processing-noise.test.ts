/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { buildChangeEntries } from '../../release-notes/processing.js';
import type {
  EnrichedRef,
  GhPort,
  RawCommit,
  TopologyResolver,
} from '../../release-notes/types.js';

function commit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    hash: 'abcdef0',
    subject: 'fix: something',
    author: 'dev',
    isMerge: false,
    parents: [],
    ...overrides,
  };
}

function enriched(overrides: Partial<EnrichedRef> = {}): EnrichedRef {
  return {
    number: 50,
    title: 'Feature PR',
    body: '',
    labels: ['feature'],
    labelsTruncated: false,
    author: 'alice',
    isPr: true,
    userImpact: null,
    ...overrides,
  };
}

function topology(childHashes: readonly string[]): TopologyResolver {
  return {
    getMergeIntroducedHashes() {
      return childHashes;
    },
    getOctopusMergeIntroducedHashes() {
      return childHashes;
    },
  };
}

function ghPort(): GhPort {
  return {
    async fetchRefs() {
      return new Map([[50, enriched()]]);
    },
  };
}

describe('classic merge process-noise handling', () => {
  it('omits a logical entry when every child is process noise', async () => {
    const commits = [
      commit({
        subject: 'Merge pull request #50 from feature',
        hash: 'mergehash',
        isMerge: true,
        parents: ['mainline', 'featurebranch'],
      }),
      commit({ subject: 'lint: fix formatting', hash: 'child1' }),
      commit({ subject: 'style: prettier run', hash: 'child2' }),
    ];

    const entries = await buildChangeEntries(
      commits,
      ghPort(),
      topology(['child1', 'child2']),
    );

    expect(entries).toHaveLength(0);
  });

  it('uses a substantive child as the logical representative', async () => {
    const commits = [
      commit({
        subject: 'Merge pull request #50 from feature',
        hash: 'mergehash',
        isMerge: true,
        parents: ['mainline', 'featurebranch'],
      }),
      commit({ subject: 'lint: fix formatting', hash: 'child1' }),
      commit({ subject: 'feat: real feature', hash: 'child2' }),
    ];

    const entries = await buildChangeEntries(
      commits,
      ghPort(),
      topology(['child1', 'child2']),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('ref:50');
    expect(entries[0]!.subject).toBe('feat: real feature');
  });

  it('retains a standalone merge without introduced children', async () => {
    const entries = await buildChangeEntries(
      [
        commit({
          subject: 'Merge pull request #50 from feature',
          hash: 'mergehash',
          isMerge: true,
          parents: ['mainline', 'featurebranch'],
        }),
      ],
      ghPort(),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('ref:50');
  });
});
