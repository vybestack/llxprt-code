/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { FileHandle } from 'node:fs/promises';

/** Reads that name their offset. A read returns exactly `length` bytes or throws. */
export interface PositionalReader {
  readAt(position: number, length: number): Promise<Uint8Array>;
}

/** Receives the bytes of one record in order. The caller owns the offsets. */
export type ByteSink = (chunk: Uint8Array) => Promise<void>;

export function createFileHandleReader(handle: FileHandle): PositionalReader {
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
  handle: FileHandle,
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
      written += bytesWritten;
    }
    position += chunk.length;
  };
}
