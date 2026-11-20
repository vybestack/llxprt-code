/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { heapStats } from 'bun:jsc';
import {
  SessionRowVisits,
  SESSION_ROW_VISIT_CAPACITY,
} from './session-row-visits.js';

describe('realistic-session observation ownership', () => {
  for (const count of [64, 256]) {
    it(`counts ${count} selected rows once with a fixed binary backing`, () => {
      Bun.gc(true);
      const before = heapStats().objectTypeCounts;
      const retained =
        process.env.ISSUE854_VISITS_TRAP === 'retain'
          ? new Set<number>()
          : undefined;
      const visits = new SessionRowVisits(count);
      expect(visits.retainedBytes).toBe(4096);
      let observed = 0;
      for (let index = count - 1; index >= 0; index--) {
        retained?.add(index);
        if (visits.claim(index)) observed++;
      }
      for (let index = 0; index < count; index++)
        if (visits.claim(index)) observed++;
      expect(observed).toBe(count);
      expect(visits.count).toBe(count);
      expect(visits.retainedBytes).toBe(4096);
      Bun.gc(true);
      const after = heapStats().objectTypeCounts;
      expect(retained?.size).toBe(
        process.env.ISSUE854_VISITS_TRAP === 'retain' ? count : undefined,
      );
      expect((after['Set'] ?? 0) - (before['Set'] ?? 0)).toBeLessThanOrEqual(0);
      expect(
        (after['Uint8Array'] ?? 0) - (before['Uint8Array'] ?? 0),
      ).toBeLessThanOrEqual(1);
    });
  }

  it('tracks every realistic-session ordinal including stateful parent rows', () => {
    const visits = new SessionRowVisits(25_002);
    for (let index = 0; index < 25_002; index++) visits.claim(index);
    expect(visits.count).toBe(25_002);
    expect(visits.retainedBytes).toBe(4096);
    expect(visits.claim(25_001)).toBe(false);
  });

  it('fails before a corpus exceeds the fixed observation capacity', () => {
    expect(() => new SessionRowVisits(SESSION_ROW_VISIT_CAPACITY + 1)).toThrow(
      RangeError,
    );
    expect(() => new SessionRowVisits(-1)).toThrow(RangeError);
    expect(() => new SessionRowVisits(1.5)).toThrow(RangeError);
  });

  it('rejects ordinals outside the selection', () => {
    const visits = new SessionRowVisits(64);
    for (const index of [-1, 64, 1.5, Number.NaN])
      expect(() => visits.claim(index)).toThrow(RangeError);
    expect(visits.count).toBe(0);
  });
});
