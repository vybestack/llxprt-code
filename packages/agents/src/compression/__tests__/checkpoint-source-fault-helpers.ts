/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { spyOn } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryCheckpoint } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import { nativeFileRows } from './support/native-file-rows.js';
import { detachedDigest } from '@vybestack/llxprt-code-core/services/history/detached-rollback-test-helpers.js';
import { expectedRange } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

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
    execute: (checkpoint: HistoryCheckpoint) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    const restore: Array<() => void> = [];
    try {
      return await withCheckpoint(async (checkpoint) => {
        if (
          !('compressionInput' in checkpoint) ||
          !(checkpoint.compressionInput?.rows instanceof JournalDumpSnapshot)
        )
          throw new Error('Expected real native checkpoint');
        const source = checkpoint.compressionInput.rows;
        const read = source.readRow.bind(source);
        const close = source.close.bind(source);
        let visited = 0;
        const cursor = spyOn(source, 'readRow').mockImplementation(
          async (position) => {
            const error = failure();
            if (++visited === ordinal && error !== undefined) throw error;
            return read(position);
          },
        );
        const lifetime = spyOn(source, 'close').mockImplementation(async () => {
          await close();
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
  return readdirSync(getScratchRoot()).filter((name) =>
    /^(history-detached-|history-density-)/.test(name),
  );
}
export function compressionInputSourceFault(
  history: HistoryService,
  failure: () => Error | undefined,
  ordinal: number,
): { readonly closed: number } {
  const open = history.openCompressionInput.bind(history);
  let closed = 0;
  history.openCompressionInput = async () => {
    const input = await open();
    const read = input.rows.readRow.bind(input.rows);
    let visited = 0;
    input.rows.readRow = (position) => {
      const error = failure();
      if (++visited === ordinal && error !== undefined) throw error;
      return read(position);
    };
    const close = input.close.bind(input);
    input.close = async () => {
      await close();
      closed++;
    };
    return input;
  };
  return {
    get closed(): number {
      return closed;
    },
  };
}

type Digest = Awaited<ReturnType<typeof detachedDigest>>;

export async function checkpointState(
  history: HistoryService,
  recording: SessionRecordingPort | undefined,
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
  return {
    live: await detachedDigest(history.streamRawHistory()),
    durable: await detachedDigest(nativeFileRows(path)),
    tokens: history.getTotalTokens(),
    base: history.getBaseTokenOffset(),
    anchor: history.getCacheAnchorSeq(),
    range: history.getContextRange(),
  };
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
