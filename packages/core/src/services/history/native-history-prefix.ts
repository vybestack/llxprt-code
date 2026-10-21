/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from './HistoryService.js';
import type { HistoryCheckpointRows } from './historyCheckpointRows.js';
import type { IContent } from './IContent.js';
import type { LocalMediaStore } from '../../storage/local-media-store.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import { randomUUID } from 'node:crypto';

async function withPrefixMedia<T>(
  checkpoint: HistoryCheckpointRows,
  store: LocalMediaStore | undefined,
  execute: () => Promise<T>,
): Promise<T> {
  if (checkpoint.mediaReferences === undefined)
    throw new Error('Native checkpoint lacks media references');
  const references = checkpoint.mediaReferences;
  const owner = `clear-snapshot:${randomUUID()}`;
  let result: { value: T } | { error: unknown };
  try {
    for await (const reference of references()) {
      if (store === undefined)
        throw new Error('History media store is unavailable');
      await store.reserve(reference, owner);
    }
    result = { value: await execute() };
  } catch (error) {
    result = { error };
  }
  try {
    for await (const reference of references()) {
      if (store === undefined)
        throw new Error('History media store is unavailable');
      await store.release(reference.contentId, owner);
    }
  } catch (error) {
    if ('error' in result) throw historyMutationFailure(result.error, [error]);
    throw error;
  }
  if ('error' in result) throw result.error;
  return result.value;
}

export class NativeHistoryPrefix implements AsyncIterable<IContent> {
  private readonly current: () => boolean;
  readonly removed: number;

  constructor(
    private readonly history: HistoryService,
    private readonly checkpoint: HistoryCheckpointRows,
    readonly length: number,
  ) {
    this.current = history.historyMutationGuard();
    this.removed = checkpoint.length - length;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
    const iterator = this.checkpoint[Symbol.asyncIterator]();
    try {
      for (let ordinal = 0; ordinal < this.length; ordinal++) {
        const next = await iterator.next();
        if (next.done === true)
          throw new Error('History prefix ended before its cut');
        yield next.value;
      }
    } finally {
      await iterator.return?.();
    }
  }

  async apply(history: HistoryService): Promise<void> {
    if (history !== this.history)
      throw new Error('History prefix belongs to another session');
    if (!this.current())
      throw new Error('History changed while its prefix was selected');
    await history.detachedValues.transform(async (source, sink) => {
      if (source.length !== this.checkpoint.length)
        throw new Error('History changed while its prefix was selected');
      let ordinal = 0;
      for await (const row of this) await sink.appendDerived(ordinal++, row);
    });
    await history.waitForCommit();
    await history.settleMediaOwnership();
  }
}

export class NativeHistoryPrefixOwner {
  constructor(private readonly history: HistoryService) {}

  withPrefix<T>(
    turns: number,
    fromEnd: boolean,
    store: LocalMediaStore | undefined,
    execute: (prefix: NativeHistoryPrefix) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const history = this.history;
    return history.detachedValues.withCheckpoint(async (checkpoint) => {
      if (!('humanCut' in checkpoint) || checkpoint.humanCut === undefined)
        throw new Error('Native history checkpoint lacks turn selection');
      const cut = await checkpoint.humanCut(turns, fromEnd);
      const prefix = new NativeHistoryPrefix(history, checkpoint, cut);
      if (prefix.removed === 0) return execute(prefix);
      return withPrefixMedia(checkpoint, store, () =>
        history.detachedValues.withRollbackCheckpoint(async (restore) => {
          try {
            signal?.throwIfAborted();
            const result = await execute(prefix);
            await history.waitForCommit();
            return result;
          } catch (error) {
            try {
              await restore();
              await history.waitForCommit();
            } catch (rollbackError) {
              throw historyMutationFailure(error, [rollbackError]);
            }
            throw error;
          }
        }),
      );
    }, signal);
  }
}

export function nativeHistoryPrefixOwner(
  history: HistoryService | null | undefined,
): NativeHistoryPrefixOwner | undefined {
  return history?.detachedValues.host().journal.compressionRowCount ===
    undefined
    ? undefined
    : new NativeHistoryPrefixOwner(history);
}
