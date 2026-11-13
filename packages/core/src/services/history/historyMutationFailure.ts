/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { PreparedHistoryBatchEffect } from './HistoryServiceCore.js';

export type MutationFailure =
  | { failed: false }
  | { failed: true; error: unknown };

export type QueuedHistoryMutation =
  | { kind: 'synchronous'; execute: () => void }
  | {
      kind: 'asynchronous';
      execute: () => Promise<void>;
      resolve: () => void;
      reject: (error: unknown) => void;
    };

export function combineMutationFailures(
  primary: MutationFailure,
  queued: MutationFailure,
): MutationFailure {
  if (!primary.failed) return queued;
  if (!queued.failed) return primary;
  return {
    failed: true,
    error: new AggregateError(
      [primary.error, queued.error],
      'Multiple history mutations failed',
    ),
  };
}

/**
 * Runs the prepared effects' finalizers in order and stops at the first
 * failure. A finalizer is an effect's commit step, so none may run once an
 * earlier one failed: the mutation is about to be rolled back, and only
 * effects that never finalized can still be rolled back cleanly.
 *
 * A cancelled `signal` is honored immediately before each finalizer, so the
 * last finalizer (the caller-owned effect that holds the commit point) never
 * starts for a request that was already cancelled. Nothing is checked after
 * it: once it succeeds the mutation is committed.
 */
export async function finalizeMutationEffects(
  effects: readonly PreparedHistoryBatchEffect[],
  signal?: AbortSignal,
): Promise<void> {
  for (const effect of effects) {
    signal?.throwIfAborted();
    await effect.finalize?.();
  }
}

/**
 * Runs the cleanup of a mutation that has committed. Every effect settles
 * even if an earlier one failed; the failures are returned for the caller to
 * log, because nothing may be undone after the commit point.
 */
export async function settleMutationEffects(
  effects: readonly PreparedHistoryBatchEffect[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const effect of effects) {
    try {
      await effect.settle?.();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  return failures;
}

/**
 * Rolls prepared effects back in reverse order and returns the failures, so
 * one failing rollback cannot stop the others.
 */
export async function rollbackMutationEffects(
  effects: readonly PreparedHistoryBatchEffect[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const effect of [...effects].reverse()) {
    try {
      await effect.rollback();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  return failures;
}

/**
 * Announces a mutation outcome to observers. A failing observer must not
 * replace the outcome being announced (a committed replacement, or the failure
 * that caused a reversion), so its failure is logged instead.
 */
export function notifyObservers(
  logger: { debug(message: string, detail: unknown): void },
  event: string,
  notify: () => void,
): void {
  try {
    notify();
  } catch (error: unknown) {
    logger.debug(`${event} listener failed`, error);
  }
}

/**
 * Rolls every effect back after a failed mutation and throws the failure that
 * caused it, together with any rollback failures.
 */
export async function rollbackAndRethrow(
  effects: readonly PreparedHistoryBatchEffect[],
  error: unknown,
): Promise<never> {
  const rollbackFailures = await rollbackMutationEffects(effects);
  if (rollbackFailures.length === 0) throw error;
  throw new AggregateError(
    [error, ...rollbackFailures],
    'History mutation and rollback failed',
  );
}
