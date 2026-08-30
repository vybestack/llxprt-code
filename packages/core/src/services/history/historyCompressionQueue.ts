/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type MutationFailure,
  combineMutationFailures,
} from './historyMutationFailure.js';

/**
 * Whether an operation queued while compression held the history lock came from
 * streaming content (`add`) or a compression rebuild (`clear`).
 */
export type CompressionOperationKind = 'add' | 'clear';

/**
 * FIFO queue of operations that arrived while compression held the history lock.
 *
 * Flushing is two-phase, partitioned at the FIRST rebuild `clear`: everything
 * from that clear onward runs first (the rebuild phase), then a single
 * `betweenPhases` callback runs, then the operations queued before it run (the
 * streaming phase). This guarantees (#3264) that a rebuild clear never destroys
 * streaming content queued before it: that content is re-applied after the
 * rebuild, and its `contentAdded` fires after `compressionLockReleased`, so
 * recording captures it and replay can recover it. When no clear is queued the
 * rebuild phase is empty and everything runs in streaming order, preserving plain
 * FIFO.
 *
 * The never-drop guarantee covers EVERY phase of the flush. Every unit — each
 * rebuild operation, the `betweenPhases` callback, and each streaming
 * operation — is attempted under its own failure capture, mirroring how
 * `runSynchronousHistoryMutation` treats synchronous mutation batches: failures are
 * combined with `combineMutationFailures` and rethrown only after all units
 * have been attempted (first failure wins; multiple failures become an
 * `AggregateError`). A throwing listener (e.g. a `tokensUpdated` listener
 * inside the rebuild clear's emit) therefore cannot abort the flush before
 * `compressionLockReleased`/`compressionEnded` fire or before the streaming
 * slice runs, and a thrown `undefined` propagates truthfully rather than being
 * swallowed by an `undefined`-keyed sentinel.
 *
 * Operations are never dropped and never rejected (#2852): `add()` is on the
 * streaming path, so failing there would lose conversation content and could break a
 * turn. Crossing the high-water mark is reported once per lock cycle so an
 * unbalanced lock would be diagnosable rather than silent (#2852); both
 * `flush()` and `clear()` re-arm that one-shot diagnostic.
 */
export class CompressionOperationQueue {
  private static readonly DEFAULT_HIGH_WATER = 4096;

  private operations: Array<{
    kind: CompressionOperationKind;
    execute: () => void;
  }> = [];

  private highWaterReported = false;

  constructor(
    private readonly onHighWater: (pendingCount: number) => void,
    private readonly highWater: number = CompressionOperationQueue.DEFAULT_HIGH_WATER,
  ) {}

  get length(): number {
    return this.operations.length;
  }

  enqueue(operation: () => void, kind: CompressionOperationKind): void {
    this.operations.push({ kind, execute: operation });
    if (!this.highWaterReported && this.operations.length >= this.highWater) {
      this.highWaterReported = true;
      this.onHighWater(this.operations.length);
    }
  }

  clear(): void {
    this.operations = [];
    this.highWaterReported = false;
  }

  flush(betweenPhases: () => void): void {
    const operations = this.operations;
    this.operations = [];
    this.highWaterReported = false;

    const firstClearIndex = operations.findIndex(
      (operation) => operation.kind === 'clear',
    );
    const rebuildOperations =
      firstClearIndex === -1 ? [] : operations.slice(firstClearIndex);
    const streamingOperations =
      firstClearIndex === -1
        ? operations
        : operations.slice(0, firstClearIndex);

    let failure: MutationFailure = { failed: false };

    for (const operation of rebuildOperations) {
      try {
        operation.execute();
      } catch (error: unknown) {
        failure = combineMutationFailures(failure, { failed: true, error });
      }
    }

    try {
      betweenPhases();
    } catch (error: unknown) {
      failure = combineMutationFailures(failure, { failed: true, error });
    }

    for (const operation of streamingOperations) {
      try {
        operation.execute();
      } catch (error: unknown) {
        failure = combineMutationFailures(failure, { failed: true, error });
      }
    }

    // Thrown only after every unit has been attempted, so a listener failure cannot
    // discard queued content or suppress the release events (#3264). No sentinel
    // keys off `undefined`, so a thrown `undefined` is rethrown truthfully.
    if (failure.failed) throw failure.error;
  }
}
