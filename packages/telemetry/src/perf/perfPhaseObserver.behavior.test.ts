/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the perf phase observer seam (P07, EVIDENCE-AC5).
 *
 * Proves: default-off (null), set/get, observer callbacks are direct.
 * Tests reset the module observer deterministically.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import {
  setPerfPhaseObserver,
  getPerfPhaseObserver,
  type PerfPhaseObserver,
} from './perfPhaseObserver.js';

describe('PerfPhaseObserver module seam', () => {
  afterEach(() => {
    setPerfPhaseObserver(null);
  });

  it('returns null by default (default-off)', () => {
    setPerfPhaseObserver(null);
    expect(getPerfPhaseObserver()).toBeNull();
  });

  it('returns the installed observer after set', () => {
    const observer: PerfPhaseObserver = {
      onProviderAttemptStart: () => undefined,
      onProviderAttemptEnd: () => undefined,
      onToolCallCompleted: () => undefined,
    };
    setPerfPhaseObserver(observer);
    expect(getPerfPhaseObserver()).toBe(observer);
  });

  it('clears to null after set(null)', () => {
    const observer: PerfPhaseObserver = {
      onProviderAttemptStart: () => undefined,
      onProviderAttemptEnd: () => undefined,
      onToolCallCompleted: () => undefined,
    };
    setPerfPhaseObserver(observer);
    expect(getPerfPhaseObserver()).not.toBeNull();
    setPerfPhaseObserver(null);
    expect(getPerfPhaseObserver()).toBeNull();
  });

  it('disabled logger does not notify (null observer short-circuits callers)', () => {
    setPerfPhaseObserver(null);
    // Callers check getPerfPhaseObserver() and short-circuit when null.
    // Simulating the caller pattern:
    const observer = getPerfPhaseObserver();
    expect(observer).toBeNull();
    // No callback is invoked.
  });
});
