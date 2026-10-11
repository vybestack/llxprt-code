/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useSyncExternalStore } from 'react';

/**
 * Registry of the slash-command actions that are currently in flight
 * (issue #2976).
 *
 * A slash-command action is awaited inline by `processSlashCommand`, so before
 * this registry existed there was nothing for the Esc handler to cancel.
 *
 * Every in-flight action is held, not just the most recent one. The same issue
 * keeps the input prompt live while a command runs, so the user can submit a
 * second command before the first finishes; a single slot would let the short
 * command's completion evict the long one and leave it uncancellable, which is
 * the exact bug being fixed.
 */
export interface SlashCommandCancellation {
  /** Registers a new in-flight action and returns its controller. */
  beginSlashCommandAction: (showProgress?: boolean) => AbortController;
  /** Deregisters an action once it has settled. */
  endSlashCommandAction: (controller: AbortController) => void;
  /** Aborts every in-flight action. Returns true iff any was aborted. */
  cancelActiveSlashCommand: () => boolean;
}

export interface SlashCommandProgressRegistry extends SlashCommandCancellation {
  subscribe: (listener: () => void) => () => void;
  getIsSlashCommandRunning: () => boolean;
}

export function createSlashCommandCancellation(): SlashCommandProgressRegistry {
  const inFlight = new Map<AbortController, boolean>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getIsSlashCommandRunning: () =>
      [...inFlight].some(
        ([controller, showProgress]) =>
          showProgress && !controller.signal.aborted,
      ),
    beginSlashCommandAction: (showProgress = false) => {
      const controller = new AbortController();
      inFlight.set(controller, showProgress);
      controller.signal.addEventListener('abort', notify, { once: true });
      notify();
      return controller;
    },
    // Keep aborted entries until finally so cancellation remains idempotent
    // even while an action is unwinding. They no longer count as busy.
    endSlashCommandAction: (controller) => {
      controller.signal.removeEventListener('abort', notify);
      inFlight.delete(controller);
      notify();
    },
    cancelActiveSlashCommand: () => {
      let cancelled = false;
      for (const controller of inFlight.keys()) {
        if (controller.signal.aborted) continue;
        controller.abort();
        cancelled = true;
      }
      return cancelled;
    },
  };
}

export function useSlashCommandCancellation(): SlashCommandCancellation & {
  isSlashCommandRunning: boolean;
} {
  const registry = useMemo(() => createSlashCommandCancellation(), []);
  const isSlashCommandRunning = useSyncExternalStore(
    registry.subscribe,
    registry.getIsSlashCommandRunning,
    registry.getIsSlashCommandRunning,
  );
  return useMemo(
    () => ({ ...registry, isSlashCommandRunning }),
    [registry, isSlashCommandRunning],
  );
}
