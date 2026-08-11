/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Focused behavioral tests for BudgetTracker abort accounting (issue #3205).
 *
 * Exercises the real BudgetTracker directly (no mocks) to prove that an
 * already-aborted signal cannot increment observed/retained records and that
 * markAborted respects the authoritative signal it was constructed with.
 */

import { describe, it, expect } from 'bun:test';
import { BudgetTracker, resolveAnalysisBudget } from './budget.js';

describe('BudgetTracker abort accounting (issue #3205)', () => {
  it('tryRetainRecord does not increment records when the signal is already aborted', () => {
    const budget = resolveAnalysisBudget(5);
    const controller = new AbortController();
    controller.abort();
    const tracker = new BudgetTracker(budget, controller.signal);

    // The record budget is 5 and nothing has been retained yet, so without an
    // abort guard this would retain a record and return true.
    const retained = tracker.tryRetainRecord();

    expect(retained).toBe(false);
    expect(tracker.recordsObserved).toBe(0);
    expect(tracker.recordsRetained).toBe(0);
    // An already-aborted signal surfaces explicit partial metadata.
    expect(tracker.truncated).toBe(true);
    expect(tracker.partialReason).toBe('aborted');
    expect(tracker.countInexact).toBe(true);
  });

  it('tryRetainRecord retains records normally while the signal is not aborted', () => {
    const budget = resolveAnalysisBudget(5);
    const controller = new AbortController();
    const tracker = new BudgetTracker(budget, controller.signal);

    expect(tracker.tryRetainRecord()).toBe(true);
    expect(tracker.tryRetainRecord()).toBe(true);
    expect(tracker.recordsObserved).toBe(2);
    expect(tracker.recordsRetained).toBe(2);
    expect(tracker.truncated).toBe(false);
  });

  it('markAborted does not alter metadata when the signal is not aborted', () => {
    const budget = resolveAnalysisBudget(5);
    const controller = new AbortController();
    const tracker = new BudgetTracker(budget, controller.signal);

    // Retain a record so there is observable state to protect.
    tracker.tryRetainRecord();
    expect(tracker.truncated).toBe(false);

    // Calling markAborted on a non-aborted signal must be a no-op: the tracker
    // owns the authoritative signal and must not fabricate an abort.
    tracker.markAborted();

    expect(tracker.truncated).toBe(false);
    expect(tracker.partialReason).toBeUndefined();
    expect(tracker.countInexact).toBe(false);
    // Prior accounting is untouched.
    expect(tracker.recordsRetained).toBe(1);
  });

  it('markAborted marks partial metadata when the signal is actually aborted', () => {
    const budget = resolveAnalysisBudget(5);
    const controller = new AbortController();
    controller.abort();
    const tracker = new BudgetTracker(budget, controller.signal);

    tracker.markAborted();

    expect(tracker.truncated).toBe(true);
    expect(tracker.partialReason).toBe('aborted');
    expect(tracker.countInexact).toBe(true);
  });
});
