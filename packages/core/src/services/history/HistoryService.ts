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

import {
  type IContent,
  type ToolCallBlock,
  type ToolResponseBlock,
} from './IContent.js';
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
import {
  ChronologyStamper,
  buildChronologyTrace,
  type ChronologyTraceEntry,
} from './historyChronology.js';

// Preserve the CompressionConfig export from the same path for consumers.
export type { CompressionConfig };

import {
  type MutationFailure,
  combineMutationFailures,
} from './historyMutationFailure.js';

type QueuedHistoryMutation =
  | { kind: 'synchronous'; execute: () => void }
  | {
      kind: 'asynchronous';
      execute: () => Promise<void>;
      resolve: () => void;
      reject: (error: unknown) => void;
    };

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
  private pendingTokenizerFailure: { error: unknown } | undefined;
  private syncGeneration: number = 0;
  private historyMutationInProgress = false;
  private historyMutationQueue: QueuedHistoryMutation[] = [];
  private logger = new DebugLogger('llxprt:history:service');

  private chronology = new ChronologyStamper();

  /**
   * Monotonic cache anchor: the highest chronology `seq` that must remain in
   * the preserved head across every subsequent middle-out compression. Once a
   * head entry is preserved by one compression, no later compression may drop
   * it, which keeps the provider-visible prefix byte-identical (#3070).
   *
   * Survives the compression clear/rebuild; reset explicitly by session-reset
   * and history-restore paths.
   */
  private cacheAnchorSeq: number = 0;

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
  private activeTokenizationModel = 'gpt-4.1';
  private activeTokenizationProvider?: string;

  private static readonly COMPRESSION_QUEUE_HIGH_WATER = 4096;
  private isCompressing: boolean = false;
  private pendingOperations: Array<() => void> = [];
  private pendingCompressionHighWaterReported: boolean = false;

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

  setActiveTokenizationTarget(
    modelName: string,
    activeProvider?: string,
  ): void {
    this.activeTokenizationModel = modelName;
    this.activeTokenizationProvider = activeProvider;
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
  private getTokenizerForModel(
    modelName: string,
    activeProvider?: string,
  ): ITokenizer {
    return getTokenizerForModel(activeProvider, modelName, {
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
    modelName = this.activeTokenizationModel,
  ): Promise<number> {
    if (!text) {
      return 0;
    }

    const tokenizer = this.getTokenizerForModel(
      modelName,
      this.activeTokenizationProvider,
    );
    try {
      return await tokenizer.countTokens(text);
    } catch (error) {
      if (tokenizer.fallbackPolicy === 'deny') {
        throw error;
      }
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
    const generation = this.syncGeneration;
    this.observeTokenizerOperation(
      this.runSerializedTokenOperation(() => {
        if (generation !== this.syncGeneration) return;

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
      }),
    );
  }

  private runSerializedTokenOperation<T>(
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const result = this.tokenizerLock.then(operation);
    this.tokenizerLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private observeTokenizerOperation(operation: Promise<void>): void {
    void operation.catch((error: unknown) => {
      this.pendingTokenizerFailure ??= { error };
      this.logger.error('Asynchronous token accounting failed', error);
    });
  }

  private invalidatePendingSyncs(): void {
    this.syncGeneration++;
  }

  private runSynchronousHistoryMutation(execute: () => void): void {
    if (this.historyMutationInProgress) {
      this.historyMutationQueue.push({ kind: 'synchronous', execute });
      return;
    }

    this.historyMutationInProgress = true;
    let failure: MutationFailure = { failed: false };
    try {
      execute();
    } catch (error: unknown) {
      failure = { failed: true, error };
    }
    const queuedFailure = this.drainSynchronousHistoryMutations();
    this.historyMutationInProgress = false;
    this.processHistoryMutationQueue();

    const combinedFailure = combineMutationFailures(failure, queuedFailure);
    if (combinedFailure.failed) throw combinedFailure.error;
  }

  private drainSynchronousHistoryMutations(): MutationFailure {
    let failure: MutationFailure = { failed: false };
    while (this.historyMutationQueue[0]?.kind === 'synchronous') {
      const mutation = this.historyMutationQueue.shift();
      if (mutation?.kind !== 'synchronous') break;
      try {
        mutation.execute();
      } catch (error: unknown) {
        failure = combineMutationFailures(failure, { failed: true, error });
      }
    }
    return failure;
  }

  private enqueueAsynchronousHistoryMutation(
    execute: () => Promise<void>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.historyMutationQueue.push({
        kind: 'asynchronous',
        execute,
        resolve,
        reject,
      });
      this.processHistoryMutationQueue();
    });
  }

  private processHistoryMutationQueue(): void {
    if (this.historyMutationInProgress) return;
    const mutation = this.historyMutationQueue.shift();
    if (mutation === undefined) return;
    if (mutation.kind === 'synchronous') {
      this.runSynchronousHistoryMutation(mutation.execute);
      return;
    }

    this.historyMutationInProgress = true;
    void mutation.execute().then(
      () =>
        this.completeAsynchronousHistoryMutation(mutation, { failed: false }),
      (error: unknown) =>
        this.completeAsynchronousHistoryMutation(mutation, {
          failed: true,
          error,
        }),
    );
  }

  private completeAsynchronousHistoryMutation(
    mutation: Extract<QueuedHistoryMutation, { kind: 'asynchronous' }>,
    failure: MutationFailure,
  ): void {
    const queuedFailure = this.drainSynchronousHistoryMutations();
    this.historyMutationInProgress = false;
    const result = combineMutationFailures(failure, queuedFailure);
    if (result.failed) mutation.reject(result.error);
    else mutation.resolve();
    this.processHistoryMutationQueue();
  }

  resetTokenAccounting(): void {
    this.invalidatePendingSyncs();
    this.baseTokenOffset = 0;
    this.emit('tokensUpdated', {
      totalTokens: this.getTotalTokens(),
      addedTokens: 0,
      contentId: null,
    });
  }

  /**
   * Add content to the history.
   * Zero-block turns are rejected at insertion (issue #2410): they corrupt
   * provider-facing history (z.ai rejects empty human turns with HTTP 400
   * error 1213). All other content with a valid speaker is accepted.
   */
  add(content: IContent, modelName?: string): void {
    if (this.isCompressing) {
      logQueuedDuringCompression(this.logger, content);
      this.queueCompressionOperation(() => {
        this.runSynchronousHistoryMutation(() => {
          this.addInternal(content, modelName);
        });
      });
      return;
    }

    this.runSynchronousHistoryMutation(() => {
      this.addInternal(content, modelName);
    });
  }

  /**
   * Queues an operation that arrived while compression held the history lock.
   *
   * Operations are never dropped and never rejected: `add()` is on the
   * streaming path, so failing here would lose conversation content and could
   * break a turn. `startCompression`/`endCompression` are balanced in a
   * `finally` by the only caller (`CompressionHandler.performCompression`), so
   * the lock is always released and the queue is bounded by how long a single
   * compression takes. Crossing the high-water mark is reported once so an
   * unbalanced lock would be diagnosable rather than silent (issue #2852).
   */
  private queueCompressionOperation(operation: () => void): void {
    this.pendingOperations.push(operation);
    if (
      !this.pendingCompressionHighWaterReported &&
      this.pendingOperations.length >=
        HistoryService.COMPRESSION_QUEUE_HIGH_WATER
    ) {
      this.pendingCompressionHighWaterReported = true;
      this.logger.error(
        'History compression queue exceeded its high-water mark; the compression lock is being held for an unexpectedly long time. No operations are dropped.',
        { pendingCount: this.pendingOperations.length },
      );
    }
  }

  private addInternal(content: IContent, modelName?: string): void {
    // Reject zero-block turns: a Content with no blocks corrupts provider-
    // facing history (notably z.ai rejects empty human turns with HTTP 400
    // error 1213, issue #2410). This is a systemic safety net — earlier
    // layers should prevent these from reaching history, but we enforce the
    // invariant here as the last line of defense.
    const hasValidSpeaker = ['human', 'ai', 'tool'].includes(content.speaker);
    const hasBlocks =
      Array.isArray(content.blocks) && content.blocks.length > 0;
    const accepted = hasValidSpeaker && hasBlocks;

    if (accepted) {
      // Stamp chronology only once the content is known to be accepted, so a
      // rejected turn never consumes a sequence number (#1721).
      this.chronology.stamp(content);
    }

    logContentAdded(this.logger, content, modelName);

    if (!accepted) {
      this.logger.debug(
        hasValidSpeaker
          ? 'Content rejected - zero blocks (issue #2410):'
          : 'Content rejected - invalid speaker:',
        content.speaker,
      );
      return;
    }

    const generation = this.syncGeneration;
    this.history.push(content);

    try {
      this.emit('contentAdded', content);
    } catch (error: unknown) {
      // Roll back the insertion. The consumed chronology sequence number is
      // intentionally NOT reclaimed: sequence numbers are never reused, and
      // the resulting gap truthfully records that an item was removed.
      this.history.pop();
      throw error;
    }

    // Update token count asynchronously but atomically
    this.observeTokenizerOperation(
      this.updateTokenCount(content, modelName, generation),
    );
  }

  /**
   * Atomically update token count for new content
   */
  private updateTokenCount(
    content: IContent,
    modelName?: string,
    generation = this.syncGeneration,
  ): Promise<void> {
    return this.runSerializedTokenOperation(async () => {
      // Always derive token counts from the stored content to avoid double counting
      // when providers attach aggregate usage metadata (which already includes prompt tokens).
      const defaultModel = modelName ?? this.activeTokenizationModel;
      const contentTokens = await this.estimateContentTokens(
        content,
        defaultModel,
      );
      if (generation !== this.syncGeneration) return;

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
  private tokenizerProvider(
    activeProvider = this.activeTokenizationProvider,
  ): TokenizerProvider {
    return {
      getTokenizerForModel: (modelName: string) =>
        this.getTokenizerForModel(modelName, activeProvider),
      activeProvider,
    };
  }

  /**
   * Add multiple contents to the history.
   *
   * Iterates a snapshot because `add` appends to `this.history`: if `contents`
   * aliases the backing array (`getRawHistory()`), a live iterator would keep
   * consuming its own appends and never terminate. `replaceAll` is already
   * immune the same way — its `filter` produces a fresh array before use.
   */
  addAll(contents: readonly IContent[], modelName?: string): void {
    for (const content of [...contents]) {
      this.add(content, modelName);
    }
  }

  async replaceAll(contents: IContent[], modelName?: string): Promise<void> {
    const accepted = contents.filter(
      (content) =>
        ['human', 'ai', 'tool'].includes(content.speaker) &&
        Array.isArray(content.blocks) &&
        content.blocks.length > 0,
    );
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.replaceAllInternal(accepted, modelName),
    );
  }

  private async replaceAllInternal(
    accepted: IContent[],
    modelName?: string,
  ): Promise<void> {
    await this.waitForTokenUpdates();
    const replacementTokens = await this.estimateTokensForContents(
      accepted,
      modelName,
    );
    const previousHistory = this.history;
    const previousTokens = this.totalTokens;
    this.invalidatePendingSyncs();
    // Uphold the chronology invariant on this insertion path too: items that
    // already carry a marker keep it, and anything new is stamped (#1721).
    for (const content of accepted) {
      this.chronology.stamp(content);
    }
    this.history = [...accepted];
    this.totalTokens = replacementTokens;
    try {
      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: replacementTokens - previousTokens,
        contentId: null,
      });
    } catch (error: unknown) {
      this.invalidatePendingSyncs();
      this.history = previousHistory;
      this.totalTokens = previousTokens;
      throw error;
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
    const failure = this.pendingTokenizerFailure;
    this.pendingTokenizerFailure = undefined;
    if (failure !== undefined) throw failure.error;
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
    // Each density replacement takes over the chronology position of the item
    // it replaces, so the surviving history keeps an unbroken sequence.
    // densityValidation stays free of chronology knowledge.
    for (const [index, replacement] of result.replacements) {
      const replacedMarker = this.history[index].metadata?.chronology;
      if (replacedMarker !== undefined) {
        this.chronology.inherit(replacement, replacedMarker);
      }
    }
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
    // Runtime invariant: the replacement MUST be a tool_response at runtime,
    // even though the TypeScript type already constrains it. A malformed
    // object with matching callId/toolName but wrong type (or missing type)
    // could slip through at runtime and corrupt tool-call/response pairing.
    const replacementType = (replacement as { type?: unknown }).type;
    if (replacementType !== 'tool_response') {
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
      // Restore BOTH invariants: the history array AND the token accounting.
      // recalculateTotalTokens may have already mutated this.totalTokens to
      // reflect the replacement content before a listener/event error aborted
      // the emit. Leaving totalTokens stale would corrupt the token budget.
      this.history[entryIndex] = previousEntry;
      this.totalTokens = previousTotalTokens;
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
    // Chronology counters are intentionally NOT reset: seq must never be reused
    // (NG8) so that items added after dispose() never collide with earlier ones.
  }

  /**
   * Clear all history
   */
  clear(): void {
    // If compression is active, queue this operation
    if (this.isCompressing) {
      this.logger.debug('Queueing clear operation during compression');
      this.queueCompressionOperation(() => {
        this.runSynchronousHistoryMutation(() => {
          this.clearInternal();
        });
      });
      return;
    }

    this.runSynchronousHistoryMutation(() => {
      this.clearInternal();
    });
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
   * Read-only snapshot of the newest chronology-marked history item. Returns
   * `null` when no item carries a chronology marker. The `turnId` comes from
   * the same item's `metadata.turnId` (null when absent).
   *
   * This is a pure accessor over existing state — no new stamping. It provides
   * the join keys (`turnId`, `userTurn`, `step`, `seq`) that the token-usage
   * turn record needs to align with the conversation.
   *
   * @issue #3130
   */
  getCurrentTurnMarker(): {
    turnId: string | null;
    userTurn: number;
    step: number;
    seq: number;
  } | null {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const marker = this.history[i].metadata?.chronology;
      if (marker !== undefined) {
        return {
          turnId: this.history[i].metadata?.turnId ?? null,
          userTurn: marker.userTurn,
          step: marker.step,
          seq: marker.seq,
        };
      }
    }
    return null;
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
