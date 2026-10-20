/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { PlannedRow } from './groupEdits.js';
import { JournalFormatError } from './errors.js';
import type { BlockPosition, IdFact } from './idFactCodec.js';
import { comparePositions } from './idFactUpdate.js';
import type { IdFactQueries } from './idFactQueries.js';
import { ENTRY_FLAG, type RowEntry } from './rowEntry.js';
import type { RowIds } from './rowReads.js';
import {
  ROW_BLOCK_TYPE,
  ROW_FLAG,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from './rowRecord.js';

export const CONTRIBUTION_FLAGS =
  ENTRY_FLAG.self | ENTRY_FLAG.splitSelf | ENTRY_FLAG.reconstructedAdjacent;

export function unitCount(entry: RowEntry): number {
  if ((entry.flags & ROW_FLAG.curated) === 0) return 0;
  return (
    Number((entry.flags & ENTRY_FLAG.self) !== 0) +
    Number((entry.flags & ENTRY_FLAG.splitSelf) !== 0) +
    Number(entry.reconBlocks > 0) +
    Number((entry.flags & ENTRY_FLAG.reconstructedAdjacent) !== 0) +
    Number(entry.answered > 0)
  );
}

export function plannedFromIds({ header, rawIds }: RowIds): PlannedRow {
  return {
    label: header.label,
    speaker: header.speaker,
    flags: header.flags,
    blockTypes: header.blocks.map((block) => block.type),
    ids: header.ids.map((tuple, index) => ({ ...tuple, rawId: rawIds[index] })),
  };
}

function samePart(
  left: BlockPosition | undefined,
  right: BlockPosition,
): boolean {
  return left?.label === right.label && left.part === right.part;
}

function selfExists(types: readonly number[], speaker: number): boolean {
  return (
    !types.includes(ROW_BLOCK_TYPE.tool_response) ||
    (speaker !== ROW_SPEAKER.tool &&
      types.some(
        (type) =>
          type !== ROW_BLOCK_TYPE.tool_response &&
          type !== ROW_BLOCK_TYPE.media,
      ))
  );
}

function selfFlags(row: PlannedRow, split: boolean): number {
  if (!split)
    return selfExists(row.blockTypes, row.speaker) ? ENTRY_FLAG.self : 0;
  const rest = row.blockTypes.filter(
    (type) => type !== ROW_BLOCK_TYPE.tool_call,
  );
  return (
    ENTRY_FLAG.self |
    (rest.length > 0 && selfExists(rest, ROW_SPEAKER.tool)
      ? ENTRY_FLAG.splitSelf
      : 0)
  );
}

function targetIsReconstructed(fact: IdFact): boolean {
  return (
    fact.firstToolResponse !== undefined &&
    (fact.firstCall === undefined ||
      comparePositions(fact.firstToolResponse, fact.firstCall) < 0)
  );
}

function reconstructs(
  row: PlannedRow,
  fact: IdFact,
  at: BlockPosition,
): boolean {
  return (
    row.speaker === ROW_SPEAKER.tool &&
    samePart(fact.firstToolResponse, at) &&
    (fact.firstCall === undefined || comparePositions(fact.firstCall, at) >= 0)
  );
}

function hasSlot(fact: IdFact, at: BlockPosition): boolean {
  const available =
    fact.firstResponse !== undefined || fact.firstAiCall !== undefined;
  return (
    available && !targetIsReconstructed(fact) && samePart(fact.firstCall, at)
  );
}

export async function withUnitContributions(
  entry: RowEntry,
  row: PlannedRow,
  facts: Pick<IdFactQueries, 'fact'>,
): Promise<RowEntry> {
  const base = entry.flags & ~CONTRIBUTION_FLAGS;
  if ((row.flags & ROW_FLAG.curated) === 0)
    return { ...entry, flags: base, reconBlocks: 0, answered: 0 };
  const split =
    row.speaker === ROW_SPEAKER.tool &&
    row.blockTypes.includes(ROW_BLOCK_TYPE.tool_call);
  let flags = base | selfFlags(row, split);
  let reconBlocks = 0;
  let answered = 0;
  const seen = new Set<string>();
  for (const id of row.ids) {
    const fact = await facts.fact(id.rawId);
    if (fact === undefined)
      throw new JournalFormatError('Unit contribution has no source fact');
    const response = id.kind === ROW_ID_KIND.response;
    const at = { label: row.label, part: split && response ? 1 : 0, block: 0 };
    if (response && reconstructs(row, fact, at)) {
      reconBlocks++;
      flags |= id.rawId === '' ? 0 : ENTRY_FLAG.reconstructedAdjacent;
    }
    if (response || id.rawId === '' || seen.has(id.rawId)) continue;
    seen.add(id.rawId);
    answered += Number(hasSlot(fact, at));
  }
  if (reconBlocks > 0xffff || answered > 0xffff)
    throw new JournalFormatError(
      'Unit contribution exceeds the row entry count width',
    );
  return { ...entry, flags, reconBlocks, answered };
}
