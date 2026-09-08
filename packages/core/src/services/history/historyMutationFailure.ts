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
 * Runs every prepared effect's finalizer, collecting failures so one bad
 * finalizer cannot hide the others.
 */
export async function finalizeMutationEffects(
  effects: readonly PreparedHistoryBatchEffect[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const effect of effects) {
    if (effect.finalize === undefined) continue;
    try {
      await effect.finalize();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'History mutation finalization failed');
  }
}
