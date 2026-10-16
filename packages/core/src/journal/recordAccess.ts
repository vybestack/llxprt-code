/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalCorruptionError, JournalFrameError } from './errors.js';
import { readFrameBody, readFrameHead, type FrameHead } from './frame.js';
import type { PositionalReader } from './positionalFile.js';
import type { TrailerHeader } from './trailerRecord.js';

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
  /**
   * `prefetchBytes` is how much of the record to read with its head, for a
   * record whose size the caller knows; it saves the second read.
   */
  readRecordHead(
    offset: number,
    what?: string,
    prefetchBytes?: number,
  ): Promise<FrameHead>;
  /** Streams the body; the CRC is checked after the last chunk, so consume it to the end. */
  readRecordBody(
    head: FrameHead,
    chunkBytes?: number,
    what?: string,
  ): AsyncGenerator<Uint8Array>;
}

export function createRecordAccess(
  path: string,
  reader: PositionalReader,
  trailer: TrailerHeader,
): RecordAccess {
  const corruption = (
    what: string,
    offset: number,
    error: JournalFrameError,
  ): JournalCorruptionError =>
    new JournalCorruptionError(
      path,
      what,
      offset,
      trailer.selfOffset,
      error.message,
      { cause: error },
    );
  return {
    async readRecordHead(offset, what = DEFAULT_WHAT, prefetchBytes) {
      try {
        return await readFrameHead(
          reader,
          offset,
          trailer.durableEnd,
          prefetchBytes,
        );
      } catch (error) {
        if (error instanceof JournalFrameError) {
          throw corruption(what, offset, error);
        }
        throw error;
      }
    },
    async *readRecordBody(head, chunkBytes, what = DEFAULT_WHAT) {
      try {
        yield* readFrameBody(reader, head, chunkBytes);
      } catch (error) {
        if (error instanceof JournalFrameError) {
          throw corruption(what, head.offset, error);
        }
        throw error;
      }
    },
  };
}
