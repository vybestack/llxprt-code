/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';

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
  beginSlashCommandAction: () => AbortController;
  /** Deregisters an action once it has settled. */
  endSlashCommandAction: (controller: AbortController) => void;
  /** Aborts every in-flight action. Returns true iff any was aborted. */
  cancelActiveSlashCommand: () => boolean;
}

export function createSlashCommandCancellation(): SlashCommandCancellation {
  const inFlight = new Set<AbortController>();
  return {
    beginSlashCommandAction: () => {
      const controller = new AbortController();
      inFlight.add(controller);
      return controller;
    },
    // Deregistration is the caller's `finally`; cancellation deliberately
    // leaves the entry in place so an aborted action that is still unwinding
    // is not mistaken for a new one.
    endSlashCommandAction: (controller) => {
      inFlight.delete(controller);
    },
    cancelActiveSlashCommand: () => {
      let cancelled = false;
      for (const controller of inFlight) {
        if (controller.signal.aborted) continue;
        controller.abort();
        cancelled = true;
      }
      return cancelled;
    },
  };
}

export function useSlashCommandCancellation(): SlashCommandCancellation {
  return useMemo(() => createSlashCommandCancellation(), []);
}
