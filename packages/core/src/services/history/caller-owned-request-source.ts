/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { EMPTY_ID_FACT, type IdFact } from '../../journal/idFactCodec.js';
import { updateFact } from '../../journal/idFactUpdate.js';
import { encodeRowDraft, entryForNewRow } from '../../journal/rowDraft.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowIds, StoredRow } from '../../journal/rowReads.js';
import type { IContent } from './IContent.js';
import type { JournalResponseSource } from './journal-response-source.js';
import { encodeContentRow } from './journalRowCodec.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';

export class CallerOwnedRequestSource implements JournalResponseSource {
  private readonly ids = new Map<string, IdFact>();
  readonly facts = {
    fact: async (id: string): Promise<IdFact | undefined> => this.ids.get(id),
  };

  private constructor(
    private readonly rows: readonly IContent[],
    private readonly tail: readonly IContent[],
  ) {}

  static async create(
    rows: readonly IContent[],
    tail: readonly IContent[],
  ): Promise<CallerOwnedRequestSource> {
    const source = new CallerOwnedRequestSource(rows, tail);
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

  private draft(label: bigint): ReturnType<typeof encodeContentRow> {
    return encodeContentRow(this.row(label), { owner: 0 });
  }

  private stored(label: bigint): StoredRow {
    const draft = this.draft(label);
    return {
      header: encodeRowDraft(label, draft).header,
      rawIds: draft.ids.map((id) => id.rawId),
      meta: draft.meta,
      blocks: draft.blocks.map((block) => block.bytes),
    };
  }

  async *entries(): AsyncGenerator<RowEntry> {
    for (let index = 0; index < this.rows.length + this.tail.length; index++) {
      const label = BigInt(index + 1);
      yield entryForNewRow(encodeRowDraft(label, this.draft(label)), 0);
    }
  }

  async entryByLabel(label: bigint): Promise<RowEntry | undefined> {
    if (label < 1n || label > BigInt(this.rows.length + this.tail.length))
      return undefined;
    return entryForNewRow(encodeRowDraft(label, this.draft(label)), 0);
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
    return this.draft(entry.label).blocks[index].bytes;
  }

  readonly isTail = (label: bigint): boolean =>
    label > BigInt(this.rows.length);
}
