/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SafeBoundaryOutcome,
  SchedulerBoundaryPort,
} from '@vybestack/llxprt-code-core/profiles/ports/schedulerBoundaryPort.js';
import type { ActiveRun } from './directProviderAdmission.js';
import { AgentBusyError } from './loop/agentBusyError.js';

export type CoordinatorCommandOutcome<T> =
  | SafeBoundaryOutcome<T>
  | { status: 'stale'; actualRevision: number };

interface PendingWindow {
  start(): void;
  cancel(): void;
}

/** One owner of turn admission and the exclusive windows used by future profile commits. */
export class AgentExecutionCoordinator implements SchedulerBoundaryPort {
  private run?: ActiveRun;
  private readonly controller = new AbortController();
  private pending: readonly PendingWindow[] = [];
  private committing?: Promise<void>;
  private disposed = false;

  current(): ActiveRun | undefined {
    return this.run;
  }

  isBusy(): boolean {
    return (
      this.run !== undefined ||
      this.pending.length > 0 ||
      this.committing !== undefined
    );
  }

  assertSettingsAdmission(): void {
    if (this.disposed) throw new Error('Session settings owner is closed');
  }

  assertNoCommit(): void {
    this.assertSettingsAdmission();
    if (this.pending.length > 0 || this.committing !== undefined) {
      throw new AgentBusyError();
    }
  }

  admit(run: ActiveRun): void {
    if (this.disposed) throw new Error('Agent is closed');
    if (this.isBusy()) throw new AgentBusyError();
    this.run = run;
  }

  release(run: ActiveRun): void {
    if (this.run !== run)
      throw new Error('Foreground admission owner mismatch');
    this.run = undefined;
    this.pump();
  }

  withSafeBoundary<T>(
    fn: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<SafeBoundaryOutcome<T>> {
    if (this.disposed || signal?.aborted === true) {
      return Promise.resolve({ status: 'cancelled' });
    }
    return new Promise<SafeBoundaryOutcome<T>>((resolve, reject) => {
      const combined = signal
        ? AbortSignal.any([signal, this.controller.signal])
        : this.controller.signal;
      const cancel = (): void => {
        this.pending = this.pending.filter((candidate) => candidate !== window);
        combined.removeEventListener('abort', cancel);
        resolve({ status: 'cancelled' });
        this.pump();
      };
      const window: PendingWindow = {
        cancel,
        start: () => {
          combined.removeEventListener('abort', cancel);
          let finished = (): void => {};
          const completion = new Promise<void>((done) => {
            finished = done;
          });
          this.committing = completion;
          void (async () => fn(combined))()
            .then((value) => resolve({ status: 'committed', value }), reject)
            .finally(() => {
              this.committing = undefined;
              finished();
              this.pump();
            });
        },
      };
      combined.addEventListener('abort', cancel, { once: true });
      this.pending = [...this.pending, window];
      this.pump();
    });
  }

  executeCommand<T>(
    command: { readonly expectedRevision: number },
    readRevision: () => number,
    commit: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<CoordinatorCommandOutcome<T>> {
    const expectedRevision = command.expectedRevision;
    return this.withSafeBoundary<
      | { readonly stale: true; readonly actualRevision: number }
      | { readonly stale: false; readonly value: T }
    >(async (heldSignal) => {
      const actualRevision = readRevision();
      if (expectedRevision !== actualRevision) {
        return { stale: true, actualRevision };
      }
      return { stale: false, value: await commit(heldSignal) };
    }, signal).then((outcome): CoordinatorCommandOutcome<T> => {
      if (outcome.status === 'cancelled') return outcome;
      if (outcome.value.stale) {
        return {
          status: 'stale',
          actualRevision: outcome.value.actualRevision,
        };
      }
      return { status: 'committed', value: outcome.value.value };
    });
  }

  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.controller.abort();
      for (const window of this.pending) window.cancel();
    }
    await this.committing;
  }

  private pump(): void {
    if (
      this.run !== undefined ||
      this.committing !== undefined ||
      this.disposed
    ) {
      return;
    }
    if (this.pending.length === 0) return;
    const [next, ...remaining] = this.pending;
    this.pending = remaining;
    next.start();
  }
}
