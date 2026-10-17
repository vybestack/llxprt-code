/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalWriterPoisonedError } from './errors.js';
import type { FlushRecords } from './flushRecords.js';
import { frameLength } from './frame.js';
import { VectoredRecordAppender, type GroupRecord } from './groupAppender.js';
import {
  createFileHandleReader,
  createFileHandleSink,
  type JournalFileHandle,
  type PositionalReader,
} from './positionalFile.js';
import {
  encodeTrailerRecord,
  TRAILER_RECORD_BYTES,
  type TrailerHeader,
} from './trailerRecord.js';

export type { GroupRecord, RecordAppender } from './groupAppender.js';

const GROUP_TAG_BYTES = 7;

/**
 * What the caller decides about a trailer; the writer fills in the rest. A
 * copy that keeps the identity of a version it copies names its `commitSeq`
 * (design 4.11); every other group takes the next one.
 */
export type TrailerState = Omit<
  TrailerHeader,
  'selfOffset' | 'commitSeq' | 'groupTag' | 'durableEnd' | 'syncMarker'
> & { readonly commitSeq?: number };

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

/** The file a writer serves; the compaction swap replaces it as a whole (design 4.11). */
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
  private handle: JournalFileHandle;
  private syncMarker: Uint8Array;
  private readonly dependencies: GroupWriterDependencies;
  /**
   * Positional reads on the writer's own descriptor; they never touch its
   * write offset. They follow the descriptor across a compaction swap.
   */
  readonly reader: PositionalReader;
  private writeOffset: number;
  private publishedTrailer: TrailerHeader | undefined;
  private queue: Promise<void> = Promise.resolve();
  private failure: { readonly error: unknown } | undefined;
  private closed = false;
  /** True from the moment the swap detaches the descriptor until it attaches one again. */
  private detached = false;

  constructor(start: GroupWriterStart, dependencies: GroupWriterDependencies) {
    this.handle = start.handle;
    this.reader = {
      readAt: (position, length) =>
        createFileHandleReader(this.requireHandle()).readAt(position, length),
    };
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

  /**
   * Groups are written one after another in the order they are committed.
   * The records of the group are written together, in as few vectored writes
   * as their size allows.
   */
  commitGroup(group: CommitGroup): Promise<CommitAck> {
    return this.commitStreamedGroup(async (appender) => {
      // Before anything is appended, so a throw here leaves the file untouched.
      const state = group.trailer(
        planOffsets(appender.nextOffset, group.records),
      );
      for (const record of group.records) await appender.append(record);
      return state;
    });
  }

  /**
   * A group whose records are produced while it is written, such as the nodes
   * of a tree built from a stream. `build` appends the records, learning each
   * offset as it goes, and returns the trailer state. It is the same commit
   * point as `commitGroup`: the records are written, flushed, and only then
   * the trailer. A `build` that throws before it appends anything leaves the
   * writer usable; one that throws after poisons it, as any failure after a
   * group began does.
   */
  commitStreamedGroup(
    build: (appender: VectoredRecordAppender) => Promise<TrailerState>,
  ): Promise<CommitAck> {
    const turn = this.queue.then(() => this.runGroup(build));
    this.queue = turn.then(noop, noop);
    return turn;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    if (!this.detached) await this.handle.close();
  }

  /** What a restore must put back: the file as the writer holds it now. */
  currentFile(): GroupWriterStart {
    return {
      handle: this.requireHandle(),
      syncMarker: this.syncMarker,
      writeOffset: this.writeOffset,
      published: this.publishedTrailer,
    };
  }

  /**
   * Swap step A (design 4.11): gives up the descriptor, which the caller
   * closes. No read or write is served until `attach`. The caller holds the
   * commit queue, so no group is in flight.
   */
  detach(): JournalFileHandle {
    const handle = this.requireHandle();
    this.detached = true;
    return handle;
  }

  /** Swap steps C and R: serves the file `next` describes, from its published state and write offset. */
  attach(next: GroupWriterStart): void {
    this.handle = next.handle;
    this.syncMarker = next.syncMarker;
    this.writeOffset = next.writeOffset;
    this.publishedTrailer = next.published;
    this.detached = false;
  }

  /** The writer accepts nothing more; every later commit throws with `error` as its cause. */
  poison(error: unknown): void {
    this.failure = { error };
  }

  private requireHandle(): JournalFileHandle {
    if (this.detached) {
      throw new Error('The journal file is being swapped by a compaction');
    }
    return this.handle;
  }

  private async runGroup(
    build: (appender: VectoredRecordAppender) => Promise<TrailerState>,
  ): Promise<CommitAck> {
    if (this.closed) throw new Error('The journal writer is closed');
    if (this.failure !== undefined) {
      throw new JournalWriterPoisonedError({ cause: this.failure.error });
    }
    this.requireHandle();
    const appender = new VectoredRecordAppender(this.handle, this.writeOffset);
    try {
      const state = await build(appender);
      const selfOffset = appender.nextOffset;
      const trailer = this.buildTrailer(state, selfOffset);
      const record = encodeTrailerRecord(trailer);
      await this.writeRecordsFlushThenTrailer(appender, record, selfOffset);
      return this.acknowledge(trailer);
    } catch (error) {
      if (appender.started) this.failure = { error };
      throw error;
    }
  }

  private buildTrailer(state: TrailerState, selfOffset: number): TrailerHeader {
    return {
      ...state,
      selfOffset,
      commitSeq: state.commitSeq ?? (this.publishedTrailer?.commitSeq ?? 0) + 1,
      groupTag: groupTagFrom(this.dependencies.random(GROUP_TAG_BYTES)),
      durableEnd: selfOffset + TRAILER_RECORD_BYTES,
      syncMarker: this.syncMarker,
    };
  }

  /** Design 4.1: the records are flushed before the trailer is written, and the trailer is not flushed. */
  private async writeRecordsFlushThenTrailer(
    appender: VectoredRecordAppender,
    trailerRecord: Uint8Array,
    trailerOffset: number,
  ): Promise<void> {
    await appender.drain();
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

function planOffsets(start: number, records: readonly GroupRecord[]): number[] {
  const offsets: number[] = [];
  let offset = start;
  for (const record of records) {
    offsets.push(offset);
    offset += frameLength(record.kindHeader.length, record.body?.length ?? 0);
  }
  return offsets;
}
