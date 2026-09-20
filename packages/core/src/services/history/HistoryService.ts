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

import { invalidateResponsesStatefulChainForRetainedRewrite as invalidateRetainedRewrite } from './IContent.js';
import { isDeepStrictEqual } from 'node:util';
import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent.js';
import { estimateContentTokens as estimateContentTokensImpl } from './historyTokenEstimation.js';
import {
  computeStatistics,
  type ConversationStatistics,
} from './curationDebugLogger.js';
import {
  collectRespondedCallIds,
  getMissingToolCalls,
  createSyntheticToolMessage,
  findUnmatchedToolCalls as findUnmatchedToolCallsHelper,
} from './historyToolPairing.js';
import { buildCuratedHistory } from './historyCuration.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import { getLastContentBySpeaker } from './historyQuery.js';
import {
  getWithinTokenLimit as getWithinTokenLimitHelper,
  summarizeOldHistory as summarizeOldHistoryHelper,
} from './historyContextWindow.js';
import {
  buildChronologyTrace,
  type ChronologyTraceEntry,
} from './historyChronology.js';
import { HistoryServiceCore } from './HistoryServiceCore.js';
import { recordClearedSpan } from './contextRange.js';
import { sanitizeProviderHistoryForSerialization } from './historyCloneUtils.js';
import {
  planHistoryMutation,
  type HistoryServiceJournalOptions,
} from './historyJournalStore.js';

export type {
  CompressionConfig,
  HistoryBatchOptions,
  HistoryBatchParticipant,
  HistoryBatchPublication,
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
  ): Promise<boolean> {
    let replaced = false;
    await this.enqueueAsynchronousHistoryMutation(async () => {
      replaced = await this.replaceToolResponseBlockInternal(
        entryIndex,
        blockIndex,
        replacement,
        modelName,
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
  ): Promise<boolean> {
    const rows = this.materializeHistory();
    const entry = Number.isInteger(entryIndex) ? rows[entryIndex] : undefined;
    if (entry === undefined) return false;
    const target = Number.isInteger(blockIndex)
      ? entry.blocks[blockIndex]
      : undefined;
    if (target?.type !== 'tool_response') return false;
    // Runtime invariant: the replacement MUST be a tool_response at runtime,
    // even though the TypeScript type already constrains it. A malformed
    // object with matching callId/toolName but wrong type (or missing type)
    // could slip through at runtime and corrupt tool-call/response pairing.
    const replacementType = (replacement as { type?: unknown }).type;
    if (replacementType !== 'tool_response') return false;
    if (target.callId !== replacement.callId) return false;
    if (target.toolName !== replacement.toolName) return false;
    if (isDeepStrictEqual(target, replacement)) return true;

    const newBlocks = [...entry.blocks];
    newBlocks[blockIndex] = replacement;
    const candidateHistory = [...rows];
    candidateHistory[entryIndex] = { ...entry, blocks: newBlocks };
    const nextHistory = invalidateRetainedRewrite(candidateHistory, entryIndex);

    // The generic planner emits one addressed replacement op per value-
    // changed row; rows the retained-rewrite invalidation touched plan the
    // same way (#854).
    const journalPlan = planHistoryMutation(rows, nextHistory);
    const oldTokens = this.totalTokens;
    for (const op of journalPlan) {
      this.journal.apply(op);
    }

    try {
      await this.recalculateTotalTokens(modelName);
    } catch (error) {
      // Restore BOTH invariants: the journal projection AND the token
      // accounting. recalculateTotalTokens may have already mutated
      // totalTokens to reflect the replacement content before a listener/
      // event error aborted the emit. Leaving totalTokens stale would
      // corrupt the token budget.
      for (const op of planHistoryMutation(nextHistory, rows)) {
        this.journal.apply(op);
      }
      this.totalTokens = oldTokens;
      // Best-effort notification so healthy listeners observe the rollback.
      // A broken listener that originally caused the failure must not mask
      // the original error.
      try {
        this.emit('tokensUpdated', {
          totalTokens: this.getTotalTokens(),
          addedTokens: 0,
          contentId: null,
        });
      } catch (emitError) {
        this.logger.debug(
          'tokensUpdated emit during rollback failed; original error preserved',
          emitError,
        );
      }
      throw error;
    }
    return true;
  }

  /**
   * Return a transient materialization of the current history (#854): a
   * fresh array per call — the journal is the system of record, so there is
   * no backing array to hand out.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P08
   * @requirement REQ-HD-003.5
   * @pseudocode history-service.md lines 10-15
   */
  getRawHistory(): readonly IContent[] {
    return this.materializeHistory();
  }

  /**
   * Force a full token recalculation after density operations.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P08
   * @requirement REQ-HD-003.6
   * @pseudocode history-service.md lines 90-120
   */
  recalculateTotalTokens(
    modelName = this.activeTokenizationModel,
    activeProvider = this.activeTokenizationProvider,
  ): Promise<void> {
    return this.runSerializedTokenOperation(async () => {
      let newTotal = 0;
      const tokenizerProvider = this.tokenizerProvider(activeProvider);
      const history = this.materializeHistory();

      for (const entry of history) {
        const entryTokens = await estimateContentTokensImpl(
          entry,
          modelName,
          tokenizerProvider,
          this.logger,
        );
        newTotal += entryTokens;
      }

      const previousTotal = this.totalTokens;
      this.totalTokens = newTotal;

      this.logger.debug('Density: recalculated total tokens', {
        previousTotal,
        newTotal,
        entryCount: history.length,
      });

      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: newTotal - previousTotal,
        contentId: null,
      });
    });
  }

  /** Get all history as a transient materialization (fresh array per call). */
  getAll(): IContent[] {
    return this.materializeHistory();
  }

  /**
   * Release all listeners and internal buffers to allow GC
   */
  dispose(): void {
    this.invalidatePendingSyncs();

    try {
      this.removeAllListeners();
    } catch {
      // Best-effort; listener removal is not critical
    }

    this.journal.dispose();
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
    const clearAndRelease = (): void => {
      this.runSynchronousHistoryMutation(() => {
        this.clearInternal();
      });
      this.enqueueSynchronousOwnershipReleaseAll();
    };
    if (this.isCompressing) {
      this.logger.debug('Queueing clear operation during compression');
      this.queueCompressionOperation(clearAndRelease);
      return;
    }

    clearAndRelease();
  }

  private clearInternal(): void {
    const previousHistory = this.materializeHistory();
    this.logger.debug('Clearing history', {
      previousLength: previousHistory.length,
    });

    this.invalidatePendingSyncs();

    // Record the cleared membership span while the boundary is still readable
    // (#854); the emitted snapshot below joins it with the emptied history.
    this.spanWindow.set(
      recordClearedSpan(this.spanWindow.get(), previousHistory),
    );

    const previousTokens = this.totalTokens;
    for (const op of planHistoryMutation(previousHistory, [])) {
      this.journal.apply(op);
    }
    this.totalTokens = 0;
    // Chronology counters are intentionally NOT reset on clear (NG8): seq must
    // never be reused so items added after a clear never collide with earlier ones.

    // Emit event with reset count
    this.emit('tokensUpdated', {
      totalTokens: this.getTotalTokens(),
      addedTokens: -previousTokens, // Negative to indicate removal
      contentId: null,
    });
    this.emitContextRangeChanged();
  }

  /** Get the last N messages from history. */
  getRecent(count: number): IContent[] {
    return this.materializeHistory().slice(-count);
  }

  /**
   * Get curated history (only valid, meaningful content)
   * Matches the behavior of extractCuratedHistory in chatSession.ts:
   * - Always includes user/human messages
   * - Always includes tool messages
   * - Only includes AI messages if they are valid (have content)
   */
  getCurated(): IContent[] {
    return buildCuratedHistory(
      this.logger,
      this.materializeHistory(),
      this.isCompressing,
    );
  }

  /** Get comprehensive history (all content including invalid/empty). */
  getComprehensive(): IContent[] {
    return this.getAll();
  }

  /**
   * Remove the last content if it matches the provided content. Matching is
   * by value (#854): reads materialize fresh projections, so a previously
   * added object's reference identity no longer exists to compare against.
   */
  removeLastIfMatches(content: IContent): boolean {
    const previous = this.materializeHistory();
    if (
      previous.length > 0 &&
      isDeepStrictEqual(previous[previous.length - 1], content)
    ) {
      const last = previous[previous.length - 1];
      this.journal.apply({
        kind: 'rewind',
        itemsRemoved: 1,
        cutSeq: last.metadata?.chronology?.seq,
      });
      this.enqueueSynchronousOwnershipReconcile(previous, () =>
        this.materializeHistory(),
      );
      return true;
    }
    return false;
  }

  /** Pop the last content from history. */
  pop(): IContent | undefined {
    const previous = this.materializeHistory();
    if (previous.length === 0) {
      return undefined;
    }
    const removed = previous[previous.length - 1];
    this.journal.apply({
      kind: 'rewind',
      itemsRemoved: 1,
      cutSeq: removed.metadata?.chronology?.seq,
    });
    this.enqueueSynchronousOwnershipReconcile(previous, () =>
      this.materializeHistory(),
    );
    // Recalculate tokens since we removed content
    // This is less efficient but ensures accuracy
    this.observeTokenizerOperation(this.recalculateTokens());
    return removed;
  }

  /**
   * Recalculate total tokens from scratch
   * Use this when removing content or when token counts might be stale
   */
  recalculateTokens(
    defaultModel = this.activeTokenizationModel,
  ): Promise<void> {
    return this.runSerializedTokenOperation(async () => {
      let newTotal = 0;
      const history = this.materializeHistory();

      for (const content of history) {
        newTotal += await this.estimateContentTokens(content, defaultModel);
      }

      const oldTotal = this.totalTokens;
      this.totalTokens = newTotal;

      // Emit event with updated count
      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: this.totalTokens - oldTotal,
        contentId: null,
      });
    });
  }

  /**
   * Get the last user (human) content
   */
  getLastUserContent(): IContent | undefined {
    return getLastContentBySpeaker(this.materializeHistory(), 'human');
  }

  /**
   * Get the last AI content
   */
  getLastAIContent(): IContent | undefined {
    return getLastContentBySpeaker(this.materializeHistory(), 'ai');
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
    return this.materializeHistory().length;
  }

  /** Check if history is empty. */
  isEmpty(): boolean {
    return this.materializeHistory().length === 0;
  }

  /** Clone the history without serializing immutable media payloads. */
  clone(): IContent[] {
    return sanitizeProviderHistoryForSerialization(this.materializeHistory());
  }

  /**
   * Find unmatched tool calls (tool calls without responses)
   */
  findUnmatchedToolCalls(): ToolCallBlock[] {
    return findUnmatchedToolCallsHelper(this.logger, this.materializeHistory());
  }

  /**
   * Validate and fix the history to ensure proper tool call/response pairing
   */
  validateAndFix(): void {
    const previous = this.materializeHistory();
    const respondedCallIds = collectRespondedCallIds(previous);
    const next = [...previous];

    let insertedCount = 0;

    for (let i = 0; i < next.length; i++) {
      const missing = getMissingToolCalls(next[i], respondedCallIds);
      if (missing.length > 0) {
        const stampedSynthetic = this.chronology.stamp(
          createSyntheticToolMessage(missing),
        );

        next.splice(i + 1, 0, stampedSynthetic);
        insertedCount += 1;

        for (const tc of missing) {
          respondedCallIds.add(tc.id);
        }

        this.observeTokenizerOperation(this.updateTokenCount(stampedSynthetic));
        i += 1;
      }
    }

    if (insertedCount > 0) {
      // Durable form of the insertions (#854): plan the ops that turn the
      // previous projection into the fixed one (wholesale rewrite — interior
      // insertions are not a marked prefix).
      for (const op of planHistoryMutation(previous, next)) {
        this.journal.apply(op);
      }
    }

    this.logger.debug('History validation complete:', {
      insertedSyntheticToolMessages: insertedCount,
      historyLength: next.length,
    });
  }

  /**
   * Get curated history with circular references removed for providers.
   * This ensures the history can be safely serialized and sent to providers.
   * A request-scoped override lets semantic purge prepare an isolated candidate
   * without mutating the live conversation before provider success.
   */
  getCuratedForProvider(
    tailContents: IContent[] = [],
    historyOverride?: readonly IContent[],
  ): IContent[] {
    const curated =
      historyOverride === undefined
        ? this.getCurated()
        : buildCuratedHistory(
            this.logger,
            [...historyOverride],
            this.isCompressing,
          );
    return buildProviderContent(curated, tailContents, this.logger);
  }

  /**
   * Streaming form of {@link getCuratedForProvider} (issue #854): the same
   * curation and provider-content pipeline over a fresh journal-fold
   * projection, yielded row by row instead of returned as a retained array.
   * Rows are sanitized clones, so cyclic tool payloads stringify safely with
   * the `_circular` marker and caller rows are never mutated.
   *
   * @param tailContents appended after the curated rows, exactly as the
   *   synchronous form does.
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  async *getCuratedForProviderStream(
    tailContents: IContent[] = [],
  ): AsyncIterable<IContent> {
    const curated = buildCuratedHistory(
      this.logger,
      this.materializeHistory(),
      this.isCompressing,
    );
    const providerContents = buildProviderContent(
      curated,
      tailContents,
      this.logger,
    );
    yield* providerContents;
  }

  /** Merge two histories, handling duplicates and conflicts. */
  merge(other: HistoryService): void {
    // Simple append for now - could be made smarter to detect duplicates
    this.addAll(other.getAll());
  }

  /**
   * Get history within a token limit (for context window management)
   */
  getWithinTokenLimit(
    maxTokens: number,
    countTokensFn: (content: IContent) => number,
  ): IContent[] {
    return getWithinTokenLimitHelper(
      this.materializeHistory(),
      maxTokens,
      countTokensFn,
    );
  }

  /**
   * Summarize older history to fit within token limits
   */
  async summarizeOldHistory(
    keepRecentCount: number,
    summarizeFn: (contents: IContent[]) => Promise<IContent>,
  ): Promise<void> {
    const previous = this.materializeHistory();
    const result = await summarizeOldHistoryHelper(
      previous,
      keepRecentCount,
      summarizeFn,
    );
    if (result) {
      // Stamp every item: retained items already carry a marker and keep it,
      // while the freshly generated summary gets a new one.
      for (const item of result) {
        this.chronology.stamp(item);
      }
      for (const op of planHistoryMutation(previous, result)) {
        this.journal.apply(op);
      }
      await this.recalculateTotalTokens();
    }
  }

  /** Export history to JSON. */
  toJSON(): string {
    return JSON.stringify(this.materializeHistory(), null, 2);
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
    return computeStatistics(this.materializeHistory());
  }

  /**
   * Get an ordered chronology trace: one compact, JSON-safe entry per history
   * item carrying its marker fields and structural descriptors. No message
   * text, tool parameters, or tool results appear in the trace.
   */
  getChronologyTrace(): ChronologyTraceEntry[] {
    return buildChronologyTrace(this.materializeHistory());
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
