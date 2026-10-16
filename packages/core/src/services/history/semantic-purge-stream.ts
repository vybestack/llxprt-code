/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { DetachedHistorySource } from './detachedHistoryMutation.js';
import {
  SemanticMediaPurgeBoundaryIdentity,
  freezeSemanticPurgeValue,
  type SemanticMediaPurgeBoundary,
  type SemanticMediaPurgeFrontier,
  type SemanticMediaPurgeOptions,
  type SemanticMediaPurgeOutcome,
} from './semantic-media-purge.js';
import {
  buildDiskPurgeCandidate,
  diskFrontier,
  locateDiskPurge,
} from './semantic-purge-candidate.js';
import {
  captureSemanticPurgeRows,
  type SemanticPurgeDiskRows,
  type SemanticPurgeRowSource,
} from './semantic-purge-disk-rows.js';

export interface SemanticPurgeStreamConfiguration {
  readonly enabled?: boolean;
  readonly explicitCacheWriteRequired: boolean;
  readonly ownership?: RowOwnership;
  readonly persist?: (
    rows: SemanticPurgeRowSource,
    frontier: SemanticMediaPurgeFrontier,
  ) => Promise<void>;
}

export class SemanticPurgeStreamTransaction {
  readonly base: SemanticPurgeRowSource;
  readonly candidate: SemanticPurgeRowSource;
  readonly preImageBoundaryIdentity:
    | SemanticMediaPurgeBoundaryIdentity
    | undefined;
  private closed = false;

  constructor(
    private readonly baseDisk: SemanticPurgeDiskRows,
    private readonly candidateDisk: SemanticPurgeDiskRows,
    readonly preImageBoundary: SemanticMediaPurgeBoundary | undefined,
    readonly changedContentIndex: number,
    readonly changedBlockIndex: number,
    readonly nextFrontier: SemanticMediaPurgeFrontier,
    readonly previousFrontier: SemanticMediaPurgeFrontier,
    readonly owner: object,
    private readonly ownership?: RowOwnership,
  ) {
    this.base = baseDisk.view();
    this.candidate = candidateDisk.view();
    this.preImageBoundaryIdentity =
      preImageBoundary === undefined
        ? undefined
        : new SemanticMediaPurgeBoundaryIdentity(preImageBoundary);
  }

  async *requestRows(
    explicitCacheWrite: boolean,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    this.assertOpen();
    let index = 0;
    const source = explicitCacheWrite ? this.base : this.candidate;
    for await (const row of source.streamRows(signal)) {
      this.assertOpen();
      const boundary = this.preImageBoundary;
      if (
        !explicitCacheWrite ||
        boundary === undefined ||
        index++ !== boundary.contentIndex
      ) {
        yield row;
        continue;
      }
      const boundaryId = this.preImageBoundaryIdentity;
      if (boundaryId === undefined || boundary.blockIndex >= row.blocks.length)
        throw new Error(
          'Semantic media purge pre-image boundary no longer exists',
        );
      const tagged = {
        ...row,
        metadata: {
          ...row.metadata,
          semanticMediaPurgeBoundary: {
            blockIndex: boundary.blockIndex,
            boundaryId,
          },
        },
      };
      freezeSemanticPurgeValue(tagged);
      this.ownership?.retain(tagged);
      try {
        yield tagged;
      } finally {
        this.ownership?.release(tagged);
      }
    }
    this.assertOpen();
  }

  assertOpen(): void {
    if (this.closed)
      throw new Error('Semantic media purge transaction is closed');
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.candidateDisk.close();
    } finally {
      this.baseDisk.close();
    }
  }
}

class PrecommitFailure extends Error {
  constructor(readonly failure: unknown) {
    super('Semantic media purge failed before durable state changed');
  }
}

async function validateTarget(
  source: DetachedHistorySource,
  expected: SemanticPurgeRowSource,
  rollback: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const mismatch = (): PrecommitFailure =>
    new PrecommitFailure(
      new Error(
        `History changed while semantic media purge ${rollback ? 'rollback was' : 'was'} pending`,
      ),
    );
  if (source.length !== expected.length) throw mismatch();
  const cursor = expected.streamRows(signal)[Symbol.asyncIterator]();
  try {
    for await (const row of source.streamRows(signal)) {
      const next = await cursor.next();
      if (next.done === true || !isDeepStrictEqual(row, next.value))
        throw mismatch();
    }
    if ((await cursor.next()).done !== true) throw mismatch();
  } finally {
    await cursor.return();
  }
}

export class SemanticMediaPurgeStreamCoordinator {
  private readonly owner = Object.freeze({});
  private currentFrontier: SemanticMediaPurgeFrontier = Object.freeze({
    contentIndex: 0,
    blockIndex: 0,
  });

  constructor(
    private readonly history: HistoryService,
    private readonly configuration: SemanticPurgeStreamConfiguration,
  ) {}

  get frontier(): SemanticMediaPurgeFrontier {
    return this.currentFrontier;
  }

  async begin(
    options: SemanticMediaPurgeOptions,
    signal?: AbortSignal,
  ): Promise<SemanticPurgeStreamTransaction | undefined> {
    if (this.configuration.enabled !== true) return undefined;
    const base = await captureSemanticPurgeRows(
      this.history.streamRawHistory(signal),
      this.configuration.ownership,
      signal,
    );
    try {
      this.currentFrontier = diskFrontier(base);
      const selected = locateDiskPurge(base, this.currentFrontier, options);
      if (selected === undefined) {
        base.close();
        return undefined;
      }
      signal?.throwIfAborted();
      const { candidate, frontier } = buildDiskPurgeCandidate(
        base,
        selected.location,
        options,
        this.configuration.ownership,
      );
      return new SemanticPurgeStreamTransaction(
        base,
        candidate,
        selected.prefix,
        selected.location.contentIndex,
        selected.location.blockIndex,
        frontier,
        this.currentFrontier,
        this.owner,
        this.configuration.ownership,
      );
    } catch (error: unknown) {
      base.close();
      throw error;
    }
  }

  private validate(transaction: SemanticPurgeStreamTransaction): void {
    if (transaction.owner !== this.owner)
      throw new Error(
        'Semantic media purge transaction belongs to another coordinator',
      );
    transaction.assertOpen();
  }

  async commit(
    transaction: SemanticPurgeStreamTransaction,
    outcome: SemanticMediaPurgeOutcome,
    signal?: AbortSignal,
  ): Promise<boolean> {
    this.validate(transaction);
    if (
      outcome.status !== 'success' ||
      (this.configuration.explicitCacheWriteRequired &&
        !outcome.cachePrefixWritten)
    )
      return false;
    await this.replace(transaction, false, signal);
    this.currentFrontier = transaction.nextFrontier;
    return true;
  }

  async rollback(
    transaction: SemanticPurgeStreamTransaction,
    signal?: AbortSignal,
  ): Promise<void> {
    this.validate(transaction);
    await this.replace(transaction, true, signal);
    this.currentFrontier = transaction.previousFrontier;
  }

  private async replace(
    transaction: SemanticPurgeStreamTransaction,
    rollback: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const expected = rollback ? transaction.candidate : transaction.base;
    const replacement = rollback ? transaction.base : transaction.candidate;
    const frontier = rollback
      ? transaction.previousFrontier
      : transaction.nextFrontier;
    const state = { persisted: false };
    try {
      await this.history.detachedValues.transform(
        async (source, sink) => {
          await validateTarget(source, expected, rollback, signal);
          try {
            await this.configuration.persist?.(replacement, frontier);
            state.persisted = true;
          } catch (error: unknown) {
            throw new PrecommitFailure(error);
          }
          for await (const row of replacement.streamRows(signal))
            sink.appendValue(row);
        },
        undefined,
        { signal },
      );
    } catch (error: unknown) {
      if (error instanceof PrecommitFailure) throw error.failure;
      if (state.persisted) {
        try {
          await this.configuration.persist?.(
            expected,
            rollback ? transaction.nextFrontier : transaction.previousFrontier,
          );
        } catch (compensation: unknown) {
          throw new AggregateError(
            [error, compensation],
            `Semantic media purge failed to ${rollback ? 'roll back' : 'replace'} history and restore durable state`,
          );
        }
      }
      throw error;
    }
  }
}
