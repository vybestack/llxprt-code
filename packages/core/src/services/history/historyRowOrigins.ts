/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, rmSync, writeSync, readSync } from 'node:fs';
import { join } from 'node:path';
import type { IContent } from './IContent.js';
import type { OwnedRow } from './historyReplaceOps.js';
import { RowOriginDictionary } from '../../recording/rowOriginDictionary.js';
import { createScratchDirSync } from '../../storage/scratch-root.js';

/** The part of a read cursor that names row origins. */
export interface RowOriginSource {
  readonly length: number;
  originAt(index: number): string | undefined;
}

const ENTRY_BYTES = 4;
const CHUNK_ENTRIES = 4096;

/**
 * The origin each row of a history had when it was captured, kept on disk one
 * fixed-width entry per row beside the row copies a compensation restores. The
 * journal's own cursor is the only source of row origins, and it describes the
 * journal as it is now; compensation needs the origins as they were before the
 * failed mutation wrote anything. Memory holds one dictionary entry per
 * distinct origin and one chunk of entries, never one entry per row.
 */
export class HistoryRowOrigins {
  private closed = false;

  private constructor(
    private readonly names: RowOriginDictionary,
    private readonly count: number,
    private readonly fd: number,
    private readonly drop: () => void,
  ) {}

  /** Record the origin of every row `cursor` holds, in row order. */
  static capture(cursor: RowOriginSource): HistoryRowOrigins {
    const root = createScratchDirSync('history-row-origins-');
    const drop = (): void => rmSync(root, { recursive: true, force: true });
    let fd: number | undefined;
    try {
      fd = openSync(join(root, 'origins'), 'w+');
      const names = new RowOriginDictionary();
      const length = cursor.length;
      const chunk = Buffer.alloc(CHUNK_ENTRIES * ENTRY_BYTES);
      for (let start = 0; start < length; start += CHUNK_ENTRIES) {
        const entries = Math.min(CHUNK_ENTRIES, length - start);
        for (let slot = 0; slot < entries; slot++)
          chunk.writeUInt32LE(
            names.idOf(cursor.originAt(start + slot)),
            slot * ENTRY_BYTES,
          );
        writeAll(fd, chunk.subarray(0, entries * ENTRY_BYTES), start);
      }
      return new HistoryRowOrigins(names, length, fd, drop);
    } catch (error) {
      try {
        if (fd !== undefined) closeSync(fd);
      } finally {
        drop();
      }
      throw error;
    }
  }

  get length(): number {
    return this.count;
  }

  /** The origin id of row `index`; undefined for an unowned row. */
  originAt(index: number): string | undefined {
    if (this.closed) throw new Error('Row origins are closed');
    if (index < 0 || index >= this.count)
      throw new RangeError(`Row origin ${index} is outside the captured rows`);
    const entry = Buffer.alloc(ENTRY_BYTES);
    const count = readSync(this.fd, entry, 0, ENTRY_BYTES, index * ENTRY_BYTES);
    if (count !== ENTRY_BYTES) throw new Error('Row origins ended early');
    const id = entry.readUInt32LE(0);
    return id === 0 ? undefined : this.names.originOf(id);
  }

  /** `rows` one at a time, each with the origin captured for its position. */
  *owned(rows: Iterable<IContent>): Generator<OwnedRow, void, unknown> {
    let index = 0;
    for (const content of rows) {
      const origin = this.originAt(index++);
      yield origin === undefined ? { content } : { content, origin };
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      closeSync(this.fd);
    } finally {
      this.drop();
    }
  }
}

function writeAll(fd: number, bytes: Buffer, entryStart: number): void {
  let written = 0;
  while (written < bytes.length) {
    const count = writeSync(
      fd,
      bytes,
      written,
      bytes.length - written,
      entryStart * ENTRY_BYTES + written,
    );
    if (count === 0) throw new Error('Row origins write made no progress');
    written += count;
  }
}
