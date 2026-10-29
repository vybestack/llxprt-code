/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { isSpeakerContent } from './historyJournalGuards.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { createScratchDirSync } from '../../storage/scratch-root.js';

/** Per row: offset and length in the rows file, then the source ordinal (or NO_ORDINAL). */
const INDEX_RECORD_BYTES = 24;
const NO_ORDINAL = -1;

export class HistoryDensityRows implements Iterable<IContent> {
  private readonly root: string;
  private readonly rows: number;
  private readonly index: number;
  private offset = 0;
  private count = 0;
  private closed = false;

  constructor(private readonly ownership?: RowOwnership) {
    this.root = createScratchDirSync('history-density-');
    let rows: number | undefined;
    let index: number | undefined;
    try {
      rows = openSync(join(this.root, 'rows'), 'w+');
      index = openSync(join(this.root, 'index'), 'w+');
      this.rows = rows;
      this.index = index;
    } catch (error) {
      try {
        this.closeOpened(index);
      } finally {
        try {
          this.closeOpened(rows);
        } finally {
          rmSync(this.root, { recursive: true, force: true });
        }
      }
      throw error;
    }
  }

  private closeOpened(fd: number | undefined): void {
    if (fd !== undefined) closeSync(fd);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Candidate rows are closed');
  }

  get length(): number {
    return this.count;
  }

  /**
   * Appends `row`. `sourceOrdinal` is the position, in the history the
   * candidate is built from, of the row this one is derived from; a publisher
   * reads it back with {@link sourceOrdinalAt} so the row keeps that row's owner.
   * A row appended without one comes from no history row (a summary, say).
   */
  append(row: IContent, sourceOrdinal?: number): void {
    this.writeRow(this.count, row);
    this.writeOrdinal(this.count, sourceOrdinal);
    this.count++;
  }

  /**
   * The history ordinal row `index` was derived from; undefined for a row its
   * writer appended without one.
   */
  sourceOrdinalAt(index: number): number | undefined {
    this.assertOpen();
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new Error('Density candidate ordinal is invalid');
    const bytes = Buffer.alloc(8);
    transfer(this.index, bytes, index * INDEX_RECORD_BYTES + 16, false);
    const ordinal = bytes.readDoubleLE(0);
    return ordinal === NO_ORDINAL ? undefined : ordinal;
  }

  private writeOrdinal(index: number, sourceOrdinal: number | undefined): void {
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleLE(sourceOrdinal ?? NO_ORDINAL, 0);
    transfer(this.index, bytes, index * INDEX_RECORD_BYTES + 16, true);
  }

  /** Serialize a sanitized value of a caller-owned row; the caller's row is never retained. */
  appendSanitized(row: IContent): void {
    this.append(sanitizeProviderContentForSerialization(row));
  }

  async *streamRows(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    signal?.throwIfAborted();
    for (const row of this) {
      yield row;
      signal?.throwIfAborted();
    }
  }

  writeRow(index: number, row: IContent): void {
    this.assertOpen();
    const bytes = Buffer.from(JSON.stringify(row));
    const position = Buffer.alloc(16);
    position.writeDoubleLE(this.offset, 0);
    position.writeDoubleLE(bytes.length, 8);
    transfer(this.rows, bytes, this.offset, true);
    transfer(this.index, position, index * INDEX_RECORD_BYTES, true);
    this.offset += bytes.length;
  }

  readRow(index: number): IContent {
    this.assertOpen();
    const position = Buffer.alloc(16);
    transfer(this.index, position, index * INDEX_RECORD_BYTES, false);
    const bytes = Buffer.alloc(position.readDoubleLE(8));
    transfer(this.rows, bytes, position.readDoubleLE(0), false);
    const row: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isSpeakerContent(row))
      throw new Error('Invalid density candidate row');
    return row;
  }

  *[Symbol.iterator](): Generator<IContent, void, unknown> {
    this.assertOpen();
    const length = this.count;
    for (let index = 0; index < length; index++) {
      const row = this.readRow(index);
      this.ownership?.retain(row);
      try {
        yield row;
      } finally {
        this.ownership?.release(row);
      }
    }
  }

  close(): void {
    this.closed = true;
    this.closeRows();
  }

  private closeRows(): void {
    try {
      closeSync(this.index);
    } finally {
      try {
        closeSync(this.rows);
      } finally {
        rmSync(this.root, { recursive: true, force: true });
      }
    }
  }
}

function transfer(
  fd: number,
  bytes: Buffer,
  offset: number,
  write: boolean,
): void {
  let transferred = 0;
  while (transferred < bytes.length) {
    const count = write
      ? writeSync(
          fd,
          bytes,
          transferred,
          bytes.length - transferred,
          offset + transferred,
        )
      : readSync(
          fd,
          bytes,
          transferred,
          bytes.length - transferred,
          offset + transferred,
        );
    if (count === 0) throw new Error('Density candidate I/O made no progress');
    transferred += count;
  }
}
