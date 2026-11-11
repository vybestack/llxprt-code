/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { DirectoryBlock } from '../../journal/row-directory.js';
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
import type { TextBlock, IContent } from './IContent.js';
import type { JournalResponseSource } from './journal-response-source.js';

export interface JournalRequestProjection {
  readonly headerLabels?: readonly [] | readonly [bigint];
  readonly blockReplacements?: ReadonlyMap<
    bigint,
    ReadonlyMap<number, TextBlock>
  >;
  readonly label?: bigint;
  readonly removedBlock?: number;
  readonly removedRow?: boolean;
  readonly readChangedRow?: (snapshot: VersionSnapshot) => Promise<IContent>;
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
  private changedFlags: number | undefined;
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
    if (projection.label !== undefined)
      source.changedFlags =
        projection.removedRow === true
          ? 0
          : (await source.changed()).header.flags;
    return source;
  }

  private async changed(): Promise<StoredRow> {
    const read = this.projection.readChangedRow;
    const label = this.projection.label;
    if (read === undefined || label === undefined)
      throw new Error('Projected request has no changed row');
    const draft = encodeContentRow(await read(this.snapshot), { owner: 0 });
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
      yield this.selected(entry)
        ? ((await this.entryByLabel(entry.label)) ?? entry)
        : entry;
    }
  }

  async entryByLabel(label: bigint): Promise<RowEntry | undefined> {
    const entry = await this.snapshot.entryByLabel(label);
    return entry !== undefined &&
      label === this.projection.label &&
      this.changedFlags !== undefined
      ? {
          ...entry,
          flags:
            (entry.flags & ~ROW_FLAG.curated) |
            (this.changedFlags & ROW_FLAG.curated),
        }
      : entry;
  }

  readonly header = (row: IContent, entry: RowEntry): IContent =>
    this.projection.header(row, entry.label);

  async nextCuratedAfter(label: bigint): Promise<RowEntry | undefined> {
    const next = await this.snapshot.nextCuratedAfter(label);
    if (next === undefined) return undefined;
    return next.label === this.projection.label &&
      ((this.changedFlags ?? ROW_FLAG.curated) & ROW_FLAG.curated) === 0
      ? this.snapshot.nextCuratedAfter(next.label)
      : next;
  }

  async readIds(entry: RowEntry): Promise<RowIds> {
    const ids =
      this.selected(entry) && this.projection.removedRow !== true
        ? await this.changed()
        : await this.snapshot.readIds(entry);
    const replacements = this.projection.blockReplacements?.get(entry.label);
    return {
      header: {
        ...ids.header,
        flags:
          this.selected(entry) && this.projection.removedRow === true
            ? ids.header.flags & ~ROW_FLAG.curated
            : ids.header.flags,
        blocks: ids.header.blocks.map((block, index) =>
          replacements?.has(index) === true
            ? { ...block, type: ROW_BLOCK_TYPE.text }
            : block,
        ),
      },
      rawIds: ids.rawIds,
      ...('head' in ids ? { head: ids.head } : {}),
    };
  }

  async readRow(entry: RowEntry): Promise<StoredRow> {
    const row = this.selected(entry)
      ? await this.changed()
      : await this.snapshot.readRow(entry);
    const replacements = this.projection.blockReplacements?.get(entry.label);
    if (replacements === undefined) return row;
    return {
      ...row,
      header: (await this.readIds(entry)).header,
      blocks: row.blocks.map((bytes, index) => {
        const replacement = replacements.get(index);
        return replacement === undefined
          ? bytes
          : Buffer.from(JSON.stringify(replacement));
      }),
    };
  }

  async *blocks(entry: RowEntry): AsyncGenerator<DirectoryBlock> {
    if (!this.selected(entry)) {
      for await (const block of this.snapshot.blocks(entry)) {
        const replacement = this.projection.blockReplacements
          ?.get(entry.label)
          ?.get(block.ordinal);
        if (replacement === undefined) yield block;
        else {
          const bytes = Buffer.from(JSON.stringify(replacement));
          yield {
            ordinal: block.ordinal,
            type: ROW_BLOCK_TYPE.text,
            length: bytes.byteLength,
            normalizedJson: true,
            async *parts() {
              yield bytes;
            },
          };
        }
      }
      return;
    }
    const stored = await this.changed();
    for (const [ordinal, original] of stored.blocks.entries()) {
      const replacement = this.projection.blockReplacements
        ?.get(entry.label)
        ?.get(ordinal);
      const bytes =
        replacement === undefined
          ? original
          : Buffer.from(JSON.stringify(replacement));
      yield {
        ordinal,
        type:
          replacement === undefined
            ? stored.header.blocks[ordinal].type
            : ROW_BLOCK_TYPE.text,
        length: bytes.byteLength,
        normalizedJson: true,
        async *parts() {
          for (let offset = 0; offset < bytes.length; offset += 65536)
            yield bytes.subarray(offset, offset + 65536);
        },
      };
    }
  }

  async readBlock(
    entry: RowEntry,
    index: number,
    ids?: RowIds,
  ): Promise<Uint8Array> {
    const replacement = this.projection.blockReplacements
      ?.get(entry.label)
      ?.get(index);
    if (replacement !== undefined)
      return Buffer.from(JSON.stringify(replacement));
    return this.selected(entry)
      ? (await this.changed()).blocks[index]
      : this.snapshot.readBlock(entry, index, ids);
  }

  async readMetadata(entry: RowEntry, ids?: RowIds): Promise<StoredRow> {
    const stored =
      this.selected(entry) && this.projection.removedRow !== true
        ? await this.changed()
        : await this.snapshot.readMetadata(entry, ids);
    return { ...stored, blocks: [] };
  }
}
