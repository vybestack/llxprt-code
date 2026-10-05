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

import {
  createDetachedHistoryAPI,
  type DetachedHistoryAPI,
} from './detachedHistoryAPI.js';
import { finalizeHistoryMutation } from './finalizeHistoryMutation.js';
import { CompressionOperationQueue } from './historyCompressionQueue.js';
import { HistoryTokenTickets } from './history-token-tickets.js';
import { type IContent } from './IContent.js';
import { EventEmitter } from 'events';
// @plan:PLAN-20260603-ISSUE1584.P05 RuntimeTokenizerFactory used for injection path
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
import type { RuntimeTokenizer as ITokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';
import { DebugLogger } from '../../debug/index.js';
import { randomUUID } from 'crypto';
import {
  withHistoryRowTransform,
  prepareRowTransformMutation,
  type HistoryRowTransform,
  type HistoryRowTransformOptions,
} from './historyRowTransform.js';

import { canonicalizeToolCallId } from './canonicalToolIds.js';
import type { DensityResult } from '../../core/compression/types.js';
import {
  estimateContentTokens as estimateContentTokensImpl,
  estimateTokensForContents as estimateTokensForContentsImpl,
  simpleTokenEstimateForText,
  type TokenizerProvider,
} from './historyTokenEstimation.js';
import { restorePendingChronologyFailure } from './historyArrayDensity.js';
import {
  acceptedHistoryValues,
  densityValueTransform,
} from './historyValueEntries.js';
import {
  withDiskDensityMutation,
  projectDensityCommitSpans,
  type DiskDensityOptimizer,
} from './historyDiskDensity.js';
import {
  logContentAdded,
  logQueuedDuringCompression,
} from './curationDebugLogger.js';
import {
  type HistoryServiceEventEmitter,
  type HistoryEventRegistration,
  type HistoryEventEmission,
  type CompressionConfig,
  type ContextRange,
  type ContextSummaryInfo,
} from './historyEventTypes.js';
import {
  buildContextRangeSnapshot,
  firstEntryContextRange,
} from './contextRange.js';
import { getTokenizerForModel } from './historyTokenizerAdapter.js';
import {
  ChronologyStamper,
  restoreMutationChronology,
  stampMutationChronology,
  type ChronologyState,
} from './historyChronology.js';
import {
  HistoryJournalStore,
  type HistoryServiceJournalOptions,
} from './historyJournalStore.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { SpanWindow } from './historySpanWindow.js';
import { HistoryMutationFifo } from './historyMutationFifo.js';
import { compensateMutation } from './planHistoryMutation.js';
import { HistoryMutationPublication } from './historyMutationPublication.js';
import {
  rollbackMutationEffects,
  prepareMutationEffects,
  historyMutationFailure,
} from './historyMutationEffects.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { HistoryMutationInput } from './historyBatchContracts.js';
import {
  chronologyOwners,
  trackMutationOwners,
} from './historyMutationOwnership.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

// Preserve the CompressionConfig export from the same path for consumers.
export type { CompressionConfig };

// The journal options type rides the Core surface for facade consumers.
export type { HistoryServiceJournalOptions } from './historyJournalStore.js';

// Batch/ownership contracts moved to historyBatchContracts.ts (size budget);
// the public export surface of this module is unchanged.
export type {
  PreparedHistoryBatchEffect,
  HistoryOwnedMediaReservation,
  HistoryMediaOwner,
  HistoryBatchOptions,
} from './historyBatchContracts.js';

import type {
  PreparedHistoryBatchEffect,
  HistoryMediaOwner,
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
  declare on: HistoryEventRegistration<this>;
  declare once: HistoryEventRegistration<this>;
  declare addListener: HistoryEventRegistration<this>;
  declare prependListener: HistoryEventRegistration<this>;
  declare prependOnceListener: HistoryEventRegistration<this>;
  declare off: HistoryEventRegistration<this>;
  declare removeListener: HistoryEventRegistration<this>;
  declare emit: HistoryEventEmission;

  abstract recalculateTotalTokens(
    modelName?: string,
    activeProvider?: string,
    signal?: AbortSignal,
  ): Promise<void>;

  /**
   * The journal is the system of record (#854): contents are never retained
   * in memory; reads materialize transiently from the journal fold plus the
   * not-yet-durable pending ops.
   *
   * @plan PLAN-20260917-ISSUE854.P05b3
   */
  protected readonly journal: HistoryJournalStore;
  readonly detachedValues: DetachedHistoryAPI;

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
  protected readonly tokenTickets = new HistoryTokenTickets(
    (execute) =>
      this.observeTokenizerOperation(this.serializeTokenOperation(execute)),
    async ({ content, modelName, generation }) => {
      this.mutationOwnership?.retain(content);
      try {
        const contentTokens = await this.estimateContentTokens(
          content,
          modelName ?? this.activeTokenizationModel,
        );
        if (generation !== this.syncGeneration) return;
        this.totalTokens += contentTokens;
        this.emit('tokensUpdated', {
          totalTokens: this.getTotalTokens(),
          addedTokens: contentTokens,
          contentId: content.metadata?.id,
        });
      } finally {
        this.mutationOwnership?.release(content);
      }
    },
    (error) => {
      this.pendingTokenizerFailure ??= { error };
      this.logger.error('Asynchronous token accounting failed', error);
    },
  );
  protected pendingTokenizerFailure: { error: unknown } | undefined;
  private syncGeneration: number = 0;
  protected mediaOwner: HistoryMediaOwner | undefined;
  private ownershipSettlement: Promise<void> = Promise.resolve();
  private ownershipFailure: unknown;
  protected logger = new DebugLogger('llxprt:history:service');
  protected readonly mutationOwnership?: RowOwnership;

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
    this.mutationOwnership = options.mutationOwnership;
    this.journal = new HistoryJournalStore(
      options.recording,
      options.attachmentCounters,
      options.mutationOwnership,
    );
    this.detachedValues = createDetachedHistoryAPI(
      this,
      this.journal,
      this.chronology,
      this.spanWindow,
      this.mutationOwnership,
      () => this.mediaOwner,
      (execute) => this.enqueueAsynchronousHistoryMutation(execute),
      (tokens) => {
        this.invalidatePendingSyncs();
        this.totalTokens = tokens;
      },
    );
  }

  /** Attach the journal store after construction (foreground wiring order). */
  attachJournal(
    recorder: SessionRecordingService,
    replace = false,
    onAttached?: () => void,
  ): Promise<void> {
    if (this.journal.isAdoptingRecorder(recorder)) {
      onAttached?.();
      return Promise.resolve();
    }
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.journal.attachJournal(recorder, replace, onAttached),
    );
  }

  detachJournal(recorder: SessionRecordingService): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.journal.detachJournal(recorder),
    );
  }

  onJournalRetired(listener: () => void): () => void {
    return this.journal.onRetired(listener);
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
    await this.enqueueAsynchronousHistoryMutation(async () => {
      await this.journal.waitForDurable();
      this.journal.retireIdleTicketStorage();
    });
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
    this.runSynchronousHistoryMutation(() => {
      this.tokenizerFactory = factory;
      this.tokenizerCache.clear();
    });
  }

  setActiveTokenizationTarget(
    modelName: string,
    activeProvider?: string,
  ): void {
    this.runSynchronousHistoryMutation(() => {
      this.activeTokenizationModel = modelName;
      this.activeTokenizationProvider = activeProvider;
    });
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
    this.runSynchronousHistoryMutation(() => {
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
    });
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
    this.tokenTickets.seal();
    return this.serializeTokenOperation(operation);
  }

  private serializeTokenOperation<T>(
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
    this.runSynchronousHistoryMutation(() => {
      this.invalidatePendingSyncs();
      this.baseTokenOffset = 0;
      this.emit('tokensUpdated', {
        totalTokens: this.getTotalTokens(),
        addedTokens: 0,
        contentId: null,
      });
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
    const wasEmpty = this.journal.getLength() === 0;
    const token = this.tokenTickets.prepare(content, modelName, generation);
    let tokenPublished = false;
    try {
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
      this.tokenTickets.publish(token);
      tokenPublished = true;
    } finally {
      if (!tokenPublished) this.tokenTickets.cancel(token);
    }
  }

  /**
   * Estimate token count for content using tokenizer
   */
  protected async estimateContentTokens(
    content: IContent,
    modelName: string,
    signal?: AbortSignal,
  ): Promise<number> {
    return estimateContentTokensImpl(
      content,
      modelName,
      this.tokenizerProvider(),
      this.logger,
      signal,
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
    if (contents.length === 0)
      return this.enqueueAsynchronousHistoryMutation(() => Promise.resolve());
    return this.detachedValues.append(contents, modelName, options);
  }

  replaceBatch(
    contents: readonly IContent[],
    modelName?: string,
    options: HistoryBatchOptions = {},
  ): Promise<void> {
    return this.detachedValues.replace(contents, modelName, {
      ...options,
      publishBatch: true,
    });
  }

  transformRows(
    transform: HistoryRowTransform,
    modelName?: string,
    options: HistoryRowTransformOptions = {},
  ): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(() =>
      this.journal.withMutationSnapshot((previous) =>
        withHistoryRowTransform(
          previous,
          transform,
          async (nextHistory) => {
            await this.commitHistoryMutation(
              await prepareRowTransformMutation(
                nextHistory,
                this,
                modelName,
                options,
              ),
              previous,
            );
          },
          this.mutationOwnership,
          options.signal,
        ),
      ),
    );
  }

  transformAll(
    transform: HistoryRowTransform,
    modelName?: string,
    options: HistoryRowTransformOptions = {},
  ): Promise<void> {
    return this.transformRows(transform, modelName, options);
  }

  registerMediaOwner(owner: HistoryMediaOwner): void {
    this.runSynchronousHistoryMutation(() => {
      this.mediaOwner = owner;
      this.journal.withReadRows((cursor) => owner.adopt(cursor.rows()));
    });
  }

  settleMediaOwnership(): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(async () => {
      const owner = this.mediaOwner;
      if (owner === undefined) return;
      await this.journal.withMutationSnapshot((previous) =>
        owner.reconcile(previous, () => previous),
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

  protected enqueueSynchronousOwnershipSettlement(): void {
    if (this.mediaOwner === undefined) return;
    this.observeOwnershipOperation(this.settleMediaOwnership());
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
    return this.journal.withReadRows((cursor) =>
      buildContextRangeSnapshot(cursor.rows(), this.spanWindow.get()),
    );
  }

  /**
   * Projections of every summary entry currently in context, derived from
   * each entry's `chronologyReplaced` metadata.
   *
   * @plan PLAN-20260917-ISSUE854.P01
   * @requirement REQ-854-004
   */
  async *getContextSummaries(): AsyncIterable<ContextSummaryInfo> {
    for await (const entry of this.journal.streamRows()) {
      const replaced = entry.metadata?.chronologyReplaced;
      if (replaced === undefined) continue;
      let text = '';
      for (const block of entry.blocks) {
        if (block.type === 'text') text += block.text;
      }
      yield {
        seq: entry.metadata?.chronology?.seq ?? 0,
        replacedFromSeq: replaced.fromSeq,
        replacedToSeq: replaced.toSeq,
        itemCount: replaced.toSeq - replaced.fromSeq + 1,
        text,
      };
    }
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
    this.emit('contextRangeChanged', this.getContextRange());
  }

  replaceAll(
    contents: readonly IContent[],
    modelName?: string,
    options: HistoryBatchOptions = {},
  ): Promise<void> {
    return this.detachedValues.replace(
      acceptedHistoryValues(contents),
      modelName,
      {
        ...options,
        publishTokens: true,
      },
    );
  }

  private snapshotMutationChronology(
    next: HistoryMutationInput['nextHistory'],
  ): {
    readonly state: ChronologyState;
    readonly entries: Iterable<ChronologyRollbackEntry>;
  } {
    return {
      state: this.chronology.snapshot(),
      entries: next.prepareChronologyRollback(),
    };
  }

  protected async commitHistoryMutation(
    input: HistoryMutationInput,
    previousHistory?: HistoryMutationSnapshot,
  ): Promise<void> {
    if (previousHistory === undefined) {
      await this.journal.withMutationSnapshot((previous) =>
        this.commitHistoryMutation(input, previous),
      );
      return;
    }
    const previousTokens = this.totalTokens;
    const previousSpans = this.spanWindow.get();
    const chronology = this.snapshotMutationChronology(input.nextHistory);
    const releaseOwners = trackMutationOwners(
      chronologyOwners(chronology.entries),
      this.mutationOwnership,
    );
    const nextHistory = input.nextHistory;
    const effects: PreparedHistoryBatchEffect[] = [];
    const publication = new HistoryMutationPublication(
      this.journal,
      this.mutationOwnership,
    );
    try {
      input.signal?.throwIfAborted();
      stampMutationChronology(this.chronology, input, previousHistory);
      const nextHistoryTokens =
        input.nextHistoryTokens ??
        (await this.estimateTokensForContents(nextHistory));
      const committedSpans = projectDensityCommitSpans(
        input,
        previousSpans,
        previousHistory,
      );
      await prepareMutationEffects(
        this.mediaOwner,
        effects,
        previousHistory,
        nextHistory,
        input.options.adoptedOwners ?? [],
        this.mutationOwnership,
      );
      for (const effect of effects) await effect.publish();
      this.invalidatePendingSyncs();
      const publishing = publication.publish(previousHistory, input);
      if (publishing !== undefined) await publishing;
      this.totalTokens = nextHistoryTokens;
      this.spanWindow.set(committedSpans);
      await finalizeHistoryMutation(
        this,
        input,
        effects,
        nextHistoryTokens - previousTokens,
        this.spanWindow.get(),
        () => this.emitContextRangeChanged(),
      );
    } catch (error: unknown) {
      const failures: unknown[] = [];
      restorePendingChronologyFailure(previousHistory, failures);
      if (publication.admittedCount > 0) {
        this.invalidatePendingSyncs();
        try {
          await compensateMutation(this.journal, previousHistory, input);
        } catch (compensationError: unknown) {
          failures.push(compensationError);
        }
      }
      this.totalTokens = previousTokens;
      this.spanWindow.set(previousSpans);
      restoreMutationChronology(this.chronology, chronology, failures);
      failures.push(...(await rollbackMutationEffects(effects)));
      throw historyMutationFailure(error, failures);
    } finally {
      publication.close();
      releaseOwners();
    }
  }

  /**
   * Estimate total tokens for hypothetical contents without mutating history.
   */
  async estimateTokensForContents(
    contents: Iterable<IContent> | AsyncIterable<IContent>,
    modelName?: string,
    signal?: AbortSignal,
  ): Promise<number> {
    return estimateTokensForContentsImpl(
      contents,
      modelName,
      this.tokenizerProvider(),
      this.logger,
      signal,
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
  async optimizeDensityRows(optimize: DiskDensityOptimizer): Promise<void> {
    await this.enqueueAsynchronousHistoryMutation(async () => {
      await this.journal.withMutationSnapshot(async (previous) => {
        await this.waitForTokenUpdates();
        await withDiskDensityMutation(
          previous,
          optimize,
          (input) => this.commitHistoryMutation(input, previous),
          (rows) => this.estimateTokensForContents(rows),
          this.mutationOwnership,
        );
      });
    });
  }

  applyDensityResult(result: DensityResult): Promise<void> {
    return this.detachedValues.transform(
      densityValueTransform(result),
      undefined,
      {
        publishTokens: true,
      },
    );
  }
}
