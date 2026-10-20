/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { PlannedRow } from './groupEdits.js';
import type { FactDeps } from './groupFacts.js';
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
import { ROW_FLAG, ROW_ID_KIND, ROW_SPEAKER } from './rowRecord.js';

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

  constructor(
    private readonly row: PlannedRow,
    private readonly deps: FactDeps,
  ) {}

  private initializeLists(rawId: string): void {
    for (const family of [ID_NS.openai, ID_NS.anthropic]) {
      for (const kind of [OCCURRENCE_KIND.call, OCCURRENCE_KIND.response]) {
        const id = normalizedIdOf(this.deps.idDeps.normalizers, family, rawId);
        const key = JSON.stringify([family, kind, id]);
        if (!this.lists.has(key))
          this.lists.set(key, { family, kind, id, positions: [] });
      }
    }
  }

  async initialize(
    source: readonly IdOccurrence[],
    ids: IdFactBatch,
  ): Promise<void> {
    for (const occurrence of source) {
      if (this.facts.has(occurrence.rawId)) continue;
      const fact = await ids.queries.fact(occurrence.rawId);
      if (fact === undefined)
        throw new JournalFormatError('Normalized row has no source fact');
      this.facts.set(occurrence.rawId, fact);
      this.initializeLists(occurrence.rawId);
    }
  }

  private factOf(id: string): IdFact {
    const fact = this.facts.get(id);
    if (fact === undefined)
      throw new JournalFormatError('Missing current-row fact');
    return fact;
  }

  private emit(
    occurrences: readonly IdOccurrence[],
    kind: OccurrenceKind,
    part: number,
    unit: number,
    speaker: number,
  ): void {
    if (kind === OCCURRENCE_KIND.call && speaker !== ROW_SPEAKER.ai) return;
    for (const occurrence of occurrences) {
      for (const family of [ID_NS.openai, ID_NS.anthropic]) {
        const id = normalizedIdOf(
          this.deps.idDeps.normalizers,
          family,
          occurrence.rawId,
        );
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
      );
  }
}

export async function writeNormalizedRowOccurrences(
  row: PlannedRow,
  entry: RowEntry,
  ids: IdFactBatch,
  deps: FactDeps,
  spill: BatchSpill,
): Promise<void> {
  if (
    deps.idDeps.occurrenceSpace !== 'source-with-normalized' ||
    (row.flags & ROW_FLAG.curated) === 0
  )
    return;
  const source = await deps.planOccurrences(row, ids.queries);
  const occurrences = new RowOccurrences(row, deps);
  await occurrences.initialize(source, ids);
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
}
