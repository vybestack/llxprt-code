/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import type { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { JournalResolver } from '@vybestack/llxprt-code-core/recording/journalResolver.js';
import { detachedDigest } from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { expectedRange } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';

export function checkpointSourceFault(
  history: HistoryService,
  failure: () => Error | undefined,
  ordinal: number,
): { readonly closed: number } {
  const withCheckpoint = history.detachedValues.withCheckpoint.bind(
    history.detachedValues,
  );
  let closed = 0;
  history.detachedValues.withCheckpoint = async <T>(
    execute: (checkpoint: HistoryIndexedRows) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const restore: Array<() => void> = [];
    try {
      return await withCheckpoint(async (checkpoint) => {
        if (!(checkpoint instanceof DetachedHistoryJournal))
          throw new Error('Expected real disk checkpoint');
        const rows = checkpoint[Symbol.iterator].bind(checkpoint);
        const close = checkpoint.close.bind(checkpoint);
        const cursor = spyOn(checkpoint, Symbol.iterator).mockImplementation(
          function* (): Generator<IContent, void, unknown> {
            let index = 0;
            for (const row of { [Symbol.iterator]: rows }) {
              const error = failure();
              if (++index === ordinal && error !== undefined) throw error;
              yield row;
            }
          },
        );
        const lifetime = spyOn(checkpoint, 'close').mockImplementation(() => {
          close();
          closed++;
        });
        restore.push(
          () => cursor.mockRestore(),
          () => lifetime.mockRestore(),
        );
        return execute(checkpoint);
      }, signal);
    } finally {
      for (const reset of restore) reset();
    }
  };
  return {
    get closed(): number {
      return closed;
    },
  };
}

export function checkpointScratch(): string[] {
  return readdirSync(tmpdir()).filter((name) =>
    /^(history-detached-|history-density-)/.test(name),
  );
}

type Digest = Awaited<ReturnType<typeof detachedDigest>>;

export async function checkpointState(
  history: HistoryService,
  recording: SessionRecordingService | undefined,
): Promise<{
  live: Digest;
  durable: Digest;
  tokens: number;
  base: number;
  anchor: number;
  range: ReturnType<HistoryService['getContextRange']>;
}> {
  const path = recording?.getFilePath();
  if (path === undefined || path === null) throw new Error('Missing journal');
  const resolver = await JournalResolver.open(path);
  try {
    const rows = async function* (): AsyncGenerator<IContent, void, unknown> {
      for await (const entry of resolver.resolve()) yield entry.content;
    };
    return {
      live: await detachedDigest(history.streamRawHistory()),
      durable: await detachedDigest(rows()),
      tokens: history.getTotalTokens(),
      base: history.getBaseTokenOffset(),
      anchor: history.getCacheAnchorSeq(),
      range: history.getContextRange(),
    };
  } finally {
    await resolver.close();
  }
}

export async function expectedCheckpointState(
  size: number,
  makeRow: (index: number, bytes: number) => IContent,
  tokens: number,
  base: number,
): Promise<Awaited<ReturnType<typeof checkpointState>>> {
  const rows = async function* (): AsyncGenerator<IContent, void, unknown> {
    for (let index = 0; index < size; index++) yield makeRow(index, 64);
  };
  const expected = await detachedDigest(rows());
  return {
    live: expected,
    durable: expected,
    tokens,
    base,
    anchor: 0,
    range: expectedRange(size),
  };
}
