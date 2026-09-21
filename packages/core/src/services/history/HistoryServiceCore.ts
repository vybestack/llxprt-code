/**
 * Copyright 2026 Vybestack LLC
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

import { finalizeMutationEffects } from './historyMutationFailure.js';
import { CompressionOperationQueue } from './historyCompressionQueue.js';
import { type IContent } from './IContent.js';
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
  logContentAdded,
  logQueuedDuringCompression,
} from './curationDebugLogger.js';
import {
  type HistoryServiceEventEmitter,
  type CompressionConfig,
  type ContextRange,
  type ContextSummaryInfo,
  type RemovedInteriorSpan,
} from './historyEventTypes.js';
import {
  computeContextSummaries,
  buildContextRangeSnapshot,
  collectDensitySpans,
  firstEntryContextRange,
  mergeCommitSpans,
} from './contextRange.js';
import { getTokenizerForModel } from './historyTokenizerAdapter.js';
import {
  ChronologyStamper,
  type ChronologyState,
} from './historyChronology.js';
import {
  HistoryJournalStore,
  planDensityMutation,
  planHistoryMutation,
  type HistoryJournalOp,
  type HistoryServiceJournalOptions,
} from './historyJournalStore.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { SpanWindow } from './historySpanWindow.js';
import { HistoryMutationFifo } from './historyMutationFifo.js';

// Preserve the CompressionConfig export from the same path for consumers.
export type { CompressionConfig };

// The journal options type rides the Core surface for facade consumers.
export type { HistoryServiceJournalOptions } from './historyJournalStore.js';

// Batch/ownership contracts moved to historyBatchContracts.ts (size budget);
// the public export surface of this module is unchanged.
export type {
  PreparedHistoryBatchEffect,
  HistoryBatchParticipant,
  HistoryOwnedMediaReservation,
  HistoryMediaOwner,
  HistoryBatchPublication,
  HistoryBatchOptions,
} from './historyBatchContracts.js';

import type {
  PreparedHistoryBatchEffect,
  HistoryBatchParticipant,
  HistoryOwnedMediaReservation,
  HistoryMediaOwner,
  HistoryBatchPublication,
  HistoryBatchOptions,
  ChronologyRollbackEntry,
} from './historyBatchContracts.js';

/**
 * Service for managing conversation history in a provider-agnostic way.
 * All history is stored as IContent. Providers are responsible for converting
 * to/from their own formats.
 */
export abstract class HistoryServiceCore
  extends EventEmitter
  implements HistoryServiceEventEmitter
{
  abstract recalculateTotalTokens(
    modelName?: string,
    activeProvider?: string,
  ): Promise<void>;

  /**
   * The journal is the system of record (#854): contents are never retained
   * in memory; reads materialize transiently from the journal fold plus the
   * not-yet-durable pending ops.
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  protected readonly journal: HistoryJournalStore;

  /**
   * Capped standing-state window for removed-interior spans (mutation-time
   * knowledge the journal fold cannot re-derive).
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  protected spanWindow = new SpanWindow();

  protected totalTokens: number = 0;
  protected baseTokenOffset: number = 0;
  protected tokenizerCache = new Map<string, ITokenizer>();
  protected tokenizerLock: Promise<void> = Promise.resolve();
  protected pendingTokenizerFailure: { error: unknown } | undefined;
  private syncGeneration: number = 0;
  private batchParticipants = new Set<HistoryBatchParticipant>();
  protected mediaOwner: HistoryMediaOwner | undefined;
  private ownershipSettlement: Promise<void> = Promise.resolve();
  private ownershipFailure: unknown;
  protected logger = new DebugLogger('llxprt:history:service');

  protected chronology = new ChronologyStamper();

  /**
   * Monotonic cache anchor: the highest chronology `seq` that must remain in
   * the preserved head across every subsequent middle-out compression. Once a
   * head entry is preserved by one compression, no later compression may drop
   * it, which keeps the provider-visible prefix byte-identical (#3070).
   *
   * Survives atomic compression replacement; reset explicitly by session-reset
   * and history-restore paths.
   */
  protected cacheAnchorSeq: number = 0;

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
  protected activeTokenizationModel = 'gpt-4.1';
  protected activeTokenizationProvider?: string;

  protected isCompressing: boolean = false;
  /**
   * True while a rebuild scope is running, so operations queued during the
   * rebuild are tagged 'rebuild' and replayed before streaming work (#3338,
   * #3264). Held here rather than in the subclass because this class owns the
   * queue the tag is applied to.
   */
  protected inRebuildScope = false;
  protected pendingOperations = new CompressionOperationQueue((pendingCount) =>
    this.logger.error(
      'History compression queue exceeded its high-water mark; the compression lock is being held for an unexpectedly long time. No operations are dropped.',
      { pendingCount },
    ),
  );

  /**
   * @param options.recording injects the journal store; omitted, the service
   *   creates its own temp-file-backed journal (no in-memory path exists).
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  protected constructor(options: HistoryServiceJournalOptions = {}) {
    super();
    this.journal = new HistoryJournalStore(options.recording);
  }

  /**
   * Transient materialization of the current history from the journal fold:
   * a fresh array on every call, retained by no one (#854).
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  protected materializeHistory(): IContent[] {
    return this.journal.materialize();
  }

  /** Attach the journal store after construction (foreground wiring order). */
  attachJournal(recorder: SessionRecordingService): void {
    this.journal.attachJournal(recorder);
  }

  /** The file backing the journal store, or null before the first record. */
  journalPath(): string | null {
    return this.journal.journalPath();
  }

  /**
   * Resolve once every mutation enqueued so far has a durable commit ack.
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  async waitForCommit(): Promise<void> {
    await this.journal.waitForDurable();
  }

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

  protected runSerializedTokenOperation<T>(
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const result = this.tokenizerLock.then(operation);
    this.tokenizerLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  protected observeTokenizerOperation(operation: Promise<void>): void {
    void operation.catch((error: unknown) => {
      this.pendingTokenizerFailure ??= { error };
      this.logger.error('Asynchronous token accounting failed', error);
    });
  }

  protected invalidatePendingSyncs(): void {
    this.syncGeneration++;
  }

  /**
   * The history mutation FIFO (extracted module; file size budget). Behavior
   * unchanged: synchronous mutations never interleave with asynchronous ones.
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  private readonly mutationFifo = new HistoryMutationFifo();

  protected runSynchronousHistoryMutation(execute: () => void): void {
    this.mutationFifo.runSynchronous(execute);
  }

  protected enqueueAsynchronousHistoryMutation(
    execute: () => Promise<void>,
  ): Promise<void> {
    return this.mutationFifo.enqueueAsynchronous(execute);
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
  protected queueCompressionOperation(operation: () => void): void {
    this.pendingOperations.enqueue(
      operation,
      this.inRebuildScope ? 'rebuild' : 'streaming',
    );
  }

  /**
   * Runs a rebuild synchronously so operations queued inside it are replayed
   * before streaming work.
   *
   * The callback returns `undefined` rather than `void` on purpose. An async
   * function returns `Promise<void>`, which is not assignable to `undefined`,
   * so the synchronous contract fails at compile time; an `await` inside the
   * scope would exit it and mis-tag the remaining work as streaming (#3338).
   */
  rebuildWith(callback: () => undefined): void {
    const previousScope = this.inRebuildScope;
    this.inRebuildScope = true;
    try {
      callback();
    } finally {
      this.inRebuildScope = previousScope;
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
    const wasEmpty = this.materializeHistory().length === 0;
    // Durable write first: the postcondition of every mutation is "journal
    // appended (awaitable ack) + observers notified" (#854).
    this.journal.apply({ kind: 'content', content });

    try {
      this.emit('contentAdded', content);
      this.mediaOwner?.adopt([content]);
    } catch (error: unknown) {
      // Roll back the insertion with a compensating rewind. The consumed
      // chronology sequence number is intentionally NOT reclaimed: sequence
      // numbers are never reused, and the resulting gap truthfully records
      // that an item was removed.
      this.journal.apply({
        kind: 'rewind',
        itemsRemoved: 1,
        cutSeq: content.metadata?.chronology?.seq,
      });
      throw error;
    }

    // Empty→first entry is a context boundary event (#854): the curated
    // context came into existence, so observers must learn its boundary even
    // though no batch commit ran. Emitted exactly once here; subsequent
    // single adds are silent. The span state resets with it so
    // getContextRange() stays at parity with this event: the context the old
    // spans described is gone.
    if (wasEmpty) {
      this.spanWindow.set([]);
      this.emit('contextRangeChanged', firstEntryContextRange(content));
    }

    // Update token count asynchronously but atomically
    this.observeTokenizerOperation(
      this.updateTokenCount(content, modelName, generation),
    );
  }

  /**
   * Atomically update token count for new content
   */
  protected updateTokenCount(
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
  protected async estimateContentTokens(
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
  protected tokenizerProvider(
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
   * Iterates a snapshot so a caller passing a materialized projection can
   * never have the iterator chase its own appends; `replaceAll` is already
   * immune the same way — its `filter` produces a fresh array before use.
   */
  addAll(contents: readonly IContent[], modelName?: string): void {
    for (const content of [...contents]) {
      this.add(content, modelName);
    }
  }

  addBatch(
    contents: readonly IContent[],
    modelName?: string,
    options: HistoryBatchOptions = {},
  ): Promise<void> {
    const batch = [...contents];
    return this.enqueueAsynchronousHistoryMutation(async () => {
      this.validateBatch(batch);
      if (batch.length === 0) return;
      await this.waitForTokenUpdates();
      const addedTokens = await this.estimateTokensForContents(
        batch,
        modelName,
      );
      await this.commitHistoryMutation({
        nextHistory: [...this.materializeHistory(), ...batch],
        nextHistoryTokens: this.totalTokens + addedTokens,
        publishedContents: batch,
        options,
      });
    });
  }

  replaceBatch(
    contents: readonly IContent[],
    modelName?: string,
    options: HistoryBatchOptions = {},
  ): Promise<void> {
    const replacement = [...contents];
    return this.enqueueAsynchronousHistoryMutation(async () => {
      this.validateBatch(replacement);
      await this.waitForTokenUpdates();
      const replacementTokens = await this.estimateTokensForContents(
        replacement,
        modelName,
      );
      await this.commitHistoryMutation({
        nextHistory: replacement,
        nextHistoryTokens: replacementTokens,
        publishedContents: replacement,
        options,
      });
    });
  }

  transformAll(
    transform: (
      contents: readonly IContent[],
    ) => readonly IContent[] | Promise<readonly IContent[]>,
    modelName?: string,
    options: HistoryBatchOptions = {},
  ): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(async () => {
      const replacement = [...(await transform(this.materializeHistory()))];
      this.validateBatch(replacement);
      await this.waitForTokenUpdates();
      const replacementTokens = await this.estimateTokensForContents(
        replacement,
        modelName,
      );
      await this.commitHistoryMutation({
        nextHistory: replacement,
        nextHistoryTokens: replacementTokens,
        options,
      });
    });
  }

  registerBatchParticipant(participant: HistoryBatchParticipant): () => void {
    this.batchParticipants.add(participant);
    return () => {
      this.batchParticipants.delete(participant);
    };
  }

  registerMediaOwner(owner: HistoryMediaOwner): void {
    this.mediaOwner = owner;
    owner.adopt(this.materializeHistory());
  }

  settleMediaOwnership(): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(async () => {
      await this.mediaOwner?.reconcile(
        this.materializeHistory(),
        () => this.materializeHistory(),
      );
    });
  }

  async waitForOwnershipSettlement(): Promise<void> {
    let settlement: Promise<void>;
    do {
      settlement = this.ownershipSettlement;
      await settlement;
    } while (settlement !== this.ownershipSettlement);
    const failure = this.ownershipFailure;
    this.ownershipFailure = undefined;
    if (failure !== undefined) throw failure;
  }

  private observeOwnershipOperation(operation: Promise<void>): void {
    const observed = operation.then(
      () => undefined,
      (error: unknown) => {
        this.ownershipFailure =
          this.ownershipFailure === undefined
            ? error
            : new AggregateError(
                [this.ownershipFailure, error],
                'Multiple history media ownership operations failed',
              );
      },
    );
    this.ownershipSettlement = this.ownershipSettlement.then(() => observed);
  }

  protected enqueueSynchronousOwnershipReconcile(
    previous: readonly IContent[],
    getNext: () => readonly IContent[],
  ): void {
    const owner = this.mediaOwner;
    if (owner === undefined) return;
    this.observeOwnershipOperation(
      this.enqueueAsynchronousHistoryMutation(() =>
        owner.reconcile(previous, getNext),
      ),
    );
  }

  protected enqueueSynchronousOwnershipReleaseAll(): void {
    const owner = this.mediaOwner;
    if (owner === undefined) return;
    this.observeOwnershipOperation(
      this.enqueueAsynchronousHistoryMutation(() => owner.releaseAll()),
    );
  }

  /**
   * The curated in-memory context boundary plus the v2 membership projection
   * (#854): boundary fields derived from the transient journal fold, joined
   * with the capped span window and the compressed spans re-derived from
   * summary metadata.
   *
   * @plan PLAN-20260917-ISSUE854.P01
   * @requirement REQ-854-004
   */
  getContextRange(): ContextRange {
    return buildContextRangeSnapshot(
      this.materializeHistory(),
      this.spanWindow.get(),
    );
  }

  /**
   * Projections of every summary entry currently in context, derived from
   * each entry's `chronologyReplaced` metadata.
   *
   * @plan PLAN-20260917-ISSUE854.P01
   * @requirement REQ-854-004
   */
  getContextSummaries(): ContextSummaryInfo[] {
    return computeContextSummaries(this.materializeHistory());
  }

  /**
   * Emits `contextRangeChanged` with the current boundary snapshot. Called
   * only from boundary-moving commit paths (history mutations and clear);
   * single-entry `add` emits only for the empty→first transition, from
   * `addInternal` directly.
   *
   * @plan PLAN-20260917-ISSUE854.P01
   * @requirement REQ-854-004
   */
  protected emitContextRangeChanged(): void {
    this.emit(
      'contextRangeChanged',
      buildContextRangeSnapshot(
        this.materializeHistory(),
        this.spanWindow.get(),
      ),
    );
  }

  replaceAll(
    contents: readonly IContent[],
    modelName?: string,
    options: HistoryBatchOptions = {},
  ): Promise<void> {
    const accepted = [...contents].filter(
      (content) =>
        ['human', 'ai', 'tool'].includes(content.speaker) &&
        Array.isArray(content.blocks) &&
        content.blocks.length > 0,
    );
    return this.enqueueAsynchronousHistoryMutation(async () => {
      await this.waitForTokenUpdates();
      const replacementTokens = await this.estimateTokensForContents(
        accepted,
        modelName,
      );
      await this.commitHistoryMutation({
        nextHistory: accepted,
        nextHistoryTokens: replacementTokens,
        options,
      });
    });
  }

  private validateBatch(contents: readonly IContent[]): void {
    for (const [index, content] of contents.entries()) {
      const validSpeaker = ['human', 'ai', 'tool'].includes(content.speaker);
      const validBlocks =
        Array.isArray(content.blocks) && content.blocks.length > 0;
      if (!validSpeaker || !validBlocks) {
        throw new Error(
          `History batch entry ${index} is invalid: ${validSpeaker ? 'content has no blocks' : 'speaker is invalid'}`,
        );
      }
    }
  }

  private stampHistory(contents: readonly IContent[]): {
    readonly state: ChronologyState;
    readonly entries: readonly ChronologyRollbackEntry[];
  } {
    const state = this.chronology.snapshot();
    const entries = contents.map((content) => ({
      content,
      hadMetadata: content.metadata !== undefined,
      chronology: content.metadata?.chronology,
    }));
    for (const content of contents) {
      this.chronology.stamp(content);
    }
    return { state, entries };
  }

  private restoreChronology(input: {
    readonly state: ChronologyState;
    readonly entries: readonly ChronologyRollbackEntry[];
  }): void {
    this.chronology.restore(input.state);
    for (const entry of input.entries) {
      if (!entry.hadMetadata) {
        delete entry.content.metadata;
      } else if (entry.chronology === undefined) {
        if (entry.content.metadata?.chronology !== undefined) {
          delete entry.content.metadata.chronology;
        }
      } else if (
        entry.content.metadata !== undefined &&
        entry.content.metadata.chronology !== entry.chronology
      ) {
        entry.content.metadata.chronology = entry.chronology;
      }
    }
  }

  private async prepareMutationEffects(
    effects: PreparedHistoryBatchEffect[],
    publication: HistoryBatchPublication | undefined,
    previousHistory: readonly IContent[],
    nextHistory: readonly IContent[],
    adopted: readonly HistoryOwnedMediaReservation[],
  ): Promise<void> {
    if (this.mediaOwner !== undefined) {
      effects.push(
        await this.mediaOwner.prepareReplacement({
          previous: previousHistory,
          next: nextHistory,
          adopted,
        }),
      );
    }
    if (publication !== undefined) {
      for (const participant of this.batchParticipants) {
        effects.push(await participant(publication));
      }
    }
  }

  private async rollbackMutationEffects(
    effects: readonly PreparedHistoryBatchEffect[],
  ): Promise<unknown[]> {
    const failures: unknown[] = [];
    for (const effect of [...effects].reverse()) {
      try {
        await effect.rollback();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    return failures;
  }

  private async commitHistoryMutation(input: {
    readonly nextHistory: readonly IContent[];
    readonly nextHistoryTokens: number;
    readonly publishedContents?: readonly IContent[];
    readonly extraRemovedInterior?: readonly RemovedInteriorSpan[];
    /**
     * Precomputed journal ops for mutations whose durable shape is narrower
     * than the generic previous→next diff (density passes). When omitted,
     * the diff is planned from the two projections.
     *
     * @plan PLAN-20260917-ISSUE854.P05b3
     */
    readonly journalPlan?: readonly HistoryJournalOp[];
    readonly options: HistoryBatchOptions;
  }): Promise<void> {
    const previousHistory = this.materializeHistory();
    const previousTokens = this.totalTokens;
    const previousSpans = this.spanWindow.get();
    const chronology = this.stampHistory(input.nextHistory);
    const nextHistory = [...input.nextHistory];
    // Membership state after this mutation (#854): accumulated spans joined
    // with the mutation's own removals (density spans pre-derived, strict
    // seq-prefix truncation as rewound), computed before any effect can run
    // and applied atomically with the durable journal ops.
    const committedSpans = mergeCommitSpans(
      previousSpans,
      input.extraRemovedInterior,
      previousHistory,
      nextHistory,
    );
    const addedTokens = input.nextHistoryTokens - previousTokens;
    const publication: HistoryBatchPublication | undefined =
      input.publishedContents === undefined
        ? undefined
        : {
            contents: input.publishedContents,
            nextHistory,
            addedTokens,
            totalTokens: this.baseTokenOffset + input.nextHistoryTokens,
          };
    const effects: PreparedHistoryBatchEffect[] = [];
    let historyPublished = false;
    try {
      await this.prepareMutationEffects(
        effects,
        publication,
        previousHistory,
        nextHistory,
        input.options.adoptedOwners ?? [],
      );
      for (const effect of effects) {
        await effect.publish();
      }

      this.invalidatePendingSyncs();
      // The swap point: the journal receives the mutation's durable ops and
      // becomes the new state of record (#854).
      for (const op of input.journalPlan ?? planHistoryMutation(previousHistory, nextHistory)) {
        this.journal.apply(op);
      }
      this.totalTokens = input.nextHistoryTokens;
      this.spanWindow.set(committedSpans);
      historyPublished = true;
      if (input.publishedContents !== undefined) {
        this.emit('contentBatchAdded', input.publishedContents);
      }
      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens,
        contentId: null,
      });
      await input.options.afterPublication?.();
      await finalizeMutationEffects(effects);
      this.emitContextRangeChanged();
    } catch (error: unknown) {
      if (historyPublished) {
        this.invalidatePendingSyncs();
        // Compensating ops restore the previous projection; the journal is
        // append-only, so a rollback is the inverse plan, not an erasure.
        for (const op of planHistoryMutation(nextHistory, previousHistory)) {
          this.journal.apply(op);
        }
        this.totalTokens = previousTokens;
        this.spanWindow.set(previousSpans);
      }
      this.restoreChronology(chronology);
      const rollbackFailures = await this.rollbackMutationEffects(effects);
      if (rollbackFailures.length === 0) throw error;
      throw new AggregateError(
        [error, ...rollbackFailures],
        'History mutation and rollback failed',
      );
    }
  }

  /**
   * Estimate total tokens for hypothetical contents without mutating history.
   */
  async estimateTokensForContents(
    contents: readonly IContent[],
    modelName?: string,
  ): Promise<number> {
    return estimateTokensForContentsImpl(
      [...contents],
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
    await this.enqueueAsynchronousHistoryMutation(async () => {
      const currentHistory = this.materializeHistory();
      validateDensityResult(result, currentHistory.length);
      // Membership spans of the entries this pass destroys (#854); indices
      // are validated against the current projection above.
      const densitySpans = collectDensitySpans(currentHistory, result);
      // Each density replacement takes over the chronology position of the item
      // it replaces, so the surviving history keeps an unbroken sequence.
      // densityValidation stays free of chronology knowledge.
      for (const [index, replacement] of result.replacements) {
        const replacedMarker = currentHistory[index].metadata?.chronology;
        if (replacedMarker !== undefined) {
          this.chronology.inherit(replacement, replacedMarker);
        }
      }
      const nextHistory = [...currentHistory];
      applyDensityMutations(nextHistory, result);
      await this.waitForTokenUpdates();
      const replacementTokens =
        await this.estimateTokensForContents(nextHistory);
      await this.commitHistoryMutation({
        nextHistory,
        nextHistoryTokens: replacementTokens,
        extraRemovedInterior: densitySpans,
        // The durable shape of a density pass is one addressed mutation, not
        // a rewrite; falls back to the generic diff for unmarked rows.
        journalPlan: planDensityMutation(currentHistory, result) ?? undefined,
        options: {},
      });

      this.logger.debug('Density: applied result', {
        replacements: result.replacements.size,
        removals: result.removals.length,
        newHistoryLength: this.materializeHistory().length,
        metadata: result.metadata,
      });
    });
  }
}
