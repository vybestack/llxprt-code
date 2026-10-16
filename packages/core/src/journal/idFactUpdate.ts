/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { OccurrenceEntry, UnitPosition } from './idEntryCodecs.js';
import type { BlockPosition, IdFact } from './idFactCodec.js';
import {
  ID_NS,
  OCCURRENCE_KIND,
  type NormalizedFamily,
  type OccurrenceKind,
} from './idKeys.js';
import { ROW_SPEAKER } from './rowRecord.js';

/**
 * The unit a block is emitted in. `leadingTool` marks a tool-speaker unit
 * before the first non-tool unit of the stream, which the Anthropic assembler
 * drops (design 3.3, namespace 2).
 */
export interface UnitPlace {
  readonly position: UnitPosition;
  readonly speaker: number;
  readonly leadingTool: boolean;
}

/**
 * One call or response block as the id index sees it, in position order. The
 * caller (the append path, or a rebuild reading row headers and id pieces)
 * decides where the block is emitted, which is the normalizer's business; the
 * rule below only records it.
 */
export interface IdOccurrence {
  readonly rawId: string;
  readonly kind: OccurrenceKind;
  /** The block's own place: row, part, block index in the part. */
  readonly at: BlockPosition;
  /** `ROW_SPEAKER` of the part that holds the block. */
  readonly partSpeaker: number;
  /** The unit the block is emitted in; for a reconstructed call the synthetic AI unit. */
  readonly unit: UnitPlace;
  /** The response score of the block (0 for a call). */
  readonly score: number;
  /** UTF-8 length of a call's name, 0 when unnamed. */
  readonly nameLen: number;
  /** A call block that stage 1 reconstructs from a response: it has no block of its own, so `at` is the response it comes from. */
  readonly reconstructed: boolean;
}

/** Pure functions of the two provider normalizers, injected because the journal does not import providers or tools. */
export interface IdNormalizers {
  openai(rawId: string): string;
  anthropic(rawId: string): string;
}

export function normalizedIdOf(
  normalizers: IdNormalizers,
  family: NormalizedFamily,
  rawId: string,
): string {
  return family === ID_NS.openai
    ? normalizers.openai(rawId)
    : normalizers.anthropic(rawId);
}

function fail(message: string): never {
  throw new JournalFormatError(message);
}

export function assertOccurrence(occ: IdOccurrence): void {
  if (occ.reconstructed && occ.kind !== OCCURRENCE_KIND.call) {
    fail('Only a call block can be reconstructed');
  }
  if (occ.unit.leadingTool && occ.unit.speaker !== ROW_SPEAKER.tool) {
    fail('Only a tool unit can come before the first non-tool unit');
  }
}

export function comparePositions(
  left: BlockPosition,
  right: BlockPosition,
): number {
  if (left.label !== right.label) return left.label < right.label ? -1 : 1;
  if (left.part !== right.part) return left.part - right.part;
  return left.block - right.block;
}

export function compareUnitPositions(
  left: UnitPosition,
  right: UnitPosition,
): number {
  if (left.label !== right.label) return left.label < right.label ? -1 : 1;
  if (left.part !== right.part) return left.part - right.part;
  return left.unit - right.unit;
}

/** A call block with a non-empty id and a non-empty name is eligible for a Kimi mapping (design 7.2). */
export function isEligibleCall(occ: IdOccurrence): boolean {
  return (
    occ.kind === OCCURRENCE_KIND.call && occ.rawId !== '' && occ.nameLen > 0
  );
}

/**
 * Whether the occurrence enters the list of `family` for its kind (design 3.3):
 * calls of both families are the call blocks in AI-speaker units. A response
 * enters the OpenAI list in a tool-speaker unit, and the Anthropic list in any
 * unit the assembler admits: every non-tool unit and the tool units after the
 * first non-tool unit.
 */
export function entersNormalizedList(
  occ: IdOccurrence,
  family: NormalizedFamily,
): boolean {
  const speaker = occ.unit.speaker;
  if (occ.kind === OCCURRENCE_KIND.call) return speaker === ROW_SPEAKER.ai;
  if (family === ID_NS.openai) return speaker === ROW_SPEAKER.tool;
  return !(speaker === ROW_SPEAKER.tool && occ.unit.leadingTool);
}

export function occurrenceEntryOf(occ: IdOccurrence): OccurrenceEntry {
  return {
    at: occ.at,
    eligible: isEligibleCall(occ),
    ai: occ.unit.speaker === ROW_SPEAKER.ai,
  };
}

function updateForCall(fact: IdFact, occ: IdOccurrence): IdFact {
  if (
    !occ.reconstructed &&
    fact.firstCall !== undefined &&
    comparePositions(occ.at, fact.firstCall) <= 0
  ) {
    fail(`Call of ${JSON.stringify(occ.rawId)} arrives out of position order`);
  }
  const ai = occ.unit.speaker === ROW_SPEAKER.ai;
  const eligible = isEligibleCall(occ);
  const real = !occ.reconstructed;
  return {
    ...fact,
    firstCall: fact.firstCall ?? (real ? occ.at : undefined),
    firstAiCall:
      fact.firstAiCall ??
      (real && occ.partSpeaker === ROW_SPEAKER.ai ? occ.at : undefined),
    callCount: fact.callCount + 1,
    lastEligibleCall: eligible
      ? { at: occ.at, nameLen: occ.nameLen }
      : fact.lastEligibleCall,
    aiWire: fact.aiWire + (ai ? 1 : 0),
    unnamed: fact.unnamed + (occ.nameLen === 0 ? 1 : 0),
    nonAiElig: fact.nonAiElig + (eligible && !ai ? 1 : 0),
  };
}

function updateForResponse(fact: IdFact, occ: IdOccurrence): IdFact {
  const counted = { ...fact, respCount: fact.respCount + 1 };
  if (occ.rawId === '') return counted;
  if (
    fact.firstResponse !== undefined &&
    comparePositions(occ.at, fact.firstResponse) <= 0
  ) {
    fail(
      `Response of ${JSON.stringify(occ.rawId)} arrives out of position order`,
    );
  }
  const better = fact.best === undefined || occ.score > fact.bestScore;
  return {
    ...counted,
    firstResponse: fact.firstResponse ?? occ.at,
    firstToolResponse:
      fact.firstToolResponse ??
      (occ.partSpeaker === ROW_SPEAKER.tool ? occ.at : undefined),
    best: better ? occ.at : fact.best,
    bestScore: better ? occ.score : fact.bestScore,
  };
}

/**
 * The update rule of design 3.3, for one block: set `C`, `Ca`, `R` or `Rt`
 * when absent, replace `best` when the score is strictly higher, bump the
 * count, replace `Ke` when the call is eligible, and bump the Kimi counters.
 * Occurrences of one id arrive in position order. A reconstructed call never
 * sets `C` or `Ca`, because those are facts about blocks that exist; it counts
 * as an AI-speaker call everywhere else. The empty id is a call key like any
 * other and is never a response key.
 */
export function updateFact(fact: IdFact, occ: IdOccurrence): IdFact {
  assertOccurrence(occ);
  return occ.kind === OCCURRENCE_KIND.call
    ? updateForCall(fact, occ)
    : updateForResponse(fact, occ);
}

/**
 * Kimi (design 7.2): an id is clean when it is non-empty and has exactly one
 * call block, that block is named and sits in an AI-speaker unit. Every other
 * id that has a call block is an exception id, which the filter must read
 * rather than derive. An id with only responses has no call block to map.
 */
export function isKimiException(rawId: string, fact: IdFact): boolean {
  if (fact.callCount === 0) return false;
  const single = fact.callCount === 1 && fact.aiWire === 1;
  const plain = fact.unnamed === 0 && fact.nonAiElig === 0;
  return !(rawId !== '' && single && plain);
}
