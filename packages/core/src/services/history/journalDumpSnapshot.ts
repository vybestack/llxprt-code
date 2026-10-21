/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  CompressionInputSnapshot,
  DensityCallLookup,
} from './compressionInput.js';
import { DensityCallFacts } from '../../journal/densityCallFacts.js';
import {
  ROW_BLOCK_TYPE,
  ROW_FLAG,
  ROW_SPEAKER,
} from '../../journal/rowRecord.js';
import { JournalFormatError } from '../../journal/errors.js';
import { decodeStoredBlock } from './journalRowCodec.js';
import type {
  CompressionChronologySelection,
  CompressionSpanAnnotation,
} from './compressionChronology.js';
import { journalCompressionSpan } from './journalCompressionSpan.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import {
  isMediaReferenceBlock,
  type IContent,
  type MediaReferenceBlock,
} from './IContent.js';
import {
  buildChronologyTrace,
  type ChronologyTraceEntry,
} from './historyChronology.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import { countDecodedRow } from './journalRowCounters.js';
import { decodeStoredRow } from './journalRowCodec.js';
import { HistoryReaderScope } from './historyReaderScope.js';
import { snapshotRows } from './journalDetachedCapture.js';

/**
 * The rows of one published version for a dump. Nothing is copied: each read
 * goes back to the file through the snapshot, one row at a time, so the dump
 * needs no spool and keeps its version however many groups commit after it.
 */
export class JournalDumpSnapshot implements HistoryDumpSnapshot {
  private readonly readers = new HistoryReaderScope('Dump snapshot is closed');
  private closing: Promise<void> | undefined;
  readonly densityCalls: DensityCallLookup = {
    firstCall: (id) =>
      this.readers.read(async () => {
        const at = await new DensityCallFacts(this.snapshot.facts).firstCall(
          id,
        );
        if (at === undefined) return undefined;
        const entry = await this.snapshot.entryByLabel(at.label);
        if (entry === undefined)
          throw new JournalFormatError('Density call points to an absent row');
        const block = decodeStoredBlock(
          await this.snapshot.readBlock(entry, at.block),
          ROW_BLOCK_TYPE.tool_call,
        );
        if (block.type !== 'tool_call')
          throw new JournalFormatError(
            'Density call points to a non-call block',
          );
        return block;
      }),
    hasResponseAfter: (id, position) =>
      this.readers.read(async () => {
        const label = await new DensityCallFacts(
          this.snapshot.facts,
        ).lastResponse(id);
        return (
          label !== undefined &&
          label > (await this.snapshot.curatedAt(position)).label
        );
      }),
  };

  constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly resumeBoundary?: bigint,
    private readonly counters?: JournalReadCounters,
    private readonly onClose: () => void = () => {},
  ) {}

  get length(): number {
    this.readers.requireOpen();
    return this.snapshot.curatedRows;
  }
  get rawLength(): number {
    this.readers.requireOpen();
    return this.snapshot.rows;
  }

  readRawRow(index: number): Promise<IContent> {
    return this.readers.read(async () =>
      decodeStoredRow(
        await this.snapshot.readRow(await this.snapshot.entryAt(index)),
        this.resumeBoundary,
      ),
    );
  }

  readRow(index: number): Promise<IContent> {
    return this.readers.read(async () => {
      const entry = await this.snapshot.curatedAt(index);
      return decodeStoredRow(
        await this.snapshot.readRow(entry),
        this.resumeBoundary,
      );
    });
  }

  sourceOrdinalAt(index: number): Promise<number> {
    return this.readers.read(async () => {
      const entry = await this.snapshot.curatedAt(index);
      return this.snapshot.rowsBelow(entry.label);
    });
  }

  checkpointRows(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    this.snapshot.requireOpen();
    return this.readers.open(this.checkpoint(signal));
  }

  private async *checkpoint(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of snapshotRows(
      this.snapshot,
      signal,
      this.resumeBoundary,
    )) {
      const release = countDecodedRow(row, this.counters);
      try {
        yield row;
      } finally {
        release();
      }
    }
  }

  mediaReferences(): AsyncGenerator<MediaReferenceBlock, void, unknown> {
    return this.readers.open(this.references());
  }

  private async *references(): AsyncGenerator<
    MediaReferenceBlock,
    void,
    unknown
  > {
    for await (const entry of this.snapshot.entries()) {
      this.readers.requireOpen();
      if ((entry.flags & ROW_FLAG.hasMedia) === 0) continue;
      const { header } = await this.snapshot.readIds(entry);
      for (let index = 0; index < header.blocks.length; index++) {
        if (header.blocks[index].type !== ROW_BLOCK_TYPE.media) continue;
        const block = decodeStoredBlock(
          await this.snapshot.readBlock(entry, index),
          ROW_BLOCK_TYPE.media,
        );
        if (isMediaReferenceBlock(block)) yield block;
      }
    }
  }

  humanCut(turns: number, fromEnd: boolean): Promise<number> {
    return this.readers.read(async () => {
      if (!Number.isSafeInteger(turns) || turns < 0)
        throw new RangeError('Human turn count must be a non-negative integer');
      if (turns === 0) return this.snapshot.rows;
      let humans = 0;
      if (fromEnd) {
        for (let index = this.snapshot.rows - 1; index >= 0; index--) {
          const entry = await this.snapshot.entryAt(index);
          if (entry.speaker === ROW_SPEAKER.human && ++humans === turns)
            return index;
        }
        return 0;
      }
      let index = 0;
      for await (const entry of this.snapshot.entries()) {
        if (entry.speaker === ROW_SPEAKER.human && ++humans === turns)
          return index;
        index++;
      }
      return this.snapshot.rows;
    });
  }

  async chronologySelection(
    start: number,
  ): Promise<CompressionChronologySelection> {
    this.readers.requireOpen();
    if (!Number.isInteger(start) || start < 0 || start > this.length)
      throw new RangeError(
        'Compression selection start is outside the snapshot',
      );
    if (start === this.length) return { ranges: [], generated: [] };
    const first = await this.sourceOrdinalAt(start);
    return {
      ranges: [{ from: first, to: this.snapshot.rows }],
      generated: [],
    };
  }

  compressionSpan(
    selection: CompressionChronologySelection,
    hasFrontier: boolean,
    signal?: AbortSignal,
  ): Promise<CompressionSpanAnnotation> {
    return this.readers.read(() =>
      journalCompressionSpan(this.snapshot, selection, hasFrontier, signal),
    );
  }

  [Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
    return this.readers.open(this.curated());
  }

  private async *curated(): AsyncGenerator<IContent, void, unknown> {
    for (let index = 0; index < this.length; index++) {
      const row = await this.readRow(index);
      const release = countDecodedRow(row, this.counters);
      try {
        yield row;
      } finally {
        release();
      }
    }
  }

  rows(): AsyncGenerator<IContent, void, unknown> {
    return this.readers.open(this.raw());
  }

  private async *raw(): AsyncGenerator<IContent, void, unknown> {
    for await (const entry of this.snapshot.entries()) {
      this.readers.requireOpen();
      const row = decodeStoredRow(
        await this.snapshot.readRow(entry),
        this.resumeBoundary,
      );
      const release = countDecodedRow(row, this.counters);
      try {
        yield row;
      } finally {
        release();
      }
    }
  }

  async *chronology(): AsyncGenerator<ChronologyTraceEntry, void, unknown> {
    for await (const content of this.rows())
      yield* buildChronologyTrace([content]);
  }

  close(): Promise<void> {
    this.closing ??= this.retire();
    return this.closing;
  }

  private async retire(): Promise<void> {
    const failures: unknown[] = [];
    for (const close of [
      () => this.readers.close(),
      () => this.snapshot.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    this.onClose();
    if (failures.length === 1) throw failures[0];
    if (failures.length > 0)
      throw new AggregateError(failures, 'Dump snapshot cleanup failed');
  }
}

export async function journalCompressionInput(this: {
  openDumpSnapshot(): Promise<JournalDumpSnapshot>;
}): Promise<CompressionInputSnapshot> {
  const dump = await this.openDumpSnapshot();
  return { previous: dump, rows: dump, close: () => dump.close() };
}
