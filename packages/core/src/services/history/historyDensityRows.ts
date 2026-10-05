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
import {
  invalidateResponsesStatefulChain,
  type IContent,
  type ChronologyMarker,
} from './IContent.js';
import type { ChronologyRollbackEntry } from './historyBatchContracts.js';
import type { DensityResult } from '../../core/compression/types.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { isSpeakerContent } from './historyJournalGuards.js';

export class HistoryDensityRows implements Iterable<IContent> {
  private readonly root: string;
  private readonly rows: number;
  private readonly index: number;
  private readonly chronologyFile: number;
  private readonly identities = new Map<number, IContent>();
  private readonly originalMarkers = new Map<number, ChronologyMarker>();
  private offset = 0;
  private count = 0;
  private closed = false;

  constructor(private readonly ownership?: RowOwnership) {
    this.root = mkdtempSync(join(tmpdir(), 'history-density-'));
    let rows: number | undefined;
    let index: number | undefined;
    try {
      rows = openSync(join(this.root, 'rows'), 'w+');
      index = openSync(join(this.root, 'index'), 'w+');
      this.chronologyFile = openSync(join(this.root, 'chronology'), 'w+');
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

  get hasIdentityRows(): boolean {
    return this.identities.size > 0;
  }

  append(row: IContent): void {
    this.writeRow(this.count, row);
    this.count++;
  }

  isIdentityRow(index: number): boolean {
    this.assertOpen();
    return this.identities.has(index);
  }

  appendIdentity(row: IContent): void {
    this.assertOpen();
    this.ownership?.retain(row);
    this.identities.set(this.count, row);
    this.count++;
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

  prepareChronologyRollback(): Iterable<ChronologyRollbackEntry> {
    for (const [index, row] of this.identities) {
      transfer(
        this.chronologyFile,
        Buffer.from([row.metadata === undefined ? 0 : 1]),
        index,
        true,
      );
      const marker = row.metadata?.chronology;
      if (marker !== undefined) this.originalMarkers.set(index, marker);
    }
    return { [Symbol.iterator]: () => this.chronologyEntries() };
  }

  private *chronologyEntries(): Generator<
    ChronologyRollbackEntry,
    void,
    unknown
  > {
    for (const [index, content] of this.identities) {
      const flag = Buffer.alloc(1);
      transfer(this.chronologyFile, flag, index, false);
      yield {
        content,
        hadMetadata: flag[0] === 1,
        chronology: this.originalMarkers.get(index),
      };
    }
  }

  capture(previous: HistoryMutationSnapshot, result: DensityResult): void {
    const removed = new Set(result.removals);
    for (let index = 0; index < previous.length; index++) {
      if (removed.has(index)) continue;
      const original =
        result.replacements.get(index) ?? previous.readRow(index);
      this.ownership?.retain(original);
      try {
        const [row] = invalidateResponsesStatefulChain([original]);
        const identity =
          result.replacements.has(index) || previous.isPendingRow(index);
        if (identity) this.appendIdentity(row);
        else this.append(row);
      } finally {
        this.ownership?.release(original);
      }
    }
  }

  writeRow(index: number, row: IContent): void {
    this.assertOpen();
    if (this.identities.has(index)) return;
    const bytes = Buffer.from(JSON.stringify(row));
    const position = Buffer.alloc(16);
    position.writeDoubleLE(this.offset, 0);
    position.writeDoubleLE(bytes.length, 8);
    transfer(this.rows, bytes, this.offset, true);
    transfer(this.index, position, index * 16, true);
    this.offset += bytes.length;
  }

  readRow(index: number): IContent {
    this.assertOpen();
    const identity = this.identities.get(index);
    if (identity !== undefined) return identity;
    const position = Buffer.alloc(16);
    transfer(this.index, position, index * 16, false);
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
    for (const row of this.identities.values()) this.ownership?.release(row);
    this.identities.clear();
    this.originalMarkers.clear();
    try {
      closeSync(this.chronologyFile);
    } finally {
      this.closeRows();
    }
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
