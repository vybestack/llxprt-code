/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  FAMILY_SLOTS,
  FAMILY_SLOT_BYTES,
  FORMAT_SLOTS,
  FORMAT_SLOT_BYTES,
  SLOT_TABLE_BYTES,
  decodeSlotTable,
  encodeSlotTableInto,
} from './slotTable.js';
import { randomSlotTable } from './__tests__/support/randomRecords.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

describe('slot table', () => {
  it('holds 3 format slots of 32 bytes and 4 family slots of 16 bytes, 160 bytes in all', () => {
    expect(FORMAT_SLOTS).toBe(3);
    expect(FAMILY_SLOTS).toBe(4);
    expect(FORMAT_SLOT_BYTES).toBe(32);
    expect(FAMILY_SLOT_BYTES).toBe(16);
    expect(SLOT_TABLE_BYTES).toBe(160);
    expect(
      FORMAT_SLOTS * FORMAT_SLOT_BYTES + FAMILY_SLOTS * FAMILY_SLOT_BYTES,
    ).toBe(160);
  });

  it('writes the fields of each slot at fixed offsets', () => {
    const table = randomSlotTable(new SeededRandom(1));
    const bytes = new Uint8Array(SLOT_TABLE_BYTES);
    encodeSlotTableInto(bytes, 0, table);
    const view = new DataView(bytes.buffer);

    const second = table.formatSlots[1];
    expect(view.getBigUint64(32, true)).toBe(second.formatKeyHash);
    expect(view.getUint32(40, true)).toBe(second.formatRev);
    expect(view.getUint32(44, true)).toBe(second.gen);
    expect(view.getBigUint64(48, true)).toBe(second.imageKeyHash);
    expect(view.getUint32(56, true)).toBe(second.imageGen);
    expect(view.getUint32(60, true)).toBe(0);
    const third = table.familySlots[2];
    expect(view.getBigUint64(96 + 32, true)).toBe(third.familyKeyHash);
    expect(view.getUint32(96 + 40, true)).toBe(third.estimatorRev);
    expect(view.getUint32(96 + 44, true)).toBe(third.gen);
  });

  it('round-trips randomized tables at an offset', () => {
    const random = new SeededRandom(2);
    for (let round = 0; round < 100; round++) {
      const table = randomSlotTable(random);
      const bytes = new Uint8Array(11 + SLOT_TABLE_BYTES);
      encodeSlotTableInto(bytes, 11, table);
      expect(decodeSlotTable(bytes, 11)).toStrictEqual(table);
    }
  });

  it('rejects a nonzero pad in a format slot', () => {
    const bytes = new Uint8Array(SLOT_TABLE_BYTES);
    encodeSlotTableInto(bytes, 0, randomSlotTable(new SeededRandom(3)));
    bytes[31] = 1;

    expect(() => decodeSlotTable(bytes, 0)).toThrow(/pad/);
  });
});
