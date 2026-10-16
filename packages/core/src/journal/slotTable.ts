/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  assertAllZero,
  getU64Big,
  putU32,
  putU64Big,
  viewOf,
  type Quad,
  type Triple,
} from './bytes.js';

/** Frozen for format version 3: they size every node (design 2.5 and 8.5). */
export const FORMAT_SLOTS = 3;
export const FAMILY_SLOTS = 4;
export const FORMAT_SLOT_BYTES = 32;
export const FAMILY_SLOT_BYTES = 16;
export const SLOT_TABLE_BYTES = 160;

const FORMAT = {
  formatKeyHash: 0,
  formatRev: 8,
  gen: 12,
  imageKeyHash: 16,
  imageGen: 24,
  padStart: 28,
};
const FAMILY = { familyKeyHash: 0, estimatorRev: 8, gen: 12 };
const FAMILY_TABLE_START = FORMAT_SLOTS * FORMAT_SLOT_BYTES;

/**
 * The design lists the fields of a slot and not their widths. Hashes are 64
 * bits and revisions and generations are 32 bits, which makes a format slot
 * 28 bytes plus 4 bytes of padding and a family slot exactly 16.
 */
export interface FormatSlot {
  readonly formatKeyHash: bigint;
  readonly formatRev: number;
  readonly gen: number;
  readonly imageKeyHash: bigint;
  readonly imageGen: number;
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
    base + FORMAT_SLOT_BYTES,
    'Format slot pad',
  );
  return {
    formatKeyHash: getU64Big(view, base + FORMAT.formatKeyHash),
    formatRev: view.getUint32(base + FORMAT.formatRev, true),
    gen: view.getUint32(base + FORMAT.gen, true),
    imageKeyHash: getU64Big(view, base + FORMAT.imageKeyHash),
    imageGen: view.getUint32(base + FORMAT.imageGen, true),
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
