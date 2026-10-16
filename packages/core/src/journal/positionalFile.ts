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

/** The part of a file handle that vectored positional writes need. */
export interface VectoredWriteTarget {
  /** Writes the buffers back to back at `position`; may stop short and reports how far it got. */
  writev(
    buffers: readonly Uint8Array[],
    position: number,
  ): Promise<{ bytesWritten: number }>;
}

/**
 * The file handle the journal opens and closes. A `node:fs/promises`
 * `FileHandle` fits it; tests wrap one to record or fail single operations.
 */
export interface JournalFileHandle
  extends PositionalReadTarget,
    PositionalWriteTarget,
    VectoredWriteTarget {
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

/** Kept well under the platform's IOV_MAX (1,024 on macOS and Linux). */
export const MAX_BUFFERS_PER_WRITEV = 512;

/**
 * Writes the buffers back to back starting at `startOffset` with as few
 * vectored calls as the platform allows, and carries on after a short write
 * from exactly where it stopped. The descriptor is never in append mode.
 */
export async function writeBuffersAt(
  target: VectoredWriteTarget,
  buffers: readonly Uint8Array[],
  startOffset: number,
): Promise<void> {
  let index = 0;
  let consumed = 0;
  let position = startOffset;
  while (index < buffers.length) {
    const batch = nextBatch(buffers, index, consumed);
    if (batch.length === 0) return;
    const { bytesWritten } = await target.writev(batch, position);
    if (bytesWritten === 0) {
      throw new Error(
        `Write of ${batch.length} buffers at ${position} made no progress`,
      );
    }
    position += bytesWritten;
    let left = bytesWritten;
    while (left > 0) {
      const available = buffers[index].length - consumed;
      if (left >= available) {
        left -= available;
        index += 1;
        consumed = 0;
      } else {
        consumed += left;
        left = 0;
      }
    }
  }
}

/** Up to the vector limit of non-empty buffers, the first one from `consumed` bytes in. */
function nextBatch(
  buffers: readonly Uint8Array[],
  index: number,
  consumed: number,
): Uint8Array[] {
  const batch: Uint8Array[] = [];
  for (let at = index; at < buffers.length; at++) {
    if (batch.length === MAX_BUFFERS_PER_WRITEV) break;
    const buffer = at === index ? buffers[at].subarray(consumed) : buffers[at];
    if (buffer.length > 0) batch.push(buffer);
  }
  return batch;
}
