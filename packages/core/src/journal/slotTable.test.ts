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
  type SlotTable,
} from './slotTable.js';
import { SUMMARY_KIND_CODE } from './slotSummary.js';
import { randomSlotTable } from './__tests__/support/randomRecords.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

describe('slot table', () => {
  it('holds 3 format slots of 40 bytes and 4 family slots of 16 bytes, 184 bytes in all', () => {
    expect(FORMAT_SLOTS).toBe(3);
    expect(FAMILY_SLOTS).toBe(4);
    expect(FORMAT_SLOT_BYTES).toBe(40);
    expect(FAMILY_SLOT_BYTES).toBe(16);
    expect(SLOT_TABLE_BYTES).toBe(184);
    expect(
      FORMAT_SLOTS * FORMAT_SLOT_BYTES + FAMILY_SLOTS * FAMILY_SLOT_BYTES,
    ).toBe(184);
  });

  it('writes the fields of each slot at fixed offsets', () => {
    const table = randomSlotTable(new SeededRandom(1));
    const bytes = new Uint8Array(SLOT_TABLE_BYTES);
    encodeSlotTableInto(bytes, 0, table);
    const view = new DataView(bytes.buffer);

    const second = table.formatSlots[1];
    expect(view.getBigUint64(40, true)).toBe(second.formatKeyHash);
    expect(view.getUint32(48, true)).toBe(second.formatRev);
    expect(view.getUint32(52, true)).toBe(second.gen);
    expect(view.getBigUint64(56, true)).toBe(second.imageKeyHash);
    expect(view.getUint32(64, true)).toBe(second.imageGen);
    expect(view.getUint8(68)).toBe(
      second.summaryKind === null ? 0 : SUMMARY_KIND_CODE[second.summaryKind],
    );
    expect(Array.from(bytes.subarray(69, 72))).toStrictEqual([0, 0, 0]);
    expect(view.getBigUint64(72, true)).toBe(BigInt(second.filledThrough));
    const third = table.familySlots[2];
    expect(view.getBigUint64(120 + 32, true)).toBe(third.familyKeyHash);
    expect(view.getUint32(120 + 40, true)).toBe(third.estimatorRev);
    expect(view.getUint32(120 + 44, true)).toBe(third.gen);
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

  it('records the summary kind of each format slot, 0 meaning an unassigned slot', () => {
    const base = randomSlotTable(new SeededRandom(4));
    const kinds = [
      ['anthropic', 1],
      ['chat', 2],
      ['responses', 3],
    ] as const;
    const table: SlotTable = {
      ...base,
      formatSlots: [
        { ...base.formatSlots[0], summaryKind: kinds[0][0] },
        { ...base.formatSlots[1], summaryKind: kinds[1][0] },
        { ...base.formatSlots[2], summaryKind: kinds[2][0] },
      ],
    };
    const bytes = new Uint8Array(SLOT_TABLE_BYTES);
    encodeSlotTableInto(bytes, 0, table);

    expect([bytes[28], bytes[68], bytes[108]]).toStrictEqual([1, 2, 3]);
    expect(
      decodeSlotTable(bytes, 0).formatSlots.map((s) => s.summaryKind),
    ).toStrictEqual(['anthropic', 'chat', 'responses']);
    bytes[28] = 0;
    expect(decodeSlotTable(bytes, 0).formatSlots[0].summaryKind).toBeNull();
  });

  it('rejects a summary kind code that is not 0 to 3', () => {
    const bytes = new Uint8Array(SLOT_TABLE_BYTES);
    encodeSlotTableInto(bytes, 0, randomSlotTable(new SeededRandom(5)));
    bytes[68] = 4;

    expect(() => decodeSlotTable(bytes, 0)).toThrow(/summary kind/);
  });
});
