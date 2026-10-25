/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { LabelSorter } from './ordered-labels.js';
import { ToolRankingTree, TOOL_RANKING_READY } from './tool-ranking-tree.js';
import {
  DensityFileFacts,
  DENSITY_FILES_READY,
  DENSITY_FILES_SCOPE,
} from './density-file-facts.js';
import { RecencyFacts, RECENCY_INDEX_READY } from './recencyFacts.js';
import {
  ACTIVE_FACT_INDEX,
  NATIVE_FACTS_THROUGH,
  NativeFactIndexReader,
} from './nativeFactIndex.js';
import { rowFormatAuxKey } from './rowFormat.js';
import { rowSummaryRange } from './row-summary-range.js';
import { decodeSlotSummary, type SlotSummary } from './slotSummary.js';
import { identitySlotSummary } from './summaryComposition.js';
import { JournalFormatError } from './errors.js';
import { decodeDecimal } from './metaFacts.js';
import {
  KimiOrdinalQueries,
  KIMI_ELIGIBLE_KEY,
  kimiEnabled,
} from './kimiOrdinals.js';
import { KIMI_FLAG, type KimiOccurrence } from './kimiFactCodec.js';
import { kimiSafeCount } from './kimiDigits.js';
import { KimiFactQueries, type KimiIdFact } from './kimiFactQueries.js';
import {
  assertMistralSlot,
  decodeMistralSlots,
  MISTRAL_SLOTS_KEY,
  MISTRAL_GENERATION_KEY,
  readMistralMapping,
  type MistralMapping,
} from './mistralMapping.js';
import {
  nextCuratedEntry,
  curatedEntryAt,
  curatedEntryWithOrdinalAt,
} from './curatedQueries.js';
import { IdFactQueries, type IdFactDeps } from './idFactQueries.js';
import type { IdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import { PinnedRead, PinLease } from './pinLease.js';
import type { RowEntry } from './rowEntry.js';
import { ROW_FLAG } from './rowRecord.js';
import type { RowReadWindowStats } from './row-read-window.js';
import {
  readRowIds,
  readStoredRow,
  type RowIds,
  type StoredRow,
} from './rowReads.js';
import {
  entryByLabel,
  hasAssistantToolCalls,
  humanRowOrdinal,
  countRowsBelow,
  countUnitsBelow,
  entryAtUnit,
  type IndexedUnit,
} from './rowTreeQueries.js';
import { readStoredBlock, readStoredMetadata } from './rowRangeReads.js';
import {
  entryAt,
  iterateRowEntries,
  type RowTreeRootRef,
} from './rowTreeReader.js';
import type { Version } from './version.js';
import type { SourceRow, VersionEdit } from './groupEdits.js';

/**
 * One published version with the reads that reach it. The version and the
 * access are taken together, so every read of a snapshot sees the same rows
 * however many groups commit after it was taken. It holds a trailer and a
 * reader, never a row. The snapshot holds the pin of its read until `close`,
 * so no compaction moves the records under it; a read after `close` throws.
 */
export class VersionSnapshot {
  readonly facts: IdFactQueries;
  private readonly kimi: KimiOrdinalQueries;
  private readonly kimiFacts: KimiFactQueries;

  constructor(
    private readonly read: PinnedRead,
    private readonly idDeps: IdFactDeps,
    private readonly idCache: IdNodeCache,
    readonly sortedLabels: LabelSorter,
    private readonly file: object = read,
  ) {
    this.kimi = new KimiOrdinalQueries(read, idDeps.hasher);
    const root = read.version?.roots.idRoot ?? 0;
    const reader =
      read.version === undefined
        ? undefined
        : new IdTrieReader(read.access, idCache);
    this.facts = new IdFactQueries(
      {
        get: async (hash) => {
          read.requireOpen();
          return reader === undefined ? undefined : reader.lookup(root, hash);
        },
      },
      idDeps,
    );
    this.kimiFacts = new KimiFactQueries(this, idDeps, this.kimi.meta);
  }

  async rowMeasurementStamp(source: bigint | RowEntry): Promise<string> {
    const entry =
      typeof source === 'bigint' ? await this.entryByLabel(source) : source;
    if (entry === undefined)
      throw new JournalFormatError('Measurement source row is absent');
    const ids = await this.readIds(entry);
    const head = ids.head;
    if (head === undefined)
      throw new JournalFormatError('Measurement source has no stored frame');
    const parts: string[] = [];
    for (const block of ids.header.blocks) {
      const bytes = await this.read.access.readRecordRange(
        head,
        block.offset + block.length,
        4,
      );
      parts.push(
        `${block.length}:${new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)}`,
      );
    }
    return parts.join(',');
  }

  async recencyFacts(revision: string): Promise<RecencyFacts> {
    this.requireOpen();
    if (this.rows === 0) return new RecencyFacts(this.facts, revision);
    const ready = await this.kimi.meta.get(
      this.version?.roots.metaRoot ?? 0,
      RECENCY_INDEX_READY,
    );
    if (new TextDecoder().decode(ready) !== revision)
      throw new JournalFormatError('Recency fact policy requires a fill');
    return new RecencyFacts(this.facts, revision);
  }

  async densityFiles(revision: string): Promise<DensityFileFacts> {
    this.requireOpen();
    const ready = await this.kimi.meta.get(
      this.version?.roots.metaRoot ?? 0,
      DENSITY_FILES_READY,
    );
    if (ready === undefined || new TextDecoder().decode(ready) !== revision)
      throw new JournalFormatError('Density file policy requires a fill');
    return new DensityFileFacts(
      new NativeFactIndexReader(this.facts, DENSITY_FILES_SCOPE),
    );
  }

  async toolRanking(revision: string): Promise<ToolRankingTree> {
    this.requireOpen();
    const ready = await this.kimi.meta.get(
      this.version?.roots.metaRoot ?? 0,
      TOOL_RANKING_READY,
    );
    if (ready === undefined || new TextDecoder().decode(ready) !== revision)
      throw new JournalFormatError('Tool ranking policy requires a fill');
    return new ToolRankingTree(this.facts);
  }

  async nativeFacts(scope: string): Promise<NativeFactIndexReader> {
    this.requireOpen();
    const active = await this.kimi.meta.get(
      this.version?.roots.metaRoot ?? 0,
      ACTIVE_FACT_INDEX,
    );
    const through = await this.kimi.meta.get(
      this.version?.roots.metaRoot ?? 0,
      NATIVE_FACTS_THROUGH,
    );
    if (
      active === undefined ||
      new TextDecoder().decode(active) !== scope ||
      through === undefined ||
      new TextDecoder().decode(through) !== String(this.version?.commitSeq)
    )
      throw new JournalFormatError('Native fact index settings require a fill');
    return new NativeFactIndexReader(this.facts, scope);
  }

  async formatSummaryRange(
    slot: number,
    from: bigint,
    to: bigint,
    selection?: {
      readonly label: bigint;
      select(summary: SlotSummary, kept: boolean): SlotSummary;
    },
  ): Promise<SlotSummary> {
    this.requireOpen();
    const version = this.version;
    if (version === undefined)
      throw new JournalFormatError('Range format is not registered');
    const format = version.slots.formatSlots[slot];
    if (format.summaryKind === null)
      throw new JournalFormatError('Range format is not registered');
    if (version.rows === 0 || from >= to)
      return identitySlotSummary(format.summaryKind);
    if (
      format.filledThrough < version.commitSeq ||
      version.aggregate.stamp[slot].gen !== format.gen ||
      version.aggregate.missingBase[slot] !== 0
    )
      throw new JournalFormatError('Range format is unmeasured or stale');
    if (selection === undefined && from <= 1n && to >= version.nextLabel)
      return decodeSlotSummary(version.aggregate.summaries[slot], format);
    return rowSummaryRange(
      this.read.access,
      version.roots.rowRoot,
      slot,
      format,
      from,
      to,
      selection,
    );
  }

  async formatAuxiliary(slot: number): Promise<Uint8Array | undefined> {
    this.requireOpen();
    const value = await this.kimi.meta.get(
      this.version?.roots.metaRoot ?? 0,
      rowFormatAuxKey(slot),
    );
    if (value === undefined) return undefined;
    const format = this.version?.slots.formatSlots[slot];
    if (format === undefined || value.byteLength < 16)
      throw new JournalFormatError('Invalid format auxiliary metadata');
    const header = new DataView(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    );
    if (
      header.getBigUint64(0, true) !== format.formatKeyHash ||
      header.getUint32(8, true) !== format.gen ||
      header.getUint32(12, true) !== format.formatRev
    )
      throw new JournalFormatError('Format auxiliary measurement is stale');
    return value.subarray(16);
  }

  normalizedId(family: 1 | 2, rawId: string): string {
    this.read.requireOpen();
    return family === 1
      ? this.idDeps.normalizers.openai(rawId)
      : this.idDeps.normalizers.anthropic(rawId);
  }

  kimiMappedId(rawId: string): Promise<string | undefined> {
    return this.kimiFacts.mappedId(rawId);
  }

  kimiIdFact(rawId: string): Promise<KimiIdFact | undefined> {
    return this.kimiFacts.idFact(rawId);
  }

  kimiExceptions(): AsyncGenerator<KimiIdFact> {
    return this.kimiFacts.exceptions();
  }

  kimiDigitCorrection(): Promise<number> {
    return this.kimiFacts.digitCorrection();
  }

  kimiUnmappedCount(): Promise<number> {
    return this.kimi.unmappedCount();
  }

  kimiUnmappedBelow(label: bigint): Promise<number> {
    return this.kimi.unmappedBelow(label);
  }

  kimiWrittenDigits(): Promise<number> {
    return this.kimiFacts.writtenDigits();
  }

  kimiUnmappedWrittenCount(): Promise<number> {
    return this.kimiFacts.unmappedWrittenCount();
  }

  async kimiFallbackIndex(occurrence: KimiOccurrence): Promise<number> {
    if ((occurrence.flags & KIMI_FLAG.unmapped) === 0)
      throw new RangeError('Kimi occurrence does not consume a fallback');
    return kimiSafeCount(
      (await this.kimiEligibleCount()) +
        (await this.kimiUnmappedBelow(occurrence.position.label)) +
        occurrence.fallbackWithinRow,
    );
  }

  kimiHolders(rawId: string): AsyncGenerator<KimiOccurrence> {
    return this.kimiFacts.holders(rawId);
  }

  kimiEligibleCount(): Promise<number> {
    return this.kimi.count();
  }

  kimiOrdinal(label: bigint, eligibleWithinRow: number): Promise<number> {
    return this.kimi.ordinal(label, eligibleWithinRow);
  }

  kimiEligibleBelow(label: bigint): Promise<number> {
    return this.kimi.below(label);
  }

  /** Whether the Kimi facts describe every row; a history with no version has none to describe. */
  async hasKimiFacts(): Promise<boolean> {
    this.read.requireOpen();
    const version = this.version;
    if (version === undefined) return true;
    return kimiEnabled(
      await this.kimi.meta.get(version.roots.metaRoot, KIMI_ELIGIBLE_KEY),
    );
  }

  async hasMistralSlot(slot: number): Promise<boolean> {
    this.read.requireOpen();
    assertMistralSlot(slot);
    const slots = decodeMistralSlots(
      await this.kimi.meta.get(
        this.version?.roots.metaRoot ?? 0,
        MISTRAL_SLOTS_KEY,
      ),
    );
    return (slots & (1 << slot)) !== 0;
  }

  async requireMistralSlot(slot: number): Promise<void> {
    if (!(await this.hasMistralSlot(slot)))
      throw new JournalFormatError('Mistral observe mappings need a fill');
  }

  async mistralGeneration(): Promise<string> {
    this.read.requireOpen();
    const generation = await this.kimi.meta.get(
      this.version?.roots.metaRoot ?? 0,
      MISTRAL_GENERATION_KEY,
    );
    if (generation === undefined)
      throw new JournalFormatError(
        'Mistral conversion generation needs a fill',
      );
    return decodeDecimal(generation).toString();
  }

  mistralCandidate(rawId: string, salt: number): string {
    this.read.requireOpen();
    const candidate = this.idDeps.mistralCandidate;
    if (candidate === undefined)
      throw new JournalFormatError(
        'Mistral mapping candidate is not registered',
      );
    return candidate(rawId, salt);
  }

  async mistralMapping(
    rawId: string,
    slot: number,
  ): Promise<MistralMapping | undefined> {
    this.read.requireOpen();
    if (this.version === undefined) return undefined;
    return readMistralMapping(
      this.read.access,
      this.facts,
      rawId,
      slot,
      this.idDeps.hasher,
    );
  }

  restorationIn(file: object): VersionEdit {
    this.read.requireOpen();
    const saved = this.version;
    if (saved === undefined) return { kind: 'clear' };
    return file === this.file
      ? { kind: 'restore', saved }
      : {
          kind: 'adoptAll',
          rows: this.sourceRows(),
          nextLabel: saved.nextLabel,
        };
  }

  private async *sourceRows(): AsyncGenerator<SourceRow> {
    for await (const entry of this.entries()) {
      yield { source: this.read.access, entry };
    }
  }

  /** Undefined for a journal with no committed group: no rows. */
  get version(): Version | undefined {
    return this.read.version;
  }

  /** Another hold on the snapshot's pin, for a reader that outlives its opener; the returned function releases it. */
  hold(): () => void | Promise<void> {
    return this.read.hold();
  }

  retain(): VersionSnapshot {
    this.requireOpen();
    return new VersionSnapshot(
      new PinnedRead(
        this.version,
        this.version === undefined ? undefined : this.read.access,
        new PinLease(this.hold()),
      ),
      this.idDeps,
      this.idCache,
      this.sortedLabels,
      this.file,
    );
  }

  /** Releases the snapshot's pin. */
  close(): void | Promise<void> {
    return this.read.close();
  }

  /** The number of live rows. */
  get rows(): number {
    return this.read.version?.rows ?? 0;
  }

  get rowWindowStats(): RowReadWindowStats | undefined {
    this.requireOpen();
    return this.version === undefined
      ? undefined
      : this.read.access.rowWindowStats;
  }

  async humanCut(turns: number, fromEnd: boolean): Promise<number> {
    this.requireOpen();
    if (!Number.isSafeInteger(turns) || turns < 0)
      throw new RangeError('Human turn count must be a non-negative integer');
    if (turns === 0) return this.rows;
    const humans = this.version?.aggregate.humanRows ?? 0;
    if (turns > humans) return fromEnd ? 0 : this.rows;
    const root = this.rootRef();
    if (root === undefined)
      throw new JournalFormatError('Human count without a row tree');
    return humanRowOrdinal(
      this.read.access,
      root,
      fromEnd ? humans - turns : turns - 1,
    );
  }

  get units(): number {
    this.read.requireOpen();
    return this.read.version?.aggregate.units ?? 0;
  }

  unitsBelow(label: bigint): Promise<number> {
    this.read.requireOpen();
    if (this.read.version === undefined) return Promise.resolve(0);
    return countUnitsBelow(this.read.access, this.rootRef(), label);
  }

  async unitAt(index: number): Promise<IndexedUnit> {
    this.read.requireOpen();
    const root = this.rootRef();
    if (root === undefined)
      throw new RangeError(`Unit ${index} of an empty snapshot`);
    return entryAtUnit(this.read.access, root, this.units, index);
  }

  get curatedRows(): number {
    this.requireOpen();
    return this.version?.aggregate.curated ?? 0;
  }

  async sourceOrdinalAt(index: number): Promise<number> {
    this.requireOpen();
    const root = this.rootRef();
    if (root === undefined)
      throw new RangeError('Curated row of an empty snapshot');
    return (
      await curatedEntryWithOrdinalAt(
        this.read.access,
        root,
        this.curatedRows,
        index,
      )
    ).ordinal;
  }

  curatedAt(index: number): Promise<RowEntry> {
    this.requireOpen();
    const root = this.rootRef();
    if (root === undefined)
      throw new RangeError('Curated row of an empty snapshot');
    return curatedEntryAt(this.read.access, root, this.curatedRows, index);
  }

  rowsBelow(label: bigint): Promise<number> {
    this.requireOpen();
    return countRowsBelow(this.read.access, this.rootRef(), label);
  }

  nextCuratedAfter(label: bigint): Promise<RowEntry | undefined> {
    this.read.requireOpen();
    const root = this.rootRef();
    if (root === undefined) return Promise.resolve(undefined);
    return nextCuratedEntry(
      this.read.access,
      root,
      this.read.version?.aggregate.curated ?? 0,
      label,
    );
  }

  /** The live rows in label order from index `from`. */
  hasAssistantToolCalls(excluded: ReadonlySet<bigint>): Promise<boolean> {
    this.read.requireOpen();
    return hasAssistantToolCalls(this.read.access, this.rootRef(), excluded);
  }

  async *entries(from = 0): AsyncGenerator<RowEntry> {
    const root = this.rootRef();
    if (root === undefined) return;
    yield* iterateRowEntries(this.read.access, root, from);
  }

  async *selectedEntries(labels: AsyncIterable<bigint>): AsyncGenerator<{
    readonly entry: RowEntry;
    readonly nextEntry: RowEntry | null;
  }> {
    let entries: AsyncGenerator<RowEntry> | undefined;
    let following: IteratorResult<RowEntry> | undefined;
    try {
      for await (const label of labels) {
        this.requireOpen();
        if (following?.done !== false || following.value.label !== label) {
          await entries?.return(undefined);
          entries = this.entries(await this.rowsBelow(label));
          following = await entries.next();
        }
        if (following.done === true || following.value.label !== label)
          throw new JournalFormatError('Selected source row is absent');
        const entry = following.value;
        following = await entries?.next();
        const next = following?.done === false ? following.value : undefined;
        yield {
          entry,
          nextEntry:
            next !== undefined && (next.flags & ROW_FLAG.curated) !== 0
              ? next
              : ((await this.nextCuratedAfter(label)) ?? null),
        };
      }
    } finally {
      await entries?.return(undefined);
    }
  }

  /** The `index`-th live row (0-based). */
  async entryAt(index: number): Promise<RowEntry> {
    this.requireOpen();
    const root = this.rootRef();
    if (root === undefined) {
      throw new JournalFormatError(`Row ${index} of an empty snapshot`);
    }
    return entryAt(this.read.access, root, index);
  }

  /** The live row `label`, or undefined when no row has it. */
  entryByLabel(label: bigint): Promise<RowEntry | undefined> {
    return entryByLabel(this.read.access, this.rootRef(), label);
  }

  readIds(entry: RowEntry): Promise<RowIds> {
    return readRowIds(this.read.access, entry);
  }

  /** The whole row an entry of this snapshot points at. */
  readRow(entry: RowEntry): Promise<StoredRow> {
    return readStoredRow(this.read.access, entry);
  }

  readBlock(entry: RowEntry, index: number, ids?: RowIds): Promise<Uint8Array> {
    this.requireOpen();
    return readStoredBlock(this.read.access, entry, index, ids);
  }

  readMetadata(entry: RowEntry, ids?: RowIds): Promise<StoredRow> {
    this.requireOpen();
    return readStoredMetadata(this.read.access, entry, ids);
  }

  requireOpen(): void {
    this.read.requireOpen();
  }

  private rootRef(): RowTreeRootRef | undefined {
    const { version } = this.read;
    return version === undefined || version.roots.rowRoot === 0
      ? undefined
      : { offset: version.roots.rowRoot, rows: version.rows };
  }
}
