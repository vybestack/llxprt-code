/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  JournalResolver,
  type ResolvedEntry,
} from '../../recording/journalResolver.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { CommitWatermark } from '../../recording/types.js';
import { invalidateResponsesStatefulChain, type IContent } from './IContent.js';
import type { ResumeProjection } from './historyResumeProjection.js';
import { createScratchDir } from '../../storage/scratch-root.js';

function requireLiveSource(isCancelled: () => boolean): void {
  if (isCancelled()) throw new Error('History journal store is disposed');
}

async function destinationCount(
  destination: SessionRecordingService,
  counters?: JournalReadCounters,
): Promise<number> {
  const filePath = destination.getFilePath();
  if (filePath === null) return 0;
  const resolver = await JournalResolver.open(filePath, {
    maxBytes: (await stat(filePath)).size,
    counters,
  });
  try {
    return await resolver.countRows();
  } finally {
    await resolver.close();
  }
}

export interface AttachmentSource {
  readonly filePath: string | null;
  readonly byteOffset: number;
  readonly resumeBoundary?: number;
  readonly projection?: ResumeProjection;
}

export interface AttachmentCommit {
  readonly watermark: CommitWatermark;
  readonly committedRows: number;
  readonly destinationRewound: boolean;
}

export class HistoryAttachmentError extends Error {
  constructor(
    cause: unknown,
    readonly committedRows: number,
    readonly destinationRewound: boolean,
  ) {
    super(
      `Journal attachment failed; destination retained ${committedRows} appended rows` +
        (destinationRewound ? ' after its history was rewound' : '') +
        `: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

async function* resolvedRows(
  filePath: string,
  maxBytes: number,
  counters?: JournalReadCounters,
): AsyncIterable<IContent> {
  const resolver = await JournalResolver.open(filePath, { maxBytes, counters });
  try {
    for await (const entry of resolver.resolve()) yield entry.content;
  } finally {
    await resolver.close();
  }
}

async function* projectedRows(filePath: string): AsyncIterable<IContent> {
  const stream = createReadStream(filePath);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield JSON.parse(line).payload.content;
  } finally {
    lines.close();
    stream.destroy();
  }
}

async function stageSource(
  source: AttachmentSource,
  target: string,
  counters?: JournalReadCounters,
): Promise<void> {
  const output = await open(target, 'wx');
  try {
    if (source.filePath === null) return;
    const boundary = source.resumeBoundary ?? 0;
    if (boundary > 0) {
      const prefix = source.projection
        ? projectedRows(source.projection.filePath)
        : resolvedRows(source.filePath, boundary, counters);
      let seq = 0;
      for await (const content of prefix) {
        const [restored] = invalidateResponsesStatefulChain([content]);
        await output.writeFile(
          `${JSON.stringify({
            v: 2,
            seq: ++seq,
            type: 'content',
            payload: { content: restored },
          })}\n`,
        );
      }
    }
    if (source.byteOffset > boundary) {
      for await (const chunk of createReadStream(source.filePath, {
        start: boundary,
        end: source.byteOffset - 1,
      }))
        await output.writeFile(chunk);
    }
  } finally {
    await output.close();
  }
}

/**
 * Replaces the destination's non-empty history with the staged rows as one
 * replace transaction, so a failure or crash before the commit leaves the
 * destination's previous history intact. Rows become part of the destination
 * only when the commit record is durable.
 */
async function commitReplacement(
  destination: SessionRecordingService,
  entries: AsyncIterable<OwnedEntry>,
  isCancelled: () => boolean,
): Promise<{ watermark: CommitWatermark; rows: number }> {
  const txId = randomUUID();
  let rows = 0;
  await destination.commit('replace_begin', { txId });
  try {
    for await (const entry of entries) {
      requireLiveSource(isCancelled);
      await destination.commit('content', seededPayload(entry, txId));
      rows++;
    }
    const watermark = await destination.commit('replace_commit', {
      txId,
      rowCount: rows,
    });
    return { watermark, rows };
  } catch (cause) {
    throw await abortReplacement(destination, txId, rows, cause);
  }
}

/** Close an unfinished transaction; its failure is reported with the cause. */
async function abortReplacement(
  destination: SessionRecordingService,
  txId: string,
  rows: number,
  cause: unknown,
): Promise<unknown> {
  try {
    await destination.commit('replace_abort', { txId, rowCount: rows });
    return cause;
  } catch (abortFailure) {
    return new AggregateError(
      [cause, abortFailure],
      `${cause instanceof Error ? cause.message : String(cause)}; replace abort failed: ${
        abortFailure instanceof Error
          ? abortFailure.message
          : String(abortFailure)
      }`,
    );
  }
}

/** A resolved row with the origin its journal line carries (absent: unowned). */
interface OwnedEntry {
  readonly content: IContent;
  readonly origin: string | undefined;
}

/** Row origin ids sit on the journal line, not on the resolved content. */
async function lineOrigin(
  handle: FileHandle,
  entry: ResolvedEntry,
): Promise<string | undefined> {
  const buffer = Buffer.alloc(entry.length);
  const { bytesRead } = await handle.read(
    buffer,
    0,
    entry.length,
    entry.offset,
  );
  if (bytesRead !== entry.length)
    throw new Error('History attachment source line was truncated');
  const origin = (
    JSON.parse(buffer.toString('utf8')) as { payload?: { origin?: unknown } }
  ).payload?.origin;
  return typeof origin === 'string' ? origin : undefined;
}

/**
 * Resolved rows with their origins, streamed through an optional origin
 * filter. Seeding keeps each row's origin so a mirror or a new primary stays
 * attributable: an owned row never becomes unowned by being copied.
 */
async function* ownedEntries(
  resolver: JournalResolver,
  stagedPath: string,
  accept: ((origin: string | undefined) => boolean) | undefined,
): AsyncIterable<OwnedEntry> {
  const handle = await open(stagedPath, 'r');
  try {
    for await (const entry of resolver.resolve()) {
      const origin = await lineOrigin(handle, entry);
      if (accept === undefined || accept(origin))
        yield { content: entry.content, origin };
    }
  } finally {
    await handle.close();
  }
}

function seededPayload(
  entry: OwnedEntry,
  tx?: string,
): { content: IContent; tx?: string; origin?: string } {
  return {
    content: entry.content,
    ...(tx === undefined ? {} : { tx }),
    ...(entry.origin === undefined ? {} : { origin: entry.origin }),
  };
}

export async function appendHistoryJournal(
  source: AttachmentSource,
  destination: SessionRecordingService,
  replace: boolean,
  isCancelled: () => boolean,
  counters?: JournalReadCounters,
  accept?: (origin: string | undefined) => boolean,
): Promise<AttachmentCommit> {
  const directory = await createScratchDir('history-attachment-');
  let committedRows = 0;
  try {
    const staged = join(directory, 'source.jsonl');
    await stageSource(source, staged, counters);
    const resolver = await JournalResolver.open(staged, { counters });
    try {
      await resolver.countRows();
      const sequence = destination.getLastEnqueuedSequence();
      await destination.flush();
      requireLiveSource(isCancelled);
      const count = replace ? await destinationCount(destination, counters) : 0;
      if (destination.getLastEnqueuedSequence() !== sequence)
        throw new Error(
          'Destination recording changed during attachment preflight',
        );
      if (count > 0) {
        const replaced = await commitReplacement(
          destination,
          ownedEntries(resolver, staged, accept),
          isCancelled,
        );
        return {
          watermark: replaced.watermark,
          committedRows: replaced.rows,
          destinationRewound: true,
        };
      }
      // A zero-length rewind on a destination that was never materialized
      // removes nothing, and committing it would write an empty session file
      // that --continue and the session list would then treat as a session.
      // The file stays unwritten until the first content row, as before the
      // journal model.
      let watermark: CommitWatermark =
        destination.getFilePath() === null
          ? { seq: destination.getLastEnqueuedSequence(), byteOffset: 0 }
          : await destination.commit('rewind', { itemsRemoved: count });
      for await (const entry of ownedEntries(resolver, staged, accept)) {
        requireLiveSource(isCancelled);
        watermark = await destination.commit('content', seededPayload(entry));
        committedRows++;
      }
      return { watermark, committedRows, destinationRewound: false };
    } finally {
      await resolver.close();
    }
  } catch (cause) {
    throw new HistoryAttachmentError(cause, committedRows, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
