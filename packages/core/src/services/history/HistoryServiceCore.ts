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
import {
  type ChronologyMarker,
  type IContent,
  type MediaReferenceBlock,
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
  logContentAdded,
  logQueuedDuringCompression,
} from './curationDebugLogger.js';
import {
  type HistoryServiceEventEmitter,
  type CompressionConfig,
} from './historyEventTypes.js';
import { getTokenizerForModel } from './historyTokenizerAdapter.js';
import {
  ChronologyStamper,
  type ChronologyState,
} from './historyChronology.js';

// Preserve the CompressionConfig export from the same path for consumers.
export type { CompressionConfig };

import {
  type MutationFailure,
  combineMutationFailures,
} from './historyMutationFailure.js';

export interface PreparedHistoryBatchEffect {
  publish(): void | Promise<void>;
  rollback(): void | Promise<void>;
  finalize?(): void | Promise<void>;
}

export type HistoryBatchParticipant = (
  publication: HistoryBatchPublication,
) => PreparedHistoryBatchEffect | Promise<PreparedHistoryBatchEffect>;

export interface HistoryOwnedMediaReservation {
  readonly contentId: string;
  readonly ownerId: string;
  readonly reference?: MediaReferenceBlock;
}

/**
 * Explicit owner participant that reconciles durable local-media ownership with live
 * history on every mutation that adds, replaces, removes, or clears history.
 * Registered via {@link HistoryService.registerMediaOwner}.
 */
export interface HistoryMediaOwner {
  /** Transactional ownership transition for a queued history mutation. */
  prepareReplacement(input: {
    readonly previous: readonly IContent[];
    readonly next: readonly IContent[];
    readonly adopted: readonly HistoryOwnedMediaReservation[];
  }): PreparedHistoryBatchEffect | Promise<PreparedHistoryBatchEffect>;

  /** Reconcile ownership from `previous` to current history for synchronous
   * mutations that cannot await (clears, pops, settlement). */
  reconcile(
    previous: readonly IContent[],
    getNext: () => readonly IContent[],
  ): Promise<void>;

  /** Release every reservation the history still owns (disposal). */
  releaseAll(): Promise<void>;

  /** Adopt reservations for content that becomes resident without a removal diff. */
  adopt(contents: readonly IContent[]): void;
}

export interface HistoryBatchPublication {
  readonly contents: readonly IContent[];
  readonly nextHistory: readonly IContent[];
  readonly addedTokens: number;
  readonly totalTokens: number;
}

export interface HistoryBatchOptions {
  readonly afterPublication?: () => void | Promise<void>;
  readonly adoptedOwners?: readonly HistoryOwnedMediaReservation[];
}

type QueuedHistoryMutation =
  | { kind: 'synchronous'; execute: () => void }
  | {
      kind: 'asynchronous';
      execute: () => Promise<void>;
      resolve: () => void;
      reject: (error: unknown) => void;
    };

interface ChronologyRollbackEntry {
  readonly content: IContent;
  readonly hadMetadata: boolean;
  readonly chronology: ChronologyMarker | undefined;
}

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

  protected history: IContent[] = [];
  protected totalTokens: number = 0;
  protected baseTokenOffset: number = 0;
  protected tokenizerCache = new Map<string, ITokenizer>();
  protected tokenizerLock: Promise<void> = Promise.resolve();
  protected pendingTokenizerFailure: { error: unknown } | undefined;
  private syncGeneration: number = 0;
  private historyMutationInProgress = false;
  private historyMutationQueue: QueuedHistoryMutation[] = [];
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

  protected runSynchronousHistoryMutation(execute: () => void): void {
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

  protected enqueueAsynchronousHistoryMutation(
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
    this.history.push(content);

    try {
      this.emit('contentAdded', content);
      this.mediaOwner?.adopt([content]);
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
        nextHistory: [...this.history, ...batch],
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
      const replacement = [...(await transform([...this.history]))];
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
    owner.adopt(this.history);
  }

  settleMediaOwnership(): Promise<void> {
    return this.enqueueAsynchronousHistoryMutation(async () => {
      await this.mediaOwner?.reconcile([...this.history], () => this.history);
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
    readonly options: HistoryBatchOptions;
  }): Promise<void> {
    const previousHistory = this.history;
    const previousTokens = this.totalTokens;
    const chronology = this.stampHistory(input.nextHistory);
    const nextHistory = [...input.nextHistory];
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
      this.history = nextHistory;
      this.totalTokens = input.nextHistoryTokens;
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
    } catch (error: unknown) {
      if (historyPublished) {
        this.invalidatePendingSyncs();
        this.history = previousHistory;
        this.totalTokens = previousTokens;
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
      validateDensityResult(result, this.history.length);
      const nextHistory = [...this.history];
      // Each density replacement takes over the chronology position of the item
      // it replaces, so the surviving history keeps an unbroken sequence.
      // densityValidation stays free of chronology knowledge.
      for (const [index, replacement] of result.replacements) {
        const replacedMarker = this.history[index].metadata?.chronology;
        if (replacedMarker !== undefined) {
          this.chronology.inherit(replacement, replacedMarker);
        }
      }
      applyDensityMutations(nextHistory, result);
      await this.waitForTokenUpdates();
      const replacementTokens =
        await this.estimateTokensForContents(nextHistory);
      await this.commitHistoryMutation({
        nextHistory,
        nextHistoryTokens: replacementTokens,
        options: {},
      });

      this.logger.debug('Density: applied result', {
        replacements: result.replacements.size,
        removals: result.removals.length,
        newHistoryLength: this.history.length,
        metadata: result.metadata,
      });
    });
  }
}
