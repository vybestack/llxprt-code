/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { PlannedRow } from './groupEdits.js';
import type { FactDeps, GroupFacts } from './groupFacts.js';
import type { IdFactQueries } from './idFactQueries.js';
import { KIMI_FLAG } from './kimiFactCodec.js';
import { replaceKimiRow, type KimiRowId } from './kimiFactWriter.js';
import { fact0Key } from './idKeys.js';
import type { IdFactBatch, BatchSpill } from './idFactBatch.js';
import type { BlockPosition, IdFact } from './idFactCodec.js';
import {
  comparePositions,
  normalizedIdOf,
  type IdOccurrence,
} from './idFactUpdate.js';
import type { UnitPosition } from './idEntryCodecs.js';
import {
  ID_NS,
  OCCURRENCE_KIND,
  type NormalizedFamily,
  type OccurrenceKind,
} from './idKeys.js';
import { ENTRY_FLAG, type RowEntry } from './rowEntry.js';
import {
  ROW_BLOCK_TYPE,
  ROW_FLAG,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from './rowRecord.js';

interface RowList {
  readonly family: NormalizedFamily;
  readonly kind: OccurrenceKind;
  readonly id: string;
  readonly positions: UnitPosition[];
}

function samePart(
  left: BlockPosition | undefined,
  right: BlockPosition,
): boolean {
  return left?.label === right.label && left.part === right.part;
}

function reconstructedTarget(fact: IdFact): boolean {
  return (
    fact.firstToolResponse !== undefined &&
    (fact.firstCall === undefined ||
      comparePositions(fact.firstToolResponse, fact.firstCall) < 0)
  );
}

function isReconstructed(occurrence: IdOccurrence, fact: IdFact): boolean {
  if (occurrence.kind !== ROW_ID_KIND.response) return false;
  if (occurrence.partSpeaker !== ROW_SPEAKER.tool) return false;
  return (
    samePart(fact.firstToolResponse, occurrence.at) &&
    (fact.firstCall === undefined ||
      comparePositions(fact.firstCall, { ...occurrence.at, block: 0 }) >= 0)
  );
}

function distinctNonempty(
  occurrences: readonly IdOccurrence[],
): IdOccurrence[] {
  const distinct = new Set<string>();
  return occurrences.filter((occurrence) => {
    if (occurrence.rawId === '' || distinct.has(occurrence.rawId)) return false;
    distinct.add(occurrence.rawId);
    return true;
  });
}

class RowOccurrences {
  private readonly facts = new Map<string, IdFact>();
  readonly lists = new Map<string, RowList>();
  eligibleCalls = 0;
  readonly kimiRows = new Map<
    string,
    {
      identity: Uint8Array;
      calls: Array<KimiRowId['calls'][number]>;
      responses: Array<KimiRowId['responses'][number]>;
    }
  >();

  constructor(
    private readonly row: PlannedRow,
    private readonly normalize: (
      family: NormalizedFamily,
      rawId: string,
    ) => string,
    private readonly kimiIdentity?: (rawId: string) => Uint8Array,
  ) {}

  private initializeLists(rawId: string): void {
    for (const family of [ID_NS.openai, ID_NS.anthropic]) {
      for (const kind of [OCCURRENCE_KIND.call, OCCURRENCE_KIND.response]) {
        const id = this.normalize(family, rawId);
        const key = JSON.stringify([family, kind, id]);
        if (!this.lists.has(key))
          this.lists.set(key, { family, kind, id, positions: [] });
      }
    }
  }

  async initialize(
    source: readonly IdOccurrence[],
    facts: Pick<IdFactQueries, 'fact'>,
  ): Promise<void> {
    for (const occurrence of source) {
      if (this.facts.has(occurrence.rawId)) continue;
      const fact = await facts.fact(occurrence.rawId);
      if (fact === undefined)
        throw new JournalFormatError('Normalized row has no source fact');
      this.facts.set(occurrence.rawId, fact);
      this.initializeLists(occurrence.rawId);
      if (this.kimiIdentity !== undefined)
        this.kimiRows.set(occurrence.rawId, {
          identity: this.kimiIdentity(occurrence.rawId),
          calls: [],
          responses: [],
        });
    }
  }

  private factOf(id: string): IdFact {
    const fact = this.facts.get(id);
    if (fact === undefined)
      throw new JournalFormatError('Missing current-row fact');
    return fact;
  }

  private recordKimi(
    occurrence: IdOccurrence,
    kind: OccurrenceKind,
    position: UnitPosition,
    eligible: boolean,
    reconstructed: boolean,
    ai: boolean,
  ): void {
    const target = this.kimiRows.get(occurrence.rawId);
    if (target === undefined)
      throw new JournalFormatError('Missing emitted Kimi row id');
    const split =
      this.row.speaker === ROW_SPEAKER.tool &&
      this.row.ids.some((id) => id.kind === ROW_ID_KIND.call);
    const indices = this.row.blockTypes.flatMap((type, index) => {
      const inPart =
        occurrence.at.part === 0
          ? type === ROW_BLOCK_TYPE.tool_call
          : type !== ROW_BLOCK_TYPE.tool_call;
      return !split || inPart ? [index] : [];
    });
    const block = indices.find(
      (_index, partBlock) => partBlock === occurrence.at.block,
    );
    if (block === undefined)
      throw new JournalFormatError('Missing emitted Kimi source block');
    const flags =
      (eligible ? KIMI_FLAG.eligible : 0) |
      (ai ? KIMI_FLAG.ai : 0) |
      (reconstructed ? KIMI_FLAG.reconstructed : 0);
    (kind === OCCURRENCE_KIND.call ? target.calls : target.responses).push({
      position,
      eligibleWithinRow: this.eligibleCalls,
      block,
      flags,
    });
  }

  private emit(
    occurrences: readonly IdOccurrence[],
    kind: OccurrenceKind,
    part: number,
    unit: number,
    speaker: number,
    responseAi = false,
  ): void {
    for (const occurrence of occurrences) {
      const reconstructed =
        kind === OCCURRENCE_KIND.call &&
        occurrence.kind === ROW_ID_KIND.response;
      const eligible =
        kind === OCCURRENCE_KIND.call &&
        occurrence.rawId !== '' &&
        (reconstructed || occurrence.nameLen > 0);
      if (this.kimiIdentity !== undefined)
        this.recordKimi(
          occurrence,
          kind,
          { label: this.row.label, part, unit },
          eligible,
          reconstructed,
          kind === OCCURRENCE_KIND.call
            ? speaker === ROW_SPEAKER.ai
            : responseAi,
        );
      if (eligible) this.eligibleCalls++;
    }
    if (kind === OCCURRENCE_KIND.call && speaker !== ROW_SPEAKER.ai) return;
    for (const occurrence of occurrences) {
      for (const family of [ID_NS.openai, ID_NS.anthropic]) {
        const id = this.normalize(family, occurrence.rawId);
        const list = this.lists.get(JSON.stringify([family, kind, id]));
        if (list === undefined)
          throw new JournalFormatError('Missing current-row normalized list');
        list.positions.push({ label: this.row.label, part, unit });
      }
    }
  }

  part(source: readonly IdOccurrence[], entry: RowEntry, part: number): void {
    const occurrences = source.filter(
      (occurrence) => occurrence.at.part === part,
    );
    const reconstructed = occurrences.filter((occurrence) =>
      isReconstructed(occurrence, this.factOf(occurrence.rawId)),
    );
    let unit = 0;
    if (reconstructed.length > 0) {
      this.emit(
        reconstructed,
        OCCURRENCE_KIND.call,
        part,
        unit++,
        ROW_SPEAKER.ai,
      );
      const responses = distinctNonempty(reconstructed);
      if (responses.length > 0)
        this.emit(
          responses,
          OCCURRENCE_KIND.response,
          part,
          unit++,
          ROW_SPEAKER.tool,
          true,
        );
    }
    const self =
      (entry.flags & (part === 0 ? ENTRY_FLAG.self : ENTRY_FLAG.splitSelf)) !==
      0;
    const calls = occurrences.filter(
      (occurrence) => occurrence.kind === ROW_ID_KIND.call,
    );
    if (self)
      this.emit(
        calls,
        OCCURRENCE_KIND.call,
        part,
        unit++,
        calls[0]?.partSpeaker ?? this.row.speaker,
      );
    const responses = distinctNonempty(calls).filter((occurrence) => {
      const fact = this.factOf(occurrence.rawId);
      return (
        !reconstructedTarget(fact) &&
        samePart(fact.firstCall, occurrence.at) &&
        (fact.firstResponse !== undefined || fact.firstAiCall !== undefined)
      );
    });
    if (responses.length > 0)
      this.emit(
        responses,
        OCCURRENCE_KIND.response,
        part,
        unit,
        ROW_SPEAKER.tool,
        (calls[0]?.partSpeaker ?? this.row.speaker) === ROW_SPEAKER.ai,
      );
  }
}

export async function normalizedRowLists(
  row: PlannedRow,
  entry: RowEntry,
  source: readonly IdOccurrence[],
  facts: Pick<IdFactQueries, 'fact'>,
  normalize: (family: NormalizedFamily, rawId: string) => string,
): Promise<readonly RowList[]> {
  const occurrences = new RowOccurrences(row, normalize);
  await occurrences.initialize(source, facts);
  for (const part of [0, 1]) occurrences.part(source, entry, part);
  return [...occurrences.lists.values()];
}

export async function writeNormalizedRowOccurrences(
  row: PlannedRow,
  entry: RowEntry,
  ids: IdFactBatch,
  deps: FactDeps,
  spill: BatchSpill,
  kimiFacts?: GroupFacts,
): Promise<number> {
  if (
    deps.idDeps.occurrenceSpace !== 'source-with-normalized' ||
    (row.flags & ROW_FLAG.curated) === 0
  )
    return 0;
  const source = await deps.planOccurrences(row, ids.queries);
  const occurrences = new RowOccurrences(
    row,
    (family, rawId) => normalizedIdOf(deps.idDeps.normalizers, family, rawId),
    kimiFacts?.kimi === true
      ? (rawId) => deps.idDeps.hasher(ID_NS.fact, fact0Key(rawId))
      : undefined,
  );
  await occurrences.initialize(source, ids.queries);
  for (const part of [0, 1]) occurrences.part(source, entry, part);
  for (const list of occurrences.lists.values()) {
    await ids.replaceNormalizedRow(
      list.family,
      list.kind,
      list.id,
      row.label,
      list.positions,
      spill,
    );
  }
  if (kimiFacts?.kimi === true) {
    for (const id of occurrences.kimiRows.values())
      await replaceKimiRow(kimiFacts, row.label, id);
  }
  return occurrences.eligibleCalls;
}
