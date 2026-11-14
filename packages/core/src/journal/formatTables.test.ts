/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { AGGREGATE_BYTES, AGGREGATE_LAYOUT } from './aggregate.js';
import {
  BODY_CRC_BYTES,
  FRAME_FLAG_BODY,
  FRAME_HEAD_BYTES,
  FRAME_HEAD_LAYOUT,
} from './frame.js';
import { MUTATION, RECORD_KIND } from './recordKinds.js';
import {
  BLOCK_DIR_ENTRY_BYTES,
  ID_TUPLE_BYTES,
  ROW_BLOCK_LAYOUT,
  ROW_FIXED_BYTES,
  ROW_FIXED_LAYOUT,
  ROW_FLAG,
  ROW_ID_KIND,
  ROW_ID_TUPLE_LAYOUT,
  ROW_SPEAKER,
} from './rowRecord.js';
import { SLOT_SUMMARY_LAYOUT, SUMMARY_KIND_CODE } from './slotSummary.js';
import {
  FAMILY_SLOT_BYTES,
  FAMILY_SLOT_LAYOUT,
  FORMAT_SLOT_BYTES,
  FORMAT_SLOT_LAYOUT,
} from './slotTable.js';
import {
  TRAILER_HEADER_BYTES,
  TRAILER_LAYOUT,
  TRAILER_RECORD_BYTES,
} from './trailerRecord.js';
import {
  designBits,
  designCodes,
  designFields,
  designTable,
} from './__tests__/support/designTables.js';

type Layout = Readonly<Record<string, { offset: number; size: number }>>;
type LayoutRow = [name: string, offset: number, size: number];

const SCALAR_TYPE = /^u(\d+)$/;
const ARRAY_TYPE = /^u(\d+)\[(\d+)\]$/;

/** The size a `uN` or `uN[k]` type must have, or `undefined` for a named structure. */
function sizeOfType(type: string): number | undefined {
  const scalar = SCALAR_TYPE.exec(type);
  if (scalar !== null) return Number(scalar[1]) / 8;
  const array = ARRAY_TYPE.exec(type);
  if (array !== null) return (Number(array[1]) / 8) * Number(array[2]);
  return undefined;
}

/** The documented fields in offset order, after checking they tile `totalBytes` and agree with their types. */
function documented(heading: string, totalBytes: number): LayoutRow[] {
  const fields = designFields(heading);
  let expectedOffset = 0;
  for (const field of fields) {
    expect({ field: field.name, offset: field.offset }).toStrictEqual({
      field: field.name,
      offset: expectedOffset,
    });
    const typeSize = sizeOfType(field.type);
    if (typeSize !== undefined) {
      expect({ field: field.name, size: field.size }).toStrictEqual({
        field: field.name,
        size: typeSize,
      });
    }
    expectedOffset += field.size;
  }
  expect(expectedOffset).toBe(totalBytes);
  return fields.map(({ name, offset, size }) => [name, offset, size]);
}

function fromCode(layout: Layout): LayoutRow[] {
  return Object.entries(layout)
    .map(([name, { offset, size }]): LayoutRow => [name, offset, size])
    .sort((left, right) => left[1] - right[1]);
}

describe('the codes and widths of design section 2.7', () => {
  it('match the frame head and the sizes derived from it', () => {
    expect(fromCode(FRAME_HEAD_LAYOUT)).toStrictEqual(
      documented('Frame head', FRAME_HEAD_BYTES),
    );
    expect(FRAME_HEAD_BYTES).toBe(20);
    expect(designBits('Frame flag bits')).toStrictEqual({
      'body present': FRAME_FLAG_BODY,
    });
    expect(TRAILER_RECORD_BYTES).toBe(
      FRAME_HEAD_BYTES + TRAILER_HEADER_BYTES + BODY_CRC_BYTES,
    );
  });

  it('match the record kind codes', () => {
    expect(designCodes('Record kinds')).toStrictEqual({ ...RECORD_KIND });
  });

  it('match the ROW fixed part, block directory entry and id tuple', () => {
    expect(fromCode(ROW_FIXED_LAYOUT)).toStrictEqual(
      documented('ROW fixed part', ROW_FIXED_BYTES),
    );
    expect(fromCode(ROW_BLOCK_LAYOUT)).toStrictEqual(
      documented('ROW block directory entry', BLOCK_DIR_ENTRY_BYTES),
    );
    expect(fromCode(ROW_ID_TUPLE_LAYOUT)).toStrictEqual(
      documented('ROW id tuple', ID_TUPLE_BYTES),
    );
  });

  it('match the ROW speaker codes, id kind codes and flag bits', () => {
    expect(designCodes('ROW speaker codes')).toStrictEqual({ ...ROW_SPEAKER });
    expect(designCodes('ROW id kind codes')).toStrictEqual({ ...ROW_ID_KIND });
    expect(designBits('ROW flag bits')).toStrictEqual({ ...ROW_FLAG });
  });

  it('match the trailer kind header and the mutation codes', () => {
    expect(fromCode(TRAILER_LAYOUT)).toStrictEqual(
      documented('Trailer kind header', TRAILER_HEADER_BYTES),
    );
    expect(designCodes('Mutation codes')).toStrictEqual({ ...MUTATION });
  });

  it('match the aggregate', () => {
    expect(fromCode(AGGREGATE_LAYOUT)).toStrictEqual(
      documented('Aggregate', AGGREGATE_BYTES),
    );
  });

  it('match the format slot, the family slot and the summary kind codes', () => {
    expect(fromCode(FORMAT_SLOT_LAYOUT)).toStrictEqual(
      documented('Format slot', FORMAT_SLOT_BYTES),
    );
    expect(fromCode(FAMILY_SLOT_LAYOUT)).toStrictEqual(
      documented('Family slot', FAMILY_SLOT_BYTES),
    );
    expect(designCodes('Summary kind codes')).toStrictEqual({
      unassigned: 0,
      ...SUMMARY_KIND_CODE,
    });
  });

  it('match the slot summary layout of every kind', () => {
    type KindLayout = {
      readonly states: number;
      readonly variantBytes: number;
      readonly variants: readonly number[];
      readonly bytes: number;
      readonly count: number;
      readonly out: number;
      readonly p?: number;
      readonly carry?: number;
      readonly r?: number;
      readonly cOut?: number;
      readonly lastL?: number;
    };
    const layouts: Readonly<Record<string, KindLayout>> = SLOT_SUMMARY_LAYOUT;
    const cell = (value: number | undefined): string =>
      value === undefined ? '-' : String(value);
    const fromCode = Object.entries(layouts).map(([kind, at]) => [
      kind,
      cell(at.states),
      cell(at.variantBytes),
      at.variants.join(', '),
      cell(at.bytes),
      cell(at.count),
      cell(at.out),
      cell(at.p),
      cell(at.carry),
      cell(at.r),
      cell(at.cOut),
      cell(at.lastL),
    ]);

    expect(designTable('Slot summary layout')).toStrictEqual(fromCode);
  });
});
