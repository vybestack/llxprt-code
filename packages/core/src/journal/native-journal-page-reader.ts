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
import { readRowIds, readStoredRow, type RowIds } from './rowReads.js';
import {
  decodeRowHeader,
  validateRowAgainstBody,
  ROW_BLOCK_TYPE,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from './rowRecord.js';
import { JournalFormatError } from './errors.js';
import { readStoredMetadata } from './rowRangeReads.js';
import { checkedRowPiece, ROW_PIECE_CRC_BYTES } from './rowPiece.js';
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ, type RowEntry } from './rowEntry.js';
import { readVersionAt } from './trailerAccess.js';
import { versionOf } from './version.js';
import { MUTATION, RECORD_KIND } from './recordKinds.js';
import { NativeResponseIndex } from './native-response-index.js';
import type { FrameHead } from './frame.js';

type ToolPageHeader = RowIds & { readonly head: FrameHead };

export type NativeJournalEntry = RowEntry;
export type NativeJournalReadDependencies = JournalReaderDependencies;

export class NativeJournalPageReader {
  private readonly responses: NativeResponseIndex;
  private pageHeader:
    | { readonly offset: number; readonly ids: ToolPageHeader }
    | undefined;

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

  private async toolPageHeader(
    entry: NativeJournalEntry,
  ): Promise<ToolPageHeader> {
    if (
      this.pageHeader?.offset === entry.recordOffset &&
      this.pageHeader.ids.header.label === entry.label
    )
      return this.pageHeader.ids;
    const head = await this.reader.readRecordHead(entry.recordOffset, 'ROW');
    if (head.kind !== RECORD_KIND.ROW)
      throw new JournalFormatError('Tool page source is not a row');
    const header = decodeRowHeader(head.kindHeader);
    if (header.label !== entry.label)
      throw new JournalFormatError('Tool page source has the wrong label');
    validateRowAgainstBody(header, head.bodyLen);
    const ids = { head, header, rawIds: [] };
    this.pageHeader = { offset: entry.recordOffset, ids };
    return ids;
  }

  async readToolPage(
    entry: NativeJournalEntry,
    start: number,
    count: number,
  ): Promise<IContent> {
    const ids = await this.toolPageHeader(entry);
    const head = ids.head;
    const metadata = await readStoredMetadata(this.reader, entry, ids);
    let call = 0;
    const selected = ids.header.blocks.flatMap((block, index) => {
      if (block.type !== ROW_BLOCK_TYPE.tool_call)
        return start === 0 ? [index] : [];
      const ordinal = call++;
      return ordinal >= start && ordinal < start + count ? [index] : [];
    });
    const blocks: Uint8Array[] = [];
    if (selected.length > 0) {
      const first = ids.header.blocks[selected[0]];
      const last = ids.header.blocks[selected[selected.length - 1]];
      const bytes = await this.reader.readRecordRange(
        head,
        first.offset,
        last.offset + last.length + ROW_PIECE_CRC_BYTES - first.offset,
      );
      for (const index of selected) {
        const block = ids.header.blocks[index];
        blocks.push(
          checkedRowPiece(
            this.reader,
            head,
            bytes.subarray(block.offset - first.offset),
            block.offset,
            block.length,
          ),
        );
      }
    }
    return decodeStoredRow({
      ...metadata,
      header: {
        ...metadata.header,
        blocks: selected.map((index) => ids.header.blocks[index]),
      },
      blocks,
    });
  }

  async callIds(entry: NativeJournalEntry): Promise<readonly string[]> {
    const ids = await readRowIds(this.reader, entry);
    return ids.rawIds.filter(
      (_, index) => ids.header.ids[index].kind === ROW_ID_KIND.call,
    );
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
    this.pageHeader = undefined;
    return this.reader.close();
  }
}
