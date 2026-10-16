/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  getU64,
  getU64Big,
  putU8,
  putU16,
  putU32,
  putU64,
  putU64Big,
  viewOf,
} from './bytes.js';
import { JournalFormatError } from './errors.js';

/** A block's place: row label, part (0 calls part or whole row, 1 remainder of a split tool row) and block index in the part. */
export interface BlockPosition {
  readonly label: bigint;
  readonly part: number;
  readonly block: number;
}

/** The last eligible call block of an id (Kimi), with the byte length of its name. */
export interface EligibleCall {
  readonly at: BlockPosition;
  readonly nameLen: number;
}

/**
 * The fact for one raw id (design 3.3), empty id included. The design's
 * letters: `firstCall` is `C`, `firstAiCall` is `Ca`, `firstResponse` is `R`,
 * `firstToolResponse` is `Rt`, `lastEligibleCall` is `Ke`.
 */
export interface IdFact {
  /** First call block in the live curated rows, any speaker. */
  readonly firstCall: BlockPosition | undefined;
  /** First call block in an AI-speaker part. */
  readonly firstAiCall: BlockPosition | undefined;
  /** First response block with this callId, any row; never set for the empty id. */
  readonly firstResponse: BlockPosition | undefined;
  /** First response block in a tool-speaker row; never set for the empty id. */
  readonly firstToolResponse: BlockPosition | undefined;
  /** The response with the highest score, the earliest on a tie. */
  readonly best: BlockPosition | undefined;
  /** 0 while `best` is absent. */
  readonly bestScore: number;
  /** Call blocks over the unit stream, reconstructed ones included; also the highest call occurrence ordinal. */
  readonly callCount: number;
  /** Response blocks over the unit stream; also the highest response occurrence ordinal. */
  readonly respCount: number;
  readonly lastEligibleCall: EligibleCall | undefined;
  /** Kimi: call blocks in AI-speaker units. */
  readonly aiWire: number;
  /** Kimi: call blocks with no name. */
  readonly unnamed: number;
  /** Kimi: eligible call blocks in units that are not AI-speaker. */
  readonly nonAiElig: number;
  /** Offset of the `VALUE` record with the mapped ids per format slot (Mistral), or 0. */
  readonly mappedRef: number;
}

export const EMPTY_ID_FACT: IdFact = {
  firstCall: undefined,
  firstAiCall: undefined,
  firstResponse: undefined,
  firstToolResponse: undefined,
  best: undefined,
  bestScore: 0,
  callCount: 0,
  respCount: 0,
  lastEligibleCall: undefined,
  aiWire: 0,
  unnamed: 0,
  nonAiElig: 0,
  mappedRef: 0,
};

const POSITION_BYTES = 12;
const FLAGS_BYTES = 2;
const COUNTERS = 5;
/** The positions in the order they are stored, with their presence bit. */
const POSITION_ORDER = [
  'firstCall',
  'firstAiCall',
  'firstResponse',
  'firstToolResponse',
  'best',
  'lastEligibleCall',
] as const;
type PositionName = (typeof POSITION_ORDER)[number];
const PRESENT_BIT = (name: PositionName): number =>
  1 << POSITION_ORDER.indexOf(name);
const PART_BIT = (name: PositionName): number =>
  1 << (POSITION_ORDER.length + POSITION_ORDER.indexOf(name));
const MAPPED_BIT = 1 << (2 * POSITION_ORDER.length);
const USED_BITS = (1 << (2 * POSITION_ORDER.length + 1)) - 1;

/** Flags, six positions of 12 bytes, the score, a name length, five counters and the mapped reference. */
export const ID_FACT_MAX_BYTES =
  FLAGS_BYTES +
  POSITION_ORDER.length * POSITION_BYTES +
  1 +
  4 +
  COUNTERS * 4 +
  8;

function positionOf(
  fact: IdFact,
  name: PositionName,
): BlockPosition | undefined {
  return name === 'lastEligibleCall' ? fact.lastEligibleCall?.at : fact[name];
}

function fail(message: string): never {
  throw new JournalFormatError(message);
}

function assertValid(fact: IdFact): void {
  if (fact.best === undefined && fact.bestScore !== 0) {
    fail('A fact with no best response has score 0');
  }
  for (const name of POSITION_ORDER) {
    const at = positionOf(fact, name);
    if (at !== undefined && at.part !== 0 && at.part !== 1) {
      fail(`${name} has part ${at.part}; a row has parts 0 and 1`);
    }
  }
}

function flagsOf(fact: IdFact): number {
  let flags = fact.mappedRef !== 0 ? MAPPED_BIT : 0;
  for (const name of POSITION_ORDER) {
    const at = positionOf(fact, name);
    if (at === undefined) continue;
    flags |= PRESENT_BIT(name) | (at.part === 1 ? PART_BIT(name) : 0);
  }
  return flags;
}

function sizeOf(flags: number, fact: IdFact): number {
  let size = FLAGS_BYTES + COUNTERS * 4;
  for (const name of POSITION_ORDER) {
    if ((flags & PRESENT_BIT(name)) !== 0) size += POSITION_BYTES;
  }
  if (fact.best !== undefined) size += 1;
  if (fact.lastEligibleCall !== undefined) size += 4;
  return (flags & MAPPED_BIT) !== 0 ? size + 8 : size;
}

/** Presence flags, the present positions, then the optional and the fixed tail; absent parts take no bytes. */
export function encodeIdFact(fact: IdFact): Uint8Array {
  assertValid(fact);
  const flags = flagsOf(fact);
  const bytes = new Uint8Array(sizeOf(flags, fact));
  const view = viewOf(bytes);
  putU16(view, 0, 'flags', flags);
  let at = FLAGS_BYTES;
  for (const name of POSITION_ORDER) {
    const position = positionOf(fact, name);
    if (position === undefined) continue;
    putU64Big(view, at, `${name}.label`, position.label);
    putU32(view, at + 8, `${name}.block`, position.block);
    at += POSITION_BYTES;
  }
  if (fact.best !== undefined) {
    putU8(view, at, 'bestScore', fact.bestScore);
    at += 1;
  }
  if (fact.lastEligibleCall !== undefined) {
    putU32(view, at, 'nameLen', fact.lastEligibleCall.nameLen);
    at += 4;
  }
  for (const count of [
    fact.callCount,
    fact.respCount,
    fact.aiWire,
    fact.unnamed,
    fact.nonAiElig,
  ]) {
    putU32(view, at, 'counter', count);
    at += 4;
  }
  if ((flags & MAPPED_BIT) !== 0) putU64(view, at, 'mappedRef', fact.mappedRef);
  return bytes;
}

function readPosition(
  view: DataView,
  at: number,
  flags: number,
  name: PositionName,
): BlockPosition {
  return {
    label: getU64Big(view, at),
    part: (flags & PART_BIT(name)) !== 0 ? 1 : 0,
    block: view.getUint32(at + 8, true),
  };
}

export function decodeIdFact(bytes: Uint8Array): IdFact {
  if (bytes.length < FLAGS_BYTES)
    fail(`IdFact of ${bytes.length} bytes has no flags`);
  const view = viewOf(bytes);
  const flags = view.getUint16(0, true);
  if ((flags & ~USED_BITS) !== 0)
    fail(`IdFact flags ${flags} set a reserved bit`);
  const positions = new Map<PositionName, BlockPosition>();
  let at = FLAGS_BYTES;
  for (const name of POSITION_ORDER) {
    if ((flags & PRESENT_BIT(name)) === 0) {
      if ((flags & PART_BIT(name)) !== 0)
        fail(`IdFact sets the part of absent ${name}`);
      continue;
    }
    if (at + POSITION_BYTES > bytes.length)
      fail('IdFact ends inside a position');
    positions.set(name, readPosition(view, at, flags, name));
    at += POSITION_BYTES;
  }
  const best = positions.get('best');
  const eligible = positions.get('lastEligibleCall');
  const tail =
    (best ? 1 : 0) +
    (eligible ? 4 : 0) +
    COUNTERS * 4 +
    ((flags & MAPPED_BIT) !== 0 ? 8 : 0);
  if (at + tail !== bytes.length) {
    fail(`IdFact is ${bytes.length} bytes, its flags need ${at + tail}`);
  }
  const bestScore = best ? view.getUint8(at) : 0;
  at += best ? 1 : 0;
  const nameLen = eligible ? view.getUint32(at, true) : 0;
  at += eligible ? 4 : 0;
  const counts = [0, 1, 2, 3, 4].map((index) =>
    view.getUint32(at + index * 4, true),
  );
  at += COUNTERS * 4;
  return {
    firstCall: positions.get('firstCall'),
    firstAiCall: positions.get('firstAiCall'),
    firstResponse: positions.get('firstResponse'),
    firstToolResponse: positions.get('firstToolResponse'),
    best,
    bestScore,
    callCount: counts[0],
    respCount: counts[1],
    lastEligibleCall:
      eligible === undefined ? undefined : { at: eligible, nameLen },
    aiWire: counts[2],
    unnamed: counts[3],
    nonAiElig: counts[4],
    mappedRef: (flags & MAPPED_BIT) !== 0 ? getU64(view, at, 'mappedRef') : 0,
  };
}
