/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import {
  openJournalReadOnly,
  type JournalReader,
  type JournalReaderDependencies,
} from './journalReader.js';
import { entryAt, iterateRowEntries, rowTreeRootOf } from './rowTreeReader.js';
import { entryByLabel } from './rowTreeQueries.js';
import { readRowIds, readStoredRow } from './rowReads.js';
import { ROW_ID_KIND, ROW_SPEAKER } from './rowRecord.js';
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ, type RowEntry } from './rowEntry.js';
import { readVersionAt } from './trailerAccess.js';
import { versionOf } from './version.js';
import { MUTATION } from './recordKinds.js';
import { NativeResponseIndex } from './native-response-index.js';

export type NativeJournalEntry = RowEntry;
export type NativeJournalReadDependencies = JournalReaderDependencies;

export class NativeJournalPageReader {
  private readonly responses: NativeResponseIndex;

  private constructor(private readonly reader: JournalReader) {
    this.responses = new NativeResponseIndex(reader);
  }

  static async open(
    path: string,
    dependencies?: NativeJournalReadDependencies,
  ): Promise<NativeJournalPageReader> {
    return new NativeJournalPageReader(
      await openJournalReadOnly(path, dependencies),
    );
  }

  get path(): string {
    return this.reader.path;
  }
  get rows(): number {
    return this.reader.trailer?.rootAggregate.rows ?? 0;
  }
  get curated(): boolean {
    return this.reader.trailer?.rootAggregate.curated === this.rows;
  }
  get groupTag(): bigint | undefined {
    return this.reader.trailer?.groupTag;
  }
  get size(): number {
    return this.reader.trailer?.durableEnd ?? this.reader.fileSize;
  }

  private root(): NonNullable<ReturnType<typeof rowTreeRootOf>> {
    const root = rowTreeRootOf(this.reader.trailer);
    if (root === undefined) throw new Error('Empty journal has no row tree');
    return root;
  }

  entryAt(ordinal: number): Promise<NativeJournalEntry> {
    return entryAt(this.reader, this.root(), ordinal);
  }

  entryByLabel(label: bigint): Promise<NativeJournalEntry | undefined> {
    return entryByLabel(this.reader, this.root(), label);
  }

  async *entries(from = 0): AsyncGenerator<NativeJournalEntry> {
    const root = rowTreeRootOf(this.reader.trailer);
    if (root !== undefined) yield* iterateRowEntries(this.reader, root, from);
  }

  async readContent(entry: NativeJournalEntry): Promise<IContent> {
    return decodeStoredRow(await readStoredRow(this.reader, entry));
  }

  async responseIds(entry: NativeJournalEntry): Promise<readonly string[]> {
    const ids = await readRowIds(this.reader, entry);
    return ids.rawIds.filter(
      (_, index) => ids.header.ids[index].kind === ROW_ID_KIND.response,
    );
  }

  isTool(entry: NativeJournalEntry): boolean {
    return entry.speaker === ROW_SPEAKER.tool;
  }
  isHuman(entry: NativeJournalEntry): boolean {
    return entry.speaker === ROW_SPEAKER.human;
  }
  chronologySeq(entry: NativeJournalEntry): number | undefined {
    return entry.chronologySeq === ROW_ENTRY_NO_CHRONOLOGY_SEQ
      ? undefined
      : Number(entry.chronologySeq);
  }

  lastResponseLabel(
    id: string,
    from: bigint,
    end: bigint,
  ): Promise<bigint | undefined> {
    return this.responses.last(id, from, end);
  }

  async clearBoundaryOffset(): Promise<number | null> {
    const trailer = this.reader.trailer;
    if (trailer === undefined) return null;
    let first = versionOf(trailer);
    while (first.parent !== 0) {
      const offset =
        [...first.skip].reverse().find((value) => value !== 0) ?? first.parent;
      first = await readVersionAt(this.reader, offset);
    }
    return first.mutation === MUTATION.replace ||
      (first.mutation === MUTATION.pop && first.rows === 0)
      ? first.selfOffset
      : null;
  }

  close(): Promise<void> {
    return this.reader.close();
  }
}
