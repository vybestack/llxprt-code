/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Private, lightweight cleanup-state owner.
 *
 * Owns the cleanup registration queues and the reentrancy/concurrency guard.
 * This module has NO `@vybestack/llxprt-code-core`, React, ink, or
 * `cleanup.ts` imports, so importing it never transitively evaluates the
 * core barrel. The pure-node test base setup imports only the reset
 * operation from here, eliminating the core-barrel cost.
 *
 * State is managed via immutable reassignment: registration appends to a
 * new array assigned back to the module-level binding; draining clears by
 * reassigning to an empty array. No mutable arrays are exposed to callers.
 *
 * Draining semantics: callbacks appended during an active drain are picked
 * up by continuing to drain until the queue is empty. This preserves the
 * observable behavior of the original live-array `for...of` iteration.
 */

type CleanupFn = (() => void) | (() => Promise<void>);
type SyncCleanupFn = () => void;

interface CleanupState {
  readonly asyncFns: readonly CleanupFn[];
  readonly syncFns: readonly SyncCleanupFn[];
  readonly inProgress: boolean;
}

const EMPTY_ASYNC_FNS: readonly CleanupFn[] = [];
const EMPTY_SYNC_FNS: readonly SyncCleanupFn[] = [];

const EMPTY_STATE: CleanupState = {
  asyncFns: EMPTY_ASYNC_FNS,
  syncFns: EMPTY_SYNC_FNS,
  inProgress: false,
};

let state: CleanupState = EMPTY_STATE;

export function registerCleanupFn(fn: CleanupFn): void {
  state = { ...state, asyncFns: [...state.asyncFns, fn] };
}

export function registerSyncCleanupFn(fn: SyncCleanupFn): void {
  state = { ...state, syncFns: [...state.syncFns, fn] };
}

export function isCleanupInProgress(): boolean {
  return state.inProgress;
}

/** Mark cleanup as started, preventing reentrant/concurrent runs. */
export function beginCleanup(): void {
  state = { ...state, inProgress: true };
}

/**
 * Drain all pending synchronous callbacks in registration order until the
 * queue is empty (callbacks appended during draining are included).
 * Returns the drained callbacks. Each callback's errors are tolerated
 * exactly as before — the caller passes an error handler.
 */
export function drainSyncCleanups(
  onError: (fn: SyncCleanupFn, error: unknown) => void,
): void {
  while (state.syncFns.length > 0) {
    // Snapshot the current batch, then clear the queue so callbacks appended
    // during this batch form a new batch for the next loop iteration.
    const batch = state.syncFns;
    state = { ...state, syncFns: [] };
    for (const fn of batch) {
      try {
        fn();
      } catch (error) {
        onError(fn, error);
      }
    }
  }
}

/**
 * Drain all pending asynchronous callbacks in registration order until the
 * queue is empty (callbacks appended during draining are included).
 */
export async function drainAsyncCleanups(
  onError: (fn: CleanupFn, error: unknown) => void,
): Promise<void> {
  while (state.asyncFns.length > 0) {
    const batch = state.asyncFns;
    state = { ...state, asyncFns: [] };
    for (const fn of batch) {
      try {
        await fn();
      } catch (error) {
        onError(fn, error);
      }
    }
  }
}

/**
 * Reset cleanup state for testing purposes only.
 * Clears pending sync/async callbacks and returns the in-progress guard
 * to idle.
 * DO NOT use this in production code.
 * @internal
 */
export function __resetCleanupStateForTesting(): void {
  state = EMPTY_STATE;
}
