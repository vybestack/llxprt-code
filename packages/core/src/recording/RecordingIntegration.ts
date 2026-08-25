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

import { type IContent } from '../services/history/IContent.js';
import {
  type HistoryBatchPublication,
  type HistoryService,
  type PreparedHistoryBatchEffect,
} from '../services/history/HistoryService.js';
import {
  type PreparedContentBatch,
  type SessionRecordingService,
} from './SessionRecordingService.js';
import type {
  PreparedPersistenceSave,
  SessionPersistenceService,
} from '../storage/SessionPersistenceService.js';

/**
 * Bridges HistoryService events to SessionRecordingService.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P14
 * @requirement REQ-INT-001, REQ-INT-002, REQ-INT-003, REQ-INT-004, REQ-INT-005, REQ-INT-006, REQ-INT-007
 * @pseudocode recording-integration.md lines 30-104
 */
export class RecordingIntegration {
  private readonly recording: SessionRecordingService;
  private historySubscription: (() => void) | null = null;
  private compressionInProgress = false;
  private disposed = false;
  private readonly persistence: SessionPersistenceService | undefined;
  private readonly pendingPersistence = new Map<number, Promise<void>>();
  private readonly persistenceFailures = new Map<number, unknown>();
  private nextPersistenceGeneration = 0;
  private disposePromise: Promise<void> | undefined;

  constructor(
    recording: SessionRecordingService,
    persistence?: SessionPersistenceService,
  ) {
    this.recording = recording;
    this.persistence = persistence;
  }

  private persist(historyService: HistoryService): void {
    if (this.persistence === undefined) return;
    const generation = ++this.nextPersistenceGeneration;
    let save: Promise<void>;
    try {
      save = this.persistence.save([...historyService.getAll()]);
    } catch (error: unknown) {
      this.persistenceFailures.set(generation, error);
      return;
    }
    const settled = save.then(
      () => {
        this.pendingPersistence.delete(generation);
      },
      (error: unknown) => {
        this.persistenceFailures.set(generation, error);
        this.pendingPersistence.delete(generation);
      },
    );
    this.pendingPersistence.set(generation, settled);
  }

  private async awaitPersistenceThrough(generation: number): Promise<void> {
    const pending = [...this.pendingPersistence.entries()]
      .filter(([pendingGeneration]) => pendingGeneration <= generation)
      .map(([, operation]) => operation);
    await Promise.all(pending);
  }

  private takePersistenceFailuresThrough(generation: number): unknown[] {
    const failures: unknown[] = [];
    for (const [failedGeneration, error] of [
      ...this.persistenceFailures.entries(),
    ].sort(([left], [right]) => left - right)) {
      if (failedGeneration > generation) continue;
      this.persistenceFailures.delete(failedGeneration);
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(
        new Error(
          `Session persistence generation ${failedGeneration} failed: ${detail}`,
          { cause: error },
        ),
      );
    }
    return failures;
  }

  private throwFailures(failures: readonly unknown[], message: string): void {
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, message);
  }

  private async prepareBatch(
    publication: HistoryBatchPublication,
  ): Promise<PreparedHistoryBatchEffect> {
    await this.recording.flush();
    if (!this.recording.isActive()) {
      throw new Error('Cannot publish history batch: recording is not active');
    }

    let persistence: PreparedPersistenceSave | undefined;
    let recording: PreparedContentBatch | undefined;
    try {
      persistence = await this.persistence?.prepareSave(
        publication.nextHistory,
      );
      if (!this.compressionInProgress) {
        recording = this.recording.prepareContentBatch(publication.contents);
      }
    } catch (error: unknown) {
      if (persistence === undefined) throw error;
      try {
        await persistence.rollback();
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          'History batch preparation and persistence rollback failed',
        );
      }
      throw error;
    }

    return {
      publish: async () => {
        recording?.publish();
        await persistence?.publish();
      },
      rollback: async () => {
        const failures: unknown[] = [];
        try {
          recording?.rollback();
        } catch (error: unknown) {
          failures.push(error);
        }
        try {
          await persistence?.rollback();
        } catch (error: unknown) {
          failures.push(error);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, 'History batch rollback failed');
        }
      },
      finalize: async () => {
        await persistence?.finalize();
        recording?.finalize();
      },
    };
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-001, REQ-INT-002
   * @pseudocode recording-integration.md lines 39-71
   */
  subscribeToHistory(historyService: HistoryService): void {
    this.unsubscribeFromHistory();
    if (this.disposed) {
      return;
    }

    const onContentAdded = (content: IContent) => {
      if (this.disposed || this.compressionInProgress) {
        return;
      }
      this.recording.recordContent(content);
      this.persist(historyService);
    };

    const onCompressionStarted = () => {
      if (this.disposed) {
        return;
      }
      this.compressionInProgress = true;
    };

    const onCompressionEnded = (summary: IContent, itemsCompressed: number) => {
      if (this.disposed) {
        return;
      }
      this.compressionInProgress = false;
      this.recording.recordCompressed(summary, itemsCompressed);
      this.persist(historyService);
    };

    const unregisterBatchParticipant = historyService.registerBatchParticipant(
      (publication) => this.prepareBatch(publication),
    );
    historyService.on('contentAdded', onContentAdded);
    historyService.on('compressionStarted', onCompressionStarted);
    historyService.on('compressionEnded', onCompressionEnded);

    this.historySubscription = () => {
      unregisterBatchParticipant();
      historyService.off('contentAdded', onContentAdded);
      historyService.off('compressionStarted', onCompressionStarted);
      historyService.off('compressionEnded', onCompressionEnded);
    };
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-001, REQ-INT-006
   * @pseudocode recording-integration.md lines 73-78
   */
  unsubscribeFromHistory(): void {
    if (!this.historySubscription) {
      return;
    }

    this.historySubscription();
    this.historySubscription = null;
    this.compressionInProgress = false;
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
    const generation = this.nextPersistenceGeneration;
    const outcomes = await Promise.allSettled([
      this.recording.flush(),
      this.awaitPersistenceThrough(generation),
    ]);
    const failures = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : [],
    );
    failures.push(...this.takePersistenceFailuresThrough(generation));
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
        await this.awaitPersistenceThrough(generation);
        const failures = this.takePersistenceFailuresThrough(generation);
        this.throwFailures(failures, 'Session persistence shutdown failed');
      } finally {
        this.disposePromise = Promise.resolve();
      }
    })();
    this.disposePromise = operation;
    return operation;
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P14
   * @requirement REQ-INT-005
   * @pseudocode recording-integration.md lines 102-104
   */
  onHistoryServiceReplaced(newHistoryService: HistoryService): void {
    this.subscribeToHistory(newHistoryService);
  }
}
