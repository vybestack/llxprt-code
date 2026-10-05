/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent, ChronologyMarker } from './IContent.js';
import { isRecord, isSpeakerContent } from './historyJournalGuards.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

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
}

export class DetachedHistoryJournal implements Iterable<IContent> {
  private readonly root: string;
  private readonly rows: number;
  private readonly index: number;
  private readonly markers: number;
  private count = 0;
  private rowOffset = 0;
  private markerOffset = 0;
  private closed = false;

  constructor(private readonly ownership?: RowOwnership) {
    this.root = mkdtempSync(join(tmpdir(), 'history-detached-'));
    const opened: number[] = [];
    try {
      this.rows = openSync(join(this.root, 'rows'), 'w+');
      opened.push(this.rows);
      this.index = openSync(join(this.root, 'index'), 'w+');
      opened.push(this.index);
      this.markers = openSync(join(this.root, 'markers'), 'w+');
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

  append(row: IContent): void {
    this.assertOpen();
    this.ownership?.retain(row);
    try {
      const marker = Buffer.from(
        JSON.stringify({
          hadMetadata: row.metadata !== undefined,
          chronology: row.metadata?.chronology,
        }),
      );
      const address = Buffer.alloc(32);
      address.writeDoubleLE(this.markerOffset, 16);
      address.writeDoubleLE(marker.length, 24);
      transfer(this.markers, marker, this.markerOffset, true);
      transfer(this.index, address, this.count * 32, true);
      this.writeRow(this.count, row);
      this.markerOffset += marker.length;
      this.count++;
    } finally {
      this.ownership?.release(row);
    }
  }

  private address(index: number): Buffer {
    this.assertOpen();
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new Error('Detached journal ordinal is invalid');
    const address = Buffer.alloc(32);
    transfer(this.index, address, index * 32, false);
    return address;
  }

  writeRow(index: number, row: IContent): void {
    this.assertOpen();
    if (!Number.isInteger(index) || index < 0 || index > this.count)
      throw new Error('Detached journal ordinal is invalid');
    const address = Buffer.alloc(32);
    transfer(this.index, address, index * 32, false);
    const bytes = Buffer.from(JSON.stringify(row));
    transfer(this.rows, bytes, this.rowOffset, true);
    address.writeDoubleLE(this.rowOffset, 0);
    address.writeDoubleLE(bytes.length, 8);
    transfer(this.index, address, index * 32, true);
    this.rowOffset += bytes.length;
  }

  readRow(index: number): IContent {
    const address = this.address(index);
    const bytes = Buffer.alloc(address.readDoubleLE(8));
    transfer(this.rows, bytes, address.readDoubleLE(0), false);
    const row: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isSpeakerContent(row)) throw new Error('Invalid detached journal row');
    return row;
  }

  readOriginalMarker(index: number): OriginalMarker {
    const address = this.address(index);
    const bytes = Buffer.alloc(address.readDoubleLE(24));
    transfer(this.markers, bytes, address.readDoubleLE(16), false);
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(value) || typeof value.hadMetadata !== 'boolean')
      throw new Error('Invalid detached marker record');
    const marker = value.chronology;
    if (marker === undefined) return { hadMetadata: value.hadMetadata };
    if (!isMarker(marker)) throw new Error('Invalid detached marker value');
    return { hadMetadata: value.hadMetadata, chronology: marker };
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
    const failures = cleanup(this.root, [this.rows, this.index, this.markers]);
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
    if (count === 0) throw new Error('Detached journal I/O made no progress');
    transferred += count;
  }
}
