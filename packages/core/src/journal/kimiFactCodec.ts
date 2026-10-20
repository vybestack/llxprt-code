/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { assertLength, putU16, putU32, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';
import {
  decodeUnitPositionValue,
  encodeUnitPositionValue,
  type UnitPosition,
} from './idEntryCodecs.js';

export const KIMI_AI_KEY = 'kimi:ai';
export const KIMI_FIELD = {
  calls: 2,
  responses: 3,
  counts: 4,
  last: 5,
  exception: 6,
} as const;
export const KIMI_FLAG = { eligible: 1, ai: 2, reconstructed: 4 } as const;

export interface KimiOccurrence {
  readonly position: UnitPosition;
  readonly eligibleWithinRow: number;
  readonly block: number;
  readonly flags: number;
}

export interface KimiCounts {
  readonly callCount: number;
  readonly eligibleCount: number;
  readonly aiCalls: number;
  readonly aiResponses: number;
  readonly otherResponses: number;
}

export const EMPTY_KIMI_COUNTS: KimiCounts = {
  callCount: 0,
  eligibleCount: 0,
  aiCalls: 0,
  aiResponses: 0,
  otherResponses: 0,
};

export function kimiKey(
  field: number,
  ordinal: number,
  identity: Uint8Array,
): Uint8Array {
  assertLength(identity, 16, 'Kimi raw identity');
  const bytes = new Uint8Array(21);
  bytes[0] = field;
  putU32(viewOf(bytes), 1, 'Kimi ordinal', ordinal);
  bytes.set(identity, 5);
  return bytes;
}

export function encodeKimiOccurrence(occurrence: KimiOccurrence): Uint8Array {
  if ((occurrence.flags & ~7) !== 0)
    throw new JournalFormatError('Invalid emitted Kimi flags');
  const bytes = new Uint8Array(20);
  bytes.set(encodeUnitPositionValue(occurrence.position));
  putU16(viewOf(bytes), 13, 'Kimi eligible rank', occurrence.eligibleWithinRow);
  putU32(viewOf(bytes), 15, 'Kimi source block', occurrence.block);
  bytes[19] = occurrence.flags;
  return bytes;
}

export function decodeKimiOccurrence(bytes: Uint8Array): KimiOccurrence {
  assertLength(bytes, 20, 'Emitted Kimi occurrence');
  if ((bytes[19] & ~7) !== 0)
    throw new JournalFormatError('Invalid emitted Kimi flags');
  return {
    position: decodeUnitPositionValue(bytes.subarray(0, 13)),
    eligibleWithinRow: viewOf(bytes).getUint16(13, true),
    block: viewOf(bytes).getUint32(15, true),
    flags: bytes[19],
  };
}

export function encodeKimiCounts(counts: KimiCounts): Uint8Array {
  const bytes = new Uint8Array(20);
  for (const [index, count] of [
    counts.callCount,
    counts.eligibleCount,
    counts.aiCalls,
    counts.aiResponses,
    counts.otherResponses,
  ].entries())
    putU32(viewOf(bytes), index * 4, 'Kimi count', count);
  return bytes;
}

export function decodeKimiCounts(bytes: Uint8Array): KimiCounts {
  assertLength(bytes, 20, 'Emitted Kimi counts');
  const view = viewOf(bytes);
  return {
    callCount: view.getUint32(0, true),
    eligibleCount: view.getUint32(4, true),
    aiCalls: view.getUint32(8, true),
    aiResponses: view.getUint32(12, true),
    otherResponses: view.getUint32(16, true),
  };
}
