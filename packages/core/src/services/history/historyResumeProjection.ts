/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { field } from '../../recording/resolverProjection.js';
import { parseChronologyBinding } from '../../recording/chronologyBinding.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { join } from 'node:path';
import type { IContent } from './IContent.js';
import type { ResumeCursorBoot } from '../../recording/resumeCursorBoot.js';
import {
  JournalResolver,
  type ResolvedEntry,
} from '../../recording/journalResolver.js';
import type { CommitWatermark } from '../../recording/types.js';
import { createScratchDir } from '../../storage/scratch-root.js';

export interface ResumeProjection {
  readonly directory: string;
  readonly filePath: string;
}

export interface ProjectionWriteObservation {
  readonly observeRow?: (content: IContent, encoded: string) => void;
  readonly writeFile?: (file: FileHandle, data: string) => Promise<void>;
}

export interface ChronologyCommitObservation {
  readonly observeCommit?: (original: ResolvedEntry, content: object) => void;
}

export async function writeResumeProjection(
  rows: AsyncIterable<IContent>,
  visit: (row: IContent) => Promise<void>,
  observation?: ProjectionWriteObservation,
): Promise<ResumeProjection> {
  const directory = await createScratchDir('history-projection-');
  const filePath = join(directory, 'projection.jsonl');
  try {
    const file = await open(filePath, 'wx');
    try {
      for await (const row of rows) {
        await visit(row);
        const encoded = `${JSON.stringify({ v: 2, type: 'content', payload: { content: row } })}\n`;
        observation?.observeRow?.(row, encoded);
        await (observation?.writeFile?.(file, encoded) ??
          file.writeFile(encoded));
      }
    } finally {
      await file.close();
    }
    return { directory, filePath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function persistResumeChronology(
  projection: ResumeProjection,
  recording: SessionRecordingService,
  boot: ResumeCursorBoot,
  observation?: ChronologyCommitObservation,
): Promise<CommitWatermark> {
  const resolver = await JournalResolver.open(boot.filePath, {
    maxBytes: boot.watermark,
    counters: boot.counters,
  });
  const original = resolver.resolve()[Symbol.asyncIterator]();
  const source = createReadStream(projection.filePath);
  const lines = createInterface({ input: source, crlfDelay: Infinity });
  let rowIndex = 0;
  let watermark = { seq: boot.lastSeq, byteOffset: boot.watermark };
  try {
    for await (const line of lines) {
      const row = await original.next();
      if (row.done === true)
        throw new Error('Resume projection exceeds source rows');
      watermark = await persistProjectedRow(
        line,
        rowIndex,
        row.value,
        recording,
        boot,
        observation,
      );
      rowIndex += 1;
    }
    if ((await original.next()).done !== true)
      throw new Error('Incomplete resume projection');
    return watermark;
  } finally {
    lines.close();
    source.destroy();
    await original.return?.();
    await resolver.close();
  }
}
async function persistProjectedRow(
  line: string,
  rowIndex: number,
  original: ResolvedEntry,
  recording: SessionRecordingService,
  boot: ResumeCursorBoot,
  observation?: ChronologyCommitObservation,
): Promise<CommitWatermark> {
  const content = field(field(JSON.parse(line), 'payload'), 'content');
  if (content === null || typeof content !== 'object')
    throw new Error('Invalid projected content');
  boot.ownership?.retain(content);
  try {
    const chronology = field(field(content, 'metadata'), 'chronology');
    const binding = parseChronologyBinding({ rowIndex, chronology });
    if (binding === null) throw new Error('Invalid projected chronology');
    const changed =
      JSON.stringify(field(content, 'blocks')) !==
      JSON.stringify(original.content.blocks);
    observation?.observeCommit?.(original, content);
    return await recording.commit('chronology_bind', {
      ...binding,
      invalidateResponses: true,
      ...(changed ? { content } : {}),
    });
  } finally {
    boot.ownership?.release(content);
  }
}

export function publishResumeRestoration(
  notifications: ReadonlyArray<() => void>,
): void {
  const failures: unknown[] = [];
  for (const notify of notifications) {
    try {
      notify();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Resume restoration observers failed');
}
