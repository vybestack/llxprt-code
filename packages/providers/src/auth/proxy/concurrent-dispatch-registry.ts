/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Per-connection registry of in-flight operations. Tracks each dispatched
 * request so that host-side work can be aborted when the socket closes,
 * preventing orphaned processes.
 *
 * @plan PLAN-20260731-GHBROKER.P03
 * @requirement REQ-005
 * @pseudocode 001-concurrent-dispatch.md lines 1-6, 23-38
 */

/** A single in-flight operation entry in the pending registry. */
export interface InFlightOp {
  /** Operation name for audit-log correlation. */
  op: string;
  /** Epoch milliseconds when the op was registered. */
  startedAt: number;
  /** AbortController to cancel host-side work on socket close. */
  abort: AbortController;
}

/** Maximum concurrent in-flight operations per connection. */
export const MAX_CONCURRENT_PER_CONNECTION = 16;

/**
 * Manages the per-connection pending-operation registry. Encapsulates
 * duplicate-id detection, concurrency enforcement, and abort-on-close.
 *
 * @plan PLAN-20260731-GHBROKER.P03
 * @requirement REQ-005
 * @pseudocode 001-concurrent-dispatch.md lines 23-38
 */
export class ConcurrentDispatchRegistry {
  private readonly pending: Map<string, InFlightOp> = new Map();

  /** Number of currently in-flight operations. */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Checks dispatch guards. Returns an error code if the request must be
   * rejected, or null if dispatch may proceed.
   *
   * @returns `{ code, message }` on rejection, or `null` to allow dispatch.
   *
   * @plan PLAN-20260731-GHBROKER.P03
   * @pseudocode 001-concurrent-dispatch.md lines 24-38
   */
  checkGuards(id: string): { code: string; message: string } | null {
    if (this.pending.has(id))
      return { code: 'INVALID_REQUEST', message: 'Duplicate request id' };
    if (this.pending.size >= MAX_CONCURRENT_PER_CONNECTION)
      return {
        code: 'RESOURCE_EXHAUSTED',
        message: 'Too many concurrent requests',
      };
    return null;
  }

  /**
   * Registers an operation before dispatch. The AbortSignal from the
   * returned AbortController should be passed to the handler.
   *
   * @plan PLAN-20260731-GHBROKER.P03
   * @pseudocode 001-concurrent-dispatch.md lines 27-28
   */
  register(id: string, op: string): AbortController {
    const controller = new AbortController();
    this.pending.set(id, { op, startedAt: Date.now(), abort: controller });
    return controller;
  }

  /** Removes an operation from the registry after dispatch completes. */
  release(id: string): void {
    this.pending.delete(id);
  }

  /**
   * Retrieves an in-flight operation by id, or undefined if none. Used by
   * the cancel handler to find the target AbortController.
   *
   * @plan PLAN-20260731-GHBROKER.P05
   * @requirement REQ-007
   * @pseudocode 002-frame-and-cancel.md lines 44-53
   */
  get(id: string): InFlightOp | undefined {
    return this.pending.get(id);
  }

  /**
   * Aborts every in-flight operation and clears the registry. Called on
   * socket close/error so no host-side work is orphaned.
   *
   * @plan PLAN-20260731-GHBROKER.P03
   * @pseudocode 001-concurrent-dispatch.md lines 3-6
   */
  abortAll(): void {
    for (const entry of this.pending.values()) entry.abort.abort();
    this.pending.clear();
  }
}
