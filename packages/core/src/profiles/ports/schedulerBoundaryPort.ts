/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Outcome of a held safe boundary.
 *
 * `committed` carries the value `fn` produced inside the held window; `cancelled`
 * means the window could not be held (the abort signal fired or the safe point never
 * arrived) and `fn` never ran. Once `fn` starts, its value must be returned even if
 * cancellation occurs during execution; `fn` owns checking cancellation before swap.
 */
export type SafeBoundaryOutcome<T> =
  | { status: 'committed'; value: T }
  | { status: 'cancelled' };

/**
 * Holds a span in which no work is mid-flight for the calling agent, across the whole
 * execution of `fn`.
 *
 * `safe` here means no model, tool, or continuation work is in-flight for the calling
 * agent. A parent turn awaiting a subagent still blocks itself: the parent is itself
 * in-flight until the subagent returns. The implementation MUST hold that safe window
 * across `fn`'s entire execution — no new work may start between the window opening
 * and `fn` completing — so a commit that rechecks and swaps inside `fn` can never race
 * work that starts after the window opens. Resolves `{ status: 'committed', value }`
 * with `fn`'s value when the window was held, or `{ status: 'cancelled' }` when the
 * abort signal fires first or the window cannot be held; `fn` is not invoked on
 * cancellation.
 *
 * The coordinator-backed implementation lands with the #2640 cutover.
 */
export interface SchedulerBoundaryPort {
  withSafeBoundary<T>(
    fn: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<SafeBoundaryOutcome<T>>;
}
