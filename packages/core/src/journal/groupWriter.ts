/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalWriterPoisonedError } from './errors.js';
import type { FlushRecords } from './flushRecords.js';
import { frameLength, writeFrame, type FrameBody } from './frame.js';
import {
  createFileHandleSink,
  type JournalFileHandle,
} from './positionalFile.js';
import {
  encodeTrailerRecord,
  TRAILER_RECORD_BYTES,
  type TrailerHeader,
} from './trailerRecord.js';

const GROUP_TAG_BYTES = 7;

/** One record of a group other than the trailer. */
export interface GroupRecord {
  readonly kind: number;
  readonly kindHeader: Uint8Array;
  readonly body?: FrameBody;
}

/** What the caller decides about a trailer; the writer fills in the rest. */
export type TrailerState = Omit<
  TrailerHeader,
  'selfOffset' | 'commitSeq' | 'groupTag' | 'durableEnd' | 'syncMarker'
>;

export interface CommitGroup {
  readonly records: readonly GroupRecord[];
  /**
   * Builds the trailer state once the offset of every record is known. It
   * runs before anything is written, so a throw leaves the file untouched.
   */
  readonly trailer: (recordOffsets: readonly number[]) => TrailerState;
}

/** Returned once the trailer's last byte has been written (design 4.1). */
export interface CommitAck {
  readonly commitSeq: number;
  readonly durableEnd: number;
  readonly groupTag: bigint;
}

export interface PublishedState extends CommitAck {
  readonly trailer: TrailerHeader;
}

export interface GroupWriterDependencies {
  readonly flush: FlushRecords;
  readonly random: (length: number) => Uint8Array;
}

export interface GroupWriterStart {
  readonly handle: JournalFileHandle;
  readonly syncMarker: Uint8Array;
  /** The file size at open: appends start here, never at a lower durable end. */
  readonly writeOffset: number;
  /** The last committed trailer, or undefined for a journal with no group. */
  readonly published: TrailerHeader | undefined;
}

function noop(): void {
  // Settles the queue tail; the caller of a commit sees the commit's own outcome.
}

function groupTagFrom(random: Uint8Array): bigint {
  let tag = 0n;
  for (let index = GROUP_TAG_BYTES - 1; index >= 0; index--) {
    tag = (tag << 8n) | BigInt(random[index]);
  }
  return tag;
}

/**
 * The single writer of one journal file (design 4.1 and 4.12). It writes at a
 * tracked offset on a read-write descriptor and never relies on the file
 * position. A group is its records, then `flushRecords`, then the trailer as
 * one write; the group is committed when that write returns. The published
 * state moves only there. A failure after the first byte of a group poisons
 * the writer.
 */
export class JournalGroupWriter {
  private readonly handle: JournalFileHandle;
  private readonly syncMarker: Uint8Array;
  private readonly dependencies: GroupWriterDependencies;
  private writeOffset: number;
  private publishedTrailer: TrailerHeader | undefined;
  private queue: Promise<void> = Promise.resolve();
  private failure: { readonly error: unknown } | undefined;
  private closed = false;

  constructor(start: GroupWriterStart, dependencies: GroupWriterDependencies) {
    this.handle = start.handle;
    this.syncMarker = start.syncMarker;
    this.writeOffset = start.writeOffset;
    this.publishedTrailer = start.published;
    this.dependencies = dependencies;
  }

  /** The last acked trailer. Undefined until the first group is acked. */
  get published(): PublishedState | undefined {
    const trailer = this.publishedTrailer;
    if (trailer === undefined) return undefined;
    return {
      commitSeq: trailer.commitSeq,
      durableEnd: trailer.durableEnd,
      groupTag: trailer.groupTag,
      trailer,
    };
  }

  /** Groups are written one after another in the order they are committed. */
  commitGroup(group: CommitGroup): Promise<CommitAck> {
    const turn = this.queue.then(() => this.runGroup(group));
    this.queue = turn.then(noop, noop);
    return turn;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    await this.handle.close();
  }

  private async runGroup(group: CommitGroup): Promise<CommitAck> {
    if (this.closed) throw new Error('The journal writer is closed');
    if (this.failure !== undefined) {
      throw new JournalWriterPoisonedError({ cause: this.failure.error });
    }
    const offsets = this.planOffsets(group.records);
    const selfOffset = offsets.end;
    const trailer = this.buildTrailer(group, offsets.records, selfOffset);
    const record = encodeTrailerRecord(trailer);
    try {
      await this.writeRecordsFlushThenTrailer(
        group.records,
        record,
        selfOffset,
      );
    } catch (error) {
      this.failure = { error };
      throw error;
    }
    return this.acknowledge(trailer);
  }

  private planOffsets(records: readonly GroupRecord[]): {
    records: number[];
    end: number;
  } {
    let offset = this.writeOffset;
    const starts: number[] = [];
    for (const record of records) {
      starts.push(offset);
      offset += frameLength(record.kindHeader.length, record.body?.length ?? 0);
    }
    return { records: starts, end: offset };
  }

  private buildTrailer(
    group: CommitGroup,
    recordOffsets: readonly number[],
    selfOffset: number,
  ): TrailerHeader {
    const state = group.trailer(recordOffsets);
    return {
      ...state,
      selfOffset,
      commitSeq: (this.publishedTrailer?.commitSeq ?? 0) + 1,
      groupTag: groupTagFrom(this.dependencies.random(GROUP_TAG_BYTES)),
      durableEnd: selfOffset + TRAILER_RECORD_BYTES,
      syncMarker: this.syncMarker,
    };
  }

  /** Design 4.1: the records are flushed before the trailer is written, and the trailer is not flushed. */
  private async writeRecordsFlushThenTrailer(
    records: readonly GroupRecord[],
    trailerRecord: Uint8Array,
    trailerOffset: number,
  ): Promise<void> {
    const sink = createFileHandleSink(this.handle, this.writeOffset);
    for (const record of records) {
      await writeFrame(sink, record.kind, record.kindHeader, record.body);
    }
    this.dependencies.flush(this.handle.fd);
    await createFileHandleSink(this.handle, trailerOffset)(trailerRecord);
  }

  /** The only place the published state and the write offset move. */
  private acknowledge(trailer: TrailerHeader): CommitAck {
    this.publishedTrailer = trailer;
    this.writeOffset = trailer.durableEnd;
    return {
      commitSeq: trailer.commitSeq,
      durableEnd: trailer.durableEnd,
      groupTag: trailer.groupTag,
    };
  }
}
