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

/**
 * @plan PLAN-20260917-ISSUE854.P05b3
 *
 * The history mutation FIFO, extracted from HistoryServiceCore (file size
 * budget; behavior unchanged). Every history mutation funnels through this
 * queue so a synchronous mutation never interleaves with an asynchronous
 * one: synchronous closures queued while a mutation is in flight drain
 * before the in-flight mutation is allowed to complete, and the combined
 * failure is reported to its owner.
 */

import {
  type MutationFailure,
  combineMutationFailures,
} from './historyMutationFailure.js';
import type { QueuedHistoryMutation } from './historyBatchContracts.js';

export class HistoryMutationFifo {
  private inProgress = false;
  private queue: QueuedHistoryMutation[] = [];

  runSynchronous(execute: () => void): void {
    if (this.inProgress) {
      this.queue.push({ kind: 'synchronous', execute });
      return;
    }

    this.inProgress = true;
    let failure: MutationFailure = { failed: false };
    try {
      execute();
    } catch (error: unknown) {
      failure = { failed: true, error };
    }
    const queuedFailure = this.drainSynchronous();
    this.inProgress = false;
    this.processQueue();

    const combinedFailure = combineMutationFailures(failure, queuedFailure);
    if (combinedFailure.failed) throw combinedFailure.error;
  }

  private drainSynchronous(): MutationFailure {
    let failure: MutationFailure = { failed: false };
    while (this.queue[0]?.kind === 'synchronous') {
      const mutation = this.queue.shift();
      if (mutation?.kind !== 'synchronous') break;
      try {
        mutation.execute();
      } catch (error: unknown) {
        failure = combineMutationFailures(failure, { failed: true, error });
      }
    }
    return failure;
  }

  enqueueAsynchronous(execute: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        kind: 'asynchronous',
        execute,
        resolve,
        reject,
      });
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.inProgress) return;
    const mutation = this.queue.shift();
    if (mutation === undefined) return;
    if (mutation.kind === 'synchronous') {
      this.runSynchronous(mutation.execute);
      return;
    }

    this.inProgress = true;
    void mutation.execute().then(
      () => this.completeAsynchronous(mutation, { failed: false }),
      (error: unknown) =>
        this.completeAsynchronous(mutation, {
          failed: true,
          error,
        }),
    );
  }

  private completeAsynchronous(
    mutation: Extract<QueuedHistoryMutation, { kind: 'asynchronous' }>,
    failure: MutationFailure,
  ): void {
    const queuedFailure = this.drainSynchronous();
    this.inProgress = false;
    const result = combineMutationFailures(failure, queuedFailure);
    if (result.failed) mutation.reject(result.error);
    else mutation.resolve();
    this.processQueue();
  }
}
