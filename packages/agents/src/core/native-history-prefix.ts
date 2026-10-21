/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryCheckpointRows } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { historyMutationFailure } from '@vybestack/llxprt-code-core/services/history/historyMutationEffects.js';
import { randomUUID } from 'node:crypto';

export async function withNativePrefixMedia<T>(
  checkpoint: HistoryCheckpointRows,
  store: LocalMediaStore,
  execute: () => Promise<T>,
): Promise<T> {
  if (checkpoint.mediaReferences === undefined)
    throw new Error('Native checkpoint lacks media references');
  const owner = `clear-snapshot:${randomUUID()}`;
  let result: { value: T } | { error: unknown };
  try {
    for await (const reference of checkpoint.mediaReferences())
      await store.reserve(reference, owner);
    result = { value: await execute() };
  } catch (error) {
    result = { error };
  }
  try {
    for await (const reference of checkpoint.mediaReferences())
      await store.release(reference.contentId, owner);
  } catch (error) {
    if ('error' in result) throw historyMutationFailure(result.error, [error]);
    throw error;
  }
  if ('error' in result) throw result.error;
  return result.value;
}

export class NativeHistoryPrefix implements AsyncIterable<IContent> {
  private readonly current: () => boolean;

  constructor(
    private readonly history: HistoryService,
    private readonly checkpoint: HistoryCheckpointRows,
    readonly length: number,
  ) {
    this.current = history.historyMutationGuard();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
    let ordinal = 0;
    for await (const row of this.checkpoint) {
      if (ordinal++ === this.length) return;
      yield row;
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
