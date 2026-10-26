/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';
import {
  encodeBodylessFrame,
  frameParts,
  frameLength,
  type FrameBody,
} from './frame.js';
import { writeBuffersAt, type VectoredWriteTarget } from './positionalFile.js';

/** One record of a group other than the trailer. */
export interface GroupRecord {
  readonly kind: number;
  readonly kindHeader: Uint8Array;
  readonly body?: FrameBody;
}

/**
 * Where the records of one commit group go. Each record gets its offset when
 * it is appended, because the group starts at a known write offset and every
 * frame length is known as soon as the record is encoded.
 */
export interface RecordAppender {
  readonly transcriptIdentity?: (offset: number) => bigint;
  readonly retainsSource?: (source: RecordAccess) => boolean;
  /** The offset the next appended record will start at. */
  readonly nextOffset: number;
  /** Takes the record and returns the offset it starts at. */
  append(record: GroupRecord): Promise<number>;
  /**
   * Writes whatever is waiting, so the records appended so far can be read
   * back from the file up to `nextOffset`.
   */
  drain(): Promise<void>;
}

/**
 * A group is written in batches of about this many bytes, each as one vectored write.
 * The batch is the compaction copy's in-flight bound, so it must sit well below the 1 MiB memory proof bound.
 */
export const DEFAULT_BATCH_BYTES = 256 * 1024;
/**
 * A body chunk smaller than this is copied into the batch, so a producer that
 * reuses its buffer cannot change bytes that are waiting for the write. A
 * larger one is written before the producer is asked for the next chunk, so
 * a body of any size is held one chunk at a time.
 */
export const COPY_CHUNK_BYTES = 64 * 1024;

/**
 * Collects the frames of one group and writes them with vectored positional
 * writes: one write for any group that fits a batch, a few for a larger one.
 * Nothing reaches the file until a batch is full or `drain` is called, so a
 * group that fails before then leaves the file untouched.
 */
export class VectoredRecordAppender implements RecordAppender {
  private cursor: number;
  private writtenTo: number;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private begun = false;
  private reservedOffsets: number[] | undefined;

  constructor(
    private readonly target: VectoredWriteTarget,
    startOffset: number,
    private readonly batchBytes: number = DEFAULT_BATCH_BYTES,
    private readonly allocation?: {
      position(): number;
      reserve(bytes: number): number;
    },
  ) {
    this.cursor = startOffset;
    this.writtenTo = startOffset;
  }

  get nextOffset(): number {
    return Math.max(this.cursor, this.allocation?.position() ?? 0);
  }

  /** True once `append` has been called, whether or not a byte has been written. */
  get started(): boolean {
    return this.begun;
  }

  reserveRecords(records: readonly GroupRecord[]): number[] {
    const lengths = records.map((record) =>
      frameLength(record.kindHeader.length, record.body?.length ?? 0),
    );
    let cursor =
      this.allocation?.reserve(
        lengths.reduce((sum, length) => sum + length, 0),
      ) ?? this.cursor;
    const offsets = lengths.map((length) => {
      const offset = cursor;
      cursor += length;
      return offset;
    });
    this.reservedOffsets = [...offsets];
    return offsets;
  }

  async append(record: GroupRecord): Promise<number> {
    this.begun = true;
    const offset =
      this.reservedOffsets?.shift() ??
      this.allocation?.reserve(
        frameLength(record.kindHeader.length, record.body?.length ?? 0),
      ) ??
      this.cursor;
    if (offset !== this.cursor) await this.drain();
    this.cursor = offset;
    if (this.pendingBytes === 0) this.writtenTo = offset;
    if (record.body === undefined) {
      this.push(encodeBodylessFrame(record.kind, record.kindHeader));
    } else {
      await this.appendWithBody(record, record.body);
    }
    if (this.pendingBytes >= this.batchBytes) await this.drain();
    return offset;
  }

  /** Writes whatever is waiting. The caller drains once more before it flushes. */
  async drain(): Promise<void> {
    if (this.pending.length === 0) return;
    const buffers = this.pending;
    const position = this.writtenTo;
    this.pending = [];
    this.writtenTo += this.pendingBytes;
    this.pendingBytes = 0;
    await writeBuffersAt(this.target, buffers, position);
  }

  private async appendWithBody(
    record: GroupRecord,
    body: FrameBody,
  ): Promise<void> {
    for await (const part of frameParts(record.kind, record.kindHeader, body)) {
      const big = part.length >= COPY_CHUNK_BYTES;
      this.push(big ? part : part.slice());
      if (big || this.pendingBytes >= this.batchBytes) await this.drain();
    }
  }

  private push(buffer: Uint8Array): void {
    this.pending.push(buffer);
    this.pendingBytes += buffer.length;
    this.cursor += buffer.length;
  }
}
