/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  selectDiffBase,
  nightlyCandidateNames,
  type TagInfo,
} from '../../release-notes/diff-selection.js';
import type { ReleaseMetadata } from '../../release-notes/types.js';

function tag(name: string, createdAt: number): TagInfo {
  return { name, createdAt };
}

describe('selectDiffBase', () => {
  it('selects the highest same-version nightly by createdAt when dates match', () => {
    const tags = [
      tag('v0.11.0-nightly.260714.zzzzzzz', 100),
      tag('v0.11.0-nightly.260714.aaaaaaa', 200),
      tag('v0.10.0', 50),
    ];
    // Same date 260714; aaaaaaa has later createdAt (200 > 100).
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.ccccccc', true)).toBe(
      'v0.11.0-nightly.260714.aaaaaaa',
    );
  });

  it('falls back to the latest older stable for a first nightly', () => {
    expect(
      selectDiffBase(
        [tag('v0.10.0', 100), tag('v0.9.0', 50)],
        'v0.11.0-nightly.260715.abc',
        true,
      ),
    ).toBe('v0.10.0');
  });

  it('excludes beta and rc tags from stable fallback', () => {
    expect(
      selectDiffBase(
        [
          tag('v0.10.0-beta.1', 300),
          tag('v0.10.0-rc.1', 200),
          tag('v0.9.0', 100),
        ],
        'v0.10.0',
        false,
      ),
    ).toBe('v0.9.0');
  });

  it('does not select a newer stable tag', () => {
    expect(
      selectDiffBase(
        [tag('v0.12.0', 300), tag('v0.10.0', 100)],
        'v0.11.0',
        false,
      ),
    ).toBe('v0.10.0');
  });

  it('returns null when no valid base exists', () => {
    expect(selectDiffBase([], 'v0.11.0', false)).toBeNull();
  });
});

describe('nightly predecessor (parsed date + createdAt chronology)', () => {
  it('selects by parsed date, not SHA lexical order', () => {
    // Nonmonotonic hashes: zzzzzzz created earlier than aaaaaaa (by createdAt).
    const tags = [
      tag('v0.11.0-nightly.260714.zzzzzzz', 100),
      tag('v0.11.0-nightly.260714.aaaaaaa', 200),
    ];
    // Same date 260714; aaaaaaa has later createdAt (200 > 100), so it wins.
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.ccccccc', true)).toBe(
      'v0.11.0-nightly.260714.aaaaaaa',
    );
  });

  it('selects the predecessor by parsed date even with nonmonotonic hashes', () => {
    // Date 260713 with SHA zzzzzzz (created at 100) is earlier than
    // date 260714 with SHA aaaaaaa (created at 50). Date wins over createdAt.
    const tags = [
      tag('v0.11.0-nightly.260713.zzzzzzz', 100),
      tag('v0.11.0-nightly.260714.aaaaaaa', 50),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.ccccccc', true)).toBe(
      'v0.11.0-nightly.260714.aaaaaaa',
    );
  });

  it('uses deterministic name tie-break when date and createdAt are equal', () => {
    const tags = [
      tag('v0.11.0-nightly.260714.bbb', 100),
      tag('v0.11.0-nightly.260714.aaa', 100),
      tag('v0.11.0-nightly.260714.ccc', 100),
    ];
    // Same date, same createdAt → lexicographic name tie-break (descending).
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.x', true)).toBe(
      'v0.11.0-nightly.260714.ccc',
    );
  });

  it('uses current tag timestamp when available for chronological comparison', () => {
    const tags = [
      tag('v0.11.0-nightly.260714.aaa', 200),
      tag('v0.11.0-nightly.260715.bbb', 100), // current tag
    ];
    // Current tag 260715.bbb has createdAt 100. The 260714.aaa tag (createdAt 200)
    // is older by date, so it's the predecessor.
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.bbb', true)).toBe(
      'v0.11.0-nightly.260714.aaa',
    );
  });

  it('is deterministic regardless of input order (shuffled)', () => {
    const tags = [
      tag('v0.11.0-nightly.260710.x', 300),
      tag('v0.11.0-nightly.260712.x', 100),
      tag('v0.11.0-nightly.260711.x', 200),
      tag('v0.11.0-nightly.260709.x', 400),
    ];
    const shuffled = [...tags].reverse();
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260713.x', true)).toBe(
      selectDiffBase(shuffled, 'v0.11.0-nightly.260713.x', true),
    );
  });

  it('handles equal timestamps deterministically', () => {
    const tags = [
      tag('v0.11.0-nightly.260710.aaa', 100),
      tag('v0.11.0-nightly.260711.bbb', 100),
      tag('v0.11.0-nightly.260709.ccc', 100),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260712.x', true)).toBe(
      'v0.11.0-nightly.260711.bbb',
    );
  });

  it('excludes the current nightly tag itself', () => {
    const tags = [
      tag('v0.11.0-nightly.260715.x', 500),
      tag('v0.11.0-nightly.260714.x', 200),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.x', true)).toBe(
      'v0.11.0-nightly.260714.x',
    );
  });

  it('excludes future nightly tags relative to current', () => {
    const tags = [
      tag('v0.11.0-nightly.260714.x', 100),
      tag('v0.11.0-nightly.260716.x', 300),
      tag('v0.11.0-nightly.260713.x', 200),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.x', true)).toBe(
      'v0.11.0-nightly.260714.x',
    );
  });

  it('falls back to latest older stable when no same-base nightly exists', () => {
    const tags = [tag('v0.10.0', 100), tag('v0.9.0', 50)];
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.abc', true)).toBe(
      'v0.10.0',
    );
  });

  it('falls back to latest older stable when nightlies are only future', () => {
    const tags = [tag('v0.10.0', 100), tag('v0.11.0-nightly.260716.x', 300)];
    expect(selectDiffBase(tags, 'v0.11.0-nightly.260715.x', true)).toBe(
      'v0.10.0',
    );
  });
});

describe('stable predecessor (semver-correct)', () => {
  it('selects the latest older stable excluding prereleases', () => {
    const tags = [
      tag('v0.9.0', 50),
      tag('v0.10.0', 100),
      tag('v0.11.0-beta.1', 200),
    ];
    expect(selectDiffBase(tags, 'v0.11.0', false)).toBe('v0.10.0');
  });

  it('excludes newer stable tags', () => {
    const tags = [tag('v0.10.0', 100), tag('v0.12.0', 300)];
    expect(selectDiffBase(tags, 'v0.11.0', false)).toBe('v0.10.0');
  });

  it('returns null when only prereleases exist below current', () => {
    const tags = [tag('v0.10.0-beta.1', 100), tag('v0.10.0-rc.1', 200)];
    expect(selectDiffBase(tags, 'v0.11.0', false)).toBeNull();
  });

  it('is deterministic regardless of input order', () => {
    const tags = [tag('v0.8.0', 50), tag('v0.10.0', 300), tag('v0.9.0', 200)];
    const shuffled = [...tags].reverse();
    expect(selectDiffBase(tags, 'v0.11.0', false)).toBe(
      selectDiffBase(shuffled, 'v0.11.0', false),
    );
  });
});

describe('prerelease predecessor (same-base, non-nightly)', () => {
  it('selects the previous alpha of the same base version', () => {
    const tags = [
      tag('v0.11.0-alpha.1', 100),
      tag('v0.11.0-alpha.2', 200),
      tag('v0.10.0', 50),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-alpha.2', false)).toBe(
      'v0.11.0-alpha.1',
    );
  });

  it('falls back to latest stable when no same-base prerelease exists', () => {
    const tags = [tag('v0.10.0', 50), tag('v0.11.0-alpha.1', 100)];
    expect(selectDiffBase(tags, 'v0.11.0-alpha.1', false)).toBe('v0.10.0');
  });

  it('falls back to latest stable when only newer prereleases exist', () => {
    const tags = [
      tag('v0.10.0', 50),
      tag('v0.11.0-alpha.3', 300),
      tag('v0.11.0-alpha.2', 200),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-alpha.1', false)).toBe('v0.10.0');
  });

  it('selects the previous beta of the same base version', () => {
    const tags = [
      tag('v0.11.0-beta.1', 100),
      tag('v0.11.0-beta.2', 200),
      tag('v0.10.0', 50),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-beta.2', false)).toBe(
      'v0.11.0-beta.1',
    );
  });

  it('selects the previous rc of the same base version', () => {
    const tags = [
      tag('v0.11.0-rc.1', 100),
      tag('v0.11.0-rc.2', 200),
      tag('v0.10.0', 50),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-rc.2', false)).toBe('v0.11.0-rc.1');
  });

  it('excludes prereleases from a different base version', () => {
    const tags = [
      tag('v0.10.0-alpha.1', 100),
      tag('v0.11.0-alpha.1', 200),
      tag('v0.10.0', 50),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-alpha.1', false)).toBe('v0.10.0');
  });

  it('excludes nightlies from prerelease candidates', () => {
    const tags = [
      tag('v0.11.0-nightly.260714.aaa', 100),
      tag('v0.11.0-alpha.2', 200),
      tag('v0.11.0-alpha.1', 150),
      tag('v0.10.0', 50),
    ];
    expect(selectDiffBase(tags, 'v0.11.0-alpha.2', false)).toBe(
      'v0.11.0-alpha.1',
    );
  });

  it('is deterministic regardless of input order', () => {
    const tags = [
      tag('v0.11.0-alpha.1', 100),
      tag('v0.11.0-alpha.3', 300),
      tag('v0.11.0-alpha.2', 200),
    ];
    const shuffled = [...tags].reverse();
    expect(selectDiffBase(tags, 'v0.11.0-alpha.4', false)).toBe(
      selectDiffBase(shuffled, 'v0.11.0-alpha.4', false),
    );
  });

  it('does not apply to stable (non-prerelease) current tags', () => {
    const tags = [
      tag('v0.10.0', 50),
      tag('v0.11.0-alpha.1', 100),
      tag('v0.11.0', 200),
    ];
    // Stable v0.11.0 uses latestStable, which excludes prereleases.
    expect(selectDiffBase(tags, 'v0.11.0', false)).toBe('v0.10.0');
  });
});

describe('nightlyCandidateNames', () => {
  it('returns same-base nightly tags excluding the current tag', () => {
    const tags = [
      tag('v0.11.0-nightly.260714.aaa', 100),
      tag('v0.11.0-nightly.260713.bbb', 200),
      tag('v0.10.0', 50),
      tag('v0.12.0-nightly.260715.ccc', 300),
    ];
    expect(nightlyCandidateNames(tags, 'v0.11.0-nightly.260715.ddd')).toContain(
      'v0.11.0-nightly.260714.aaa',
    );
    expect(nightlyCandidateNames(tags, 'v0.11.0-nightly.260715.ddd')).toContain(
      'v0.11.0-nightly.260713.bbb',
    );
  });

  it('excludes the current tag itself', () => {
    const tags = [tag('v0.11.0-nightly.260714.aaa', 100)];
    expect(nightlyCandidateNames(tags, 'v0.11.0-nightly.260714.aaa')).toEqual(
      [],
    );
  });

  it('excludes nightlies from a different base version', () => {
    const tags = [
      tag('v0.11.0-nightly.260714.aaa', 100),
      tag('v0.12.0-nightly.260714.bbb', 200),
    ];
    const candidates = nightlyCandidateNames(tags, 'v0.11.0-nightly.260715.x');
    expect(candidates).toContain('v0.11.0-nightly.260714.aaa');
    expect(candidates).not.toContain('v0.12.0-nightly.260714.bbb');
  });

  it('excludes stable tags', () => {
    const tags = [tag('v0.10.0', 50), tag('v0.11.0-nightly.260714.aaa', 100)];
    const candidates = nightlyCandidateNames(tags, 'v0.11.0-nightly.260715.x');
    expect(candidates).not.toContain('v0.10.0');
  });

  it('returns empty for a stable (non-nightly) current tag', () => {
    const tags = [tag('v0.10.0', 50), tag('v0.11.0-nightly.260714.aaa', 100)];
    expect(nightlyCandidateNames(tags, 'v0.11.0')).toEqual([]);
  });

  it('returns empty when no same-base nightlies exist', () => {
    const tags = [tag('v0.10.0', 50), tag('v0.12.0-nightly.260715.aaa', 100)];
    expect(nightlyCandidateNames(tags, 'v0.11.0-nightly.260715.bbb')).toEqual(
      [],
    );
  });

  it('excludes chronologically future nightly candidates', () => {
    // Current tag is 260715. Tags 260716 and 260717 are future — they
    // must NOT appear in the candidate list at all.
    const tags = [
      tag('v0.11.0-nightly.260714.aaa', 100),
      tag('v0.11.0-nightly.260716.bbb', 200),
      tag('v0.11.0-nightly.260717.ccc', 300),
      tag('v0.11.0-nightly.260710.ddd', 400),
    ];
    const candidates = nightlyCandidateNames(tags, 'v0.11.0-nightly.260715.x');
    expect(candidates).toContain('v0.11.0-nightly.260714.aaa');
    expect(candidates).toContain('v0.11.0-nightly.260710.ddd');
    expect(candidates).not.toContain('v0.11.0-nightly.260716.bbb');
    expect(candidates).not.toContain('v0.11.0-nightly.260717.ccc');
  });

  it('keeps same-date candidates (same-day predecessors)', () => {
    // Same-date tags with earlier createdAt are valid predecessors.
    const tags = [
      tag('v0.11.0-nightly.260714.aaa', 50),
      tag('v0.11.0-nightly.260714.bbb', 100),
    ];
    const candidates = nightlyCandidateNames(tags, 'v0.11.0-nightly.260715.x');
    expect(candidates).toContain('v0.11.0-nightly.260714.aaa');
    expect(candidates).toContain('v0.11.0-nightly.260714.bbb');
  });

  it('never selects a chronologically future nightly as predecessor (261015 → 261049)', () => {
    // Reproduces the exact scenario from the issue: current nightly is
    // 261015 and there is a future 261049 tag. 261049 must never be
    // selected as the predecessor.
    const tags = [
      tag('v0.11.0-nightly.261015.abc', 10_000),
      tag('v0.11.0-nightly.261049.xyz', 20_000),
      tag('v0.11.0-nightly.261014.def', 9000),
    ];
    const result = selectDiffBase(tags, 'v0.11.0-nightly.261015.abc', true);
    expect(result).not.toBe('v0.11.0-nightly.261049.xyz');
    expect(result).toBe('v0.11.0-nightly.261014.def');
    // Also verify nightlyCandidateNames excludes the future tag so it
    // never gets queried for metadata.
    expect(
      nightlyCandidateNames(tags, 'v0.11.0-nightly.261015.abc'),
    ).not.toContain('v0.11.0-nightly.261049.xyz');
  });
});

describe('release metadata selection', () => {
  const published = (publishedAt: number): ReleaseMetadata => ({
    status: 'published',
    publishedAt,
  });

  it('orders published candidates deterministically on timestamp ties', () => {
    const current = 'v0.11.0-nightly.260715.current';
    const lookup = (): ReleaseMetadata => published(100);
    const tags = [
      tag('v0.11.0-nightly.260714.aaa', 20),
      tag('v0.11.0-nightly.260714.ccc', 10),
      tag('v0.11.0-nightly.260714.bbb', 30),
      tag(current, 40),
    ];

    expect(selectDiffBase(tags, current, true, lookup)).toBe(
      'v0.11.0-nightly.260714.ccc',
    );
  });

  it('is deterministic regardless of metadata-enabled input order', () => {
    const current = 'v0.11.0-nightly.260715.current';
    const lookup = (candidate: string): ReleaseMetadata => ({
      status: 'published',
      publishedAt: candidate.endsWith('.aaa') ? 200 : 300,
    });
    const tags = [
      tag('v0.11.0-nightly.260714.aaa', 20),
      tag('v0.11.0-nightly.260713.bbb', 30),
      tag(current, 40),
    ];

    expect(selectDiffBase(tags, current, true, lookup)).toBe(
      selectDiffBase([...tags].reverse(), current, true, lookup),
    );
  });

  it('fails when nightly publication metadata is unknown', () => {
    const current = 'v0.11.0-nightly.260715.current';
    const tags = [
      tag('v0.10.0', 10),
      tag('v0.11.0-nightly.260714.failed', 20),
      tag(current, 30),
    ];
    const lookup = (): ReleaseMetadata => ({ status: 'unknown' });

    expect(() => selectDiffBase(tags, current, true, lookup)).toThrow(
      'Unable to determine the previous published nightly release',
    );
  });
});
