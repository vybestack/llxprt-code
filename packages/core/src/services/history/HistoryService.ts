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

import type {
  HistoryRepair,
  StagedProfileAdoption,
} from './historyStorePort.js';
import { RemovalObserverFailure } from './historyRemovalObserverFailure.js';
import { estimateMergedAppendTokens } from './historyMergeRows.js';
import type { HistoryDensityRows } from './historyDensityRows.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type { CompressionInputSnapshot } from './compressionInput.js';
export type {
  HistoryDumpSource,
  HistoryDumpSnapshot,
} from './historyDumpSnapshot.js';
import { publishResumeRestoration } from './historyResumeProjection.js';
import type { ResumeBoot } from './historyStorePort.js';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import { isDeepStrictEqual } from 'node:util';
import type { IContent } from './IContent.js';
import { estimateContentTokens as estimateContentTokensImpl } from './historyTokenEstimation.js';
import type { ConversationStatistics } from './curationDebugLogger.js';
export type { ToolPairingStreamOptions } from './historyToolPairing.js';
import { isCuratedContent } from './historyCuration.js';
import { streamProviderContentSnapshot } from './provider-request-snapshot.js';
export type { ProviderRequestSnapshot } from './provider-request-snapshot.js';

import {
  streamHistoryJson,
  writeHistoryJson,
  type HistoryJsonSink,
} from './history-export.js';
export type { HistoryJsonSink } from './history-export.js';
import {
  ChronologyStamper,
  projectChronologyTraceEntry,
  type ChronologyTraceEntry,
} from './historyChronology.js';
import { HistoryServiceReads } from './HistoryServiceReads.js';

import type { HistoryServiceJournalOptions } from './historyBatchContracts.js';

export type {
  CompressionConfig,
  HistoryBatchOptions,
  HistoryMediaOwner,
  HistoryOwnedMediaReservation,
  PreparedHistoryBatchEffect,
  HistoryServiceJournalOptions,
} from './HistoryServiceCore.js';

/**
 * Provider-neutral conversation history service.
 *
 * Mutation, ownership, chronology, and token-accounting mechanics live in the
 * cohesive base implementation. This class owns history queries, lifecycle,
 * compression coordination, and serialization. All state lives in the
 * journal (#854): reads materialize transiently, writes append durable ops.
 */
/** Commit flips the live history synchronously; rollback discards the staging. */
export type PreparedProfileAdoption = (() => void) & {
  rollback(): Promise<void>;
};

export class HistoryService extends HistoryServiceReads {
  /**
   * @param options.recording injects the journal store. Omitted, the service
   *   records into its own temp-file-backed journal; call
   *   {@link attachJournal} to move onto a session recorder after
   *   construction (foreground wiring order).
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  constructor(options: HistoryServiceJournalOptions = {}) {
    super(options);
  }

  openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    return this.journal.openDumpSnapshot();
  }

  openCompressionInput(): Promise<CompressionInputSnapshot> {
    return this.journal.openCompressionInput();
  }

  async adoptResumeBoot(
    recording: SessionRecordingPort,
    boot: ResumeBoot,
    afterPublication: () => void | Promise<void> = () => {},
  ): Promise<string[]> {
    if (this.isCompressing) {
      return new Promise((resolve, reject) => {
        this.queueCompressionOperation(() => {
          void this.adoptResumeBoot(recording, boot, afterPublication).then(
            resolve,
            reject,
          );
        });
      });
    }
    let warnings: string[] = [];
    await this.enqueueAsynchronousHistoryMutation(async () => {
      warnings = await this.adoptResumeBootInternal(
        recording,
        boot,
        afterPublication,
      );
    });
    return warnings;
  }

  private async adoptResumeBootInternal(
    recording: SessionRecordingPort,
    boot: ResumeBoot,
    afterPublication: () => void | Promise<void>,
  ): Promise<string[]> {
    await this.waitForTokenUpdates();
    const previous = {
      chronology: this.chronology,
      tokens: this.totalTokens,
      anchor: this.cacheAnchorSeq,
      spans: this.spanWindow.get(),
      range: this.getContextRange(),
    };
    let published = false;
    return this.journal.adoptResume({
      recording,
      boot,
      mediaOwner: this.mediaOwner,
      estimate: (rows) => this.estimateTokensForContents(rows),
      publish: (state) => {
        this.invalidatePendingSyncs();
        this.chronology = state.chronology;
        this.totalTokens = state.tokens;
        this.cacheAnchorSeq = 0;
        this.spanWindow.set([]);
        published = true;
        this.emit('tokensUpdated', {
          totalTokens: this.getTotalTokens(),
          addedTokens: state.tokens - previous.tokens,
          contentId: null,
        });
        this.emit('contextRangeChanged', state.range);
      },
      restore: () => {
        this.chronology = previous.chronology;
        this.totalTokens = previous.tokens;
        this.cacheAnchorSeq = previous.anchor;
        this.spanWindow.set(previous.spans);
        if (published) {
          publishResumeRestoration([
            ...this.rawListeners('tokensUpdated').map(
              (listener) => () =>
                listener.call(this, {
                  totalTokens: this.getTotalTokens(),
                  addedTokens: 0,
                  contentId: null,
                }),
            ),
            ...this.rawListeners('contextRangeChanged').map(
              (listener) => () => listener.call(this, previous.range),
            ),
          ]);
        }
      },
      afterPublication,
    });
  }

  /**
   * Stage the candidate's rows against the live journal and return the commit.
   * Preparing changes nothing visible; the returned function flips rows and
   * derived accounting synchronously and throws, leaving the live history
   * untouched, when the live journal changed since preparation. `rollback()`
   * discards the staged rows instead.
   */
  async prepareProfileAdoption(
    candidate: HistoryService,
  ): Promise<PreparedProfileAdoption> {
    await Promise.all([
      this.waitForTokenUpdates(),
      candidate.waitForTokenUpdates(),
      this.waitForOwnershipSettlement(),
      candidate.waitForOwnershipSettlement(),
    ]);
    // A no-op mutation on each FIFO resolves only after every queued or
    // in-flight mutation has drained, which is what "idle" means here.
    await Promise.all([
      this.enqueueAsynchronousHistoryMutation(async () => {}),
      candidate.enqueueAsynchronousHistoryMutation(async () => {}),
    ]);
    if (this.isCompressing || candidate.isCompressing) {
      throw new Error('Profile history adoption requires idle histories');
    }
    const holder: { staged?: StagedProfileAdoption } = {};
    await this.enqueueAsynchronousHistoryMutation(async () => {
      holder.staged = await this.journal.stageProfileReplacement(
        candidate.journal,
        {
          ownership: this.mutationOwnership,
          origin: this.journal.primaryOriginId(),
        },
      );
    });
    const replacement = holder.staged;
    if (replacement === undefined)
      throw new Error('Profile history adoption was not staged');
    const commitDerivedState = () => {
      replacement.commit();
      this.invalidatePendingSyncs();
      candidate.invalidatePendingSyncs();
      this.totalTokens = candidate.totalTokens;
      this.baseTokenOffset = candidate.baseTokenOffset;
      this.tokenizerFactory = candidate.tokenizerFactory;
      this.tokenizerCache = candidate.tokenizerCache;
      this.activeTokenizationModel = candidate.activeTokenizationModel;
      this.activeTokenizationProvider = candidate.activeTokenizationProvider;
      this.chronology = candidate.chronology;
      this.cacheAnchorSeq = candidate.cacheAnchorSeq;
      this.mediaOwner = candidate.mediaOwner;
      candidate.mediaOwner = undefined;
      candidate.totalTokens = 0;
      candidate.baseTokenOffset = 0;
      candidate.tokenizerCache = new Map();
      candidate.chronology = new ChronologyStamper();
      candidate.cacheAnchorSeq = 0;
    };
    return Object.assign(commitDerivedState, {
      rollback: () => replacement.rollback(),
    });
  }

  /**
   * Force a full token recalculation after density operations.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P08
   * @requirement REQ-HD-003.6
   * @pseudocode history-service.md lines 90-120
   */
  recalculateTotalTokens(
    modelName?: string,
    activeProvider?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.recalculateTotalTokensInternal(modelName, activeProvider, signal),
    );
  }

  private recalculateTotalTokensInternal(
    modelName = this.activeTokenizationModel,
    activeProvider = this.activeTokenizationProvider,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.runSerializedTokenOperation(async () => {
      signal?.throwIfAborted();
      let newTotal = 0;
      let entryCount = 0;
      const tokenizerProvider = this.tokenizerProvider(activeProvider);
      for await (const entry of this.journal.streamRows(undefined, signal)) {
        const entryTokens = await estimateContentTokensImpl(
          entry,
          modelName,
          tokenizerProvider,
          this.logger,
          signal,
        );
        signal?.throwIfAborted();
        newTotal += entryTokens;
        entryCount += 1;
      }
      signal?.throwIfAborted();

      const previousTotal = this.totalTokens;
      this.totalTokens = newTotal;

      this.logger.debug('Density: recalculated total tokens', {
        previousTotal,
        newTotal,
        entryCount,
      });

      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: newTotal - previousTotal,
        contentId: null,
      });
    });
  }

  /**
   * Release all listeners and internal buffers to allow GC. Resolves once the
   * journal's recorder is disposed and its scratch directory is removed, and
   * rejects with the journal's disposal failure; callers must await it.
   */
  dispose(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.runSynchronousHistoryMutation(() => {
        this.disposeInternal().then(resolve, reject);
      });
    });
  }

  private async disposeInternal(): Promise<void> {
    this.invalidatePendingSyncs();
    this.removeAllListeners();

    const journalDisposal = this.journal.dispose();
    this.tokenTickets.close();
    this.totalTokens = 0;
    this.baseTokenOffset = 0;
    this.isCompressing = false;
    this.pendingOperations.clear();
    this.tokenizerCache.clear();
    this.tokenizerLock = Promise.resolve();
    this.pendingTokenizerFailure = undefined;
    if (this.mediaOwner !== undefined) {
      this.enqueueSynchronousOwnershipReleaseAll();
    }
    // Chronology counters are intentionally NOT reset: seq must never be reused
    // (NG8) so that items added after dispose() never collide with earlier ones.
    await journalDisposal;
  }

  /**
   * Clear all history. Resolves once the clear has been applied. When
   * compression holds the history lock the clear is queued: the promise
   * settles when the queue flushes at the end of compression, and a failure
   * both rejects it and is reported by the flush like any queued operation.
   */
  async clear(): Promise<void> {
    const rebuilding = this.isCompressing && this.inRebuildScope;
    const clearAndRelease = (): Promise<void> => {
      if (this.journal.clearIsAsynchronous !== true)
        return this.clearInTurn(rebuilding);
      // The clear is applied a queue turn after this call. A provider token
      // count requested before it describes rows it removes, so it is
      // dropped now, as the old store's synchronous clear drops it.
      this.invalidatePendingSyncs();
      return this.clearHoldingQueue(rebuilding);
    };
    if (this.isCompressing) {
      this.logger.debug('Queueing clear operation during compression');
      await new Promise<void>((resolve, reject) => {
        this.queueCompressionOperation(() => {
          try {
            const cleared = clearAndRelease();
            this.queuedClears.track(cleared);
            cleared.then(resolve, reject);
          } catch (error: unknown) {
            reject(error);
            throw error;
          }
        });
      });
      return;
    }

    await clearAndRelease();
  }

  /** The old store clears inside the synchronous turn, so a failure throws out of it. */
  private clearInTurn(rebuilding: boolean): Promise<void> {
    let cleared: Promise<void> = Promise.resolve();
    this.runSynchronousHistoryMutation(() => {
      try {
        cleared = this.clearInternal(rebuilding);
      } finally {
        if (!rebuilding) this.enqueueSynchronousOwnershipSettlement();
      }
    });
    return cleared;
  }

  /**
   * A journal clear runs after it is started, so the mutation queue is held
   * until it settles: what is added meanwhile follows the clear and is not
   * swept up by it (D-W7-5).
   */
  private clearHoldingQueue(rebuilding: boolean): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(async () => {
      try {
        await this.clearInternal(rebuilding);
      } finally {
        if (!rebuilding) this.enqueueSynchronousOwnershipSettlement();
      }
    });
  }

  private clearInternal(rebuilding: boolean): Promise<void> {
    const previousTokens = this.totalTokens;
    const previousSpans = this.spanWindow.get();
    return this.journal.clear({
      spans: previousSpans,
      rollbackOnFailure: !rebuilding,
      publish: (spans) => {
        this.spanWindow.set(spans);
        this.totalTokens = 0;
        // Rebuild appends continue after observer failures, so their clear and
        // token generation must remain committed rather than restore old rows.
        if (rebuilding) this.invalidatePendingSyncs();
        this.emit('tokensUpdated', {
          totalTokens: this.getTotalTokens(),
          addedTokens: -previousTokens,
          contentId: null,
        });
        this.emitContextRangeChanged();
        if (!rebuilding) this.invalidatePendingSyncs();
      },
      restore: () => {
        this.totalTokens = previousTokens;
        this.spanWindow.set(previousSpans);
      },
    });
  }

  /** Cold curated rows over journal membership pinned at the first next(). */
  async *streamCuratedHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    if (this.isCompressing) {
      this.logger.debug(
        'getCurated called during compression - returning snapshot',
      );
    }
    for await (const row of this.journal.streamRows(undefined, signal)) {
      if (isCuratedContent(row)) yield row;
    }
  }

  /** Count curated rows without constructing the curated history. */
  async countCuratedRows(): Promise<number> {
    let count = 0;
    for await (const row of this.streamCuratedHistory()) {
      void row;
      count += 1;
    }
    return count;
  }

  /** Compare semantic AFC content with the curated prefix, stopping at the first mismatch. */
  async matchingCuratedPrefix(incoming: readonly IContent[]): Promise<number> {
    let index = 0;
    if (incoming.length === 0) return index;
    for await (const row of this.streamCuratedHistory()) {
      if (
        row.speaker !== incoming[index].speaker ||
        !isDeepStrictEqual(row.blocks, incoming[index].blocks)
      )
        break;
      index += 1;
      if (index === incoming.length) return index;
    }
    return index;
  }

  /**
   * Remove the last content if it matches the provided content. Matching is
   * by value (#854): reads materialize fresh projections, so a previously
   * added object's reference identity no longer exists to compare against.
   */
  async removeLastIfMatches(content: IContent): Promise<boolean> {
    let removed = false;
    await this.enqueueAsynchronousHistoryMutation(async () => {
      removed = await this.removeLastIfMatchesInternal(content);
    });
    return removed;
  }

  private async removeLastIfMatchesInternal(
    content: IContent,
  ): Promise<boolean> {
    return (
      (await this.journal.removeTail({
        owner: this.mediaOwner,
        ownership: this.mutationOwnership,
        match: content,
      })) !== undefined
    );
  }

  /** Pop the last content from history. */
  async pop(): Promise<IContent | undefined> {
    let removed: IContent | undefined;
    await this.enqueueAsynchronousHistoryMutation(async () => {
      removed = await this.popInternal();
    });
    return removed;
  }

  private popInternal(): Promise<IContent | undefined> {
    return this.journal.removeTail({
      owner: this.mediaOwner,
      ownership: this.mutationOwnership,
      recalculate: () =>
        this.recalculateTokensInternal(
          this.activeTokenizationModel,
          undefined,
          true,
        ),
    });
  }

  /**
   * Recalculate total tokens from scratch
   * Use this when removing content or when token counts might be stale
   */
  recalculateTokens(
    defaultModel = this.activeTokenizationModel,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.recalculateTokensInternal(defaultModel, signal);
  }

  private recalculateTokensInternal(
    defaultModel: string,
    signal?: AbortSignal,
    removal = false,
  ): Promise<void> {
    return this.runSerializedTokenOperation(async () => {
      signal?.throwIfAborted();
      let newTotal = 0;
      for await (const content of this.journal.streamRows(undefined, signal)) {
        newTotal += await this.estimateContentTokens(
          content,
          defaultModel,
          signal,
        );
        signal?.throwIfAborted();
      }
      signal?.throwIfAborted();

      const oldTotal = this.totalTokens;
      this.totalTokens = newTotal;

      try {
        this.emit('tokensUpdated', {
          totalTokens: this.getTotalTokens(),
          addedTokens: this.totalTokens - oldTotal,
          contentId: null,
        });
      } catch (error) {
        if (removal) {
          this.totalTokens = oldTotal;
          throw new RemovalObserverFailure(error);
        }
        throw error;
      }
    });
  }

  /**
   * Validate and fix the history to ensure proper tool call/response pairing
   */
  async validateAndFix(): Promise<void> {
    if (this.isCompressing) {
      return new Promise<void>((resolve, reject) => {
        this.queueCompressionOperation(() => {
          void this.validateAndFix().then(resolve, reject);
        });
      });
    }
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.validateAndFixInternal(),
    );
  }

  private async validateAndFixInternal(): Promise<void> {
    const chronology = this.chronology.snapshot();
    let repair: HistoryRepair;
    try {
      repair = await this.journal.validateAndFix({
        ownership: this.mutationOwnership,
        stamp: (row) => this.chronology.stamp(row),
      });
    } catch (error) {
      this.chronology.restore(chronology);
      throw error;
    }
    if (repair.inserted.length === 0) {
      await repair.close();
      return;
    }
    const tokens = this.runSerializedTokenOperation(async () => {
      const oldTokens = this.totalTokens;
      try {
        for (const row of repair.inserted) {
          const addedTokens = await this.estimateContentTokens(
            row,
            this.activeTokenizationModel,
          );
          this.totalTokens += addedTokens;
          this.emit('tokensUpdated', {
            totalTokens: this.getTotalTokens(),
            addedTokens,
            contentId: row.metadata?.id,
          });
        }
      } catch (error) {
        try {
          await repair.rollback();
        } finally {
          this.totalTokens = oldTokens;
          this.chronology.restore(chronology);
          this.notifyRestoredTokens();
        }
        throw error;
      } finally {
        await repair.close();
      }
    });
    this.observeTokenizerOperation(tokens);
    void this.enqueueAsynchronousHistoryMutation(() => tokens).catch(
      (error: unknown) =>
        this.logger.debug('Validation settlement failed', error),
    );
  }

  private notifyRestoredTokens(): void {
    for (const listener of this.rawListeners('tokensUpdated')) {
      try {
        listener.call(this, {
          totalTokens: this.getTotalTokens(),
          addedTokens: 0,
          contentId: null,
        });
      } catch (error) {
        this.logger.debug('Token rollback observer failed', error);
      }
    }
  }

  /**
   * Cold provider curation over journal membership or request-scoped rows.
   * Normalization uses disk-backed indexes and emits one sanitized row at a time.
   * Rows are sanitized clones, so cyclic tool payloads stringify safely with
   * the `_circular` marker and caller rows are never mutated.
   *
   * @param tailContents appended after the curated rows.
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  async *getCuratedForProviderStream(
    tailContents: IContent[] = [],
    signal?: AbortSignal,
    historyOverride?: Iterable<IContent> | AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* streamProviderContentSnapshot(
      await this.prepareCuratedForProviderSnapshot(
        tailContents,
        { signal },
        historyOverride,
      ),
    );
  }

  /** Append pinned source rows atomically, retaining duplicate values and markers. */
  merge(other: HistoryService): Promise<void> {
    if (this.isCompressing) {
      return new Promise((resolve, reject) => {
        this.queueCompressionOperation(() => {
          void this.merge(other).then(resolve, reject);
        });
      });
    }
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.journal.mergeFrom({
        source: other.journal,
        ownership: this.mutationOwnership,
        host: this.detachedValues.host(),
        publish: (nextHistory, previous) =>
          this.publishMergedRows(nextHistory, previous),
      }),
    );
  }

  private async publishMergedRows(
    nextHistory: HistoryDensityRows,
    previous: HistoryMutationSnapshot,
  ): Promise<void> {
    await this.waitForTokenUpdates();
    const addedTokens = await estimateMergedAppendTokens(
      nextHistory,
      previous.length,
      (row) => this.estimateContentTokens(row, this.activeTokenizationModel),
      this.mutationOwnership,
    );
    await this.commitHistoryMutation(
      {
        nextHistory,
        nextHistoryTokens: this.totalTokens + addedTokens,
        publishedRowStart: previous.length,
        streamPublication: !previous.hasPendingRows,
        options: {},
      },
      previous,
    );
  }

  /** Cold JSON chunks, byte-equivalent to JSON.stringify(history, null, 2). */
  streamJSON(signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
    return streamHistoryJson(this.streamRawHistory(signal), signal);
  }

  /** Await each sink write before pulling the next history row. */
  writeJSON(write: HistoryJsonSink, signal?: AbortSignal): Promise<void> {
    return writeHistoryJson(this.streamJSON(signal), write, signal);
  }

  /** Import history from JSON. */
  static fromJSON(json: string): HistoryService {
    const service = new HistoryService();
    const history = JSON.parse(json);
    service.addAll(history);
    return service;
  }

  /**
   * Mark compression as starting
   * This will cause add() operations to queue until compression completes
   */
  startCompression(origin?: object): void {
    this.logger.debug('Starting compression - locking history');
    this.isCompressing = true;
    this.emit('compressionStarted', origin);
  }

  /**
   * Mark compression as complete
   * This will flush all queued operations.
   * When summary and itemsCompressed are provided, emits a compressionEnded
   * event so the recording service can log the compression.
   */
  endCompression(
    summary?: IContent,
    itemsCompressed?: number,
    origin?: object,
  ): void {
    this.logger.debug('Compression complete - unlocking history', {
      pendingCount: this.pendingOperations.length,
    });

    this.isCompressing = false;

    try {
      this.pendingOperations.flush(() => {
        // Route the release events through the same mutation FIFO as the dequeued
        // closures: if an asynchronous mutation was in flight, its rebuild
        // contentAdded must land BEFORE these events (staying inside the recording
        // suppression window), then the streaming content after them (#3264). When
        // nothing is in flight this executes inline, behavior unchanged.
        this.runSynchronousHistoryMutation(() => {
          this.emit('compressionLockReleased', origin);

          if (summary && itemsCompressed !== undefined) {
            this.emit('compressionEnded', summary, itemsCompressed, origin);
          }
        });
      });
    } finally {
      // Reconcile the completed rebuild, never its transient cleared membership.
      this.enqueueSynchronousOwnershipSettlement();
    }
  }

  /**
   * Waits for the clears queued under the compression lock and reports the
   * failure of any that failed, once. Every other operation is applied or
   * queued in the mutation FIFO when it is called, so there is nothing else to
   * wait for.
   */
  async waitForPendingOperations(): Promise<void> {
    await this.queuedClears.settle();
  }

  /**
   * Get conversation statistics
   */
  getStatistics(): ConversationStatistics {
    return this.journal.statistics();
  }

  get compressionRowCount(): number | undefined {
    return this.journal.compressionRowCount?.();
  }

  /**
   * Get an ordered chronology trace: one compact, JSON-safe entry per history
   * item carrying its marker fields and structural descriptors. No message
   * text, tool parameters, or tool results appear in the trace.
   */
  async *getChronologyTrace(): AsyncGenerator<
    ChronologyTraceEntry,
    void,
    unknown
  > {
    for await (const content of this.journal.streamRows()) {
      const entry = projectChronologyTraceEntry(content);
      if (entry !== undefined) yield entry;
    }
  }

  /**
   * The highest chronology `seq` that the preserved head must always include.
   * Zero means no anchor has been established yet (#3070).
   */
  getCacheAnchorSeq(): number {
    return this.cacheAnchorSeq;
  }

  /**
   * Set the chronology identity of the current preserved-head boundary. The
   * boundary moves monotonically by array position, but chronology seq values
   * do not: synthetic compression entries receive newer seq values before
   * preserved tail entries. Exact identity, not numeric ordering, is required.
   */
  setCacheAnchorSeq(seq: number): void {
    if (!Number.isInteger(seq) || seq <= 0) {
      throw new Error(
        `Cache-anchor seq must be a positive integer: got ${seq}`,
      );
    }
    this.cacheAnchorSeq = seq;
  }

  /** Reset the anchor to 0 for session-reset / history-restore paths. @see #3070 */
  resetCacheAnchorSeq(): void {
    this.cacheAnchorSeq = 0;
  }
}
