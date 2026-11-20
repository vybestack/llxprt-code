/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeAdmittedRow, readAdmittedRows } from './row-admission.js';
import { encodeRowDraft, type RowDraft } from './rowDraft.js';
import { JournalInputError, JournalWriterPoisonedError } from './errors.js';
import type { FlushRecords } from './flushRecords.js';
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
 * and its `groupTag` (design 4.11, D-ORCH-6); every other group takes the next
 * sequence and a fresh random tag.
 */
export type TrailerState = Omit<
  TrailerHeader,
  'selfOffset' | 'commitSeq' | 'groupTag' | 'durableEnd' | 'syncMarker'
> & { readonly commitSeq?: number; readonly groupTag?: bigint };

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
  readonly notifyCommit?: (ack: CommitAck, swapped?: boolean) => void;
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
 * state moves only there. A write failure after a group starts poisons the
 * writer. A marked input failure discards the uncommitted tail instead.
 */
export class JournalGroupWriter {
  flushCommitted(): Promise<void> {
    const turn = this.queue.then(() => {
      if (this.failure !== undefined) throw this.failure.error;
      try {
        this.dependencies.flush(this.requireHandle().fd);
      } catch (error) {
        this.failure = { error };
        throw error;
      }
    });
    this.queue = turn.then(noop, noop);
    return turn;
  }

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
  private readerHolds = 0;
  private retired = false;
  private fileClose: Promise<void> | undefined;
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

  private admissionEpoch = 0;

  private reserve(bytes: number): number {
    const offset = this.writeOffset;
    this.writeOffset += bytes;
    return offset;
  }

  admitRow(draft: RowDraft): { start: number; end: number } {
    if (this.closed) throw new Error('The journal writer is closed');
    if (this.failure !== undefined)
      throw new JournalWriterPoisonedError({ cause: this.failure.error });
    const encoded = encodeRowDraft(0n, draft);
    const start = this.reserve(encoded.recordLength);
    this.admissionEpoch++;
    try {
      const end = writeAdmittedRow(
        this.requireHandle().fd,
        start,
        draft,
        encoded,
      );
      return { start, end };
    } catch (error) {
      this.poison(error);
      throw error;
    }
  }

  admittedRows(start: number, end: number): AsyncGenerator<RowDraft> {
    return readAdmittedRows(this.reader, start, end);
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
      const state = group.trailer(appender.reserveRecords(group.records));
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
   * writer usable. After appending, only a marked input failure can discard
   * the uncommitted tail and leave the writer usable; other failures poison it.
   */
  commitStreamedGroup(
    build: (appender: VectoredRecordAppender) => Promise<TrailerState>,
  ): Promise<CommitAck> {
    return this.prepareGroup(build).then((ack) => {
      if (ack === undefined) throw new Error('A commit group left no trailer');
      return ack;
    });
  }

  prepareGroup(
    build: (
      appender: VectoredRecordAppender,
    ) => Promise<TrailerState | undefined>,
    flushTrailer = false,
  ): Promise<CommitAck | undefined> {
    const turn = this.queue.then(() => this.runGroup(build, flushTrailer));
    this.queue = turn.then(noop, noop);
    return turn;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    this.retired = true;
    if (this.readerHolds === 0) await this.closeFile();
  }

  retainReader(): () => void | Promise<void> {
    if (this.closed) throw new Error('The journal writer is closed');
    this.readerHolds += 1;
    let released = false;
    return () => {
      if (released) throw new Error('A journal reader was released twice');
      released = true;
      this.readerHolds -= 1;
      if (this.retired && this.readerHolds === 0) return this.closeFile();
      return undefined;
    };
  }

  private closeFile(): Promise<void> {
    if (this.detached) return Promise.resolve();
    this.fileClose ??= this.handle.close().catch((error: unknown) => {
      this.fileClose = undefined;
      throw error;
    });
    return this.fileClose;
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
    if (next.published !== undefined)
      this.dependencies.notifyCommit?.(next.published, true);
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
    build: (
      appender: VectoredRecordAppender,
    ) => Promise<TrailerState | undefined>,
    flushTrailer: boolean,
  ): Promise<CommitAck | undefined> {
    if (this.closed) throw new Error('The journal writer is closed');
    if (this.failure !== undefined) {
      throw new JournalWriterPoisonedError({ cause: this.failure.error });
    }
    this.requireHandle();
    const startOffset = this.writeOffset;
    const admissionEpoch = this.admissionEpoch;
    const appender = new VectoredRecordAppender(
      this.handle,
      startOffset,
      flushTrailer ? 16 * 1024 : undefined,
      {
        position: () => this.writeOffset,
        reserve: (bytes) => this.reserve(bytes),
      },
    );
    try {
      const state = await build(appender);
      if (state === undefined) {
        if (appender.started) {
          await this.rollbackGroup(startOffset, admissionEpoch);
        }
        return undefined;
      }
      const selfOffset = this.reserve(TRAILER_RECORD_BYTES);
      const trailer = this.buildTrailer(state, selfOffset);
      const record = encodeTrailerRecord(trailer);
      await this.writeRecordsFlushThenTrailer(appender, record, selfOffset);
      if (flushTrailer) this.dependencies.flush(this.handle.fd);
      return this.acknowledge(trailer);
    } catch (error) {
      if (error instanceof JournalInputError) {
        try {
          await this.rollbackGroup(startOffset, admissionEpoch);
        } catch (rollback) {
          const failure = new AggregateError(
            [error.failure, rollback],
            'Journal input rollback failed',
          );
          this.failure = { error: failure };
          throw failure;
        }
        throw error.failure;
      }
      if (appender.started || admissionEpoch !== this.admissionEpoch)
        this.failure = { error };
      else this.writeOffset = startOffset;
      throw error;
    }
  }

  private async rollbackGroup(
    startOffset: number,
    admissionEpoch: number,
  ): Promise<void> {
    if (admissionEpoch !== this.admissionEpoch)
      throw new Error('Cannot roll back a group across synchronous admissions');
    await this.handle.truncate(startOffset);
    this.writeOffset = startOffset;
  }

  private buildTrailer(state: TrailerState, selfOffset: number): TrailerHeader {
    return {
      ...state,
      selfOffset,
      commitSeq: state.commitSeq ?? (this.publishedTrailer?.commitSeq ?? 0) + 1,
      groupTag:
        state.groupTag ??
        groupTagFrom(this.dependencies.random(GROUP_TAG_BYTES)),
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
    this.writeOffset = Math.max(this.writeOffset, trailer.durableEnd);
    this.dependencies.notifyCommit?.(trailer);
    return {
      commitSeq: trailer.commitSeq,
      durableEnd: trailer.durableEnd,
      groupTag: trailer.groupTag,
    };
  }
}
