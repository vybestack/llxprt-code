/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createReadStream } from 'node:fs';
import type { SessionEventType } from '../../recording/types.js';

/** One committed journal record and the byte range of its line. */
export interface ScannedJournalRecord {
  readonly start: number;
  /** Exclusive end offset, after the line's newline. */
  readonly end: number;
  readonly seq: number;
  readonly type: SessionEventType;
  readonly payload: unknown;
}

function parseRecord(
  text: string,
  start: number,
  end: number,
): ScannedJournalRecord {
  const parsed = JSON.parse(text) as {
    seq?: unknown;
    type?: unknown;
    payload?: unknown;
  };
  if (typeof parsed.seq !== 'number' || typeof parsed.type !== 'string')
    throw new Error(
      `History journal record at byte ${start} has no sequence or type`,
    );
  return {
    start,
    end,
    seq: parsed.seq,
    type: parsed.type as SessionEventType,
    payload: parsed.payload,
  };
}

interface LineSplit {
  readonly records: ScannedJournalRecord[];
  readonly rest: Buffer;
  readonly offset: number;
}

/** Split complete lines off `pending`, which starts at byte `offset`. */
function splitLines(pending: Buffer, offset: number): LineSplit {
  const records: ScannedJournalRecord[] = [];
  let rest = pending;
  let position = offset;
  for (let newline = rest.indexOf(0x0a); newline !== -1; ) {
    const lineEnd = position + newline + 1;
    const text = rest.subarray(0, newline).toString('utf8');
    if (text.length > 0) records.push(parseRecord(text, position, lineEnd));
    rest = rest.subarray(newline + 1);
    position = lineEnd;
    newline = rest.indexOf(0x0a);
  }
  return { records, rest, offset: position };
}

/**
 * Stream the records of the committed byte range [start, end) one at a time,
 * with the byte range of each. The range must begin and end on record
 * boundaries. Closing the iterator early releases the file.
 */
export async function* scanJournalRecords(
  filePath: string,
  start: number,
  end: number,
): AsyncGenerator<ScannedJournalRecord, void, undefined> {
  if (end <= start) return;
  const stream = createReadStream(filePath, { start, end: end - 1 });
  let pending: Buffer = Buffer.alloc(0);
  let offset = start;
  try {
    for await (const chunk of stream) {
      const split = splitLines(
        Buffer.concat([pending, chunk as Buffer]),
        offset,
      );
      pending = split.rest;
      offset = split.offset;
      yield* split.records;
    }
    if (pending.length > 0)
      yield parseRecord(
        pending.toString('utf8'),
        offset,
        offset + pending.length,
      );
  } finally {
    stream.destroy();
  }
}
