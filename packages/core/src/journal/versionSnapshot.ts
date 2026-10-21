/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ToolRankingTree, TOOL_RANKING_READY } from './tool-ranking-tree.js';
import {
  DensityFileFacts,
  DENSITY_FILES_READY,
  DENSITY_FILES_SCOPE,
} from './density-file-facts.js';
import { RecencyFacts, RECENCY_INDEX_READY } from './recencyFacts.js';
import { ACTIVE_FACT_INDEX, NativeFactIndexReader } from './nativeFactIndex.js';
import { rowFormatAuxKey } from './rowFormat.js';
import { JournalFormatError } from './errors.js';
import { decodeDecimal } from './metaFacts.js';
import { KimiOrdinalQueries } from './kimiOrdinals.js';
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
import { nextCuratedEntry, curatedEntryAt } from './curatedQueries.js';
import { IdFactQueries, type IdFactDeps } from './idFactQueries.js';
import type { IdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import type { PinnedRead } from './pinLease.js';
import type { RowEntry } from './rowEntry.js';
import {
  readRowIds,
  readStoredRow,
  type RowIds,
  type StoredRow,
} from './rowReads.js';
import {
  entryByLabel,
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
    idCache: IdNodeCache,
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
    if (active === undefined || new TextDecoder().decode(active) !== scope)
      throw new JournalFormatError('Native fact index settings require a fill');
    return new NativeFactIndexReader(this.facts, scope);
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

  async requireMistralSlot(slot: number): Promise<void> {
    this.read.requireOpen();
    assertMistralSlot(slot);
    const slots = decodeMistralSlots(
      await this.kimi.meta.get(
        this.version?.roots.metaRoot ?? 0,
        MISTRAL_SLOTS_KEY,
      ),
    );
    if ((slots & (1 << slot)) === 0)
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

  /** Releases the snapshot's pin. */
  close(): void | Promise<void> {
    return this.read.close();
  }

  /** The number of live rows. */
  get rows(): number {
    return this.read.version?.rows ?? 0;
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
  async *entries(from = 0): AsyncGenerator<RowEntry> {
    const root = this.rootRef();
    if (root === undefined) return;
    yield* iterateRowEntries(this.read.access, root, from);
  }

  /** The `index`-th live row (0-based). */
  entryAt(index: number): Promise<RowEntry> {
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

  readBlock(entry: RowEntry, index: number): Promise<Uint8Array> {
    return readStoredBlock(this.read.access, entry, index);
  }

  readMetadata(entry: RowEntry): Promise<StoredRow> {
    return readStoredMetadata(this.read.access, entry);
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
