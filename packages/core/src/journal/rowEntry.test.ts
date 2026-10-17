/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import {
  ENTRY_FLAG,
  ROW_ENTRY_BYTES,
  ROW_ENTRY_LAYOUT,
  ROW_ENTRY_NO_CHRONOLOGY_SEQ,
  decodeRowEntry,
  encodeRowEntryInto,
  type RowEntry,
} from './rowEntry.js';
import { ROW_FLAG } from './rowRecord.js';
import { assertContiguous } from './__tests__/support/layoutChecks.js';
import {
  TEST_KINDS,
  syntheticEntry,
} from './__tests__/support/rowTreeFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

function encode(entry: RowEntry): Uint8Array {
  const bytes = new Uint8Array(ROW_ENTRY_BYTES);
  encodeRowEntryInto(bytes, 0, entry);
  return bytes;
}

describe('row entry (design 3.2)', () => {
  it('is 1,112 bytes with the fields tiling it', () => {
    expect(ROW_ENTRY_BYTES).toBe(1112);
    assertContiguous(ROW_ENTRY_LAYOUT, 1112);
  });

  it('sizes each field group as the design table does', () => {
    const sizes = Object.fromEntries(
      Object.entries(ROW_ENTRY_LAYOUT).map(([name, span]) => [name, span.size]),
    );

    expect(sizes.label + sizes.recordOffset + sizes.recordLength).toBe(24);
    expect(
      sizes.speaker + sizes.flags + sizes.reconBlocks + sizes.answered,
    ).toBe(7);
    expect(
      sizes.chronologySeq +
        sizes.chronologyUserTurn +
        sizes.chronologyStep +
        sizes.chronologyRecordedAt,
    ).toBe(24);
    expect(sizes.owner + sizes.callBlocks + sizes.unmappedBlocks).toBe(8);
    expect(sizes.lensRef).toBe(24);
    expect(sizes.summary).toBe(888);
    expect(sizes.media).toBe(56);
    expect(sizes.tokens).toBe(48);
    expect(sizes.stamp).toBe(24);
  });

  it('round-trips random entries', () => {
    const random = new SeededRandom(21);
    for (let index = 0; index < 50; index++) {
      const entry = syntheticEntry(random, index, TEST_KINDS);

      expect(decodeRowEntry(encode(entry), 0)).toStrictEqual(entry);
    }
  });

  it('keeps the derived flag bits above the ROW flag bits', () => {
    const rowBits = Object.values(ROW_FLAG).reduce((all, bit) => all | bit, 0);

    expect(rowBits & ENTRY_FLAG.pairSensitive).toBe(0);
    expect(rowBits & ENTRY_FLAG.imageContrib).toBe(0);
    expect(ENTRY_FLAG.pairSensitive & ENTRY_FLAG.imageContrib).toBe(0);
  });

  it('decodes an entry that sits inside a larger buffer', () => {
    const random = new SeededRandom(22);
    const entry = syntheticEntry(random, 3, TEST_KINDS);
    const buffer = new Uint8Array(ROW_ENTRY_BYTES * 2 + 5);
    encodeRowEntryInto(buffer, 5 + ROW_ENTRY_BYTES, entry);

    expect(decodeRowEntry(buffer, 5 + ROW_ENTRY_BYTES)).toStrictEqual(entry);
  });

  it('stores no chronology seq as all ones', () => {
    const random = new SeededRandom(23);
    const entry: RowEntry = {
      ...syntheticEntry(random, 0, TEST_KINDS),
      chronologySeq: ROW_ENTRY_NO_CHRONOLOGY_SEQ,
    };

    expect(decodeRowEntry(encode(entry), 0).chronologySeq).toBe(
      0xffff_ffff_ffff_ffffn,
    );
  });

  it('refuses values that do not fit their fields', () => {
    const random = new SeededRandom(24);
    const base = syntheticEntry(random, 0, TEST_KINDS);

    expect(() => encode({ ...base, speaker: 3 })).toThrow(JournalFormatError);
    expect(() => encode({ ...base, flags: 1 << 13 })).toThrow(
      JournalFormatError,
    );
    expect(() => encode({ ...base, callBlocks: 65_536 })).toThrow(
      JournalFormatError,
    );
    expect(() => encode({ ...base, answered: 65_536 })).toThrow(
      JournalFormatError,
    );
    expect(() => encode({ ...base, label: 0n })).toThrow(JournalFormatError);
    expect(() =>
      encode({
        ...base,
        summary: [new Uint8Array(3), base.summary[1], base.summary[2]],
      }),
    ).toThrow(JournalFormatError);
  });

  it('refuses stored bytes that the format keeps zero', () => {
    const random = new SeededRandom(25);
    const bytes = encode(syntheticEntry(random, 0, TEST_KINDS));
    bytes[ROW_ENTRY_LAYOUT.pad.offset] = 1;

    expect(() => decodeRowEntry(bytes, 0)).toThrow(JournalFormatError);
  });

  it('refuses a buffer too short for an entry', () => {
    expect(() =>
      decodeRowEntry(new Uint8Array(ROW_ENTRY_BYTES - 1), 0),
    ).toThrow(JournalFormatError);
  });
});
