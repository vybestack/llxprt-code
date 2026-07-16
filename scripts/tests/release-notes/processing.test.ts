/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  groupPrCommits,
  buildChangeEntries,
} from '../../release-notes/processing.js';
import {
  getCommits,
  createTopologyResolver,
} from '../../release-notes/git-port.js';
import { useTempRepo, gitCommit, gitMerge } from './fixtures.js';
import type {
  RawCommit,
  EnrichedRef,
  GhPort,
  TopologyResolver,
} from '../../release-notes/types.js';

function makeCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    hash: 'abcdef0',
    subject: 'fix: something',
    author: 'dev',
    isMerge: false,
    parents: [],
    ...overrides,
  };
}

function makeEnriched(overrides: Partial<EnrichedRef> = {}): EnrichedRef {
  return {
    number: 1,
    title: 'Issue title',
    body: '',
    labels: [],
    labelsTruncated: false,
    author: 'someone',
    isPr: false,
    userImpact: null,
    ...overrides,
  };
}

function fakeTopology(
  map: ReadonlyMap<string, readonly string[]>,
): TopologyResolver {
  return {
    getMergeIntroducedHashes(firstParent: string, _secondParent: string) {
      return map.get(firstParent) ?? [];
    },
    getOctopusMergeIntroducedHashes(parents: readonly string[]) {
      const firstParent = parents[0] ?? '';
      const seen = new Set<string>();
      const result: string[] = [];
      for (let index = 1; index < parents.length; index += 1) {
        const introduced = map.get(firstParent) ?? [];
        for (const hash of introduced) {
          if (!seen.has(hash)) {
            seen.add(hash);
            result.push(hash);
          }
        }
      }
      return result;
    },
  };
}

describe('groupPrCommits (PR-identity-based grouping)', () => {
  it('groups commits from the same squash PR into one logical entry', () => {
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'feat: add streaming (#100)',
        hash: 'aaa1111',
        author: 'alice',
      }),
      makeCommit({
        subject: 'fix: edge case in streaming (#100)',
        hash: 'bbb2222',
        author: 'alice',
      }),
      makeCommit({
        subject: 'feat: unrelated thing (#200)',
        hash: 'ccc3333',
        author: 'bob',
      }),
    ];
    const groups = groupPrCommits(commits);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.commits.map((c) => c.hash)).toEqual([
      'aaa1111',
      'bbb2222',
    ]);
    expect(groups[1]!.commits.map((c) => c.hash)).toEqual(['ccc3333']);
  });

  it('keeps commits without refs as individual entries', () => {
    const commits: RawCommit[] = [
      makeCommit({ subject: 'feat: standalone', hash: 'aaa1111' }),
      makeCommit({ subject: 'fix: another standalone', hash: 'bbb2222' }),
    ];
    const groups = groupPrCommits(commits);
    expect(groups).toHaveLength(2);
  });

  it('uses first commit as the representative for a group', () => {
    const commits: RawCommit[] = [
      makeCommit({ subject: 'feat: main work (#42)', hash: 'aaa1111' }),
      makeCommit({ subject: 'fix: followup (#42)', hash: 'bbb2222' }),
    ];
    const groups = groupPrCommits(commits);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.representative.subject).toContain('main work');
    expect(groups[0]!.representative.hash).toBe('aaa1111');
  });

  it('does NOT merge distinct PRs that close the same issue', () => {
    // Two distinct PRs (#10 and #20) both close issue #5 — they must remain
    // separate entries. Fixes #5 is enrichment, not a grouping key.
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'feat: approach A Fixes #5 (#10)',
        hash: 'aaa1111',
      }),
      makeCommit({
        subject: 'feat: approach B Fixes #5 (#20)',
        hash: 'bbb2222',
      }),
    ];
    const groups = groupPrCommits(commits);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.commits[0]!.hash).toBe('aaa1111');
    expect(groups[1]!.commits[0]!.hash).toBe('bbb2222');
  });

  it('groups classic merge children into one PR entry via topology', () => {
    const childHashes = ['child1', 'child2'];
    const resolver = fakeTopology(new Map([['mainline', childHashes]]));
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #50 from feature',
        hash: 'mergehash',
        isMerge: true,
        parents: ['mainline', 'featurebranch'],
      }),
      makeCommit({ subject: 'feat: child 1', hash: 'child1' }),
      makeCommit({ subject: 'fix: child 2', hash: 'child2' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.commits.map((c) => c.hash)).toEqual([
      'mergehash',
      'child1',
      'child2',
    ]);
    expect(groups[0]!.childHashes).toEqual(['child1', 'child2']);
  });

  it('keeps a classic merge as its own group when topology resolver is absent', () => {
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #50 from feature',
        hash: 'mergehash',
        isMerge: true,
        parents: ['mainline', 'featurebranch'],
      }),
    ];
    const groups = groupPrCommits(commits);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.commits.map((c) => c.hash)).toEqual(['mergehash']);
    expect(groups[0]!.childHashes).toEqual([]);
  });

  it('groups multiple classic merges by PR identity', () => {
    const resolver = fakeTopology(
      new Map([
        ['main1', ['childA']],
        ['main2', ['childB']],
      ]),
    );
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #50 from feature',
        hash: 'merge50',
        isMerge: true,
        parents: ['main1', 'feat1'],
      }),
      makeCommit({
        subject: 'Merge pull request #60 from feature',
        hash: 'merge60',
        isMerge: true,
        parents: ['main2', 'feat2'],
      }),
      makeCommit({ subject: 'feat: child A', hash: 'childA' }),
      makeCommit({ subject: 'fix: child B', hash: 'childB' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    expect(groups).toHaveLength(2);
    const pr50 = groups.find((g) => g.representative.subject.includes('#50'))!;
    const pr60 = groups.find((g) => g.representative.subject.includes('#60'))!;
    expect(pr50.commits.map((c) => c.hash)).toContain('merge50');
    expect(pr50.commits.map((c) => c.hash)).toContain('childA');
    expect(pr60.commits.map((c) => c.hash)).toContain('merge60');
    expect(pr60.commits.map((c) => c.hash)).toContain('childB');
  });

  it('assigns nested merge children to the nearest (innermost) introducing PR', () => {
    const resolver = fakeTopology(
      new Map([
        ['outerMain', ['innerMerge', 'grandchild']],
        ['innerMain', ['grandchild']],
      ]),
    );
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #100 from outer',
        hash: 'outerMerge',
        isMerge: true,
        parents: ['outerMain', 'outerFeat'],
      }),
      makeCommit({
        subject: 'Merge pull request #50 from inner',
        hash: 'innerMerge',
        isMerge: true,
        parents: ['innerMain', 'innerFeat'],
      }),
      makeCommit({ subject: 'feat: grandchild', hash: 'grandchild' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    expect(groups).toHaveLength(2);
    const outer = groups.find((g) => g.representative.hash === 'outerMerge')!;
    const inner = groups.find((g) => g.representative.hash === 'innerMerge')!;
    expect(outer.commits.map((c) => c.hash)).toContain('outerMerge');
    expect(outer.commits.map((c) => c.hash)).toContain('innerMerge');
    expect(outer.commits.map((c) => c.hash)).not.toContain('grandchild');
    expect(inner.commits.map((c) => c.hash)).not.toContain('innerMerge');
    expect(inner.commits.map((c) => c.hash)).toContain('grandchild');
  });

  it('keeps childHashes and commits consistent for nested merges (no loss/duplication)', () => {
    const resolver = fakeTopology(
      new Map([
        ['outerMain', ['innerMerge', 'gc1', 'gc2']],
        ['innerMain', ['gc1', 'gc2']],
      ]),
    );
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #100 from outer',
        hash: 'outerMerge',
        isMerge: true,
        parents: ['outerMain', 'outerFeat'],
      }),
      makeCommit({
        subject: 'Merge pull request #50 from inner',
        hash: 'innerMerge',
        isMerge: true,
        parents: ['innerMain', 'innerFeat'],
      }),
      makeCommit({ subject: 'feat: gc1', hash: 'gc1' }),
      makeCommit({ subject: 'fix: gc2', hash: 'gc2' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    const allAssignedHashes = groups.flatMap((g) =>
      g.commits.map((c) => c.hash),
    );
    for (const hash of ['gc1', 'gc2']) {
      expect(allAssignedHashes.filter((h) => h === hash)).toHaveLength(1);
    }
    for (const group of groups) {
      const commitHashes = group.commits.map((c) => c.hash);
      for (const childHash of group.childHashes) {
        expect(commitHashes).toContain(childHash);
      }
    }
  });
});

describe('nested classic merges — temp-git integration', () => {
  const getDir = useTempRepo('llxprt-nested-merge');

  it('groups a real nested merge: outer PR owns inner merge, inner PR owns grandchild', () => {
    const dir = getDir();
    const root = gitCommit(dir, 'root');
    execFileSync('git', ['tag', 'start', root], { encoding: 'utf8' });

    // Create sub-branch with grandchild commit
    execFileSync('git', ['checkout', '-b', 'sub'], { encoding: 'utf8' });
    gitCommit(dir, 'feat: grandchild work');
    const grandchildHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    // Create inner-feature branch from root, merge sub into it
    execFileSync('git', ['checkout', root], { encoding: 'utf8' });
    execFileSync('git', ['checkout', '-b', 'inner-feature'], {
      encoding: 'utf8',
    });
    gitCommit(dir, 'feat: inner feature work');
    gitMerge(dir, 'Merge pull request #50 from sub', 'sub');
    const innerMergeHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    // Merge inner-feature into main
    execFileSync('git', ['checkout', 'main'], { encoding: 'utf8' });
    gitMerge(
      dir,
      'Merge pull request #100 from inner-feature',
      'inner-feature',
    );
    const outerMergeHash = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    const commits = getCommits('start', 'HEAD');
    const resolver = createTopologyResolver();
    const groups = groupPrCommits(commits, resolver);

    const grandchildOwners = groups.filter((g) =>
      g.commits.some((c) => c.hash === grandchildHash),
    );
    expect(grandchildOwners).toHaveLength(1);

    const outerGroup = groups.find(
      (g) => g.representative.hash === outerMergeHash,
    );
    expect(outerGroup).toBeDefined();
    expect(outerGroup!.commits.map((c) => c.hash)).toContain(innerMergeHash);

    const allHashes = commits.map((c) => c.hash);
    const assignedHashes = groups.flatMap((g) => g.commits.map((c) => c.hash));
    for (const hash of allHashes) {
      expect(assignedHashes.filter((h) => h === hash)).toHaveLength(1);
    }
  });
});

describe('buildChangeEntries', () => {
  it('enriches commits via gh port and classifies them', async () => {
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'feat: add Ollama support (#42)',
        hash: 'aaa1111',
        author: 'alice',
      }),
    ];

    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map<number, EnrichedRef>([
          [
            42,
            makeEnriched({
              number: 42,
              title: 'Add Ollama support',
              labels: ['Provider Support'],
              isPr: true,
              author: 'alice',
            }),
          ],
        ]);
      },
    };

    const entries = await buildChangeEntries(commits, fakeGh);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.category).toBe('new');
    expect(entries[0]!.eligibleForHighlights).toBe(true);
    expect(entries[0]!.enriched[0]!.title).toBe('Add Ollama support');
  });

  it('attaches immutable source facts once during entry construction', async () => {
    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map<number, EnrichedRef>([
          [
            42,
            makeEnriched({
              number: 42,
              title: 'Resume interrupted sessions',
              body: 'Users can now resume interrupted sessions.',
              labels: ['feature'],
            }),
          ],
        ]);
      },
    };

    const entries = await buildChangeEntries(
      [makeCommit({ subject: 'feat: recovery (#42)' })],
      fakeGh,
    );

    expect(entries[0]?.sourceFacts).toEqual([
      expect.objectContaining({
        sourceId: 'ref:42',
        userImpact: 'Users can now resume interrupted sessions.',
      }),
    ]);
    expect(Object.isFrozen(entries[0]?.sourceFacts)).toBe(true);
    expect(Object.isFrozen(entries[0]?.sourceFacts[0])).toBe(true);
  });

  it('handles gh port returning no enrichment gracefully', async () => {
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'fix: standalone fix',
        hash: 'aaa1111',
        author: 'alice',
      }),
    ];
    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map();
      },
    };
    const entries = await buildChangeEntries(commits, fakeGh);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.enriched).toEqual([]);
  });

  it('retains unavailable references only in All Changes', async () => {
    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map();
      },
    };

    const entries = await buildChangeEntries(
      [makeCommit({ subject: 'feat: add provider support (#42)' })],
      fakeGh,
    );

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (entry === undefined) {
      throw new Error('Expected the unavailable reference to be retained');
    }
    expect(entry.category).toBe('internal');
    expect(entry.eligibleForHighlights).toBe(false);
  });

  it('never demotes a breaking child from a non-conventional PR title', async () => {
    const resolver = fakeTopology(new Map([['mainline', ['child']]]));
    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map([
          [42, makeEnriched({ number: 42, title: 'Improve configuration' })],
        ]);
      },
    };
    const commits = [
      makeCommit({
        subject: 'Merge pull request #42 from feature',
        hash: 'merge',
        isMerge: true,
        parents: ['mainline', 'feature'],
      }),
      makeCommit({
        subject: 'feat!: replace public config format',
        hash: 'child',
      }),
    ];

    const entries = await buildChangeEntries(commits, fakeGh, resolver);

    expect(entries[0]!.category).toBe('breaking');
  });

  it('marks internal-label entries as ineligible for highlights', async () => {
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'refactor: restructure providers (#99)',
        hash: 'aaa1111',
        author: 'alice',
      }),
    ];
    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map<number, EnrichedRef>([
          [
            99,
            makeEnriched({
              number: 99,
              title: 'Restructure providers',
              labels: ['Code Quality', 'Modularization'],
            }),
          ],
        ]);
      },
    };
    const entries = await buildChangeEntries(commits, fakeGh);
    expect(entries[0]!.eligibleForHighlights).toBe(false);
  });

  it('keeps complete commits through topology-aware grouping', async () => {
    const childHashes = ['child1', 'child2'];
    const resolver = fakeTopology(new Map([['mainline', childHashes]]));
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #50 from feature',
        hash: 'mergehash',
        isMerge: true,
        parents: ['mainline', 'featurebranch'],
      }),
      makeCommit({ subject: 'feat: child 1', hash: 'child1' }),
      makeCommit({ subject: 'fix: child 2', hash: 'child2' }),
    ];
    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map<number, EnrichedRef>([
          [
            50,
            makeEnriched({
              number: 50,
              title: 'Feature PR',
              labels: ['feature'],
              isPr: true,
              author: 'alice',
            }),
          ],
        ]);
      },
    };
    const entries = await buildChangeEntries(commits, fakeGh, resolver);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('ref:50');
    expect(entries[0]!.childHashes).toEqual(['child1', 'child2']);
  });

  it('does not merge distinct PRs closing the same issue into one entry', async () => {
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'feat: approach A Fixes #5 (#10)',
        hash: 'aaa1111',
      }),
      makeCommit({
        subject: 'feat: approach B Fixes #5 (#20)',
        hash: 'bbb2222',
      }),
    ];
    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map<number, EnrichedRef>([
          [5, makeEnriched({ number: 5, title: 'Shared issue', isPr: false })],
          [
            10,
            makeEnriched({
              number: 10,
              title: 'PR A',
              isPr: true,
              author: 'alice',
            }),
          ],
          [
            20,
            makeEnriched({
              number: 20,
              title: 'PR B',
              isPr: true,
              author: 'bob',
            }),
          ],
        ]);
      },
    };
    const entries = await buildChangeEntries(commits, fakeGh);
    expect(entries).toHaveLength(2);
    // Both PR refs are retained as enrichment (issue ref included).
    expect(entries[0]!.enriched.length).toBeGreaterThanOrEqual(1);
    expect(entries[1]!.enriched.length).toBeGreaterThanOrEqual(1);
  });

  it('nested merge topology: outer PR does NOT collect inner PR enrichment (no label contamination)', async () => {
    const resolver = fakeTopology(
      new Map([
        ['outerMain', ['innerMerge', 'grandchild']],
        ['innerMain', ['grandchild']],
      ]),
    );
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #100 from outer',
        hash: 'outerMerge',
        isMerge: true,
        parents: ['outerMain', 'outerFeat'],
      }),
      makeCommit({
        subject: 'Merge pull request #50 from inner',
        hash: 'innerMerge',
        isMerge: true,
        parents: ['innerMain', 'innerFeat'],
      }),
      makeCommit({ subject: 'feat: grandchild', hash: 'grandchild' }),
    ];
    const fakeGh: GhPort = {
      async fetchRefs() {
        return new Map<number, EnrichedRef>([
          [
            100,
            makeEnriched({
              number: 100,
              title: 'Outer PR',
              labels: ['feature'],
              isPr: true,
              author: 'alice',
            }),
          ],
          [
            50,
            makeEnriched({
              number: 50,
              title: 'Inner PR',
              labels: ['bug', 'fix'],
              isPr: true,
              author: 'bob',
            }),
          ],
        ]);
      },
    };
    const entries = await buildChangeEntries(commits, fakeGh, resolver);
    expect(entries).toHaveLength(2);
    const outer = entries.find((e) => e.id === 'ref:100')!;
    const inner = entries.find((e) => e.id === 'ref:50')!;
    const outerNumbers = outer.enriched.map((r) => r.number);
    expect(outerNumbers).not.toContain(50);
    expect(outerNumbers).toContain(100);
    const innerNumbers = inner.enriched.map((r) => r.number);
    expect(innerNumbers).toContain(50);
    expect(innerNumbers).not.toContain(100);
    expect(outer.category).toBe('new');
    // Inner entry's enrichment only contains its own PR #50 (bug/fix labels),
    // never the outer PR #100's 'feature' label.
    const innerLabelCount = inner.enriched.flatMap((r) => r.labels);
    expect(innerLabelCount).not.toContain('feature');
    expect(innerLabelCount).toContain('bug');
  });

  it('respects metadataAvailable for owning-PR classification', async () => {
    const cases = [
      {
        title: 'feat: add streaming support',
        labels: [],
        metadataAvailable: true,
        commitSubject: 'chore: minor cleanup (#42)',
        expectedCategory: 'new',
        eligible: true,
      },
      {
        title: 'feat: add streaming support',
        labels: ['feature'],
        metadataAvailable: false,
        commitSubject: 'chore: minor cleanup (#42)',
        expectedCategory: 'internal',
        eligible: false,
      },
      {
        title: 'Improve configuration loading',
        labels: ['bug'],
        metadataAvailable: true,
        commitSubject: 'perf: optimize config path (#42)',
        expectedCategory: 'fix',
        eligible: true,
      },
    ];
    for (const c of cases) {
      const fakeGh: GhPort = {
        async fetchRefs() {
          return new Map<number, EnrichedRef>([
            [
              42,
              makeEnriched({
                number: 42,
                title: c.title,
                labels: c.labels,
                metadataAvailable: c.metadataAvailable,
                isPr: true,
              }),
            ],
          ]);
        },
      };
      const entries = await buildChangeEntries(
        [makeCommit({ subject: c.commitSubject })],
        fakeGh,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]!.category).toBe(c.expectedCategory);
      expect(entries[0]!.eligibleForHighlights).toBe(c.eligible);
    }
  });
});

describe('classic merge wrapper — topology behavior', () => {
  it('groups all children under the merge commit via topology', () => {
    const childHashes = ['childA', 'childB', 'childC'];
    const resolver = fakeTopology(new Map([['mainline', childHashes]]));
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #70 from feature',
        hash: 'mergehash',
        isMerge: true,
        parents: ['mainline', 'featurebranch'],
      }),
      makeCommit({ subject: 'feat: child A', hash: 'childA' }),
      makeCommit({ subject: 'fix: child B', hash: 'childB' }),
      makeCommit({ subject: 'refactor: child C', hash: 'childC' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.commits).toHaveLength(4);
    expect(groups[0]!.childHashes).toEqual(['childA', 'childB', 'childC']);
  });

  it('does not associate a child with the wrong merge commit', () => {
    const resolver = fakeTopology(
      new Map([
        ['mainline1', ['childA']],
        ['mainline2', ['childB']],
      ]),
    );
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #80 from feature',
        hash: 'merge80',
        isMerge: true,
        parents: ['mainline1', 'feat1'],
      }),
      makeCommit({
        subject: 'Merge pull request #90 from feature',
        hash: 'merge90',
        isMerge: true,
        parents: ['mainline2', 'feat2'],
      }),
      makeCommit({ subject: 'feat: child A', hash: 'childA' }),
      makeCommit({ subject: 'fix: child B', hash: 'childB' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    expect(groups).toHaveLength(2);
    const pr80 = groups.find((g) => g.representative.hash === 'merge80')!;
    const pr90 = groups.find((g) => g.representative.hash === 'merge90')!;
    expect(pr80.commits.map((c) => c.hash)).toContain('childA');
    expect(pr80.commits.map((c) => c.hash)).not.toContain('childB');
    expect(pr90.commits.map((c) => c.hash)).toContain('childB');
    expect(pr90.commits.map((c) => c.hash)).not.toContain('childA');
  });
});

describe('octopus merge grouping (3+ parents)', () => {
  it('groups a 3-parent octopus merge and all its introduced children into one entry', () => {
    const resolver = fakeTopology(
      new Map([['octoMain', ['childA', 'childB', 'childC']]]),
    );
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #70 from feature',
        hash: 'octoMerge',
        isMerge: true,
        parents: ['octoMain', 'branch1', 'branch2'],
      }),
      makeCommit({ subject: 'feat: child A', hash: 'childA' }),
      makeCommit({ subject: 'fix: child B', hash: 'childB' }),
      makeCommit({ subject: 'refactor: child C', hash: 'childC' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.commits.map((c) => c.hash)).toEqual([
      'octoMerge',
      'childA',
      'childB',
      'childC',
    ]);
    expect(groups[0]!.childHashes).toEqual(['childA', 'childB', 'childC']);
  });

  it('deduplicates overlapping introduced children from octopus parents', () => {
    const resolver: TopologyResolver = {
      getMergeIntroducedHashes() {
        return [];
      },
      getOctopusMergeIntroducedHashes(parents: readonly string[]) {
        const firstParent = parents[0]!;
        const map = new Map<string, readonly string[]>([
          ['octoMain', ['branch1Child', 'sharedChild', 'branch2Child']],
        ]);
        const introduced = map.get(firstParent) ?? [];
        return [...new Set(introduced)];
      },
    };
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #80 from octopus',
        hash: 'octoMerge',
        isMerge: true,
        parents: ['octoMain', 'branch1', 'branch2'],
      }),
      makeCommit({ subject: 'feat: branch1 child', hash: 'branch1Child' }),
      makeCommit({ subject: 'fix: shared child', hash: 'sharedChild' }),
      makeCommit({ subject: 'refactor: branch2 child', hash: 'branch2Child' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    expect(groups).toHaveLength(1);
    const childOccurrences = groups[0]!.childHashes.filter(
      (h) => h === 'sharedChild',
    );
    expect(childOccurrences).toHaveLength(1);
    expect(groups[0]!.childHashes).toContain('branch1Child');
    expect(groups[0]!.childHashes).toContain('sharedChild');
    expect(groups[0]!.childHashes).toContain('branch2Child');
  });

  it('keeps octopus merge children in exactly one group (no loss, no duplication)', () => {
    const resolver = fakeTopology(
      new Map([['octoMain', ['childA', 'childB']]]),
    );
    const commits: RawCommit[] = [
      makeCommit({
        subject: 'Merge pull request #100 from octopus',
        hash: 'octoMerge',
        isMerge: true,
        parents: ['octoMain', 'b1', 'b2'],
      }),
      makeCommit({ subject: 'feat: child A', hash: 'childA' }),
      makeCommit({ subject: 'fix: child B', hash: 'childB' }),
      makeCommit({ subject: 'feat: unrelated PR (#200)', hash: 'standalone' }),
    ];
    const groups = groupPrCommits(commits, resolver);
    expect(groups).toHaveLength(2);
    const octoGroup = groups.find(
      (g) => g.representative.hash === 'octoMerge',
    )!;
    expect(octoGroup.commits.map((c) => c.hash)).toContain('childA');
    expect(octoGroup.commits.map((c) => c.hash)).toContain('childB');
    const allHashes = groups.flatMap((g) => g.commits.map((c) => c.hash));
    expect(allHashes.filter((h) => h === 'childA')).toHaveLength(1);
    expect(allHashes.filter((h) => h === 'childB')).toHaveLength(1);
  });
});
