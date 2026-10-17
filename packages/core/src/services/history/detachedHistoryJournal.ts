/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent, ChronologyMarker } from './IContent.js';
import { isRecord, isSpeakerContent } from './historyJournalGuards.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { createScratchDirSync } from '../../storage/scratch-root.js';
import { TailBufferedFile } from './tailBufferedFile.js';
import type { HistoryRowOrigins } from './historyRowOrigins.js';

const stalled = 'Detached journal I/O made no progress';
const rowsBufferBytes = 64 * 1024;
const sideBufferBytes = 32 * 1024;

function isMarker(value: unknown): value is ChronologyMarker {
  if (!isRecord(value)) return false;
  return (
    typeof value.seq === 'number' &&
    typeof value.userTurn === 'number' &&
    typeof value.step === 'number' &&
    typeof value.recordedAt === 'number'
  );
}

interface OriginalMarker {
  readonly hadMetadata: boolean;
  readonly chronology?: ChronologyMarker;
  /** The ordinal of the history row this row was derived from, when the writer recorded one. */
  readonly sourceOrdinal?: number;
}

export class DetachedHistoryJournal implements Iterable<IContent> {
  private readonly root: string;
  private readonly rows: TailBufferedFile;
  private readonly index: TailBufferedFile;
  private readonly markers: TailBufferedFile;
  private readonly descriptors: readonly number[];
  private count = 0;
  private rowOffset = 0;
  private markerOffset = 0;
  private closed = false;
  private rowOrigins: HistoryRowOrigins | undefined;

  constructor(private readonly ownership?: RowOwnership) {
    this.root = createScratchDirSync('history-detached-');
    const opened: number[] = [];
    try {
      opened.push(openSync(join(this.root, 'rows'), 'w+'));
      opened.push(openSync(join(this.root, 'index'), 'w+'));
      opened.push(openSync(join(this.root, 'markers'), 'w+'));
      this.descriptors = opened;
      const [rows, index, markers] = opened;
      this.rows = new TailBufferedFile(rows, rowsBufferBytes, stalled);
      this.index = new TailBufferedFile(index, sideBufferBytes, stalled);
      this.markers = new TailBufferedFile(markers, sideBufferBytes, stalled);
    } catch (error) {
      const failures = cleanup(this.root, opened);
      if (failures.length > 0)
        throw new AggregateError(
          [error, ...failures],
          'Detached journal acquisition failed',
        );
      throw error;
    }
  }

  get length(): number {
    return this.count;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Detached journal is closed');
  }

  /**
   * Take ownership of the origins the captured rows had in the journal. The
   * rows hold content only; rolling back to this copy needs each row's owner.
   */
  adoptOrigins(origins: HistoryRowOrigins): void {
    this.assertOpen();
    if (this.rowOrigins !== undefined)
      throw new Error('Detached journal already has row origins');
    this.rowOrigins = origins;
  }

  /** The origin each row had when captured; fails for a journal that was not captured. */
  get origins(): HistoryRowOrigins {
    this.assertOpen();
    if (this.rowOrigins === undefined)
      throw new Error('Detached journal has no captured row origins');
    return this.rowOrigins;
  }

  /**
   * Appends `row`. `sourceOrdinal` is the position, in the history the
   * candidate is built from, of the row this one is derived from; a publisher
   * reads it back with {@link sourceOrdinalAt} so the row keeps that row's owner.
   * A row appended without one is written under the operation's origin.
   */
  append(row: IContent, sourceOrdinal?: number): void {
    this.assertOpen();
    this.ownership?.retain(row);
    try {
      const marker = Buffer.from(
        JSON.stringify({
          hadMetadata: row.metadata !== undefined,
          chronology: row.metadata?.chronology,
          sourceOrdinal,
        }),
      );
      const bytes = Buffer.from(JSON.stringify(row));
      const address = Buffer.alloc(32);
      address.writeDoubleLE(this.rowOffset, 0);
      address.writeDoubleLE(bytes.length, 8);
      address.writeDoubleLE(this.markerOffset, 16);
      address.writeDoubleLE(marker.length, 24);
      this.markers.write(marker, this.markerOffset);
      this.rows.write(bytes, this.rowOffset);
      this.index.write(address, this.count * 32);
      this.markerOffset += marker.length;
      this.rowOffset += bytes.length;
      this.count++;
    } finally {
      this.ownership?.release(row);
    }
  }

  /** Writes out and frees the append buffers, surfacing any failed write. */
  settle(): void {
    this.assertOpen();
    this.markers.release();
    this.rows.release();
    this.index.release();
  }

  private address(index: number): Buffer {
    this.assertOpen();
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new Error('Detached journal ordinal is invalid');
    const address = Buffer.alloc(32);
    this.index.read(address, index * 32);
    return address;
  }

  writeRow(index: number, row: IContent): void {
    this.assertOpen();
    if (!Number.isInteger(index) || index < 0 || index > this.count)
      throw new Error('Detached journal ordinal is invalid');
    const address = Buffer.alloc(32);
    this.index.read(address, index * 32);
    const bytes = Buffer.from(JSON.stringify(row));
    this.rows.write(bytes, this.rowOffset);
    address.writeDoubleLE(this.rowOffset, 0);
    address.writeDoubleLE(bytes.length, 8);
    this.index.write(address, index * 32);
    this.rowOffset += bytes.length;
  }

  readRow(index: number): IContent {
    const address = this.address(index);
    const bytes = Buffer.alloc(address.readDoubleLE(8));
    this.rows.read(bytes, address.readDoubleLE(0));
    const row: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isSpeakerContent(row)) throw new Error('Invalid detached journal row');
    return row;
  }

  readOriginalMarker(index: number): OriginalMarker {
    const address = this.address(index);
    const bytes = Buffer.alloc(address.readDoubleLE(24));
    this.markers.read(bytes, address.readDoubleLE(16));
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value) || typeof value.hadMetadata !== 'boolean')
      throw new Error('Invalid detached marker record');
    const marker = value.chronology;
    const sourceOrdinal = value.sourceOrdinal;
    if (sourceOrdinal !== undefined && typeof sourceOrdinal !== 'number')
      throw new Error('Invalid detached source ordinal');
    if (marker !== undefined && !isMarker(marker))
      throw new Error('Invalid detached marker value');
    return {
      hadMetadata: value.hadMetadata,
      ...(marker === undefined ? {} : { chronology: marker }),
      ...(sourceOrdinal === undefined ? {} : { sourceOrdinal }),
    };
  }

  /**
   * The history ordinal row `index` was derived from; undefined for a row its
   * writer appended without one (a row no history row produced, such as a summary).
   */
  sourceOrdinalAt(index: number): number | undefined {
    return this.readOriginalMarker(index).sourceOrdinal;
  }

  *[Symbol.iterator](): Generator<IContent, void, unknown> {
    this.assertOpen();
    const count = this.count;
    for (let index = 0; index < count; index++) {
      const row = this.readRow(index);
      this.ownership?.retain(row);
      try {
        yield row;
      } finally {
        this.ownership?.release(row);
      }
    }
  }

  async *streamRows(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    signal?.throwIfAborted();
    for (const row of this) {
      signal?.throwIfAborted();
      yield row;
    }
    signal?.throwIfAborted();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const failures = cleanup(this.root, this.descriptors);
    try {
      this.rowOrigins?.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Detached journal cleanup failed');
  }
}

function cleanup(root: string, files: readonly number[]): unknown[] {
  const failures: unknown[] = [];
  for (const fd of [...files].reverse()) {
    try {
      closeSync(fd);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  return failures;
}
