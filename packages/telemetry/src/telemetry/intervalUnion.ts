/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

interface Interval {
  start: number;
  end: number;
}

/**
 * Incrementally maintained, sorted, non-overlapping interval list.
 *
 * Each insertion is O(n) worst-case (binary-search position + neighbour
 * merge). The total covered duration is maintained incrementally so
 * durationMs() is O(1): add() adjusts the cached total by the net change of
 * the merge only, never re-walking every interval. This replaces the
 * previously private quadratic implementation that recomputed the full
 * duration on every insert.
 *
 * Merge semantics (preserved from the original private implementation):
 * - touching (adjacent) intervals merge, e.g. [0,10) + [10,20) => [0,20)
 * - overlapping intervals merge, counting the overlap once
 * - an interval fully nested inside another adds no duration
 * - gaps are never bridged
 * - degenerate (end <= start), zero-length and non-finite intervals are ignored
 */
class IntervalUnion {
  private readonly intervals: Interval[] = [];
  private cachedDurationMs = 0;

  add(start: number, end: number): void {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    if (end <= start) return;

    const list = this.intervals;

    if (list.length === 0) {
      list.push({ start, end });
      this.cachedDurationMs += end - start;
      return;
    }

    // Binary search: first index whose start >= `start`.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start < start) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    let from = lo;
    let mergedStart = start;
    let mergedEnd = end;

    // Left neighbour overlaps or is adjacent (touching merges).
    if (lo > 0 && list[lo - 1].end >= start) {
      from = lo - 1;
      mergedStart = list[from].start;
      mergedEnd = Math.max(list[from].end, end);
    }

    // Absorb every interval forward that overlaps or touches the merge.
    let to = from;
    while (to < list.length && list[to].start <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, list[to].end);
      to++;
    }

    if (from === to) {
      // No overlap: pure insert, the full span is net-new.
      list.splice(lo, 0, { start, end });
      this.cachedDurationMs += end - start;
      return;
    }

    // Replace [from, to) with the merged span, adjusting the cached
    // duration by the net change (merged span - sum of removed spans).
    let removedDuration = 0;
    for (let k = from; k < to; k++) {
      removedDuration += list[k].end - list[k].start;
    }
    list.splice(from, to - from, { start: mergedStart, end: mergedEnd });
    this.cachedDurationMs += mergedEnd - mergedStart - removedDuration;
  }

  durationMs(): number {
    return this.cachedDurationMs;
  }

  count(): number {
    return this.intervals.length;
  }

  get latestEnd(): number {
    return this.intervals[this.intervals.length - 1]?.end ?? 0;
  }

  union(other: IntervalUnion): IntervalUnion {
    const result = new IntervalUnion();
    for (const iv of this.intervals) {
      result.add(iv.start, iv.end);
    }
    for (const iv of other.intervals) {
      result.add(iv.start, iv.end);
    }
    return result;
  }

  clear(): void {
    this.intervals.length = 0;
    this.cachedDurationMs = 0;
  }
}

export { IntervalUnion };
