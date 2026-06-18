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

import { type IContent, type ToolCallBlock } from './IContent.js';
import { EventEmitter } from 'events';
// @plan:PLAN-20260603-ISSUE1584.P05 RuntimeTokenizerFactory used for injection path
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer as ITokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';
import { DebugLogger } from '../../debug/index.js';
import { randomUUID } from 'crypto';
import { canonicalizeToolCallId } from './canonicalToolIds.js';
import type { DensityResult } from '../../core/compression/types.js';
import {
  estimateContentTokens as estimateContentTokensImpl,
  estimateTokensForContents as estimateTokensForContentsImpl,
  resolveModelName,
  simpleTokenEstimateForText,
  type TokenizerProvider,
} from './historyTokenEstimation.js';
import {
  validateDensityResult,
  applyDensityMutations,
} from './densityValidation.js';
import {
  computeStatistics,
  type ConversationStatistics,
  logContentAdded,
  logQueuedDuringCompression,
} from './curationDebugLogger.js';
import {
  type HistoryServiceEventEmitter,
  type CompressionConfig,
} from './historyEventTypes.js';
import { getTokenizerForModel } from './historyTokenizerAdapter.js';
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

// Preserve the CompressionConfig export from the same path for consumers.
export type { CompressionConfig };

/**
 * Service for managing conversation history in a provider-agnostic way.
 * All history is stored as IContent. Providers are responsible for converting
 * to/from their own formats.
 */
export class HistoryService
  extends EventEmitter
  implements HistoryServiceEventEmitter
{
  private history: IContent[] = [];
  private totalTokens: number = 0;
  private baseTokenOffset: number = 0;
  private tokenizerCache = new Map<string, ITokenizer>();
  private tokenizerLock: Promise<void> = Promise.resolve();
  private logger = new DebugLogger('llxprt:history:service');

  /**
   * @plan:PLAN-20260603-ISSUE1584.P05
   * @requirement:REQ-DEP-001
   * @pseudocode component-boundaries.md C-CB-01, lines 10-15
   *
   * Injected tokenizer factory. When provided, HistoryService uses the factory
   * to obtain tokenizers instead of constructing provider tokenizers directly.
   * This eliminates the core→providers import dependency on the injection path.
   */
  private tokenizerFactory?: RuntimeTokenizerFactory;

  // Compression state and queue
  private isCompressing: boolean = false;
  private pendingOperations: Array<() => void> = [];

  /**
   * @plan:PLAN-20260603-ISSUE1584.P05
   * @requirement:REQ-DEP-001
   * @pseudocode component-boundaries.md C-CB-01, lines 10-15
   *
   * Set the tokenizer factory for injection-based tokenizer resolution.
   * When set, getTokenizerForModel will prefer the factory over
   * constructing provider tokenizers directly.
   */
  setTokenizerFactory(factory: RuntimeTokenizerFactory): void {
    this.tokenizerFactory = factory;
    this.tokenizerCache.clear();
  }

  /**
   * Get or create tokenizer for a specific model.
   *
   * @plan:PLAN-20260603-ISSUE1584.P05
   * @requirement:REQ-DEP-001
   * @pseudocode component-boundaries.md C-CB-01, lines 10-15
   *
   * When a RuntimeTokenizerFactory is injected, it is preferred over
   * direct provider tokenizer construction. This removes the core→providers
   * dependency when using the injection path.
   */
  private getTokenizerForModel(modelName: string): ITokenizer {
    return getTokenizerForModel(modelName, {
      tokenizerCache: this.tokenizerCache,
      tokenizerFactory: this.tokenizerFactory,
    });
  }

  /**
   * Generate a new canonical history tool ID.
   * Format: hist_tool_<hash>
   */
  generateHistoryId(
    turnKey: string,
    callIndex: number,
    providerName?: string,
    rawId?: string,
    toolName?: string,
  ): string {
    return canonicalizeToolCallId({
      providerName,
      rawId,
      toolName,
      turnKey,
      callIndex,
    });
  }

  /**
   * Get a callback suitable for passing into converters
   * which will generate normalized history IDs on demand.
   */
  getIdGeneratorCallback(turnKey?: string): () => string {
    let callIndex = 0;
    const stableTurnKey = turnKey ?? this.generateTurnKey();
    return () => this.generateHistoryId(stableTurnKey, callIndex++);
  }

  generateTurnKey(): string {
    return `turn_${randomUUID()}`;
  }

  /**
   * Get the current total token count including base offset (system prompt).
   *
   * This value is used for compression threshold calculations and should always
   * reflect the total context size that will be sent to the API.
   *
   * @returns baseTokenOffset + totalTokens (history tokens)
   */
  getTotalTokens(): number {
    return this.baseTokenOffset + this.totalTokens;
  }

  getBaseTokenOffset(): number {
    return this.baseTokenOffset;
  }

  async estimateTokensForText(
    text: string,
    modelName: string = 'gpt-4.1',
  ): Promise<number> {
    if (!text) {
      return 0;
    }

    try {
      const tokenizer = this.getTokenizerForModel(modelName);
      return await tokenizer.countTokens(text);
    } catch (error) {
      this.logger.debug(
        'Error counting tokens for raw text, using fallback:',
        error,
      );
      return simpleTokenEstimateForText(text);
    }
  }

  /**
   * Set a base offset that is always included in the total token count.
   * Useful for accounting for system prompts or other fixed overhead.
   *
   * The system prompt token count should be set once at chat start using this method.
   * This offset is included in getTotalTokens() to ensure compression threshold
   * calculations account for the full context size (system prompt + history).
   *
   * NOTE: The system prompt itself is NEVER compressed - only conversation history
   * returned by getCurated() is subject to compression.
   *
   * @param offset - Number of tokens in the system prompt or fixed overhead
   */
  setBaseTokenOffset(offset: number): void {
    const normalized = Math.max(0, Math.floor(offset));
    const delta = normalized - this.baseTokenOffset;
    this.baseTokenOffset = normalized;

    if (delta !== 0) {
      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: delta,
        contentId: null,
      });
    }
  }

  /**
   * Sync the total token count to match actual prompt tokens from a provider.
   * This adjusts the baseTokenOffset so estimates align with the real count.
   */
  syncTotalTokens(actualTotal: number): void {
    if (!Number.isFinite(actualTotal)) {
      this.logger.debug('Skipping syncTotalTokens for non-finite value', {
        actualTotal,
      });
      return;
    }

    const normalized = Math.max(0, Math.floor(actualTotal));

    // Ensure sync happens after any pending token estimation updates.
    this.tokenizerLock = this.tokenizerLock.then(() => {
      const currentTotal = this.getTotalTokens();
      const drift = normalized - currentTotal;

      if (drift === 0) {
        return;
      }

      this.baseTokenOffset += drift;

      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: drift,
        contentId: null,
      });
    });
  }

  /**
   * Add content to the history
   * Note: We accept all content including empty responses for comprehensive history.
   * Filtering happens only when getting curated history.
   */
  add(content: IContent, modelName?: string): void {
    // If compression is active, queue this operation
    if (this.isCompressing) {
      logQueuedDuringCompression(this.logger, content);

      this.pendingOperations.push(() => {
        this.addInternal(content, modelName);
      });
      return;
    }

    // Otherwise, add immediately
    this.addInternal(content, modelName);
  }

  private addInternal(content: IContent, modelName?: string): void {
    logContentAdded(this.logger, content, modelName);

    // Only do basic validation - must have valid speaker
    if (['human', 'ai', 'tool'].includes(content.speaker)) {
      this.history.push(content);

      this.logger.debug(
        'Content added successfully, history length:',
        this.history.length,
      );

      this.emit('contentAdded', content);

      // Update token count asynchronously but atomically
      void this.updateTokenCount(content, modelName);
    } else {
      this.logger.debug('Content rejected - invalid speaker:', content.speaker);
    }
  }

  /**
   * Atomically update token count for new content
   */
  private async updateTokenCount(
    content: IContent,
    modelName?: string,
  ): Promise<void> {
    // Use a lock to prevent race conditions
    this.tokenizerLock = this.tokenizerLock.then(async () => {
      // Always derive token counts from the stored content to avoid double counting
      // when providers attach aggregate usage metadata (which already includes prompt tokens).
      const defaultModel = modelName ?? 'gpt-4.1';
      const contentTokens = await this.estimateContentTokens(
        content,
        defaultModel,
      );

      // Atomically update the total
      this.totalTokens += contentTokens;

      // Emit event with updated count
      const eventData = {
        totalTokens: this.getTotalTokens(),
        addedTokens: contentTokens,
        contentId: content.metadata?.id,
      };

      this.logger.debug('Emitting tokensUpdated:', eventData);

      this.emit('tokensUpdated', eventData);
    });

    return this.tokenizerLock;
  }

  /**
   * Estimate token count for content using tokenizer
   */
  private async estimateContentTokens(
    content: IContent,
    modelName: string,
  ): Promise<number> {
    return estimateContentTokensImpl(
      content,
      modelName,
      this.tokenizerProvider(),
      this.logger,
    );
  }

  /** Provide the TokenizerProvider interface for the token estimation helpers. */
  private tokenizerProvider(): TokenizerProvider {
    return {
      getTokenizerForModel: (modelName: string) =>
        this.getTokenizerForModel(modelName),
    };
  }

  /**
   * Add multiple contents to the history
   */
  addAll(contents: IContent[], modelName?: string): void {
    for (const content of contents) {
      this.add(content, modelName);
    }
  }

  /**
   * Estimate total tokens for hypothetical contents without mutating history.
   */
  async estimateTokensForContents(
    contents: IContent[],
    modelName?: string,
  ): Promise<number> {
    return estimateTokensForContentsImpl(
      contents,
      modelName,
      this.tokenizerProvider(),
      this.logger,
    );
  }

  /**
   * Wait for any in-flight token updates to complete.
   */
  async waitForTokenUpdates(): Promise<void> {
    await this.tokenizerLock;
  }

  /**
   * Apply a density optimization result to the raw history.
   *
   * @plan PLAN-20260211-HIGHDENSITY.P08
   * @requirement REQ-HD-003.1, REQ-HD-003.2, REQ-HD-003.3, REQ-HD-001.6, REQ-HD-001.7
   * @pseudocode history-service.md lines 20-82
   */
  async applyDensityResult(result: DensityResult): Promise<void> {
    validateDensityResult(result, this.history.length);
    applyDensityMutations(this.history, result);

    this.logger.debug('Density: applied result', {
      replacements: result.replacements.size,
      removals: result.removals.length,
      newHistoryLength: this.history.length,
      metadata: result.metadata,
    });

    // T1: Full recalculation through tokenizerLock
    await this.recalculateTotalTokens();
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
  async recalculateTotalTokens(): Promise<void> {
    this.tokenizerLock = this.tokenizerLock.then(async () => {
      let newTotal = 0;
      const defaultModel = 'gpt-4.1';

      for (const entry of this.history) {
        const entryTokens = await this.estimateContentTokens(
          entry,
          defaultModel,
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

    return this.tokenizerLock;
  }

  /** Get all history (shallow copy). */
  getAll(): IContent[] {
    return [...this.history];
  }

  /**
   * Release all listeners and internal buffers to allow GC
   */
  dispose(): void {
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
  }

  /**
   * Clear all history
   */
  clear(): void {
    // If compression is active, queue this operation
    if (this.isCompressing) {
      this.logger.debug('Queueing clear operation during compression');
      this.pendingOperations.push(() => {
        this.clearInternal();
      });
      return;
    }

    // Otherwise, clear immediately
    this.clearInternal();
  }

  private clearInternal(): void {
    this.logger.debug('Clearing history', {
      previousLength: this.history.length,
    });

    const previousTokens = this.totalTokens;
    this.history = [];
    this.totalTokens = 0;

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
      this.history.pop();
      return true;
    }
    return false;
  }

  /** Pop the last content from history. */
  pop(): IContent | undefined {
    const removed = this.history.pop();
    if (removed) {
      // Recalculate tokens since we removed content
      // This is less efficient but ensures accuracy
      void this.recalculateTokens();
    }
    return removed;
  }

  /**
   * Recalculate total tokens from scratch
   * Use this when removing content or when token counts might be stale
   */
  async recalculateTokens(defaultModel: string = 'gpt-4.1'): Promise<void> {
    this.tokenizerLock = this.tokenizerLock.then(async () => {
      let newTotal = 0;

      for (const content of this.history) {
        // Use the model from content metadata, or fall back to provided default
        const modelToUse = resolveModelName(
          content.metadata?.model,
          defaultModel,
        );
        newTotal += await this.estimateContentTokens(content, modelToUse);
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

    return this.tokenizerLock;
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

  /** Clone the history (deep copy). */
  clone(): IContent[] {
    return JSON.parse(JSON.stringify(this.history));
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
        const syntheticToolMessage = createSyntheticToolMessage(missing);

        this.history.splice(i + 1, 0, syntheticToolMessage);
        insertedCount += 1;

        for (const tc of missing) {
          respondedCallIds.add(tc.id);
        }

        void this.updateTokenCount(syntheticToolMessage);
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
   */
  getCuratedForProvider(tailContents: IContent[] = []): IContent[] {
    const curated = this.getCurated();
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
}
