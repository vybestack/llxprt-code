/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { DirectoryBlock } from '../../journal/row-directory.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowIds, StoredRow } from '../../journal/rowReads.js';
import { encodeRowDraft } from '../../journal/rowDraft.js';
import { ROW_FLAG } from '../../journal/rowRecord.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { IContent } from './IContent.js';
import type { JournalResponseSource } from './journal-response-source.js';

export interface JournalRequestProjection {
  readonly headerLabels?: readonly [] | readonly [bigint];
  readonly label?: bigint;
  readonly readChangedRow?: (snapshot: VersionSnapshot) => Promise<IContent>;
  readonly header: (row: IContent, label: bigint) => IContent;
}

export interface JournalRequestBase extends JournalResponseSource {
  nextCuratedAfter(label: bigint): Promise<RowEntry | undefined>;
}

export class JournalProjectedSource implements JournalRequestBase {
  private changedFlags: number | undefined;

  private constructor(
    private readonly snapshot: VersionSnapshot,
    readonly projection: JournalRequestProjection,
  ) {}

  get facts(): JournalRequestBase['facts'] {
    return this.snapshot.facts;
  }

  static async create(
    snapshot: VersionSnapshot,
    projection: JournalRequestProjection,
  ): Promise<JournalProjectedSource> {
    const source = new JournalProjectedSource(snapshot, projection);
    if (projection.label !== undefined)
      source.changedFlags = (await source.changed()).header.flags;
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
    const ids = this.selected(entry)
      ? await this.changed()
      : await this.snapshot.readIds(entry);
    return {
      header: ids.header,
      rawIds: ids.rawIds,
      ...('head' in ids ? { head: ids.head } : {}),
    };
  }

  async readRow(entry: RowEntry): Promise<StoredRow> {
    return this.selected(entry) ? this.changed() : this.snapshot.readRow(entry);
  }

  async *blocks(entry: RowEntry): AsyncGenerator<DirectoryBlock> {
    if (!this.selected(entry)) {
      yield* this.snapshot.blocks(entry);
      return;
    }
    const stored = await this.changed();
    for (const [ordinal, bytes] of stored.blocks.entries()) {
      yield {
        ordinal,
        type: stored.header.blocks[ordinal].type,
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
    return this.selected(entry)
      ? (await this.changed()).blocks[index]
      : this.snapshot.readBlock(entry, index, ids);
  }

  async readMetadata(entry: RowEntry, ids?: RowIds): Promise<StoredRow> {
    const stored = this.selected(entry)
      ? await this.changed()
      : await this.snapshot.readMetadata(entry, ids);
    return { ...stored, blocks: [] };
  }
}
