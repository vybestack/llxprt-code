/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type MutationFailure,
  combineMutationFailures,
} from './historyMutationFailure.js';

/** The phase in which a compression-queued operation must run. */
export type CompressionOperationKind = 'rebuild' | 'streaming';

/**
 * FIFO queue of operations that arrived while compression held the history lock.
 *
 * Explicitly tagged rebuild operations run first, followed by `betweenPhases`,
 * then streaming operations. FIFO is preserved within each phase (#3264, #3338).
 *
 * Every operation and `betweenPhases` is attempted under its own failure capture.
 * Failures are combined and thrown after the complete flush, including a thrown
 * `undefined`. The first failure wins unless multiple failures produce an
 * `AggregateError`. Operations are never dropped (#2852).
 *
 * Crossing the high-water mark is reported once per lock cycle. Both `flush()`
 * and `clear()` re-arm that diagnostic.
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

    const rebuildOperations = operations.filter(
      (operation) => operation.kind === 'rebuild',
    );
    const streamingOperations = operations.filter(
      (operation) => operation.kind === 'streaming',
    );

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
    // discard queued content or suppress the release events (#3264). A thrown
    // `undefined` is rethrown truthfully rather than swallowed by a sentinel.
    if (failure.failed) throw failure.error;
  }
}
