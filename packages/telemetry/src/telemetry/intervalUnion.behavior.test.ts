/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { IntervalUnion } from './intervalUnion.js';

/**
 * Independent brute-force merge of intervals, used only to cross-check the
 * incrementally maintained durationMs(). It re-derives the union from the raw
 * recorded adds rather than trusting the class under test.
 */
function bruteForceDuration(
  intervals: ReadonlyArray<readonly [number, number]>,
): number {
  const valid = intervals.filter(
    ([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s,
  );
  if (valid.length === 0) return 0;
  const sorted = [...valid].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = sorted[0][0];
  let curEnd = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] <= curEnd) {
      curEnd = Math.max(curEnd, sorted[i][1]);
    } else {
      total += curEnd - curStart;
      curStart = sorted[i][0];
      curEnd = sorted[i][1];
    }
  }
  total += curEnd - curStart;
  return total;
}

describe('IntervalUnion', () => {
  let u: IntervalUnion;

  beforeEach(() => {
    u = new IntervalUnion();
  });

  describe('empty state', () => {
    it('reports zero duration and zero count before any add', () => {
      expect(u.durationMs()).toBe(0);
      expect(u.count()).toBe(0);
      expect(u.latestEnd).toBe(0);
    });
  });

  describe('EVIDENCE-AC5a: disjoint intervals', () => {
    it('sums disjoint interval durations and grows count', () => {
      u.add(0, 10);
      u.add(20, 30);
      u.add(40, 50);
      expect(u.durationMs()).toBe(30);
      expect(u.count()).toBe(3);
    });

    it('keeps a gap between disjoint intervals uncounted', () => {
      u.add(0, 100);
      u.add(200, 300);
      expect(u.durationMs()).toBe(200);
    });
  });

  describe('overlapping intervals merge without double-counting', () => {
    it('counts the overlap once', () => {
      u.add(0, 1000);
      u.add(500, 1500);
      expect(u.durationMs()).toBe(1500);
      expect(u.count()).toBe(1);
    });

    it('collapses identical intervals to a single span', () => {
      u.add(0, 2000);
      u.add(0, 2000);
      expect(u.durationMs()).toBe(2000);
      expect(u.count()).toBe(1);
    });
  });

  describe('adjacent (touching) intervals merge', () => {
    it('merges [0,10) and [10,20) into a single 20ms span', () => {
      u.add(0, 10);
      u.add(10, 20);
      expect(u.durationMs()).toBe(20);
      expect(u.count()).toBe(1);
    });
  });

  describe('nested interval adds no duration', () => {
    it('an interval fully inside another changes nothing', () => {
      u.add(0, 100);
      expect(u.durationMs()).toBe(100);
      u.add(10, 20);
      expect(u.durationMs()).toBe(100);
      expect(u.count()).toBe(1);
    });

    it('a later larger interval absorbs earlier nested ones', () => {
      u.add(10, 20);
      u.add(30, 40);
      u.add(0, 100);
      expect(u.durationMs()).toBe(100);
      expect(u.count()).toBe(1);
    });
  });

  describe('incremental duration equals brute-force recompute', () => {
    it('matches an independent merge after each mixed insert', () => {
      const recorded: Array<[number, number]> = [];
      const pattern: ReadonlyArray<readonly [number, number]> = [
        [0, 10],
        [5, 15],
        [100, 110],
        [105, 200],
        [50, 60],
        [55, 58],
        [300, 310],
        [0, 400],
        [1000, 1010],
        [1005, 1020],
      ];
      for (const [s, e] of pattern) {
        u.add(s, e);
        recorded.push([s, e]);
        expect(u.durationMs()).toBe(bruteForceDuration(recorded));
      }
    });

    it('stays exact across 250 disjoint intervals', () => {
      const recorded: Array<[number, number]> = [];
      for (let i = 0; i < 250; i++) {
        const s = i * 20;
        u.add(s, s + 10);
        recorded.push([s, s + 10]);
      }
      expect(u.durationMs()).toBe(bruteForceDuration(recorded));
      expect(u.durationMs()).toBe(250 * 10);
    });

    it('stays exact with out-of-order overlapping inserts', () => {
      const recorded: Array<[number, number]> = [];
      const starts = [400, 10, 200, 5, 350, 100, 0, 250];
      for (const s of starts) {
        u.add(s, s + 50);
        recorded.push([s, s + 50]);
        expect(u.durationMs()).toBe(bruteForceDuration(recorded));
      }
    });
  });

  describe('union of two sets', () => {
    it('merges two unions into one', () => {
      const a = new IntervalUnion();
      a.add(0, 10);
      a.add(20, 30);
      const b = new IntervalUnion();
      b.add(5, 25);
      const merged = a.union(b);
      expect(merged.durationMs()).toBe(30);
      expect(merged.count()).toBe(1);
    });

    it('does not mutate the operands', () => {
      const a = new IntervalUnion();
      a.add(0, 10);
      const b = new IntervalUnion();
      b.add(100, 110);
      const merged = a.union(b);
      expect(merged.durationMs()).toBe(20);
      expect(a.durationMs()).toBe(10);
      expect(b.durationMs()).toBe(10);
    });

    it('handles empty operands', () => {
      const a = new IntervalUnion();
      const b = new IntervalUnion();
      b.add(0, 10);
      expect(a.union(b).durationMs()).toBe(10);
      expect(b.union(a).durationMs()).toBe(10);
      expect(a.union(new IntervalUnion()).durationMs()).toBe(0);
    });
  });

  describe('invalid, zero-length and degenerate intervals', () => {
    it('ignores zero-length intervals', () => {
      u.add(0, 0);
      expect(u.durationMs()).toBe(0);
      expect(u.count()).toBe(0);
    });

    it('ignores negative-length intervals', () => {
      u.add(10, 5);
      expect(u.durationMs()).toBe(0);
      expect(u.count()).toBe(0);
    });

    it('ignores non-finite endpoints', () => {
      u.add(Number.NaN, 10);
      u.add(0, Number.POSITIVE_INFINITY);
      u.add(Number.NEGATIVE_INFINITY, 10);
      expect(u.durationMs()).toBe(0);
      expect(u.count()).toBe(0);
    });

    it('leaves an existing union untouched when a degenerate add follows', () => {
      u.add(0, 10);
      u.add(5, 5);
      u.add(20, 10);
      u.add(Number.NaN, 100);
      expect(u.durationMs()).toBe(10);
      expect(u.count()).toBe(1);
    });
  });

  describe('latestEnd', () => {
    it('tracks the maximum end across intervals', () => {
      u.add(0, 10);
      expect(u.latestEnd).toBe(10);
      u.add(100, 200);
      expect(u.latestEnd).toBe(200);
      u.add(5, 15);
      expect(u.latestEnd).toBe(200);
    });
  });

  describe('clear', () => {
    it('resets duration and count to zero', () => {
      u.add(0, 10);
      u.add(20, 30);
      u.clear();
      expect(u.durationMs()).toBe(0);
      expect(u.count()).toBe(0);
      expect(u.latestEnd).toBe(0);
    });

    it('allows reuse after clear', () => {
      u.add(0, 10);
      u.clear();
      u.add(100, 110);
      expect(u.durationMs()).toBe(10);
      expect(u.count()).toBe(1);
    });
  });
});
