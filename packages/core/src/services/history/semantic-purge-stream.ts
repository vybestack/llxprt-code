/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import { NativeSemanticPurgeBase } from './semantic-purge-native-base.js';
import { HistoryReaderScope } from './historyReaderScope.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import {
  selectNativeSemanticPurge,
  type NativeSemanticPurgeCandidate,
  type SemanticPurgeResource,
} from './semantic-purge-native.js';
import type { HistoryMutationMark } from './historyStorePort.js';
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
  private readonly readers = new HistoryReaderScope(
    'Semantic media purge transaction is closed',
  );
  publishedMark: HistoryMutationMark | undefined;

  constructor(
    private readonly baseDisk: SemanticPurgeResource,
    private readonly candidateDisk: SemanticPurgeResource,
    readonly preImageBoundary: SemanticMediaPurgeBoundary | undefined,
    readonly changedContentIndex: number,
    readonly changedBlockIndex: number,
    readonly nextFrontier: SemanticMediaPurgeFrontier,
    readonly previousFrontier: SemanticMediaPurgeFrontier,
    readonly owner: object,
    private readonly ownership?: RowOwnership,
    readonly native?: NativeSemanticPurgeCandidate,
  ) {
    this.base = baseDisk.view();
    this.candidate = candidateDisk.view();
    this.preImageBoundaryIdentity =
      preImageBoundary === undefined
        ? undefined
        : new SemanticMediaPurgeBoundaryIdentity(preImageBoundary);
  }

  requestRows(
    explicitCacheWrite: boolean,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    return this.readers.open(this.request(explicitCacheWrite, signal));
  }

  private async *request(
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const failures: unknown[] = [];
    for (const close of [
      () => this.readers.close(),
      () => this.candidateDisk.close(),
      () => this.baseDisk.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw historyMutationFailure(failures[0], failures.slice(1));
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
    signal?.throwIfAborted();
    const snapshot =
      await this.history.detachedValues.openSemanticPurgeSnapshot();
    if (snapshot !== undefined) {
      try {
        const selected = await selectNativeSemanticPurge(
          snapshot,
          options,
          signal,
          this.configuration.ownership,
        );
        if (selected === undefined) {
          await snapshot.close();
          return undefined;
        }
        this.currentFrontier = selected.previousFrontier;
        return new SemanticPurgeStreamTransaction(
          new NativeSemanticPurgeBase(snapshot, this.configuration.ownership),
          selected.candidate,
          selected.prefix,
          selected.candidate.location.contentIndex,
          selected.candidate.location.blockIndex,
          selected.candidate.frontier,
          selected.previousFrontier,
          this.owner,
          this.configuration.ownership,
          selected.candidate,
        );
      } catch (error) {
        try {
          await snapshot.close();
        } catch (cleanup) {
          throw historyMutationFailure(error, [cleanup]);
        }
        throw error;
      }
    }
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

  private async rollbackNative(
    transaction: SemanticPurgeStreamTransaction,
    candidate: NativeSemanticPurgeCandidate,
  ): Promise<void> {
    const journal = this.history.detachedValues.host().journal;
    const prior = journal.mutationMark();
    await this.history.detachedValues.withRollbackCheckpoint(
      async (restore) => {
        let persisted = false;
        try {
          await this.configuration.persist?.(
            transaction.base,
            transaction.previousFrontier,
          );
          persisted = true;
          await candidate.snapshot.restore();
        } catch (error) {
          const failures: unknown[] = [];
          if (!journal.isCurrentMutationMark(prior)) {
            try {
              await restore();
              await this.history.waitForCommit();
            } catch (failure) {
              failures.push(failure);
            }
          }
          if (persisted) {
            try {
              await this.configuration.persist?.(
                transaction.candidate,
                transaction.nextFrontier,
              );
            } catch (failure) {
              failures.push(failure);
            }
          }
          throw historyMutationFailure(error, failures);
        }
      },
    );
  }

  private async replaceNative(
    transaction: SemanticPurgeStreamTransaction,
    rollback: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const candidate = transaction.native;
    if (candidate === undefined)
      throw new Error('Missing native semantic purge candidate');
    const journal = this.history.detachedValues.host().journal;
    if (
      rollback
        ? transaction.publishedMark === undefined ||
          !journal.isCurrentMutationMark(transaction.publishedMark)
        : !candidate.snapshot.isCurrent()
    )
      throw new Error('History changed while semantic media purge was pending');
    signal?.throwIfAborted();
    if (rollback) {
      await this.rollbackNative(transaction, candidate);
      return;
    }
    const state = { persisted: false };
    try {
      await this.history.detachedValues.transform(
        async (source, sink) => {
          if (source.length !== transaction.base.length)
            throw new Error(
              'History changed while semantic media purge was pending',
            );
          await this.configuration.persist?.(
            transaction.candidate,
            transaction.nextFrontier,
          );
          state.persisted = true;
          await candidate.publish(sink, signal);
        },
        undefined,
        { signal },
      );
      await this.history.waitForCommit();
      transaction.publishedMark = journal.mutationMark();
    } catch (error) {
      if (state.persisted) {
        try {
          await this.configuration.persist?.(
            transaction.base,
            transaction.previousFrontier,
          );
        } catch (compensation) {
          throw new AggregateError(
            [error, compensation],
            'Semantic media purge failed to restore durable state',
            { cause: error },
          );
        }
      }
      throw error;
    }
  }

  private async replace(
    transaction: SemanticPurgeStreamTransaction,
    rollback: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    if (transaction.native !== undefined) {
      await this.replaceNative(transaction, rollback, signal);
      return;
    }
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
          // The replacement has the rows of the target, one for one.
          let ordinal = 0;
          for await (const row of replacement.streamRows(signal))
            await sink.appendDerived(ordinal++, row);
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
