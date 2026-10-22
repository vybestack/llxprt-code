/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowIds, StoredRow } from '../../journal/rowReads.js';
import type { BlockPosition, IdFact } from '../../journal/idFactCodec.js';
import { encodeRowDraft } from '../../journal/rowDraft.js';
import {
  ROW_BLOCK_TYPE,
  ROW_FLAG,
  ROW_SPEAKER,
} from '../../journal/rowRecord.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { IContent } from './IContent.js';
import type { JournalResponseSource } from './journal-response-source.js';

export interface JournalRequestProjection {
  readonly label?: bigint;
  readonly removedBlock?: number;
  readonly removedRow?: boolean;
  readonly readChangedRow?: () => Promise<IContent>;
  readonly header: (row: IContent, label: bigint) => IContent;
}

export interface JournalRequestBase extends JournalResponseSource {
  nextCuratedAfter(label: bigint): Promise<RowEntry | undefined>;
}

export class JournalProjectedSource implements JournalRequestBase {
  readonly facts = {
    fact: async (id: string): Promise<IdFact | undefined> => {
      const fact = await this.snapshot.facts.fact(id);
      if (fact === undefined) return undefined;
      const map = (
        at: BlockPosition | undefined,
      ): BlockPosition | undefined => {
        if (
          at === undefined ||
          at.label !== this.projection.label ||
          this.removedPartBlock === undefined
        )
          return at;
        const removed = this.removedPartBlock;
        return at.part === removed.part && at.block > removed.block
          ? { ...at, block: at.block - 1 }
          : at;
      };
      return {
        ...fact,
        firstCall: map(fact.firstCall),
        firstAiCall: map(fact.firstAiCall),
        firstToolResponse: map(fact.firstToolResponse),
        firstResponse: map(fact.firstResponse),
        best: map(fact.best),
        lastEligibleCall:
          fact.lastEligibleCall === undefined
            ? undefined
            : {
                ...fact.lastEligibleCall,
                at: map(fact.lastEligibleCall.at) ?? fact.lastEligibleCall.at,
              },
      };
    },
  };
  private removedPartBlock:
    | { readonly part: number; readonly block: number }
    | undefined;

  private constructor(
    private readonly snapshot: VersionSnapshot,
    readonly projection: JournalRequestProjection,
  ) {}

  static async create(
    snapshot: VersionSnapshot,
    projection: JournalRequestProjection,
  ): Promise<JournalProjectedSource> {
    const source = new JournalProjectedSource(snapshot, projection);
    if (
      projection.label !== undefined &&
      projection.removedBlock !== undefined
    ) {
      const entry = await snapshot.entryByLabel(projection.label);
      if (entry === undefined)
        throw new Error('Projected request row is absent');
      const { header } = await snapshot.readIds(entry);
      const split =
        header.speaker === ROW_SPEAKER.tool &&
        header.blocks.some((block) => block.type === ROW_BLOCK_TYPE.tool_call);
      const indices = header.blocks.flatMap((block, index) =>
        !split || block.type !== ROW_BLOCK_TYPE.tool_call ? [index] : [],
      );
      source.removedPartBlock = {
        part: split ? 1 : 0,
        block: indices.indexOf(projection.removedBlock),
      };
    }
    return source;
  }

  private async changed(): Promise<StoredRow> {
    const read = this.projection.readChangedRow;
    const label = this.projection.label;
    if (read === undefined || label === undefined)
      throw new Error('Projected request has no changed row');
    const draft = encodeContentRow(await read(), { owner: 0 });
    const encoded = encodeRowDraft(label, draft);
    return {
      header: encoded.header,
      rawIds: draft.ids.map((id) => id.rawId),
      meta: draft.meta,
      blocks: draft.blocks.map((block) => block.bytes),
    };
  }

  private selected(entry: RowEntry): boolean {
    return entry.label === this.projection.label;
  }

  async *entries(): AsyncGenerator<RowEntry> {
    for await (const entry of this.snapshot.entries()) {
      if (this.selected(entry) && this.projection.removedRow === true) continue;
      yield entry;
    }
  }

  async entryByLabel(label: bigint): Promise<RowEntry | undefined> {
    const entry = await this.snapshot.entryByLabel(label);
    return entry !== undefined &&
      label === this.projection.label &&
      this.projection.removedRow === true
      ? { ...entry, flags: entry.flags & ~ROW_FLAG.curated }
      : entry;
  }

  readonly header = (row: IContent, entry: RowEntry): IContent =>
    this.projection.header(row, entry.label);

  async nextCuratedAfter(label: bigint): Promise<RowEntry | undefined> {
    const next = await this.snapshot.nextCuratedAfter(label);
    return next !== undefined &&
      next.label === this.projection.label &&
      this.projection.removedRow === true
      ? this.snapshot.nextCuratedAfter(next.label)
      : next;
  }

  async readIds(entry: RowEntry): Promise<RowIds> {
    if (!this.selected(entry)) return this.snapshot.readIds(entry);
    if (this.projection.removedRow === true) {
      const ids = await this.snapshot.readIds(entry);
      return {
        ...ids,
        header: { ...ids.header, flags: ids.header.flags & ~ROW_FLAG.curated },
      };
    }
    const row = await this.changed();
    return { header: row.header, rawIds: row.rawIds };
  }

  readRow(entry: RowEntry): Promise<StoredRow> {
    return this.selected(entry) ? this.changed() : this.snapshot.readRow(entry);
  }

  async readBlock(entry: RowEntry, index: number): Promise<Uint8Array> {
    return this.selected(entry)
      ? (await this.changed()).blocks[index]
      : this.snapshot.readBlock(entry, index);
  }

  async readMetadata(entry: RowEntry): Promise<StoredRow> {
    const stored =
      this.selected(entry) && this.projection.removedRow !== true
        ? await this.changed()
        : await this.snapshot.readMetadata(entry);
    return { ...stored, blocks: [] };
  }
}
