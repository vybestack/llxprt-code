/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  JournalCorruptionError,
  JournalFormatError,
  JournalFrameError,
} from './errors.js';
import {
  readFrameBody,
  readFrameStart,
  type FrameHead,
  type FrameStart,
} from './frame.js';
import {
  JournalShortReadError,
  type PositionalReader,
} from './positionalFile.js';
import type { TrailerHeader } from './trailerRecord.js';
import { rowReadWindow, type RowReadWindowStats } from './row-read-window.js';
import { RECORD_KIND } from './recordKinds.js';

/** What a record is called in an error when the caller does not name it. */
const DEFAULT_WHAT = 'record';

/**
 * Reads of records that a committed trailer reaches. A record like that was
 * written, flushed and then named by an intact trailer, so a frame that does
 * not fit, a frame CRC that fails or a body CRC that fails is corruption and
 * never a torn tail (design 2.2). The error names the file, the record's
 * offset and the trailer that led to it.
 */
export interface RecordAccess {
  readonly sourceIdentity?: object;
  readonly rowWindowStats?: RowReadWindowStats;
  recordError(head: FrameHead, error: Error): JournalCorruptionError;
  /**
   * `prefetchBytes` is how much of the record to read with its head, for a
   * record whose size the caller knows; it saves the second read. Sparse
   * tree paths disable `readAhead` so unrelated neighboring bytes stay on disk.
   */
  readRecordHead(
    offset: number,
    what?: string,
    prefetchBytes?: number,
    readAhead?: boolean,
  ): Promise<FrameHead>;
  /**
   * The head and the body bytes that arrived with it, in one read of up to
   * `prefetchBytes`. The prefix is not CRC-checked (see `FrameStart`).
   */
  readRecordStart(
    offset: number,
    what: string,
    prefetchBytes: number,
  ): Promise<FrameStart>;
  /** Reads one range within a validated frame body; the whole-body CRC is not checked. */
  readRecordRange(
    head: FrameHead,
    offset: number,
    length: number,
  ): Promise<Uint8Array>;
  /** Streams the body; the CRC is checked after the last chunk, so consume it to the end. */
  readRecordBody(
    head: FrameHead,
    chunkBytes?: number,
    what?: string,
  ): AsyncGenerator<Uint8Array>;
}

/**
 * What bounds a record access: the end of the readable bytes and the trailer
 * named in an error. A published trailer is one; a copier that reads back
 * records of its own unfinished group passes the end of what it has written.
 */
export type AccessBounds = Pick<TrailerHeader, 'selfOffset' | 'durableEnd'>;

function validateRange(
  head: FrameHead,
  offset: number,
  length: number,
  durableEnd: number,
): void {
  const invalidOffset = !Number.isSafeInteger(offset) || offset < 0;
  const invalidLength = !Number.isSafeInteger(length) || length < 0;
  if (
    invalidOffset ||
    invalidLength ||
    offset + length > head.bodyLen ||
    head.endOffset > durableEnd
  )
    throw new JournalFormatError('Record body range is out of bounds');
}

export function groupReadAccess(
  path: string,
  writer: { readonly reader: PositionalReader },
  version: AccessBounds | undefined,
): (durableEnd: number, windowRows?: boolean) => RecordAccess {
  return (durableEnd, windowRows) =>
    createRecordAccess(
      path,
      writer.reader,
      { selfOffset: version?.selfOffset ?? 0, durableEnd },
      windowRows,
    );
}

function readWindowedBody(
  reader: PositionalReader,
  window: PositionalReader | undefined,
  head: FrameHead,
  chunkBytes: number | undefined,
): AsyncGenerator<Uint8Array> {
  return readFrameBody(
    head.kind === RECORD_KIND.ROW ? (window ?? reader) : reader,
    head,
    chunkBytes,
  );
}

function headReader(
  what: string,
  reader: PositionalReader,
  window: PositionalReader | undefined,
  nodeWindow: PositionalReader,
): PositionalReader {
  if (what === 'ITNODE') return nodeWindow;
  return what === 'ROW' ? (window ?? reader) : reader;
}

function recordCorruption(
  path: string,
  trailer: AccessBounds,
): (what: string, offset: number, error: Error) => JournalCorruptionError {
  return (what: string, offset: number, error: Error): JournalCorruptionError =>
    new JournalCorruptionError(
      path,
      what,
      offset,
      trailer.selfOffset,
      error.message,
      { cause: error },
    );
}

export function createRecordAccess(
  path: string,
  reader: PositionalReader,
  trailer: AccessBounds,
  windowRows = false,
  exactMetadata = false,
): RecordAccess {
  const window = windowRows
    ? rowReadWindow(reader, trailer.durableEnd)
    : undefined;
  const nodeWindow = rowReadWindow(reader, trailer.durableEnd);
  const corruption = recordCorruption(path, trailer);
  const readStart = async (
    offset: number,
    what: string,
    prefetchBytes?: number,
    readAhead = true,
  ): Promise<FrameStart> => {
    try {
      const metadata =
        exactMetadata && (what === 'RTNODE' || what === 'ITNODE');
      return await readFrameStart(
        readAhead && !metadata
          ? headReader(what, reader, window, nodeWindow)
          : reader,
        offset,
        trailer.durableEnd,
        metadata && what !== 'ITNODE' ? undefined : prefetchBytes,
      );
    } catch (error) {
      if (
        error instanceof JournalFrameError ||
        error instanceof JournalShortReadError
      ) {
        throw corruption(what, offset, error);
      }
      throw error;
    }
  };
  return {
    sourceIdentity: reader,
    rowWindowStats: window?.stats,
    recordError: (head, error) => corruption('ROW', head.offset, error),
    async readRecordHead(
      offset,
      what = DEFAULT_WHAT,
      prefetchBytes,
      readAhead,
    ) {
      return (await readStart(offset, what, prefetchBytes, readAhead)).head;
    },
    readRecordStart: (offset, what, prefetchBytes) =>
      readStart(offset, what, prefetchBytes),
    async readRecordRange(head, offset, length) {
      validateRange(head, offset, length, trailer.durableEnd);
      try {
        return await (
          head.kind === RECORD_KIND.ROW ? (window ?? reader) : reader
        ).readAt(head.bodyOffset + offset, length);
      } catch (error) {
        if (error instanceof JournalShortReadError)
          throw corruption('ROW', head.offset, error);
        throw error;
      }
    },
    async *readRecordBody(head, chunkBytes, what = DEFAULT_WHAT) {
      try {
        yield* readWindowedBody(reader, window, head, chunkBytes);
      } catch (error) {
        if (
          error instanceof JournalFrameError ||
          error instanceof JournalShortReadError
        ) {
          throw corruption(what, head.offset, error);
        }
        throw error;
      }
    },
  };
}
