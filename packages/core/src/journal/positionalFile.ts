/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/** Reads that name their offset. A read returns exactly `length` bytes or throws. */
export interface PositionalReader {
  readAt(position: number, length: number): Promise<Uint8Array>;
}

/** The part of a file handle that positional reads need. */
export interface PositionalReadTarget {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
}

/** The part of a file handle that positional writes need. */
export interface PositionalWriteTarget {
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesWritten: number }>;
}

/**
 * The file handle the journal opens and closes. A `node:fs/promises`
 * `FileHandle` fits it; tests wrap one to record or fail single operations.
 */
export interface JournalFileHandle
  extends PositionalReadTarget,
    PositionalWriteTarget {
  readonly fd: number;
  stat(): Promise<{ size: number }>;
  truncate(length: number): Promise<void>;
  close(): Promise<void>;
}

/** Receives the bytes of one record in order. The caller owns the offsets. */
export type ByteSink = (chunk: Uint8Array) => Promise<void>;

export function createFileHandleReader(
  handle: PositionalReadTarget,
): PositionalReader {
  return {
    async readAt(position: number, length: number): Promise<Uint8Array> {
      const buffer = new Uint8Array(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(
          buffer,
          filled,
          length - filled,
          position + filled,
        );
        if (bytesRead === 0) {
          throw new Error(
            `Unexpected end of file reading ${length} bytes at ${position}: got ${filled}`,
          );
        }
        filled += bytesRead;
      }
      return buffer;
    },
  };
}

/** Positional writes starting at `startOffset`; the descriptor is never in append mode. */
export function createFileHandleSink(
  handle: PositionalWriteTarget,
  startOffset: number,
): ByteSink {
  let position = startOffset;
  return async (chunk: Uint8Array): Promise<void> => {
    let written = 0;
    while (written < chunk.length) {
      const { bytesWritten } = await handle.write(
        chunk,
        written,
        chunk.length - written,
        position + written,
      );
      if (bytesWritten === 0) {
        throw new Error(
          `Write of ${chunk.length - written} bytes at ${position + written} made no progress`,
        );
      }
      written += bytesWritten;
    }
    position += chunk.length;
  };
}
