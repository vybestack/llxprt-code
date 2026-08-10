/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  computeBoundedDelta,
  boundSnapshot,
  boundSnapshotBytes,
  OVERLAP_SEARCH_BOUND,
  TERMINAL_DISCONTINUITY_NOTICE,
  MAX_RETAINED_SNAPSHOT_CHARS,
} from './terminalOutputDelta.js';

describe('computeBoundedDelta - bounded linear-time overlap (issue #3200 finding 6)', () => {
  it('returns clean delta for a monotonic append', () => {
    const result = computeBoundedDelta('hello', 'hello world', false);
    expect(result.delta).toBe(' world');
    expect(result.discontinuity).toBe(false);
  });

  it('returns the full current when previous is empty', () => {
    const result = computeBoundedDelta('', 'first output', false);
    expect(result.delta).toBe('first output');
    expect(result.discontinuity).toBe(false);
  });

  it('returns full current for a non-truncated reset', () => {
    const result = computeBoundedDelta('old content', 'new content', false);
    expect(result.delta).toBe('new content');
    expect(result.discontinuity).toBe(false);
  });

  it('recovers the overlap when the peer evicts the head (truncated)', () => {
    // The peer evicted "head-evicted-" from the beginning.
    const previous = 'head-evicted-kept-content';
    const current = 'kept-content' + ' more output';
    const result = computeBoundedDelta(previous, current, true);
    expect(result.delta).toBe(' more output');
    expect(result.discontinuity).toBe(true);
  });

  it('emits a discontinuity notice when no overlap is found within the bound', () => {
    // Completely different content, truncated flag set.
    const previous = 'a'.repeat(100);
    const current = 'b'.repeat(100);
    const result = computeBoundedDelta(previous, current, true);
    expect(result.discontinuity).toBe(true);
    expect(result.delta).toContain(TERMINAL_DISCONTINUITY_NOTICE);
  });

  it('does not replay the entire window when overlap is small', () => {
    const previous = 'AAAA' + 'z'.repeat(1000);
    const current = 'z' + 'B'.repeat(1000);
    const result = computeBoundedDelta(previous, current, true);
    // Only a 1-char overlap: the delta is the current minus the 1-char overlap.
    expect(result.delta).toBe('B'.repeat(1000));
    expect(result.discontinuity).toBe(true);
  });

  it('bounds the overlap search to OVERLAP_SEARCH_BOUND', () => {
    // previous and current share a long overlap (>BOUND), plus eviction.
    // The overlap exceeds the bound, so the search caps at k=BOUND and the
    // delta contains the remaining shared bytes plus the new tail.
    const extra = 5000;
    const shared = 'S'.repeat(OVERLAP_SEARCH_BOUND + extra);
    const evicted = 'EVICTED_HEAD_';
    const previous = evicted + shared;
    const current = shared + 'TAIL';
    const result = computeBoundedDelta(previous, current, true);
    // k = BOUND matches (the shared suffix/prefix). The delta is current minus
    // the first BOUND chars: the remaining `extra` shared S's + TAIL.
    expect(result.delta).toBe('S'.repeat(extra) + 'TAIL');
    expect(result.discontinuity).toBe(true);
  });

  it('handles disjoint content larger than both bounded search operands', () => {
    const previous = 'A'.repeat(OVERLAP_SEARCH_BOUND * 4);
    const current = 'B'.repeat(OVERLAP_SEARCH_BOUND * 4);

    const result = computeBoundedDelta(previous, current, true);

    expect(result.discontinuity).toBe(true);
    expect(result.delta).toContain(TERMINAL_DISCONTINUITY_NOTICE);
  });

  it('recovers the longest overlap for a fully-overlapping prefix (KMP correctness)', () => {
    // previous is a suffix of a repeated pattern; current is the same repeated
    // pattern continuing. Verifies the KMP matcher returns the FULL overlap
    // (not 0), which a naive backward scan would also find but a buggy reset
    // could lose.
    const previous = 'ababab';
    const current = 'ababab' + ' tail';
    const result = computeBoundedDelta(previous, current, true);
    expect(result.delta).toBe(' tail');
    expect(result.discontinuity).toBe(false);
  });

  it('recovers a repeated-pattern overlap ending mid-pattern (KMP fallback)', () => {
    // current begins with a suffix that is the tail of a repeated unit.
    const previous = 'xaxabx' + 'ababab';
    const current = 'abab' + 'ZZZ';
    const result = computeBoundedDelta(previous, current, true);
    // Longest suffix of previous = prefix of current: 'abab' (4).
    expect(result.delta).toBe('ZZZ');
    expect(result.discontinuity).toBe(true);
  });
});

describe('boundSnapshotBytes - configured byte-budget bounding (issue #3200 finding 4)', () => {
  it('returns the string unchanged when under the budget', () => {
    expect(boundSnapshotBytes('hello', 64)).toBe('hello');
  });

  it('keeps only the tail within the byte budget', () => {
    const big = 'A'.repeat(100);
    const bounded = boundSnapshotBytes(big, 40);
    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(40);
    expect(bounded).toBe('A'.repeat(40));
  });

  it('bounds by UTF-8 bytes, not chars, for multibyte content', () => {
    // Each char is 3 bytes in UTF-8. Budget 30 bytes -> retain 10 chars.
    const text = 'A'.repeat(5) + '\u4e16'.repeat(20);
    const bounded = boundSnapshotBytes(text, 30);
    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(30);
    // No replacement chars (no split multibyte sequence).
    expect(bounded).not.toContain('\uFFFD');
  });

  it('never splits a multibyte character at the start boundary', () => {
    // Budget lands inside a multibyte char; the start must advance to the next
    // character boundary.
    const text = '\u4e16'.repeat(10);
    const bounded = boundSnapshotBytes(text, 7);
    expect(bounded).not.toContain('\uFFFD');
    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(7);
  });

  it('returns empty for a nonpositive budget', () => {
    expect(boundSnapshotBytes('hello', 0)).toBe('');
    expect(boundSnapshotBytes('hello', -5)).toBe('');
  });
});

describe('boundSnapshot - retained polling state bounding (issue #3200 finding 4)', () => {
  it('returns the string unchanged when under the cap', () => {
    expect(boundSnapshot('hello')).toBe('hello');
  });

  it('keeps only the tail when over the cap', () => {
    const big = 'A'.repeat(MAX_RETAINED_SNAPSHOT_CHARS + 1000);
    const bounded = boundSnapshot(big);
    expect(bounded.length).toBe(MAX_RETAINED_SNAPSHOT_CHARS);
    expect(bounded.endsWith('A'.repeat(100))).toBe(true);
  });

  it('does not retain a low surrogate at the trim boundary', () => {
    const tail = 'A'.repeat(MAX_RETAINED_SNAPSHOT_CHARS - 1);
    const text = `P\uD83D\uDE00${tail}`;

    const bounded = boundSnapshot(text);

    expect(bounded).toBe(tail);
    expect(Buffer.from(bounded, 'utf8').toString('utf8')).not.toContain(
      '\uFFFD',
    );
  });
});
