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
 * Two independent 32-bit multiplicative hashes of `value`, concatenated in
 * base-36 to give a 64-bit comparison key.
 *
 * The low lane is FNV-1a (offset basis 0x811c9dc5, prime 0x01000193). The high
 * lane uses the same xor-then-multiply shape with a different seed and a
 * different odd multiplier (the murmur3 finalizer constant 0x85ebca6b) so the
 * two lanes do not move together.
 *
 * This shrinks a content payload to a comparison key and is never a security
 * boundary. A collision would additionally have to land on the same chronology
 * `seq` before it could suppress anything.
 */
function fingerprint(value: string): string {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ code, 0x85ebca6b);
  }
  return `${(low >>> 0).toString(36)}.${(high >>> 0).toString(36)}`;
}

/**
 * The identity of a content record for duplicate detection: its chronology
 * `seq` paired with a fingerprint of the exact payload.
 *
 * Returns `null` when the content carries no chronology marker. Such content
 * has no identity, so it is always recorded rather than risk suppressing
 * something that was never written.
 *
 * `seq` alone is NOT sufficient. It is unique only within one `HistoryService`
 * instance, `ChronologyStamper.inherit` deliberately gives a replacement entry
 * the replaced entry's marker, and `merge` can import entries from a foreign
 * chronology. Pairing it with the payload fingerprint means suppression can
 * only ever discard content byte-identical to a record already written.
 *
 * @issue #3132
 */
function acceptsOrigin(
  owner: object | undefined,
  origin: object | undefined,
): boolean {
  return owner === undefined || origin === undefined || origin === owner;
}

function contentIdentity(content: IContent): string | null {
  const seq = content.metadata?.chronology?.seq;
  if (typeof seq !== 'number') {
    return null;
  }
  return `${seq}:${fingerprint(
    JSON.stringify({
      ...content,
      metadata: { ...content.metadata, turnId: undefined },
    }),
  )}`;
}

function unstampedContentIdentity(content: IContent): string {
  return fingerprint(
    JSON.stringify({
      ...content,
      metadata: {
        ...content.metadata,
        chronology: undefined,
        turnId: undefined,
      },
    }),
  );
}

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
  private owner: object | undefined;
  private compressionInProgress = false;
  /**
   * Identities of the content records this recording already contains.
   *
   * Several production paths rebuild history wholesale by calling
   * `HistoryService.clear()` and then re-`add()`ing the retained entries. Each
   * re-`add()` emits `contentAdded`, so without this set the rebuild appends a
   * byte-identical copy of every retained entry to the session file, and
   * `ReplayEngine` replays those copies into doubled history on resume.
   *
   * Scoped to the one `SessionRecordingService` this integration wraps, so it
   * is never reset while that file is open. Bounded by the number of distinct
   * content records written to the session.
   *
   * @issue #3132
   */
  private readonly recordedIdentities = new Set<string>();
  private readonly unstampedSnapshot = new Map<number, string>();
  private disposed = false;
  private readonly persistence: SessionPersistenceService | undefined;
  private readonly pendingPersistence = new Map<number, Promise<void>>();
  private readonly pendingBatches = new Set<Promise<void>>();
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
    let releaseBatch: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    this.pendingBatches.add(pending);
    const release = (): void => {
      this.pendingBatches.delete(pending);
      releaseBatch();
    };
    try {
      const effect = await this.prepareBatchEffect(publication);
      return {
        publish: () => effect.publish(),
        rollback: async () => {
          try {
            await effect.rollback();
          } finally {
            release();
          }
        },
        finalize: async () => {
          await effect.finalize?.();
          release();
        },
      };
    } catch (error: unknown) {
      release();
      throw error;
    }
  }

  private async prepareBatchEffect(
    publication: HistoryBatchPublication,
  ): Promise<PreparedHistoryBatchEffect> {
    await this.recording.flush();
    if (!this.recording.isActive()) {
      throw new Error('Cannot publish history batch: recording is not active');
    }

    let persistence: PreparedPersistenceSave | undefined;
    let recording: PreparedContentBatch | undefined;
    let batchContents: readonly IContent[] = [];
    try {
      persistence = await this.persistence?.prepareSave(
        publication.nextHistory,
      );
      if (!this.compressionInProgress) {
        batchContents = publication.contents.filter(
          (content) => !this.hasRecordedContent(content),
        );
        if (batchContents.length > 0) {
          recording = this.recording.prepareContentBatch(batchContents);
        }
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
        for (const content of batchContents) this.markRecordedContent(content);
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
  subscribeToHistory(historyService: HistoryService, owner?: object): void {
    this.unsubscribeFromHistory();
    if (this.disposed) {
      return;
    }
    this.owner = owner;

    // Whatever is already in history at subscribe time is content this
    // recording either already contains (resume and fork both attach to a
    // seeded file) or has deliberately excluded, since content added before
    // subscribing is never recorded. Either way a later rebuild must not
    // append it (issue #3132).
    this.rememberExistingHistory(historyService);

    const onContentAdded = (content: IContent, origin?: object) => {
      if (
        this.disposed ||
        this.compressionInProgress ||
        !acceptsOrigin(owner, origin)
      ) {
        return;
      }
      if (this.hasRecordedContent(content)) return;
      this.recording.recordContent(content);
      this.markRecordedContent(content);
      this.persist(historyService);
    };

    const onCompressionStarted = (origin?: object) => {
      if (this.disposed || !acceptsOrigin(owner, origin)) return;
      this.compressionInProgress = true;
    };

    const onCompressionLockReleased = (origin?: object) => {
      if (this.disposed || !acceptsOrigin(owner, origin)) return;
      this.compressionInProgress = false;
    };

    const onCompressionEnded = (
      summary: IContent,
      itemsCompressed: number,
      origin?: object,
    ) => {
      if (this.disposed || !acceptsOrigin(owner, origin)) return;
      this.compressionInProgress = false;
      this.recording.recordCompressed(summary, itemsCompressed);
      this.persist(historyService);
    };

    const unregisterBatchParticipant = historyService.registerBatchParticipant(
      (publication) =>
        acceptsOrigin(owner, publication.origin)
          ? this.prepareBatch(publication)
          : { publish: () => undefined, rollback: () => undefined },
    );
    this.historySubscription = () =>
      this.removeSubscriptions([
        unregisterBatchParticipant,
        () => historyService.off('contentAdded', onContentAdded),
        () => historyService.off('compressionStarted', onCompressionStarted),
        () =>
          historyService.off(
            'compressionLockReleased',
            onCompressionLockReleased,
          ),
        () => historyService.off('compressionEnded', onCompressionEnded),
      ]);
    try {
      historyService.on('contentAdded', onContentAdded);
      historyService.on('compressionStarted', onCompressionStarted);
      historyService.on('compressionLockReleased', onCompressionLockReleased);
      historyService.on('compressionEnded', onCompressionEnded);
    } catch (error: unknown) {
      try {
        this.unsubscribeFromHistory();
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error, cleanupError],
          'History subscription and cleanup failed',
        );
      }
      throw error;
    }
  }

  private removeSubscriptions(removals: ReadonlyArray<() => void>): void {
    const failures: unknown[] = [];
    for (const remove of removals) {
      try {
        remove();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    this.throwFailures(failures, 'History subscription cleanup failed');
  }

  /**
   * Seed {@link recordedIdentities} from the history that is already present
   * on the service being subscribed to.
   *
   * @issue #3132
   */
  private hasRecordedContent(content: IContent): boolean {
    const identity = contentIdentity(content);
    if (identity !== null && this.recordedIdentities.has(identity)) return true;
    const seq = content.metadata?.chronology?.seq;
    return (
      typeof seq === 'number' &&
      this.unstampedSnapshot.get(seq) === unstampedContentIdentity(content)
    );
  }

  private markRecordedContent(content: IContent): void {
    const identity = contentIdentity(content);
    if (identity !== null) this.recordedIdentities.add(identity);
  }

  private rememberExistingHistory(historyService: HistoryService): void {
    this.rememberRecordedHistory(historyService.getAll());
  }

  rememberRecordedHistory(history: readonly IContent[]): void {
    for (const [index, content] of history.entries()) {
      const identity = contentIdentity(content);
      if (identity !== null) {
        this.recordedIdentities.add(identity);
      } else {
        this.unstampedSnapshot.set(
          index + 1,
          unstampedContentIdentity(content),
        );
      }
    }
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

    const unsubscribe = this.historySubscription;
    this.historySubscription = null;
    this.compressionInProgress = false;
    unsubscribe();
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
    const generation = this.nextPersistenceGeneration;
    const operation = (async (): Promise<void> => {
      const failures: unknown[] = [];
      try {
        this.unsubscribeFromHistory();
      } catch (error: unknown) {
        failures.push(error);
      }
      await Promise.all([
        this.awaitPersistenceThrough(generation),
        ...this.pendingBatches,
      ]);
      failures.push(...this.takePersistenceFailuresThrough(generation));
      this.throwFailures(failures, 'Recording integration shutdown failed');
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
    this.subscribeToHistory(newHistoryService, this.owner);
  }
}
