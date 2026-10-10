/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createReadStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { JournalResolver } from '../../recording/journalResolver.js';
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

export async function appendHistoryJournal(
  source: AttachmentSource,
  destination: SessionRecordingService,
  replace: boolean,
  isCancelled: () => boolean,
  counters?: JournalReadCounters,
): Promise<AttachmentCommit> {
  const directory = await createScratchDir('history-attachment-');
  let committedRows = 0;
  let destinationRewound = false;
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
      let watermark = await destination.commit('rewind', {
        itemsRemoved: count,
      });
      destinationRewound = count > 0;
      for await (const entry of resolver.resolve()) {
        requireLiveSource(isCancelled);
        watermark = await destination.commit('content', {
          content: entry.content,
        });
        committedRows++;
      }
      return { watermark, committedRows, destinationRewound };
    } finally {
      await resolver.close();
    }
  } catch (cause) {
    throw new HistoryAttachmentError(cause, committedRows, destinationRewound);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
