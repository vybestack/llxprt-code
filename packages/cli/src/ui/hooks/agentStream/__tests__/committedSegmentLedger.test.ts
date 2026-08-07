/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for CommittedSegmentLedger — the per-stream ledger that tracks
 * static history item ids committed for the in-flight assistant attempt, so a
 * discard-and-restart (issue #3048) can retract exactly those ids.
 *
 * @plan PLAN-20260806-ISSUE3048.P09
 * @requirement REQ-3048-009
 */

import { describe, it, expect } from 'bun:test';
import { CommittedSegmentLedger } from '../committedSegmentLedger.js';

describe('CommittedSegmentLedger', () => {
  it('starts empty before any assistant message begins', () => {
    const ledger = new CommittedSegmentLedger();
    expect(ledger.ids).toStrictEqual([]);
    expect(ledger.drain()).toStrictEqual([]);
  });

  it('records ids appended during an assistant message', () => {
    const ledger = new CommittedSegmentLedger();
    ledger.begin();
    ledger.record(1);
    ledger.record(2);
    expect(ledger.ids).toStrictEqual([1, 2]);
  });

  it('drain returns the recorded ids and clears them', () => {
    const ledger = new CommittedSegmentLedger();
    ledger.begin();
    ledger.record(5);
    ledger.record(7);
    expect(ledger.drain()).toStrictEqual([5, 7]);
    expect(ledger.ids).toStrictEqual([]);
  });

  it('a second drain returns an empty list so a retry cannot re-remove ids', () => {
    const ledger = new CommittedSegmentLedger();
    ledger.begin();
    ledger.record(11);
    ledger.drain();
    expect(ledger.drain()).toStrictEqual([]);
  });

  it('begin drops ids from a previous assistant message', () => {
    const ledger = new CommittedSegmentLedger();
    ledger.begin();
    ledger.record(1);
    ledger.record(2);
    ledger.begin();
    expect(ledger.ids).toStrictEqual([]);
  });

  it('exposes ids as a read-only view', () => {
    const ledger = new CommittedSegmentLedger();
    ledger.begin();
    ledger.record(3);
    const snapshot = ledger.ids;
    expect(snapshot).toStrictEqual([3]);
    ledger.record(4);
    expect(ledger.ids).toStrictEqual([3, 4]);
  });

  /**
   * @requirement REQ-3048-009 (review finding: ledger lifecycle)
   * @scenario A normally-completed assistant message ends the ledger so its
   *   committed ids become permanent and cannot be retracted by a later turn.
   */
  it('end clears recorded ids without retracting them', () => {
    const ledger = new CommittedSegmentLedger();
    ledger.begin();
    ledger.record(9);
    ledger.record(10);
    ledger.end();
    expect(ledger.ids).toStrictEqual([]);
    // After end, a drain (the retry path) returns nothing: the ids are gone,
    // not retracted.
    expect(ledger.drain()).toStrictEqual([]);
  });

  it('end bounds the ledger to a single message lifecycle', () => {
    const ledger = new CommittedSegmentLedger();
    // First message: committed ids, then completed.
    ledger.begin();
    ledger.record(1);
    ledger.end();
    // A later message begins; its ids are tracked independently.
    ledger.begin();
    ledger.record(2);
    expect(ledger.drain()).toStrictEqual([2]);
  });
});
