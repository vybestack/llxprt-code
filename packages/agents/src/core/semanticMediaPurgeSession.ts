/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  IContent,
  SemanticMediaPurgeCacheWriteEvidence,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SemanticMediaPurgeFrontier } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import {
  SemanticMediaPurgeStreamCoordinator,
  type SemanticPurgeStreamTransaction,
} from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import type { SemanticPurgeRowSource } from '@vybestack/llxprt-code-core/services/history/semantic-purge-disk-rows.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';

export type SemanticMediaPurgeMode = 'off' | 'remove' | 'summary';

export interface SemanticMediaPurgeCompletion {
  readonly status: 'success' | 'error' | 'cancelled';
  readonly usage: UsageStats | undefined;
  readonly cacheWriteEvidence?: SemanticMediaPurgeCacheWriteEvidence;
  readonly retryHandoff: boolean;
}

export interface PreparedSemanticMediaPurgeBoundary {
  readonly contentIndex: number;
  readonly blockIndex: number;
  readonly boundaryId: object;
}

export interface SemanticMediaPurgeSessionOptions {
  readonly history: HistoryService;
  readonly mode: () => SemanticMediaPurgeMode;
  readonly requiresExplicitCacheWrite?: () => boolean;
  readonly ownership?: RowOwnership;
  readonly persist: (
    candidateHistory: SemanticPurgeRowSource,
    frontier: SemanticMediaPurgeFrontier,
  ) => Promise<void>;
}

function observedAnthropicCacheWrite(usage: UsageStats | undefined): boolean {
  const cacheCreationTokens = usage?.cache_creation_input_tokens;
  return (
    typeof cacheCreationTokens === 'number' &&
    Number.isFinite(cacheCreationTokens) &&
    cacheCreationTokens > 0
  );
}

function matchesRequiredCacheWrite(
  boundary: PreparedSemanticMediaPurgeBoundary | undefined,
  evidence: SemanticMediaPurgeCompletion,
): boolean {
  if (boundary === undefined) return false;
  if (evidence.cacheWriteEvidence === undefined) return false;
  if (evidence.cacheWriteEvidence.boundaryId !== boundary.boundaryId)
    return false;
  if (evidence.cacheWriteEvidence.preparation !== 'added') return false;
  return observedAnthropicCacheWrite(evidence.usage);
}

export class SemanticMediaPurgeAttempt {
  readonly candidateHistory: SemanticPurgeRowSource;
  readonly requestHistory: SemanticPurgeRowSource;
  readonly preparedBoundary: PreparedSemanticMediaPurgeBoundary | undefined;
  private completed = false;
  private committed = false;
  private retryHandoff = false;

  private released = false;

  constructor(
    private readonly coordinator: SemanticMediaPurgeStreamCoordinator,
    private readonly transaction: SemanticPurgeStreamTransaction,
    private readonly requiresExplicitCacheWrite: boolean,
    private readonly releaseAttempt: () => void,
  ) {
    this.candidateHistory = transaction.candidate;
    this.requestHistory = requiresExplicitCacheWrite
      ? Object.freeze({
          length: transaction.base.length,
          streamRows: (
            signal?: AbortSignal,
          ): AsyncGenerator<IContent, void, unknown> =>
            transaction.requestRows(true, signal),
        })
      : transaction.candidate;
    const location = transaction.preImageBoundary;
    const boundaryId = transaction.preImageBoundaryIdentity;
    this.preparedBoundary =
      requiresExplicitCacheWrite &&
      location !== undefined &&
      boundaryId !== undefined
        ? Object.freeze({ ...location, boundaryId })
        : undefined;
  }

  markRetryHandoff(): void {
    this.retryHandoff = true;
  }

  async complete(evidence: SemanticMediaPurgeCompletion): Promise<boolean> {
    if (this.completed) {
      throw new Error('Semantic media purge attempt is already complete');
    }
    this.completed = true;
    try {
      if (evidence.retryHandoff || this.retryHandoff) {
        this.committed = await this.coordinator.commit(this.transaction, {
          status: 'retry-handoff',
          cachePrefixWritten: false,
        });
        return this.committed;
      }
      const cachePrefixWritten = this.requiresExplicitCacheWrite
        ? matchesRequiredCacheWrite(this.preparedBoundary, evidence)
        : true;
      this.committed = await this.coordinator.commit(this.transaction, {
        status:
          this.requiresExplicitCacheWrite && !cachePrefixWritten
            ? 'error'
            : evidence.status,
        cachePrefixWritten,
      });
      return this.committed;
    } finally {
      if (!this.committed) this.release();
    }
  }

  finalize(): void {
    this.release();
  }

  async rollbackCommitted(): Promise<void> {
    if (!this.committed) return;
    await this.coordinator.rollback(this.transaction);
    this.committed = false;
    this.release();
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    try {
      this.transaction.close();
    } finally {
      this.releaseAttempt();
    }
  }

  async failAfterProcessingError(): Promise<void> {
    if (this.committed) {
      await this.rollbackCommitted();
      return;
    }
    if (!this.completed) {
      await this.complete({
        status: 'error',
        usage: undefined,
        retryHandoff: false,
      });
    }
  }
}

export class SemanticMediaPurgeSession {
  private readonly coordinator: SemanticMediaPurgeStreamCoordinator;
  private attemptChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: SemanticMediaPurgeSessionOptions) {
    this.coordinator = new SemanticMediaPurgeStreamCoordinator(
      options.history,
      {
        enabled: true,
        explicitCacheWriteRequired: false,
        ownership: options.ownership,
        persist: options.persist,
      },
    );
  }

  isEnabled(): boolean {
    return this.options.mode() !== 'off';
  }

  async begin(
    requiresExplicitCacheWrite = this.options.requiresExplicitCacheWrite?.() ??
      false,
    signal?: AbortSignal,
  ): Promise<SemanticMediaPurgeAttempt | undefined> {
    if (this.options.mode() === 'off') return undefined;
    signal?.throwIfAborted();
    const releaseAttempt = await this.acquireAttempt();
    try {
      signal?.throwIfAborted();
      const mode = this.options.mode();
      if (mode === 'off') {
        releaseAttempt();
        return undefined;
      }
      const transaction = await this.coordinator.begin({ mode }, signal);
      if (
        transaction === undefined ||
        (requiresExplicitCacheWrite &&
          transaction.preImageBoundary === undefined)
      ) {
        transaction?.close();
        releaseAttempt();
        return undefined;
      }
      return new SemanticMediaPurgeAttempt(
        this.coordinator,
        transaction,
        requiresExplicitCacheWrite,
        releaseAttempt,
      );
    } catch (error: unknown) {
      releaseAttempt();
      throw error;
    }
  }

  private async acquireAttempt(): Promise<() => void> {
    const previousAttempt = this.attemptChain;
    let releaseAttempt: () => void = () => undefined;
    this.attemptChain = new Promise<void>((resolve) => {
      releaseAttempt = resolve;
    });
    await previousAttempt;
    return releaseAttempt;
  }
}
