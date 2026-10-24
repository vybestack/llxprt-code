/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  assertAllZero,
  getU64,
  getU64Big,
  putU8,
  putU32,
  putU64,
  putU64Big,
  span,
  viewOf,
  type Quad,
  type Triple,
} from './bytes.js';
import { JournalFormatError } from './errors.js';
import { SUMMARY_KIND_CODE, type SummaryKind } from './slotSummary.js';

/** Frozen for format version 3: they size every node (design 2.5 and 8.5). */
export const FORMAT_SLOTS = 3;
export const FAMILY_SLOTS = 4;
export const FORMAT_SLOT_BYTES = 40;
export const FAMILY_SLOT_BYTES = 16;
export const SLOT_TABLE_BYTES = 184;

/** Offsets inside one format slot (design 2.7); bytes 29 to 31 are zero. */
export const FORMAT_SLOT_LAYOUT = {
  formatKeyHash: span(0, 8),
  formatRev: span(8, 4),
  gen: span(12, 4),
  imageKeyHash: span(16, 8),
  imageGen: span(24, 4),
  summaryKind: span(28, 1),
  pad: span(29, 3),
  filledThrough: span(32, 8),
};
/** Offsets inside one family slot (design 2.7). */
export const FAMILY_SLOT_LAYOUT = {
  familyKeyHash: span(0, 8),
  estimatorRev: span(8, 4),
  gen: span(12, 4),
};
const FORMAT = {
  formatKeyHash: FORMAT_SLOT_LAYOUT.formatKeyHash.offset,
  formatRev: FORMAT_SLOT_LAYOUT.formatRev.offset,
  gen: FORMAT_SLOT_LAYOUT.gen.offset,
  imageKeyHash: FORMAT_SLOT_LAYOUT.imageKeyHash.offset,
  imageGen: FORMAT_SLOT_LAYOUT.imageGen.offset,
  summaryKind: FORMAT_SLOT_LAYOUT.summaryKind.offset,
  padStart: FORMAT_SLOT_LAYOUT.pad.offset,
  filledThrough: FORMAT_SLOT_LAYOUT.filledThrough.offset,
};
const FAMILY = {
  familyKeyHash: FAMILY_SLOT_LAYOUT.familyKeyHash.offset,
  estimatorRev: FAMILY_SLOT_LAYOUT.estimatorRev.offset,
  gen: FAMILY_SLOT_LAYOUT.gen.offset,
};
const KIND_OF_CODE: ReadonlyMap<number, SummaryKind> = new Map([
  [SUMMARY_KIND_CODE.anthropic, 'anthropic'],
  [SUMMARY_KIND_CODE.chat, 'chat'],
  [SUMMARY_KIND_CODE.responses, 'responses'],
]);
const UNASSIGNED_KIND_CODE = 0;
const FAMILY_TABLE_START = FORMAT_SLOTS * FORMAT_SLOT_BYTES;

/**
 * The design lists the fields of a slot and not their widths. Hashes are 64
 * bits and revisions and generations are 32 bits, which makes a format slot
 * 28 bytes, the 1-byte summary kind and 3 bytes of padding, and a family slot
 * exactly 16. `summaryKind` is the format of the transfer summary the slot
 * holds in every aggregate, and `null` is a slot not yet assigned a format.
 */
export interface FormatSlot {
  readonly formatKeyHash: bigint;
  readonly formatRev: number;
  readonly gen: number;
  readonly imageKeyHash: bigint;
  readonly imageGen: number;
  readonly summaryKind: SummaryKind | null;
  readonly filledThrough: number;
}

export interface FamilySlot {
  readonly familyKeyHash: bigint;
  readonly estimatorRev: number;
  readonly gen: number;
}

export interface SlotTable {
  readonly formatSlots: Triple<FormatSlot>;
  readonly familySlots: Quad<FamilySlot>;
}

function encodeFormatSlot(
  view: DataView,
  base: number,
  slot: FormatSlot,
): void {
  putU64Big(
    view,
    base + FORMAT.formatKeyHash,
    'formatKeyHash',
    slot.formatKeyHash,
  );
  putU32(view, base + FORMAT.formatRev, 'formatRev', slot.formatRev);
  putU32(view, base + FORMAT.gen, 'format slot gen', slot.gen);
  putU64Big(
    view,
    base + FORMAT.imageKeyHash,
    'imageKeyHash',
    slot.imageKeyHash,
  );
  putU32(view, base + FORMAT.imageGen, 'imageGen', slot.imageGen);
  putU64(
    view,
    base + FORMAT.filledThrough,
    'filledThrough',
    slot.filledThrough,
  );
  putU8(
    view,
    base + FORMAT.summaryKind,
    'summaryKind',
    slot.summaryKind === null
      ? UNASSIGNED_KIND_CODE
      : SUMMARY_KIND_CODE[slot.summaryKind],
  );
}

function encodeFamilySlot(
  view: DataView,
  base: number,
  slot: FamilySlot,
): void {
  putU64Big(
    view,
    base + FAMILY.familyKeyHash,
    'familyKeyHash',
    slot.familyKeyHash,
  );
  putU32(view, base + FAMILY.estimatorRev, 'estimatorRev', slot.estimatorRev);
  putU32(view, base + FAMILY.gen, 'family slot gen', slot.gen);
}

export function encodeSlotTableInto(
  target: Uint8Array,
  offset: number,
  table: SlotTable,
): void {
  const view = viewOf(target);
  table.formatSlots.forEach((slot, index) =>
    encodeFormatSlot(view, offset + index * FORMAT_SLOT_BYTES, slot),
  );
  table.familySlots.forEach((slot, index) =>
    encodeFamilySlot(
      view,
      offset + FAMILY_TABLE_START + index * FAMILY_SLOT_BYTES,
      slot,
    ),
  );
}

function decodeFormatSlot(
  source: Uint8Array,
  view: DataView,
  base: number,
): FormatSlot {
  assertAllZero(
    source,
    base + FORMAT.padStart,
    base + FORMAT_SLOT_LAYOUT.pad.offset + FORMAT_SLOT_LAYOUT.pad.size,
    'Format slot pad',
  );
  const kindCode = view.getUint8(base + FORMAT.summaryKind);
  const summaryKind =
    kindCode === UNASSIGNED_KIND_CODE ? null : KIND_OF_CODE.get(kindCode);
  if (summaryKind === undefined) {
    throw new JournalFormatError(
      `Format slot summary kind code ${kindCode} is not 0 to 3`,
    );
  }
  return {
    formatKeyHash: getU64Big(view, base + FORMAT.formatKeyHash),
    formatRev: view.getUint32(base + FORMAT.formatRev, true),
    gen: view.getUint32(base + FORMAT.gen, true),
    imageKeyHash: getU64Big(view, base + FORMAT.imageKeyHash),
    imageGen: view.getUint32(base + FORMAT.imageGen, true),
    summaryKind,
    filledThrough: getU64(view, base + FORMAT.filledThrough, 'filledThrough'),
  };
}

function decodeFamilySlot(view: DataView, base: number): FamilySlot {
  return {
    familyKeyHash: getU64Big(view, base + FAMILY.familyKeyHash),
    estimatorRev: view.getUint32(base + FAMILY.estimatorRev, true),
    gen: view.getUint32(base + FAMILY.gen, true),
  };
}

export function decodeSlotTable(source: Uint8Array, offset: number): SlotTable {
  const view = viewOf(source);
  const format = (index: number): FormatSlot =>
    decodeFormatSlot(source, view, offset + index * FORMAT_SLOT_BYTES);
  const family = (index: number): FamilySlot =>
    decodeFamilySlot(
      view,
      offset + FAMILY_TABLE_START + index * FAMILY_SLOT_BYTES,
    );
  return {
    formatSlots: [format(0), format(1), format(2)],
    familySlots: [family(0), family(1), family(2), family(3)],
  };
}
