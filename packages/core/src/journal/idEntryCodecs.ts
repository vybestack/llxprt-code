/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  assertLength,
  getU64,
  getU64Big,
  putU8,
  putU32,
  putU64,
  putU64Big,
  viewOf,
} from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { BlockPosition } from './idFactCodec.js';
import { ID_HASH_BYTES } from './idTrieNode.js';

/** The unit a block is emitted in: row, part and the unit's index among the units that part emits (design 3.3). */
export interface UnitPosition {
  readonly label: bigint;
  readonly part: number;
  readonly unit: number;
}

/** The `k`-th occurrence of a raw id (namespace 4). */
export interface OccurrenceEntry {
  readonly at: BlockPosition;
  /** A call block with a non-empty id and a non-empty name. */
  readonly eligible: boolean;
  /** The unit holding the block is AI-speaker. */
  readonly ai: boolean;
}

const COUNT_BYTES = 4;
const UNIT_POSITION_BYTES = 13;
const OCCURRENCE_BYTES = 14;
const RELOCATION_BYTES = 8;
const FLAG_ELIGIBLE = 1;
const FLAG_AI = 2;

export function encodeCountValue(count: number): Uint8Array {
  const bytes = new Uint8Array(COUNT_BYTES);
  putU32(viewOf(bytes), 0, 'count', count);
  return bytes;
}

export function decodeCountValue(bytes: Uint8Array): number {
  assertLength(bytes, COUNT_BYTES, 'Count value');
  return viewOf(bytes).getUint32(0, true);
}

function assertPart(part: number): void {
  if (part !== 0 && part !== 1) {
    throw new JournalFormatError(`A row has parts 0 and 1, not ${part}`);
  }
}

export function encodeUnitPositionValue(position: UnitPosition): Uint8Array {
  assertPart(position.part);
  const bytes = new Uint8Array(UNIT_POSITION_BYTES);
  const view = viewOf(bytes);
  putU64Big(view, 0, 'label', position.label);
  putU8(view, 8, 'part', position.part);
  putU32(view, 9, 'unit', position.unit);
  return bytes;
}

export function decodeUnitPositionValue(bytes: Uint8Array): UnitPosition {
  assertLength(bytes, UNIT_POSITION_BYTES, 'Unit position value');
  const view = viewOf(bytes);
  const part = view.getUint8(8);
  assertPart(part);
  return {
    label: getU64Big(view, 0),
    part,
    unit: view.getUint32(9, true),
  };
}

export function encodeOccurrenceValue(entry: OccurrenceEntry): Uint8Array {
  assertPart(entry.at.part);
  const bytes = new Uint8Array(OCCURRENCE_BYTES);
  const view = viewOf(bytes);
  putU64Big(view, 0, 'label', entry.at.label);
  putU8(view, 8, 'part', entry.at.part);
  putU32(view, 9, 'block', entry.at.block);
  putU8(
    view,
    13,
    'flags',
    (entry.eligible ? FLAG_ELIGIBLE : 0) | (entry.ai ? FLAG_AI : 0),
  );
  return bytes;
}

export function decodeOccurrenceValue(bytes: Uint8Array): OccurrenceEntry {
  assertLength(bytes, OCCURRENCE_BYTES, 'Occurrence value');
  const view = viewOf(bytes);
  const part = view.getUint8(8);
  assertPart(part);
  const flags = view.getUint8(13);
  if ((flags & ~(FLAG_ELIGIBLE | FLAG_AI)) !== 0) {
    throw new JournalFormatError(
      `Occurrence flags ${flags} set a reserved bit`,
    );
  }
  return {
    at: { label: getU64Big(view, 0), part, block: view.getUint32(9, true) },
    eligible: (flags & FLAG_ELIGIBLE) !== 0,
    ai: (flags & FLAG_AI) !== 0,
  };
}

/** Namespaces 3 and 5 store a 128-bit hash. */
export function encodeHashValue(hash: Uint8Array): Uint8Array {
  assertLength(hash, ID_HASH_BYTES, 'Hash value');
  return hash.slice();
}

export function decodeHashValue(bytes: Uint8Array): Uint8Array {
  assertLength(bytes, ID_HASH_BYTES, 'Hash value');
  return bytes.slice();
}

/** Namespace 6: the offset the record has in the new file. */
export function encodeRelocationValue(newOffset: number): Uint8Array {
  const bytes = new Uint8Array(RELOCATION_BYTES);
  putU64(viewOf(bytes), 0, 'offset', newOffset);
  return bytes;
}

export function decodeRelocationValue(bytes: Uint8Array): number {
  assertLength(bytes, RELOCATION_BYTES, 'Relocation value');
  return getU64(viewOf(bytes), 0, 'offset');
}
