/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  classifyCommit,
  classifyEnrichedRefs,
  isEligibleForHighlights,
  shouldDemoteFromProminent,
  deriveEffectiveCategory,
  INTERNAL_LABELS,
  PROMOTING_LABELS,
} from '../../release-notes/classification.js';
import type { RawCommit, EnrichedRef } from '../../release-notes/types.js';

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
    title: 'Some issue',
    body: '',
    labels: [],
    labelsTruncated: false,
    author: 'someone',
    isPr: false,
    userImpact: null,
    ...overrides,
  };
}

describe('classifyCommit', () => {
  it('classifies feat: as new', () => {
    expect(
      classifyCommit(makeCommit({ subject: 'feat: add Gemini support' })),
    ).toBe('new');
  });

  it('classifies fix: as fix', () => {
    expect(classifyCommit(makeCommit({ subject: 'fix: resolve crash' }))).toBe(
      'fix',
    );
  });

  it('classifies perf: as improvement', () => {
    expect(
      classifyCommit(makeCommit({ subject: 'perf: faster startup' })),
    ).toBe('improvement');
  });

  it('classifies refactor: as internal', () => {
    expect(
      classifyCommit(makeCommit({ subject: 'refactor: clean up utils' })),
    ).toBe('internal');
  });

  it('classifies test: as internal', () => {
    expect(
      classifyCommit(makeCommit({ subject: 'test: add unit tests' })),
    ).toBe('internal');
  });

  it('classifies chore: as internal', () => {
    expect(classifyCommit(makeCommit({ subject: 'chore: update deps' }))).toBe(
      'internal',
    );
  });

  it('classifies docs: as improvement when user-facing', () => {
    expect(
      classifyCommit(makeCommit({ subject: 'docs: update getting started' })),
    ).toBe('improvement');
  });

  it('classifies BREAKING as breaking', () => {
    expect(
      classifyCommit(makeCommit({ subject: 'feat!: remove deprecated API' })),
    ).toBe('breaking');
  });

  it('classifies BREAKING CHANGE footer as breaking', () => {
    expect(
      classifyCommit(
        makeCommit({
          subject: 'refactor: API overhaul\n\nBREAKING CHANGE: old API removed',
        }),
      ),
    ).toBe('breaking');
  });

  it('defaults unknown prefixes to improvement', () => {
    expect(classifyCommit(makeCommit({ subject: 'misc: whatever' }))).toBe(
      'improvement',
    );
  });
});

describe('INTERNAL_LABELS', () => {
  it('includes the canonical composite internal label', () => {
    expect(INTERNAL_LABELS.has('code quality / modularization')).toBe(true);
  });
});

describe('PROMOTING_LABELS', () => {
  it('includes Provider Support', () => {
    expect(PROMOTING_LABELS.has('provider support')).toBe(true);
  });

  it('includes Tooling', () => {
    expect(PROMOTING_LABELS.has('tooling')).toBe(true);
  });

  it('includes configuration', () => {
    expect(PROMOTING_LABELS.has('configuration')).toBe(true);
  });
});

describe('isEligibleForHighlights', () => {
  it('returns false when enriched has an internal label', () => {
    const enriched = [makeEnriched({ labels: ['Code Quality'] })];
    expect(isEligibleForHighlights('new', enriched)).toBe(false);
  });

  it('returns false for internal category commits', () => {
    expect(isEligibleForHighlights('internal', [])).toBe(false);
  });

  it('returns true for new feature with no internal labels', () => {
    expect(isEligibleForHighlights('new', [])).toBe(true);
  });

  it('returns true for fix with no internal labels', () => {
    expect(isEligibleForHighlights('fix', [])).toBe(true);
  });

  it('returns true for breaking change with no internal labels', () => {
    expect(isEligibleForHighlights('breaking', [])).toBe(true);
  });

  it('returns true when enriched has a promoting label', () => {
    const enriched = [makeEnriched({ labels: ['Provider Support'] })];
    expect(isEligibleForHighlights('improvement', enriched)).toBe(true);
  });

  it('internal label overrides promoting label', () => {
    const enriched = [
      makeEnriched({ labels: ['Provider Support', 'Modularization'] }),
    ];
    expect(isEligibleForHighlights('new', enriched)).toBe(false);
  });
});

describe('promoting-label semantics', () => {
  it('promotes an internal-category commit to eligible when tagged feature', () => {
    const enriched = [makeEnriched({ labels: ['feature'] })];
    expect(isEligibleForHighlights('internal', enriched)).toBe(true);
  });

  it('promotes an internal-category commit to eligible when tagged bug', () => {
    const enriched = [makeEnriched({ labels: ['bug'] })];
    expect(isEligibleForHighlights('internal', enriched)).toBe(true);
  });

  it('promotes an internal-category commit to eligible when tagged enhancement', () => {
    const enriched = [makeEnriched({ labels: ['enhancement'] })];
    expect(isEligibleForHighlights('internal', enriched)).toBe(true);
  });

  it('promotes an internal-category commit to eligible when tagged ux', () => {
    const enriched = [makeEnriched({ labels: ['ux'] })];
    expect(isEligibleForHighlights('internal', enriched)).toBe(true);
  });

  it('promotes an internal-category commit to eligible when tagged ui', () => {
    const enriched = [makeEnriched({ labels: ['ui'] })];
    expect(isEligibleForHighlights('internal', enriched)).toBe(true);
  });

  it('promotes an internal-category commit to eligible when tagged performance', () => {
    const enriched = [makeEnriched({ labels: ['performance'] })];
    expect(isEligibleForHighlights('internal', enriched)).toBe(true);
  });

  it('internal label always wins over promoting label regardless of order', () => {
    expect(
      isEligibleForHighlights('new', [
        makeEnriched({ labels: ['tech-debt', 'feature'] }),
      ]),
    ).toBe(false);
    expect(
      isEligibleForHighlights('new', [
        makeEnriched({ labels: ['feature', 'tech-debt'] }),
      ]),
    ).toBe(false);
  });

  it('internal label wins over promoting label even across multiple refs', () => {
    const enriched = [
      makeEnriched({ number: 1, labels: ['feature'] }),
      makeEnriched({ number: 2, labels: ['refactor'] }),
    ];
    expect(isEligibleForHighlights('new', enriched)).toBe(false);
  });

  it('does not demote when only promoting labels are present', () => {
    const enriched = [makeEnriched({ labels: ['enhancement', 'ux'] })];
    expect(shouldDemoteFromProminent(enriched)).toBe(false);
  });

  it('internal label demotes even when a promoting label is present', () => {
    const enriched = [makeEnriched({ labels: ['feature', 'cleanup'] })];
    expect(shouldDemoteFromProminent(enriched)).toBe(true);
  });

  it('case-insensitive: Feature and FEATURE both promote', () => {
    expect(
      isEligibleForHighlights('internal', [
        makeEnriched({ labels: ['Feature'] }),
      ]),
    ).toBe(true);
    expect(
      isEligibleForHighlights('internal', [
        makeEnriched({ labels: ['FEATURE'] }),
      ]),
    ).toBe(true);
  });
});

describe('shouldDemoteFromProminent', () => {
  it('demotes a feat commit with an internal label', () => {
    const enriched = [makeEnriched({ labels: ['Code Quality'] })];
    expect(shouldDemoteFromProminent(enriched)).toBe(true);
  });

  it('demotes a fix commit with an internal label', () => {
    const enriched = [makeEnriched({ labels: ['tech-debt'] })];
    expect(shouldDemoteFromProminent(enriched)).toBe(true);
  });

  it('does not demote when no internal labels are present', () => {
    const enriched = [makeEnriched({ labels: ['bug'] })];
    expect(shouldDemoteFromProminent(enriched)).toBe(false);
  });

  it('demotes when any enriched ref has an internal label', () => {
    const enriched = [
      makeEnriched({ number: 1, labels: ['feature'] }),
      makeEnriched({ number: 2, labels: ['refactor'] }),
    ];
    expect(shouldDemoteFromProminent(enriched)).toBe(true);
  });

  it('does not demote with only promoting labels', () => {
    const enriched = [makeEnriched({ labels: ['enhancement', 'ux'] })];
    expect(shouldDemoteFromProminent(enriched)).toBe(false);
  });
});

describe('deriveEffectiveCategory', () => {
  it('returns the original category when no labels are present', () => {
    expect(deriveEffectiveCategory('new', [])).toBe('new');
    expect(deriveEffectiveCategory('fix', [])).toBe('fix');
    expect(deriveEffectiveCategory('improvement', [])).toBe('improvement');
    expect(deriveEffectiveCategory('internal', [])).toBe('internal');
  });

  it('internal label overrides any commit-prefix category', () => {
    expect(
      deriveEffectiveCategory('new', [makeEnriched({ labels: ['tech-debt'] })]),
    ).toBe('internal');
    expect(
      deriveEffectiveCategory('fix', [makeEnriched({ labels: ['refactor'] })]),
    ).toBe('internal');
    expect(
      deriveEffectiveCategory('breaking', [
        makeEnriched({ labels: ['cleanup'] }),
      ]),
    ).toBe('internal');
  });

  it('internal label wins over promoting label in effective category', () => {
    const enriched = [makeEnriched({ labels: ['feature', 'tech-debt'] })];
    expect(deriveEffectiveCategory('new', enriched)).toBe('internal');
    expect(deriveEffectiveCategory('internal', enriched)).toBe('internal');
  });

  it('promoting label bug promotes internal to fix', () => {
    expect(
      deriveEffectiveCategory('internal', [makeEnriched({ labels: ['bug'] })]),
    ).toBe('fix');
  });

  it('promoting label fix promotes internal to fix', () => {
    expect(
      deriveEffectiveCategory('internal', [makeEnriched({ labels: ['fix'] })]),
    ).toBe('fix');
  });

  it('promoting label feature promotes internal to new', () => {
    expect(
      deriveEffectiveCategory('internal', [
        makeEnriched({ labels: ['feature'] }),
      ]),
    ).toBe('new');
  });

  it('promoting label enhancement promotes internal to new', () => {
    expect(
      deriveEffectiveCategory('internal', [
        makeEnriched({ labels: ['enhancement'] }),
      ]),
    ).toBe('new');
  });

  it('promoting label provider support promotes internal to new', () => {
    expect(
      deriveEffectiveCategory('internal', [
        makeEnriched({ labels: ['provider support'] }),
      ]),
    ).toBe('new');
  });

  it('promoting label ux promotes internal to improvement', () => {
    expect(
      deriveEffectiveCategory('internal', [makeEnriched({ labels: ['ux'] })]),
    ).toBe('improvement');
  });

  it('promoting label ui promotes internal to improvement', () => {
    expect(
      deriveEffectiveCategory('internal', [makeEnriched({ labels: ['ui'] })]),
    ).toBe('improvement');
  });

  it('promoting label performance promotes internal to improvement', () => {
    expect(
      deriveEffectiveCategory('internal', [
        makeEnriched({ labels: ['performance'] }),
      ]),
    ).toBe('improvement');
  });

  it('promoting label does not demote a higher-signal category', () => {
    // A feat commit with a 'bug' promoting label stays 'new', not 'fix',
    // because the prefix category 'new' is more specific than the bug
    // promoting label which would push to 'fix'. The original category
    // is preserved when the promoting label would lower the category.
    expect(
      deriveEffectiveCategory('new', [makeEnriched({ labels: ['bug'] })]),
    ).toBe('new');
  });

  it('internal label precedence overrides promoting label across multiple refs', () => {
    const enriched = [
      makeEnriched({ number: 1, labels: ['feature'] }),
      makeEnriched({ number: 2, labels: ['refactor'] }),
    ];
    expect(deriveEffectiveCategory('internal', enriched)).toBe('internal');
  });

  it('bug promoting label takes precedence over feature in same ref', () => {
    // When a single ref carries both 'bug' and 'feature', the fix tier
    // (bug) wins over the new tier (feature) for the effective category
    // from an internal-prefix commit.
    const enriched = [makeEnriched({ labels: ['bug', 'feature'] })];
    expect(deriveEffectiveCategory('internal', enriched)).toBe('fix');
  });

  it('case-insensitive: Bug and BUG both promote to fix', () => {
    expect(
      deriveEffectiveCategory('internal', [makeEnriched({ labels: ['Bug'] })]),
    ).toBe('fix');
    expect(
      deriveEffectiveCategory('internal', [makeEnriched({ labels: ['BUG'] })]),
    ).toBe('fix');
  });
});

describe('classifyEnrichedRefs internal-label precedence', () => {
  it('keeps internal labels authoritative over titles and promoting labels', () => {
    const enriched = [
      makeEnriched({
        title: 'feat: add visible capability',
        labels: ['feature', 'internal'],
      }),
    ];

    expect(classifyEnrichedRefs(enriched)).toBe('internal');
  });
});

describe('unavailable metadata', () => {
  const unavailable = makeEnriched({
    title: 'feat: add visible capability',
    labels: ['feature'],
    metadataAvailable: false,
  });

  it('is excluded from highlights', () => {
    expect(isEligibleForHighlights('new', [unavailable])).toBe(false);
  });

  it('is demoted from prominent categories', () => {
    expect(shouldDemoteFromProminent([unavailable])).toBe(true);
    expect(deriveEffectiveCategory('new', [unavailable])).toBe('internal');
    expect(classifyEnrichedRefs([unavailable])).toBe('internal');
  });
});

describe('realistic label truncation with 100 nodes and totalCount 150', () => {
  // Simulates a real PR/issue with 150 labels where the GraphQL
  // labels(first:100) connection returns only the first 100 nodes and
  // totalCount=150. The gh-port layer sets labelsTruncated=true to signal
  // that unfetched label pages may contain internal labels we cannot see.

  function makeTruncatedRef(): EnrichedRef {
    return makeEnriched({
      labels: Array.from({ length: 100 }, (_, i) => `label-${i}`),
      labelsTruncated: true,
    });
  }

  it('classifies a truncated-label entry as internal regardless of prefix', () => {
    // Even a feat: commit with truncated labels is conservatively demoted
    // to internal, because an unseen internal label may exist on page 2+.
    expect(deriveEffectiveCategory('new', [makeTruncatedRef()])).toBe(
      'internal',
    );
  });

  it('renders a truncated-label entry as ineligible for highlights', () => {
    expect(isEligibleForHighlights('new', [makeTruncatedRef()])).toBe(false);
  });

  it('demotes a truncated-label entry from prominent categories', () => {
    expect(shouldDemoteFromProminent([makeTruncatedRef()])).toBe(true);
  });

  it('does not demote when labels are not truncated even with many labels', () => {
    // 100 labels with totalCount=100 means no truncation — classification
    // proceeds normally based on the visible labels.
    const ref = makeEnriched({
      labels: Array.from({ length: 100 }, (_, i) => `label-${i}`),
      labelsTruncated: false,
    });
    expect(shouldDemoteFromProminent([ref])).toBe(false);
    expect(isEligibleForHighlights('new', [ref])).toBe(true);
  });
});

describe('classifyEnrichedRefs', () => {
  it('preserves a feature title when a lower-ranked UX label is present', () => {
    const enriched = [
      makeEnriched({ title: 'feat: add visual configuration', labels: ['ux'] }),
    ];

    expect(classifyEnrichedRefs(enriched)).toBe('new');
  });

  it('keeps the owning PR category ahead of a related issue title', () => {
    const enriched = [
      makeEnriched({ title: 'fix: restore profile loading' }),
      makeEnriched({ number: 2, title: 'feat: support saved profiles' }),
    ];

    expect(classifyEnrichedRefs(enriched)).toBe('fix');
  });

  it('does not let related issue labels recategorize the owning PR', () => {
    const enriched = [
      makeEnriched({ title: 'fix: restore profile loading' }),
      makeEnriched({
        number: 2,
        title: 'Profile loading fails',
        labels: ['feature'],
      }),
    ];

    expect(classifyEnrichedRefs(enriched)).toBe('fix');
  });
});

describe('deriveEffectiveCategory ownership scoping', () => {
  it('does not let a related ref promoting label recategorize the owning PR', () => {
    // Owning PR #1 is internal (no labels); related issue #2 carries a
    // 'feature' label. The owning PR must remain internal — the related
    // ref's promoting label must not positively recategorize it.
    const enriched = [
      makeEnriched({ number: 1, labels: [] }),
      makeEnriched({ number: 2, labels: ['feature'] }),
    ];
    expect(deriveEffectiveCategory('internal', enriched)).toBe('internal');
  });

  it('does not let a related ref bug label promote the owning PR', () => {
    const enriched = [
      makeEnriched({ number: 1, labels: [] }),
      makeEnriched({ number: 2, labels: ['bug'] }),
    ];
    expect(deriveEffectiveCategory('internal', enriched)).toBe('internal');
  });

  it('still promotes when the owning/first ref carries the promoting label', () => {
    const enriched = [
      makeEnriched({ number: 1, labels: ['feature'] }),
      makeEnriched({ number: 2, labels: [] }),
    ];
    expect(deriveEffectiveCategory('internal', enriched)).toBe('new');
  });

  it('retains conservative internal-label demotion across all refs', () => {
    // Owning PR #1 carries no internal label, but related issue #2 carries
    // 'refactor'. The internal-label demotion applies across all enriched
    // refs, so the owning PR is still demoted to internal.
    const enriched = [
      makeEnriched({ number: 1, labels: ['feature'] }),
      makeEnriched({ number: 2, labels: ['refactor'] }),
    ];
    expect(deriveEffectiveCategory('new', enriched)).toBe('internal');
  });

  it('owning promoting label wins over related internal label for eligibility edge', () => {
    // Internal label on related ref still demotes — ownership scoping only
    // restricts positive promotion, not conservative demotion.
    const enriched = [
      makeEnriched({ number: 1, labels: ['bug'] }),
      makeEnriched({ number: 2, labels: ['tech-debt'] }),
    ];
    expect(deriveEffectiveCategory('internal', enriched)).toBe('internal');
  });
});
