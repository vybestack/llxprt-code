/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { EMPTY_ID_FACT, type IdFact } from '../../journal/idFactCodec.js';
import { updateFact } from '../../journal/idFactUpdate.js';
import { encodeRowDraft, entryForNewRow } from '../../journal/rowDraft.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowIds, StoredRow } from '../../journal/rowReads.js';
import type { IContent } from './IContent.js';
import type { JournalResponseSource } from './journal-response-source.js';
import { encodeContentRow, encodeContentBlock } from './journalRowCodec.js';
import { ROW_FLAG } from '../../journal/rowRecord.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';

export class CallerOwnedRequestSource implements JournalResponseSource {
  private readonly ids = new Map<string, IdFact>();
  private current:
    | {
        readonly label: bigint;
        readonly draft: ReturnType<typeof encodeContentRow>;
        stored?: StoredRow;
        entry?: RowEntry;
      }
    | undefined;
  readonly facts = {
    fact: async (id: string): Promise<IdFact | undefined> => this.ids.get(id),
  };

  private constructor(
    private readonly rows: readonly IContent[],
    private readonly tail: readonly IContent[],
    private readonly preserveEmptyAi: boolean,
  ) {}

  static async create(
    rows: readonly IContent[],
    tail: readonly IContent[],
    preserveEmptyAi = false,
  ): Promise<CallerOwnedRequestSource> {
    const source = new CallerOwnedRequestSource(rows, tail, preserveEmptyAi);
    for await (const entry of source.entries()) {
      const draft = source.draft(entry.label);
      for (const occurrence of await planSourceRowOccurrences({
        label: entry.label,
        speaker: draft.speaker,
        flags: draft.flags,
        ids: draft.ids,
        blockTypes: draft.blocks.map((block) => block.type),
      })) {
        source.ids.set(
          occurrence.rawId,
          updateFact(
            source.ids.get(occurrence.rawId) ?? EMPTY_ID_FACT,
            occurrence,
          ),
        );
      }
    }
    return source;
  }

  private row(label: bigint): IContent {
    const index = Number(label - 1n);
    return index < this.rows.length
      ? this.rows[index]
      : this.tail[index - this.rows.length];
  }

  private included(row: IContent): boolean {
    return (
      row.blocks.length > 0 || (this.preserveEmptyAi && row.speaker === 'ai')
    );
  }

  private captured(
    label: bigint,
  ): NonNullable<CallerOwnedRequestSource['current']> {
    if (this.current?.label !== label) {
      const row = this.row(label);
      const draft = encodeContentRow(row, { owner: 0 });
      this.current = {
        label,
        draft: {
          ...draft,
          flags: this.included(row)
            ? draft.flags | ROW_FLAG.curated
            : draft.flags,
        },
      };
    }
    return this.current;
  }

  private draft(label: bigint): ReturnType<typeof encodeContentRow> {
    return this.captured(label).draft;
  }

  close(): void {
    this.current = undefined;
  }

  private stored(label: bigint): StoredRow {
    const current = this.captured(label);
    const { draft } = current;
    return (current.stored ??= {
      header: encodeRowDraft(label, draft).header,
      rawIds: draft.ids.map((id) => id.rawId),
      meta: draft.meta,
      blocks: draft.blocks.map((block) => block.bytes),
    });
  }

  private entry(label: bigint): RowEntry {
    const current = this.captured(label);
    return (current.entry ??= entryForNewRow(
      encodeRowDraft(label, current.draft),
      0,
    ));
  }

  async *entries(): AsyncGenerator<RowEntry> {
    for (let index = 0; index < this.rows.length + this.tail.length; index++) {
      const label = BigInt(index + 1);
      yield this.entry(label);
    }
  }

  async entryByLabel(label: bigint): Promise<RowEntry | undefined> {
    if (label < 1n || label > BigInt(this.rows.length + this.tail.length))
      return undefined;
    return this.entry(label);
  }

  async readIds(entry: RowEntry): Promise<RowIds> {
    const { header, rawIds } = this.stored(entry.label);
    return { header, rawIds };
  }

  async readRow(entry: RowEntry): Promise<StoredRow> {
    return this.stored(entry.label);
  }

  async readMetadata(entry: RowEntry): Promise<StoredRow> {
    return { ...this.stored(entry.label), blocks: [] };
  }

  async readBlock(entry: RowEntry, index: number): Promise<Uint8Array> {
    return encodeContentBlock(this.row(entry.label).blocks[index]).bytes;
  }

  async nextCuratedAfter(label: bigint): Promise<RowEntry | undefined> {
    for (
      let index = Number(label);
      index < this.rows.length + this.tail.length;
      index++
    ) {
      const next = BigInt(index + 1);
      if (this.included(this.row(next))) return this.entryByLabel(next);
    }
    return undefined;
  }

  readonly header = (row: IContent): IContent => row;

  readonly isTail = (label: bigint): boolean =>
    label > BigInt(this.rows.length);
}
