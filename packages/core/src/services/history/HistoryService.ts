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
import { deepCloneWithoutCircularRefs } from './historyCloneUtils.js';

export type {
  CompressionConfig,
  HistoryBatchOptions,
  HistoryBatchParticipant,
  HistoryBatchPublication,
  HistoryMediaOwner,
  HistoryOwnedMediaReservation,
  PreparedHistoryBatchEffect,
} from './HistoryServiceCore.js';

function hasToolResponseType(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, 'type') === 'tool_response';
}

/**
 * Provider-neutral conversation history service.
 *
 * Mutation, ownership, chronology, and token-accounting mechanics live in the
 * cohesive base implementation. This class owns history queries, lifecycle,
 * compression coordination, and serialization.
 */
export class HistoryService extends HistoryServiceCore {
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
    if (
      !Number.isInteger(entryIndex) ||
      entryIndex < 0 ||
      entryIndex >= this.history.length
    ) {
      return false;
    }
    const entry = this.history[entryIndex];
    if (
      !Number.isInteger(blockIndex) ||
      blockIndex < 0 ||
      blockIndex >= entry.blocks.length
    ) {
      return false;
    }

    const target = entry.blocks[blockIndex];
    if (target.type !== 'tool_response') {
      return false;
    }
    if (!hasToolResponseType(replacement)) {
      return false;
    }
    if (
      target.callId !== replacement.callId ||
      target.toolName !== replacement.toolName
    ) {
      return false;
    }

    const newBlocks = [...entry.blocks];
    newBlocks[blockIndex] = replacement;
    const previousEntry = this.history[entryIndex];
    const previousTotalTokens = this.totalTokens;
    this.history[entryIndex] = { ...entry, blocks: newBlocks };

    try {
      await this.recalculateTotalTokens(modelName);
    } catch (error) {
      this.history[entryIndex] = previousEntry;
      this.totalTokens = previousTotalTokens;
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
   * Return a read-only typed view of the backing history array.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P08
   * @requirement REQ-HD-003.5
   * @pseudocode history-service.md lines 10-15
   */
  getRawHistory(): readonly IContent[] {
    return this.history;
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

      for (const entry of this.history) {
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
        entryCount: this.history.length,
      });

      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: newTotal - previousTotal,
        contentId: null,
      });
    });
  }

  /** Get all history (shallow copy). */
  getAll(): IContent[] {
    return [...this.history];
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

    this.history = [];
    this.totalTokens = 0;
    this.baseTokenOffset = 0;
    this.isCompressing = false;
    this.pendingOperations = [];
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
    this.logger.debug('Clearing history', {
      previousLength: this.history.length,
    });

    this.invalidatePendingSyncs();

    const previousTokens = this.totalTokens;
    this.history = [];
    this.totalTokens = 0;
    // Chronology counters are intentionally NOT reset on clear (NG8): seq must
    // never be reused so items added after a clear never collide with earlier ones.

    // Emit event with reset count
    this.emit('tokensUpdated', {
      totalTokens: this.getTotalTokens(),
      addedTokens: -previousTokens, // Negative to indicate removal
      contentId: null,
    });
  }

  /** Get the last N messages from history. */
  getRecent(count: number): IContent[] {
    return this.history.slice(-count);
  }

  /**
   * Get curated history (only valid, meaningful content)
   * Matches the behavior of extractCuratedHistory in chatSession.ts:
   * - Always includes user/human messages
   * - Always includes tool messages
   * - Only includes AI messages if they are valid (have content)
   */
  getCurated(): IContent[] {
    return buildCuratedHistory(this.logger, this.history, this.isCompressing);
  }

  /** Get comprehensive history (all content including invalid/empty). */
  getComprehensive(): IContent[] {
    return this.getAll();
  }

  /** Remove the last content if it matches the provided content. */
  removeLastIfMatches(content: IContent): boolean {
    const last = this.history[this.history.length - 1];
    if (last === content) {
      const previous = [...this.history];
      this.history.pop();
      this.enqueueSynchronousOwnershipReconcile(previous, () => this.history);
      return true;
    }
    return false;
  }

  /** Pop the last content from history. */
  pop(): IContent | undefined {
    const previous = [...this.history];
    const removed = this.history.pop();
    if (removed) {
      this.enqueueSynchronousOwnershipReconcile(previous, () => this.history);
      // Recalculate tokens since we removed content
      // This is less efficient but ensures accuracy
      this.observeTokenizerOperation(this.recalculateTokens());
    }
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

      for (const content of this.history) {
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
    return getLastContentBySpeaker(this.history, 'human');
  }

  /**
   * Get the last AI content
   */
  getLastAIContent(): IContent | undefined {
    return getLastContentBySpeaker(this.history, 'ai');
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
    return this.history.length;
  }

  /** Check if history is empty. */
  isEmpty(): boolean {
    return this.history.length === 0;
  }

  /** Clone the history without serializing immutable media payloads. */
  clone(): IContent[] {
    return deepCloneWithoutCircularRefs(this.history);
  }

  /**
   * Find unmatched tool calls (tool calls without responses)
   */
  findUnmatchedToolCalls(): ToolCallBlock[] {
    return findUnmatchedToolCallsHelper(this.logger, this.history);
  }

  /**
   * Validate and fix the history to ensure proper tool call/response pairing
   */
  validateAndFix(): void {
    const respondedCallIds = collectRespondedCallIds(this.history);

    let insertedCount = 0;

    for (let i = 0; i < this.history.length; i++) {
      const missing = getMissingToolCalls(this.history[i], respondedCallIds);
      if (missing.length > 0) {
        const stampedSynthetic = this.chronology.stamp(
          createSyntheticToolMessage(missing),
        );

        this.history.splice(i + 1, 0, stampedSynthetic);
        insertedCount += 1;

        for (const tc of missing) {
          respondedCallIds.add(tc.id);
        }

        this.observeTokenizerOperation(this.updateTokenCount(stampedSynthetic));
        i += 1;
      }
    }

    this.logger.debug('History validation complete:', {
      insertedSyntheticToolMessages: insertedCount,
      historyLength: this.history.length,
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
    return getWithinTokenLimitHelper(this.history, maxTokens, countTokensFn);
  }

  /**
   * Summarize older history to fit within token limits
   */
  async summarizeOldHistory(
    keepRecentCount: number,
    summarizeFn: (contents: IContent[]) => Promise<IContent>,
  ): Promise<void> {
    const result = await summarizeOldHistoryHelper(
      this.history,
      keepRecentCount,
      summarizeFn,
    );
    if (result) {
      // Stamp every item: retained items already carry a marker and keep it,
      // while the freshly generated summary gets a new one.
      for (const item of result) {
        this.chronology.stamp(item);
      }
      this.history = result;
      await this.recalculateTotalTokens();
    }
  }

  /** Export history to JSON. */
  toJSON(): string {
    return JSON.stringify(this.history, null, 2);
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
    this.pendingCompressionHighWaterReported = false;

    // Flush all pending operations
    const operations = this.pendingOperations;
    this.pendingOperations = [];

    for (const operation of operations) {
      operation();
    }

    this.logger.debug('Flushed pending operations', {
      count: operations.length,
    });

    if (summary && itemsCompressed !== undefined) {
      this.emit('compressionEnded', summary, itemsCompressed);
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
    return computeStatistics(this.history);
  }

  /**
   * Get an ordered chronology trace: one compact, JSON-safe entry per history
   * item carrying its marker fields and structural descriptors. No message
   * text, tool parameters, or tool results appear in the trace.
   */
  getChronologyTrace(): ChronologyTraceEntry[] {
    return buildChronologyTrace(this.history);
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
