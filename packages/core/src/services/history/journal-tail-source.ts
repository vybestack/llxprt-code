/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import {
  admittedMediaSource,
  type AdmittedMediaSource,
} from '../../storage/admitted-media-source.js';
import { isMediaReferenceBlock } from './IContent.js';
import {
  EMPTY_ID_FACT,
  type BlockPosition,
  type IdFact,
} from '../../journal/idFactCodec.js';
import { updateFact } from '../../journal/idFactUpdate.js';
import { encodeRowDraft, entryForNewRow } from '../../journal/rowDraft.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowIds, StoredRow } from '../../journal/rowReads.js';
import {
  ROW_BLOCK_TYPE,
  ROW_FLAG,
  ROW_SPEAKER,
} from '../../journal/rowRecord.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { ContentBlock, IContent } from './IContent.js';
import { encodeContentRow } from './journalRowCodec.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';
import type { JournalResponseSource } from './journal-response-source.js';
import { callTarget } from './journal-reconstruction.js';
import {
  JournalProjectedSource,
  type JournalRequestBase,
  type JournalRequestProjection,
} from './journal-request-projection.js';

interface TailRow {
  readonly entry: RowEntry;
  readonly stored: StoredRow;
  readonly origins: readonly number[];
  readonly admissions: ReadonlyArray<AdmittedMediaSource | undefined>;
}

function tailRow(
  label: bigint,
  row: IContent,
  origins: WeakMap<ContentBlock, number>,
  nextOrigin: () => number,
): TailRow {
  const draft = encodeContentRow(row, { owner: 0 });
  const encoded = encodeRowDraft(label, {
    ...draft,
    flags: draft.flags | ROW_FLAG.curated,
  });
  return {
    entry: entryForNewRow(encoded, 0),
    stored: {
      header: encoded.header,
      rawIds: draft.ids.map((id) => id.rawId),
      meta: draft.meta,
      blocks: draft.blocks.map((block) => block.bytes),
    },
    admissions: row.blocks.map((block) =>
      isMediaReferenceBlock(block) ? admittedMediaSource(block) : undefined,
    ),
    origins: row.blocks.map((block) => {
      let id = origins.get(block);
      if (id === undefined) {
        id = nextOrigin();
        origins.set(block, id);
      }
      return id;
    }),
  };
}

export class JournalTailSource implements JournalResponseSource {
  private readonly overlay = new Map<string, IdFact>();
  private readonly tailRows: readonly TailRow[];
  readonly facts = {
    fact: async (rawId: string): Promise<IdFact | undefined> => {
      this.snapshot.requireOpen();
      return this.overlay.get(rawId) ?? this.base.facts.fact(rawId);
    },
  };

  private constructor(
    private readonly snapshot: VersionSnapshot,
    tail: readonly IContent[],
    private readonly firstLabel: bigint,
    private readonly base: JournalRequestBase,
    private readonly projection?: JournalRequestProjection,
  ) {
    const origins = new WeakMap<ContentBlock, number>();
    let next = 0;
    this.tailRows = tail.map((row, index) =>
      tailRow(firstLabel + BigInt(index), row, origins, () => next++),
    );
  }

  static async create(
    snapshot: VersionSnapshot,
    tail: readonly IContent[],
    projection?: JournalRequestProjection,
  ): Promise<JournalTailSource> {
    snapshot.requireOpen();
    const source = new JournalTailSource(
      snapshot,
      tail,
      snapshot.version?.nextLabel ?? 1n,
      projection === undefined
        ? snapshot
        : await JournalProjectedSource.create(snapshot, projection),
      projection,
    );
    for (const row of source.tailRows) {
      const { header, rawIds } = row.stored;
      const occurrences = await planSourceRowOccurrences(
        {
          label: header.label,
          speaker: header.speaker,
          flags: header.flags,
          blockTypes: header.blocks.map((block) => block.type),
          ids: header.ids.map((id, index) => ({ ...id, rawId: rawIds[index] })),
        },
        snapshot.facts,
      );
      for (const occurrence of occurrences) {
        const old =
          (await source.facts.fact(occurrence.rawId)) ?? EMPTY_ID_FACT;
        source.overlay.set(occurrence.rawId, updateFact(old, occurrence));
      }
    }
    return source;
  }

  readonly isTail = (label: bigint): boolean => label >= this.firstLabel;
  readonly header = (row: IContent, entry: RowEntry): IContent =>
    this.isTail(entry.label) ? row : (this.base.header?.(row, entry) ?? row);

  hasPendingId(rawId: string): boolean {
    this.snapshot.requireOpen();
    return this.overlay.has(rawId);
  }

  affectedJournalLabels(): readonly bigint[] {
    const labels = new Set<bigint>();
    if (this.projection?.label !== undefined) labels.add(this.projection.label);
    for (const [id, fact] of this.overlay) {
      if (id === '') continue;
      const target = callTarget(fact);
      if (target !== undefined && !this.isTail(target.at.label))
        labels.add(target.at.label);
    }
    return [...labels].sort((left, right) =>
      left < right ? -1 : Number(left > right),
    );
  }

  *tailEntries(): Generator<RowEntry> {
    for (const row of this.tailRows) yield row.entry;
  }

  async nextCuratedAfter(label: bigint): Promise<RowEntry | undefined> {
    if (this.isTail(label))
      return this.tailRows[Number(label - this.firstLabel) + 1]?.entry;
    return (await this.base.nextCuratedAfter(label)) ?? this.tailRows[0]?.entry;
  }

  private tailAt(label: bigint): TailRow {
    this.snapshot.requireOpen();
    const index = Number(label - this.firstLabel);
    if (index < 0 || index >= this.tailRows.length)
      throw new JournalFormatError('Tail source row is absent');
    return this.tailRows[index];
  }

  async *entries(): AsyncGenerator<RowEntry> {
    yield* this.base.entries();
    for (const row of this.tailRows) yield row.entry;
  }

  entryByLabel(label: bigint): Promise<RowEntry | undefined> {
    return this.isTail(label)
      ? Promise.resolve(this.tailAt(label).entry)
      : this.base.entryByLabel(label);
  }

  readIds(entry: RowEntry): Promise<RowIds> {
    if (!this.isTail(entry.label)) return this.base.readIds(entry);
    const { header, rawIds } = this.tailAt(entry.label).stored;
    return Promise.resolve({ header, rawIds });
  }

  readRow(entry: RowEntry): Promise<StoredRow> {
    return this.isTail(entry.label)
      ? Promise.resolve(this.tailAt(entry.label).stored)
      : this.base.readRow(entry);
  }

  async readBlock(entry: RowEntry, index: number): Promise<Uint8Array> {
    if (!this.isTail(entry.label)) return this.base.readBlock(entry, index);
    const blocks = this.tailAt(entry.label).stored.blocks;
    if (!Number.isInteger(index) || index < 0 || index >= blocks.length)
      throw new JournalFormatError('Tail source block is absent');
    return blocks[index];
  }

  async readMetadata(entry: RowEntry): Promise<StoredRow> {
    if (!this.isTail(entry.label)) return this.base.readMetadata(entry);
    return { ...this.tailAt(entry.label).stored, blocks: [] };
  }

  captureAdmission(at: BlockPosition, block: ContentBlock): void {
    if (this.isTail(at.label) && isMediaReferenceBlock(block))
      this.tailAt(at.label).admissions[this.blockIndex(at)]?.capture(block);
  }

  private origin(at: BlockPosition): number {
    return this.tailAt(at.label).origins[this.blockIndex(at)];
  }

  private blockIndex(at: BlockPosition): number {
    const row = this.tailAt(at.label);
    const split =
      row.stored.header.speaker === ROW_SPEAKER.tool &&
      row.stored.header.blocks.some(
        (block) => block.type === ROW_BLOCK_TYPE.tool_call,
      );
    const indices = row.stored.header.blocks.flatMap((block, index) =>
      !split || (at.part === 0) === (block.type === ROW_BLOCK_TYPE.tool_call)
        ? [index]
        : [],
    );
    if (
      !Number.isInteger(at.block) ||
      at.block < 0 ||
      at.block >= indices.length
    )
      throw new JournalFormatError('Tail source block is absent');
    return indices[at.block];
  }

  readonly sameBlock = (left: BlockPosition, right: BlockPosition): boolean =>
    this.isTail(left.label) &&
    this.isTail(right.label) &&
    this.origin(left) === this.origin(right);
}
