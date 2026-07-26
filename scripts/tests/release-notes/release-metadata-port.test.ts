/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  createBoundedReleaseMetadataLookup,
  createReleaseMetadataPort,
  createStaticReleaseMetadataPort,
  MAX_NIGHTLY_CANDIDATES,
  parseReleaseMetadata,
} from '../../release-notes/release-metadata-port.js';
import {
  nightlyCandidateNames,
  selectDiffBase,
  type TagInfo,
} from '../../release-notes/diff-selection.js';
import type { ReleaseMetadata } from '../../release-notes/types.js';

const published = (publishedAt: number): ReleaseMetadata => ({
  status: 'published',
  publishedAt,
});
const absent: ReleaseMetadata = { status: 'confirmed-absent' };
const unknown: ReleaseMetadata = { status: 'unknown' };

function tag(name: string, createdAt: number): TagInfo {
  return { name, createdAt };
}

describe('parseReleaseMetadata', () => {
  it('models a valid publication timestamp as published', () => {
    expect(
      parseReleaseMetadata(
        JSON.stringify({ publishedAt: '2025-07-14T00:00:00Z' }),
      ),
    ).toEqual(published(Date.parse('2025-07-14T00:00:00Z')));
  });

  it('models an explicit null publication as confirmed absent', () => {
    expect(parseReleaseMetadata(JSON.stringify({ publishedAt: null }))).toEqual(
      absent,
    );
  });

  it.each([
    ['missing field', JSON.stringify({})],
    ['invalid JSON', 'not json'],
    ['null response', 'null'],
    ['invalid timestamp', JSON.stringify({ publishedAt: 'not-a-date' })],
  ])('models %s as unknown', (_label, raw) => {
    expect(parseReleaseMetadata(raw)).toEqual(unknown);
  });
});

describe('ReleaseMetadataPort', () => {
  it('preserves explicit static states and treats unmapped tags as unknown', async () => {
    const port = createStaticReleaseMetadataPort(
      new Map([
        ['published', published(1000)],
        ['absent', absent],
      ]),
    );

    expect(await port.getReleaseMetadata('published')).toEqual(published(1000));
    expect(await port.getReleaseMetadata('absent')).toEqual(absent);
    expect(await port.getReleaseMetadata('unmapped')).toEqual(unknown);
  });

  it('models runner failures as unknown rather than absent', async () => {
    const port = createReleaseMetadataPort(() => {
      throw new Error('network failure');
    });

    expect(await port.getReleaseMetadata('v1.0.0')).toEqual(unknown);
  });

  it('passes the tag name to the isolated gh runner', async () => {
    const calls: string[][] = [];
    const port = createReleaseMetadataPort((args) => {
      calls.push([...args]);
      return JSON.stringify([
        { tagName: 'v2.0.0', publishedAt: '2025-01-01T00:00:00Z' },
      ]);
    });

    await port.getReleaseMetadata('v2.0.0');

    expect(calls).toEqual([
      ['release', 'list', '--limit', '1000', '--json', 'tagName,publishedAt'],
    ]);
  });
});

describe('createBoundedReleaseMetadataLookup', () => {
  it('returns undefined when there are no candidates', async () => {
    const lookup = await createBoundedReleaseMetadataLookup(
      createStaticReleaseMetadataPort(new Map()),
      [],
    );

    expect(lookup).toBeUndefined();
  });

  it('retains unknown for overflow instead of mixing tag chronology into selection', async () => {
    const candidates = Array.from(
      { length: MAX_NIGHTLY_CANDIDATES + 10 },
      (_, index) => `v0.11.0-nightly.261${String(index).padStart(3, '0')}.x`,
    );
    const metadata = new Map<string, ReleaseMetadata>(
      candidates.map((candidate, index) => [candidate, published(index)]),
    );
    const lookup = await createBoundedReleaseMetadataLookup(
      createStaticReleaseMetadataPort(metadata),
      candidates,
    );

    expect(lookup?.(candidates[0]!)).toEqual(published(0));
    expect(lookup?.(candidates[MAX_NIGHTLY_CANDIDATES]!)).toEqual(unknown);
  });

  it('loads release metadata once for all bounded candidates', async () => {
    let calls = 0;
    const port = createReleaseMetadataPort(() => {
      calls++;
      return JSON.stringify([
        { tagName: 'candidate-75', publishedAt: '2025-01-01T00:00:00Z' },
      ]);
    });
    const candidates = Array.from(
      { length: 120 },
      (_, index) => `candidate-${index}`,
    );

    const lookup = await createBoundedReleaseMetadataLookup(port, candidates);

    expect(calls).toBe(1);
    expect(lookup?.('candidate-75')).toEqual(published(1735689600000));
  });

  it('retains a successful retry for the first candidate', async () => {
    const results = [unknown, published(123), unknown];
    let calls = 0;
    const lookup = await createBoundedReleaseMetadataLookup(
      {
        async getReleaseMetadata() {
          return results[calls++] ?? unknown;
        },
      },
      ['candidate'],
    );

    expect(calls).toBe(2);
    expect(lookup?.('candidate')).toEqual(published(123));
  });
});

describe('bounded nightly publication selection', () => {
  it('uses publication order rather than tag date or creation time', () => {
    const current = 'v0.11.0-nightly.260715.current';
    const olderDate = 'v0.11.0-nightly.260713.older';
    const newerDate = 'v0.11.0-nightly.260714.newer';
    const tags = [tag(olderDate, 200), tag(newerDate, 300), tag(current, 400)];
    const lookup = (candidate: string): ReleaseMetadata =>
      candidate === olderDate ? published(900) : published(800);

    expect(selectDiffBase(tags, current, true, lookup)).toBe(olderDate);
  });

  it('never selects a tag confirmed to have no release', () => {
    const current = 'v0.11.0-nightly.260715.current';
    const absentTag = 'v0.11.0-nightly.260714.absent';
    const publishedTag = 'v0.11.0-nightly.260713.published';
    const lookup = (candidate: string): ReleaseMetadata =>
      candidate === absentTag ? absent : published(100);

    expect(
      selectDiffBase(
        [tag(absentTag, 900), tag(publishedTag, 100), tag(current, 1000)],
        current,
        true,
        lookup,
      ),
    ).toBe(publishedTag);
  });

  it('fails closed when any candidate metadata lookup fails', () => {
    const current = 'v0.11.0-nightly.260715.current';
    const failedTag = 'v0.11.0-nightly.260714.failed';
    const publishedTag = 'v0.11.0-nightly.260713.published';
    const lookup = (candidate: string): ReleaseMetadata =>
      candidate === failedTag ? unknown : published(100);

    expect(() =>
      selectDiffBase(
        [tag(failedTag, 900), tag(publishedTag, 100), tag(current, 1000)],
        current,
        true,
        lookup,
      ),
    ).toThrow('Unable to determine the previous published nightly release');
  });

  it('cannot select or chronology-mix an overflow tag beyond the lookup bound', async () => {
    const current = 'v0.11.0-nightly.261070.current';
    const tags = Array.from({ length: 60 }, (_, index) => {
      const day = index + 10;
      return tag(`v0.11.0-nightly.2610${day}.candidate-${day}`, day * 1000);
    });
    const candidates = nightlyCandidateNames(
      [...tags, tag(current, 70_000)],
      current,
    );
    const selected = candidates[10]!;
    const overflow = candidates[MAX_NIGHTLY_CANDIDATES]!;
    const metadata = new Map<string, ReleaseMetadata>(
      candidates.map((candidate) => [candidate, published(1)]),
    );
    metadata.set(selected, published(500));
    metadata.set(overflow, published(10_000));
    const lookup = await createBoundedReleaseMetadataLookup(
      createStaticReleaseMetadataPort(metadata),
      candidates,
    );

    expect(
      selectDiffBase([...tags, tag(current, 70_000)], current, true, lookup),
    ).toBe(selected);
  });
});
