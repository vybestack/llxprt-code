/**
 * Copyright 2025 Vybestack LLC
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

import type { HistoryService } from '../services/history/HistoryService.js';
import type { SessionRecordingService } from './SessionRecordingService.js';
import type { SessionPersistenceService } from '../storage/SessionPersistenceService.js';
import {
  RecordingFailureStore,
  RecordingFailureNotice,
} from './recording-failure-report.js';

interface PersistenceOutcome {
  readonly failed: boolean;
  readonly cause?: WeakRef<object>;
}

/**
 * Owns history journal attachment and turn-boundary persistence.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P14
 * @requirement REQ-INT-001, REQ-INT-002, REQ-INT-003, REQ-INT-004, REQ-INT-005, REQ-INT-006, REQ-INT-007
 * @pseudocode recording-integration.md lines 30-104
 */
export class RecordingIntegration {
  private readonly recording: SessionRecordingService;
  private historySubscription: (() => void) | null = null;
  private disposed = false;
  private readonly persistence: SessionPersistenceService | undefined;
  private readonly pendingPersistence = new Map<number, Promise<void>>();
  private readonly persistenceFailures: RecordingFailureStore;
  private nextPersistenceGeneration = 0;
  private reportingFailure: WeakRef<Error> | undefined;
  private reportingFailed = false;
  private disposalFailureCount = 0;
  private disposalFirstFailureGeneration = Infinity;
  private disposalFirstFailureCause: WeakRef<object> | undefined;
  private disposePromise: Promise<void> | undefined;
  private journalHistory: HistoryService | undefined;
  private subscriptionGeneration = 0;
  private detachmentSettlement: Promise<void> = Promise.resolve();
  private detachmentFailure: { error: unknown } | undefined;
  private attachmentSettlement: Promise<void> = Promise.resolve();
  private attachmentOperation: Promise<void> = Promise.resolve();
  private attachmentFailure: { error: unknown } | undefined;

  private async settleAttachment(): Promise<void> {
    await this.attachmentSettlement;
    const failure = this.attachmentFailure;
    this.attachmentFailure = undefined;
    if (failure !== undefined) throw failure.error;
  }

  private detach(history: HistoryService): void {
    const operation = history
      .detachJournal(this.recording)
      .catch((error: unknown) => {
        this.detachmentFailure = {
          error:
            this.detachmentFailure === undefined
              ? error
              : new AggregateError(
                  [this.detachmentFailure.error, error],
                  'Journal detachment failed',
                ),
        };
      });
    this.detachmentSettlement = Promise.all([
      this.detachmentSettlement,
      operation,
    ]).then(() => undefined);
  }

  private async settleDetachments(): Promise<void> {
    await this.detachmentSettlement;
    const failure = this.detachmentFailure;
    this.detachmentFailure = undefined;
    if (failure !== undefined) throw failure.error;
  }

  constructor(
    recording: SessionRecordingService,
    persistence?: SessionPersistenceService,
    failureReportDirectory?: string,
  ) {
    this.recording = recording;
    this.persistence = persistence;
    this.persistenceFailures = new RecordingFailureStore(
      failureReportDirectory,
    );
  }

  private persistJournal(history: HistoryService): Promise<PersistenceOutcome> {
    const generation = ++this.nextPersistenceGeneration;
    const save = (async () => {
      await history.waitForCommit();
      await this.recording.flush();
      const file = this.recording.getFilePath();
      if (file !== null) await this.persistence?.saveJournal(file);
      return { failed: false };
    })().catch((error: unknown) => {
      const cause =
        (typeof error === 'object' && error !== null) ||
        typeof error === 'function'
          ? new WeakRef(error)
          : undefined;
      if (this.disposed) {
        this.disposalFailureCount += 1;
        if (generation < this.disposalFirstFailureGeneration) {
          this.disposalFirstFailureGeneration = generation;
          this.disposalFirstFailureCause = cause;
        }
      }
      try {
        this.persistenceFailures.record(generation, error);
        return { failed: true, cause };
      } catch (reportError: unknown) {
        this.reportingFailed = true;
        if (reportError instanceof Error)
          this.reportingFailure = new WeakRef(reportError);
        throw reportError;
      }
    });
    const settlement = save.then(
      () => {
        this.pendingPersistence.delete(generation);
      },
      () => {
        this.pendingPersistence.delete(generation);
      },
    );
    this.pendingPersistence.set(generation, settlement);
    return save;
  }

  private async awaitPersistenceThrough(generation: number): Promise<void> {
    for (const [pendingGeneration, operation] of this.pendingPersistence) {
      if (pendingGeneration <= generation) await operation;
    }
  }

  private throwFailures(failures: readonly unknown[], message: string): void {
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, message);
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-001, REQ-INT-002
   * @pseudocode recording-integration.md lines 39-71
   */
  subscribeToJournal(history: HistoryService): Promise<void> {
    if (this.journalHistory === history) return this.attachmentOperation;
    this.unsubscribeFromHistory();
    if (this.disposed) return Promise.resolve();
    const generation = this.subscriptionGeneration;
    this.journalHistory = history;
    try {
      const operation = history.attachJournal(this.recording, true, () => {
        if (generation !== this.subscriptionGeneration) return;
        this.historySubscription = history.onJournalRetired(() => {
          this.unsubscribeFromHistory();
        });
      });
      this.attachmentOperation = operation;
      this.attachmentSettlement = operation.catch((error: unknown) => {
        if (generation === this.subscriptionGeneration) {
          this.historySubscription?.();
          this.historySubscription = null;
          this.journalHistory = undefined;
        }
        this.attachmentFailure = { error };
      });
      return operation;
    } catch (error) {
      this.journalHistory = undefined;
      throw error;
    }
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-001, REQ-INT-006
   * @pseudocode recording-integration.md lines 73-78
   */
  unsubscribeFromHistory(): void {
    this.subscriptionGeneration += 1;
    const history = this.journalHistory;
    this.journalHistory = undefined;
    if (history !== undefined) this.detach(history);
    if (!this.historySubscription) {
      return;
    }

    this.historySubscription();
    this.historySubscription = null;
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-003
   * @pseudocode recording-integration.md lines 80-82
   */
  recordProviderSwitch(provider: string, model: string): void {
    if (this.disposed) {
      return;
    }
    this.recording.recordProviderSwitch(provider, model);
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-003
   * @pseudocode recording-integration.md lines 84-86
   */
  recordDirectoriesChanged(dirs: string[]): void {
    if (this.disposed) {
      return;
    }
    this.recording.recordDirectoriesChanged(dirs);
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-003
   * @pseudocode recording-integration.md lines 88-90
   */
  recordSessionEvent(
    severity: 'info' | 'warning' | 'error',
    message: string,
  ): void {
    if (this.disposed) {
      return;
    }
    this.recording.recordSessionEvent(severity, message);
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-004, REQ-INT-007
   * @pseudocode recording-integration.md lines 92-94
   */
  async flushAtTurnBoundary(): Promise<void> {
    if (this.disposed) return;
    if (this.reportingFailed)
      throw (
        this.reportingFailure?.deref() ??
        new Error(
          'Persistence failure report storage failed; integration requires disposal',
        )
      );
    const history = this.journalHistory;
    const save: Promise<PersistenceOutcome> =
      history === undefined
        ? Promise.resolve({ failed: false })
        : this.persistJournal(history);
    const generation = this.nextPersistenceGeneration;
    const outcomes = await Promise.allSettled([
      this.settleAttachment().then(() => this.recording.flush()),
      this.awaitPersistenceThrough(generation),
      save,
    ]);
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : [],
    );
    const ownSave = outcomes[2];
    const cause =
      ownSave.status === 'fulfilled' ? ownSave.value.cause?.deref() : undefined;
    const report = this.persistenceFailures.takeThrough(
      generation,
      'Recording and persistence flush failed',
      cause,
    );
    if (report !== undefined) failures.push(report);
    else if (ownSave.status === 'fulfilled' && ownSave.value.failed)
      failures.push(
        new RecordingFailureNotice(1, generation, ownSave.value.cause),
      );
    this.throwFailures(failures, 'Recording and persistence flush failed');
  }

  getRecordingService(): SessionRecordingService {
    return this.recording;
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-006
   * @pseudocode recording-integration.md lines 96-98
   */
  dispose(): Promise<void> {
    if (this.disposePromise !== undefined) return this.disposePromise;
    this.disposed = true;
    this.unsubscribeFromHistory();
    const generation = this.nextPersistenceGeneration;
    const operation = (async (): Promise<void> => {
      try {
        const settlements = await Promise.allSettled([
          this.awaitPersistenceThrough(generation),
          this.settleAttachment(),
          this.settleDetachments(),
        ]);
        const failures: unknown[] = settlements.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        const report = this.persistenceFailures.takeThrough(
          generation,
          'Session persistence shutdown failed',
        );
        if (report !== undefined) failures.push(report);
        else if (this.disposalFailureCount > 0)
          failures.push(
            new RecordingFailureNotice(
              this.disposalFailureCount,
              this.disposalFirstFailureGeneration,
              this.disposalFirstFailureCause,
            ),
          );
        if (this.reportingFailed)
          failures.push(
            this.reportingFailure?.deref() ??
              new Error(
                'Persistence diagnostic storage failed during shutdown',
              ),
          );
        this.throwFailures(failures, 'Journal shutdown failed');
      } finally {
        this.disposePromise = Promise.resolve();
      }
    })();
    this.disposePromise = operation;
    return operation;
  }
}
