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

import { rewriteToolResponse } from './historyToolRewrite.js';
import { HistoryValidationRepair } from './historyValidationRepair.js';
import {
  removeHistoryTail,
  RemovalObserverFailure,
} from './historyRemoveTail.js';
import { clearHistoryRows } from './historyClearRows.js';
import { withFallbackRestoreRows } from './historyFallbackRows.js';
import {
  withMergedHistoryRows,
  estimateMergedAppendTokens,
} from './historyMergeRows.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
export type {
  HistoryDumpSource,
  HistoryDumpSnapshot,
} from './historyDumpSnapshot.js';
import { adoptResumeJournal } from './historyResumeAdoption.js';
import { publishResumeRestoration } from './historyResumeProjection.js';
import type { ResumeCursorBoot } from '../../recording/resumeCursorBoot.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { isDeepStrictEqual } from 'node:util';
import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent.js';
import { estimateContentTokens as estimateContentTokensImpl } from './historyTokenEstimation.js';
import {
  computeStatistics,
  type ConversationStatistics,
} from './curationDebugLogger.js';
import {
  findUnmatchedToolCalls as findUnmatchedToolCallsHelper,
  type ToolPairingStreamOptions,
} from './historyToolPairing.js';
export type { ToolPairingStreamOptions } from './historyToolPairing.js';
import {
  isCuratedContent,
  streamCuratedProviderHistory,
} from './historyCuration.js';
import { streamProviderContent } from './provider-curated-stream.js';

import {
  withSummaryRows,
  type HistorySummaryCallback,
} from './history-summary.js';
export type {
  HistorySummarySource,
  HistorySummaryCallback,
} from './history-summary.js';
import {
  streamHistoryJson,
  writeHistoryJson,
  type HistoryJsonSink,
} from './history-export.js';
export type { HistoryJsonSink } from './history-export.js';
import {
  projectChronologyTraceEntry,
  findCurrentTurnMarker,
  type CurrentTurnMarker,
  type ChronologyTraceEntry,
} from './historyChronology.js';
import { HistoryServiceCore } from './HistoryServiceCore.js';

import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import type { HistoryServiceJournalOptions } from './historyJournalStore.js';

export type {
  HistoryTransformEntry,
  HistoryTransformSource,
  HistoryTransformSink,
  HistoryRowTransformOptions,
  HistoryRowTransform,
} from './historyRowTransform.js';

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
export class HistoryService extends HistoryServiceCore {
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

  withRawHistorySnapshot<T>(
    execute: (snapshot: HistoryMutationSnapshot) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.journal.withMutationSnapshot(execute, signal);
  }

  restoreRawHistorySnapshot(
    snapshot: HistoryMutationSnapshot,
    modelName?: string,
  ): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(() =>
      withFallbackRestoreRows(
        snapshot,
        async (nextHistory) => {
          await this.waitForTokenUpdates();
          const nextHistoryTokens = await this.estimateTokensForContents(
            nextHistory.streamRows(),
            modelName,
          );
          await this.commitHistoryMutation({
            nextHistory,
            nextHistoryTokens,
            streamPublication: !snapshot.hasPendingRows,
            options: {},
          });
        },
        this.mutationOwnership,
      ),
    );
  }
  async adoptResumeBoot(
    recording: SessionRecordingService,
    boot: ResumeCursorBoot,
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
    recording: SessionRecordingService,
    boot: ResumeCursorBoot,
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
    return adoptResumeJournal({
      journal: this.journal,
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
   * Immutably replace a single tool_response block with a replacement
   * tool_response block, preserving callId/toolName invariants.
   *
   * Unlike a generic block-replacement API, this method enforces structural
   * invariants that compression/truncation callers rely on:
   *   - The target block at (entryIndex, blockIndex) MUST be a tool_response.
   *   - The replacement MUST be a tool_response.
   *   - The replacement MUST carry the same callId and toolName as the target.
   * This prevents accidental corruption of tool-call/response pairing.
   */
  async replaceToolResponseBlock(
    entryIndex: number,
    blockIndex: number,
    replacement: ToolResponseBlock,
    modelName?: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    let replaced = false;
    await this.enqueueAsynchronousHistoryMutation(async () => {
      replaced = await this.replaceToolResponseBlockInternal(
        entryIndex,
        blockIndex,
        replacement,
        modelName,
        signal,
      );
    });
    return replaced;
  }

  /**
   * Runs inside the asynchronous mutation FIFO so a concurrent add() observes
   * the replacement as one step rather than landing mid-recalculation.
   */
  private async replaceToolResponseBlockInternal(
    entryIndex: number,
    blockIndex: number,
    replacement: ToolResponseBlock,
    modelName?: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    let oldTokens = this.totalTokens;
    return rewriteToolResponse({
      journal: this.journal,
      entryIndex,
      blockIndex,
      replacement,
      ownership: this.mutationOwnership,
      owner: this.mediaOwner,
      signal,
      prepareTokens: async () => {
        await this.waitForTokenUpdates();
        oldTokens = this.totalTokens;
      },
      recalculate: () =>
        this.recalculateTotalTokensInternal(modelName, undefined, signal),
      restoreTokens: () => {
        this.totalTokens = oldTokens;
        this.notifyRestoredTokens();
      },
    });
  }

  async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* this.journal.streamRows(undefined, signal);
  }

  async getCurrentTurnMarker(): Promise<CurrentTurnMarker | null> {
    let latest: CurrentTurnMarker | null = null;
    for await (const row of this.streamRawHistory()) {
      const marker = findCurrentTurnMarker([row]);
      if (marker !== null) latest = marker;
    }
    return latest;
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
   * Release all listeners and internal buffers to allow GC
   */
  dispose(): void {
    this.runSynchronousHistoryMutation(() => this.disposeInternal());
  }

  private disposeInternal(): void {
    this.invalidatePendingSyncs();

    try {
      this.removeAllListeners();
    } catch {
      // Best-effort; listener removal is not critical
    }

    this.journal.dispose();
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
  }

  /**
   * Clear all history
   */
  clear(): void {
    const rebuilding = this.isCompressing && this.inRebuildScope;
    const clearAndRelease = (): void => {
      this.runSynchronousHistoryMutation(() => {
        try {
          this.clearInternal(rebuilding);
        } finally {
          if (!rebuilding) this.enqueueSynchronousOwnershipSettlement();
        }
      });
    };
    if (this.isCompressing) {
      this.logger.debug('Queueing clear operation during compression');
      this.queueCompressionOperation(clearAndRelease);
      return;
    }

    clearAndRelease();
  }

  private clearInternal(rebuilding: boolean): void {
    const previousTokens = this.totalTokens;
    const previousSpans = this.spanWindow.get();
    clearHistoryRows({
      journal: this.journal,
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

  /** Cold chronological suffix stream, preserving slice(-count), including count=0. */
  async *getRecent(
    count: number,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* this.journal.streamRows({ kind: 'recent', count }, signal);
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

  /** Cold stream of all content, including invalid/empty, pinned at first next(). */
  async *getComprehensive(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* this.journal.streamRows(undefined, signal);
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
    const tail = this.getLastContent();
    if (tail === undefined || !isDeepStrictEqual(tail, content)) return false;
    return (
      (await removeHistoryTail({
        journal: this.journal,
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
    return removeHistoryTail({
      journal: this.journal,
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
   * Get the last user (human) content
   */
  getLastUserContent(): IContent | undefined {
    return this.getLastContent('human');
  }

  /**
   * Get the last AI content
   */
  getLastAIContent(): IContent | undefined {
    return this.getLastContent('ai');
  }

  private getLastContent(speaker?: IContent['speaker']): IContent | undefined {
    return this.journal.withReadRows((cursor) => {
      for (const row of cursor.rows(true)) {
        if (speaker === undefined || row.speaker === speaker) return row;
      }
      return undefined;
    });
  }

  /**
   * Record a complete turn (user input + AI response + optional tool interactions)
   */
  recordTurn(
    userInput: IContent,
    aiResponse: IContent,
    toolInteractions?: IContent[],
  ): void {
    this.add(userInput);
    this.add(aiResponse);
    if (toolInteractions) {
      this.addAll(toolInteractions);
    }
  }

  /** Get the number of messages in history. */
  length(): number {
    return this.journal.getLength();
  }

  /** Check if history is empty. */
  isEmpty(): boolean {
    return this.journal.getLength() === 0;
  }

  /** Cold sanitized copies over membership pinned at the first next(). */
  async *clone(): AsyncGenerator<IContent, void, unknown> {
    for await (const content of this.journal.streamRows()) {
      yield sanitizeProviderContentForSerialization(content);
    }
  }

  /**
   * Find unmatched tool calls (tool calls without responses)
   */
  findUnmatchedToolCalls(
    options: ToolPairingStreamOptions = {},
  ): AsyncGenerator<ToolCallBlock, void, unknown> {
    return findUnmatchedToolCallsHelper(
      this.logger,
      this.journal.streamRows(),
      options,
    );
  }

  /**
   * Validate and fix the history to ensure proper tool call/response pairing
   */
  validateAndFix(): void {
    this.runSynchronousHistoryMutation(() => this.validateAndFixInternal());
  }

  private validateAndFixInternal(): void {
    const repair = new HistoryValidationRepair(this.mutationOwnership);
    const chronology = this.chronology.snapshot();
    try {
      const captured = this.journal.capturePendingFold();
      try {
        this.journal.adoptMutationBoundary(captured.durableTail);
      } finally {
        captured.release();
      }
      this.journal.withReadRows((cursor) =>
        repair.capture(cursor, (row) => this.chronology.stamp(row)),
      );
      repair.publish(this.journal);
    } catch (error) {
      this.chronology.restore(chronology);
      repair.close();
      throw error;
    }
    if (repair.inserted.length === 0) {
      repair.close();
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
          repair.rollback(this.journal);
        } finally {
          this.totalTokens = oldTokens;
          this.chronology.restore(chronology);
          this.notifyRestoredTokens();
        }
        throw error;
      } finally {
        repair.close();
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
    yield* streamProviderContent(
      streamCuratedProviderHistory(
        this.logger,
        historyOverride ?? this.journal.streamRows(undefined, signal),
        this.isCompressing,
        signal,
      ),
      tailContents,
      this.logger,
      { signal },
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
      this.journal.withMutationSnapshot((previous) =>
        other.withRawHistorySnapshot((incoming) =>
          withMergedHistoryRows(
            previous,
            incoming,
            async (nextHistory) => {
              await this.waitForTokenUpdates();
              const addedTokens = await estimateMergedAppendTokens(
                nextHistory,
                previous.length,
                (row) =>
                  this.estimateContentTokens(row, this.activeTokenizationModel),
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
            },
            this.mutationOwnership,
          ),
        ),
      ),
    );
  }

  /** Cold chronological stream of the newest contiguous suffix fitting the budget. */
  async *getWithinTokenLimit(
    maxTokens: number,
    countTokensFn: (content: IContent) => number,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    yield* this.journal.streamRows(
      { kind: 'tokens', maxTokens, countTokens: countTokensFn },
      signal,
    );
  }

  /**
   * Summarize older history to fit within token limits
   */
  async summarizeOldHistory(
    keepRecentCount: number,
    summarizeFn: HistorySummaryCallback,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.summarizeOldHistoryInternal(keepRecentCount, summarizeFn, signal),
    );
  }

  private async summarizeOldHistoryInternal(
    keepRecentCount: number,
    summarizeFn: HistorySummaryCallback,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.waitForTokenUpdates();
    const chronology = this.chronology.snapshot();
    try {
      await this.journal.withMutationSnapshot(async (previous) => {
        for (const row of previous) {
          if (row.metadata?.chronology !== undefined)
            this.chronology.stamp(row);
        }
        await withSummaryRows(
          previous,
          keepRecentCount,
          summarizeFn,
          async (nextHistory) => {
            const nextHistoryTokens = await this.estimateTokensForContents(
              nextHistory.streamRows(signal),
              this.activeTokenizationModel,
              signal,
            );
            await this.commitHistoryMutation(
              {
                nextHistory,
                nextHistoryTokens,
                streamPublication: !previous.hasPendingRows,
                signal,
                options: {},
              },
              previous,
            );
          },
          this.mutationOwnership,
          signal,
        );
      }, signal);
    } catch (error) {
      this.chronology.restore(chronology);
      throw error;
    }
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
  startCompression(): void {
    this.logger.debug('Starting compression - locking history');
    this.isCompressing = true;
    this.emit('compressionStarted');
  }

  /**
   * Mark compression as complete
   * This will flush all queued operations.
   * When summary and itemsCompressed are provided, emits a compressionEnded
   * event so the recording service can log the compression.
   */
  endCompression(summary?: IContent, itemsCompressed?: number): void {
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
          this.emit('compressionLockReleased');

          if (summary && itemsCompressed !== undefined) {
            this.emit('compressionEnded', summary, itemsCompressed);
          }
        });
      });
    } finally {
      // Reconcile the completed rebuild, never its transient cleared membership.
      this.enqueueSynchronousOwnershipSettlement();
    }
  }

  /**
   * Wait for all pending operations to complete
   * For synchronous operations, this is now a no-op but kept for API compatibility
   */
  async waitForPendingOperations(): Promise<void> {
    // Since operations are now synchronous, nothing to wait for
    return Promise.resolve();
  }

  /**
   * Get conversation statistics
   */
  getStatistics(): ConversationStatistics {
    return this.journal.withReadRows((cursor) =>
      computeStatistics(cursor.rows()),
    );
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
