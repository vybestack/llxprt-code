/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the in-flight slash-command registry. Real
 * AbortControllers are used throughout, so aborting actually flips
 * signal.aborted rather than merely recording a call.
 */

import { describe, it, expect } from 'bun:test';
import { createSlashCommandCancellation } from './useSlashCommandCancellation.js';

describe('slash-command cancellation registry', () => {
  it('reports nothing to cancel before any action starts', () => {
    const registry = createSlashCommandCancellation();

    expect(registry.cancelActiveSlashCommand()).toBe(false);
  });

  it('aborts the registered controller and reports that it did so', () => {
    const registry = createSlashCommandCancellation();

    const controller = registry.beginSlashCommandAction();

    expect(controller.signal.aborted).toBe(false);
    expect(registry.cancelActiveSlashCommand()).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it('reports nothing to cancel on a second attempt at the same action', () => {
    const registry = createSlashCommandCancellation();

    registry.beginSlashCommandAction();

    expect(registry.cancelActiveSlashCommand()).toBe(true);
    expect(registry.cancelActiveSlashCommand()).toBe(false);
  });

  it('reports nothing to cancel once the action has settled', () => {
    const registry = createSlashCommandCancellation();

    const controller = registry.beginSlashCommandAction();
    registry.endSlashCommandAction(controller);

    expect(registry.cancelActiveSlashCommand()).toBe(false);
    expect(controller.signal.aborted).toBe(false);
  });

  it('registers a fresh, non-aborted controller for each action', () => {
    const registry = createSlashCommandCancellation();

    const first = registry.beginSlashCommandAction();
    const second = registry.beginSlashCommandAction();

    expect(first.signal.aborted).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(first.signal).not.toBe(second.signal);
  });

  it('cancels every concurrently running action, not just the newest', () => {
    // The prompt stays live during a command, so a second command can be
    // submitted while a long one runs. Tracking only the newest would let the
    // short command evict the long one and leave it uncancellable — the exact
    // bug this whole change is fixing.
    const registry = createSlashCommandCancellation();

    const longRunning = registry.beginSlashCommandAction();
    const shortLived = registry.beginSlashCommandAction();

    expect(registry.cancelActiveSlashCommand()).toBe(true);
    expect(longRunning.signal.aborted).toBe(true);
    expect(shortLived.signal.aborted).toBe(true);
  });

  it('keeps the long-running action cancellable after a short one finishes', () => {
    const registry = createSlashCommandCancellation();

    const longRunning = registry.beginSlashCommandAction();
    const shortLived = registry.beginSlashCommandAction();
    registry.endSlashCommandAction(shortLived);

    expect(registry.cancelActiveSlashCommand()).toBe(true);
    expect(longRunning.signal.aborted).toBe(true);
    expect(shortLived.signal.aborted).toBe(false);
  });

  it('leaves a cancelled action registered until it actually unwinds', () => {
    const registry = createSlashCommandCancellation();

    const controller = registry.beginSlashCommandAction();
    registry.cancelActiveSlashCommand();
    const later = registry.beginSlashCommandAction();

    // The still-unwinding action must not be re-aborted, but the new one must.
    expect(registry.cancelActiveSlashCommand()).toBe(true);
    expect(later.signal.aborted).toBe(true);
    registry.endSlashCommandAction(controller);
    registry.endSlashCommandAction(later);
    expect(registry.cancelActiveSlashCommand()).toBe(false);
  });
});
