/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { crc32 } from 'node:zlib';
import { JournalFormatError, JournalFrameError } from './errors.js';
import { encodeFrameStart } from './frame.js';
import { MUTATION, RECORD_KIND } from './recordKinds.js';
import {
  TRAILER_HEADER_BYTES,
  TRAILER_LAYOUT,
  TRAILER_RECORD_BYTES,
  decodeTrailerHeader,
  decodeTrailerRecord,
  encodeTrailerHeader,
  encodeTrailerRecord,
  type TrailerHeader,
} from './trailerRecord.js';
import { assertContiguous } from './__tests__/support/layoutChecks.js';
import { randomTrailer } from './__tests__/support/randomRecords.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

const SELF_OFFSET = 4096;

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function sampleTrailer(seed: number, selfOffset = SELF_OFFSET): TrailerHeader {
  const random = new SeededRandom(seed);
  return randomTrailer(random, selfOffset, random.bytes(8));
}

function isJournalFailure(run: () => unknown): boolean {
  try {
    run();
  } catch (error) {
    return (
      error instanceof JournalFrameError || error instanceof JournalFormatError
    );
  }
  return false;
}

function options(trailer: TrailerHeader, offset = SELF_OFFSET) {
  return { offset, syncMarker: trailer.syncMarker };
}

describe('trailer sizes', () => {
  it('is a 1,480-byte kind header in a 1,500-byte record', () => {
    const trailer = sampleTrailer(1);

    expect(TRAILER_HEADER_BYTES).toBe(1480);
    expect(TRAILER_RECORD_BYTES).toBe(1500);
    expect(encodeTrailerHeader(trailer).length).toBe(1480);
    expect(encodeTrailerRecord(trailer).length).toBe(1500);
  });

  it('lays out the fields contiguously with the sizes of design section 2.5', () => {
    assertContiguous(TRAILER_LAYOUT, 1480);
    expect(TRAILER_LAYOUT.rootAggregate.size).toBe(1144);
    expect(TRAILER_LAYOUT.slots.size).toBe(160);
    expect(TRAILER_LAYOUT.skip.size).toBe(24);
    expect(TRAILER_LAYOUT.syncMarker).toStrictEqual({ offset: 1472, size: 8 });
  });

  it('adds the slot table and the running fields up to the 1,480 the design states', () => {
    const beforeAggregate =
      8 + 8 + 8 + 24 + 8 + 8 + 8 + 16 + 4 * 8 + 3 * 8 + 8 + 8;

    expect(beforeAggregate).toBe(160);
    expect(beforeAggregate + 1144 + 160 + 8 + 8).toBe(1480);
  });
});

describe('trailer header', () => {
  it('puts each field at the offset the design order implies', () => {
    const trailer = sampleTrailer(2);
    const bytes = encodeTrailerHeader(trailer);
    const view = viewOf(bytes);

    expect(view.getBigUint64(0, true)).toBe(BigInt(trailer.selfOffset));
    expect(view.getBigUint64(8, true)).toBe(BigInt(trailer.commitSeq));
    expect(view.getBigUint64(16, true)).toBe(BigInt(trailer.parent));
    expect(view.getBigUint64(24, true)).toBe(BigInt(trailer.skip[0]));
    expect(view.getBigUint64(32, true)).toBe(BigInt(trailer.skip[1]));
    expect(view.getBigUint64(40, true)).toBe(BigInt(trailer.skip[2]));
    expect(view.getBigUint64(48, true)).toBe(trailer.lineage);
    expect(view.getBigUint64(56, true)).toBe(BigInt(trailer.lineageDepth));
    expect(bytes[64]).toBe(trailer.mutation);
    expect(view.getBigUint64(64, true) >> 8n).toBe(trailer.groupTag);
    expect(view.getBigUint64(72, true)).toBe(trailer.mutationArg0);
    expect(view.getBigUint64(80, true)).toBe(trailer.mutationArg1);
    expect(view.getBigUint64(88, true)).toBe(BigInt(trailer.rowRoot));
    expect(view.getBigUint64(96, true)).toBe(BigInt(trailer.idRoot));
    expect(view.getBigUint64(104, true)).toBe(BigInt(trailer.metaRoot));
    expect(view.getBigUint64(112, true)).toBe(BigInt(trailer.stateRoot));
    expect(view.getBigUint64(120, true)).toBe(trailer.nextLabel);
    expect(view.getBigUint64(128, true)).toBe(trailer.firstLabel);
    expect(view.getBigUint64(136, true)).toBe(BigInt(trailer.lastRowOffset));
    expect(view.getUint32(144, true)).toBe(trailer.lastOwner);
    expect(view.getUint32(148, true)).toBe(0);
    expect(view.getBigUint64(152, true)).toBe(BigInt(trailer.ckptBytes));
    expect(view.getUint32(160, true)).toBe(trailer.rootAggregate.rows);
    expect(view.getBigUint64(1304, true)).toBe(
      trailer.slots.formatSlots[0].formatKeyHash,
    );
    expect(view.getBigUint64(1400, true)).toBe(
      trailer.slots.familySlots[0].familyKeyHash,
    );
    expect(view.getBigUint64(1464, true)).toBe(BigInt(trailer.durableEnd));
    expect(Array.from(bytes.subarray(1472))).toStrictEqual(
      Array.from(trailer.syncMarker),
    );
  });

  it('keeps the group tag in the 7 bytes after the mutation byte', () => {
    const trailer: TrailerHeader = {
      ...sampleTrailer(3),
      mutation: MUTATION.pop,
      groupTag: 0x01020304050607n,
    };

    const bytes = encodeTrailerHeader(trailer);

    expect(Array.from(bytes.subarray(64, 72))).toStrictEqual([
      2, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  it('round-trips randomized trailers', () => {
    const random = new SeededRandom(2026);
    for (let round = 0; round < 200; round++) {
      const trailer = randomTrailer(random, random.bits(40), random.bytes(8));
      expect(decodeTrailerHeader(encodeTrailerHeader(trailer))).toStrictEqual(
        trailer,
      );
    }
  });

  it('refuses fields that do not fit', () => {
    const good = sampleTrailer(4);

    expect(() => encodeTrailerHeader({ ...good, groupTag: 1n << 56n })).toThrow(
      /groupTag/,
    );
    expect(() => encodeTrailerHeader({ ...good, lastOwner: 2 ** 32 })).toThrow(
      /lastOwner/,
    );
    expect(() => encodeTrailerHeader({ ...good, rowRoot: -1 })).toThrow(
      /rowRoot/,
    );
    expect(() =>
      encodeTrailerHeader({ ...good, syncMarker: new Uint8Array(7) }),
    ).toThrow(/syncMarker/);
  });

  it('rejects an unknown mutation code and nonzero padding', () => {
    const bytes = encodeTrailerHeader(sampleTrailer(5));
    const unknown = bytes.slice();
    unknown[64] = 99;
    const padded = bytes.slice();
    padded[149] = 1;

    expect(() => decodeTrailerHeader(unknown)).toThrow(/mutation/);
    expect(() => decodeTrailerHeader(padded)).toThrow(/padding/);
    expect(() => decodeTrailerHeader(bytes.subarray(0, 1479))).toThrow(
      JournalFormatError,
    );
  });
});

describe('trailer record', () => {
  it('is framed as kind 0x7f with no body, and ends with the sync marker then the CRC', () => {
    const trailer = sampleTrailer(6);
    const record = encodeTrailerRecord(trailer);
    const view = viewOf(record);

    expect(record[0]).toBe(RECORD_KIND.TRAILER);
    expect(record[1]).toBe(0);
    expect(view.getUint16(2, true)).toBe(1480);
    expect(view.getBigUint64(4, true)).toBe(0n);
    expect(view.getUint32(12, true)).toBe(
      crc32(record.subarray(16, 1496), crc32(record.subarray(0, 12))),
    );
    expect(Array.from(record.subarray(1488, 1496))).toStrictEqual(
      Array.from(trailer.syncMarker),
    );
    expect(view.getUint32(1496, true)).toBe(0);
  });

  it('round-trips randomized records at their own offset', () => {
    const random = new SeededRandom(7);
    for (let round = 0; round < 100; round++) {
      const offset = random.bits(40);
      const trailer = randomTrailer(random, offset, random.bytes(8));
      expect(
        decodeTrailerRecord(
          encodeTrailerRecord(trailer),
          options(trailer, offset),
        ),
      ).toStrictEqual(trailer);
    }
  });

  it('detects every single bit flip anywhere in the 1,500 bytes', () => {
    const trailer = sampleTrailer(8);
    const record = encodeTrailerRecord(trailer);

    for (let bit = 0; bit < TRAILER_RECORD_BYTES * 8; bit++) {
      const flipped = record.slice();
      flipped[bit >> 3] ^= 1 << (bit & 7);
      expect(
        isJournalFailure(() => decodeTrailerRecord(flipped, options(trailer))),
      ).toBe(true);
    }
  });

  it('reports a flip in the frame as a frame error', () => {
    const trailer = sampleTrailer(9);
    const record = encodeTrailerRecord(trailer);
    record[700] ^= 0x04;

    expect(() => decodeTrailerRecord(record, options(trailer))).toThrow(
      JournalFrameError,
    );
  });

  it('rejects a record that is not at the offset it names', () => {
    const trailer = sampleTrailer(10);
    const record = encodeTrailerRecord(trailer);

    expect(() =>
      decodeTrailerRecord(record, options(trailer, SELF_OFFSET + 8)),
    ).toThrow(/selfOffset/);
  });

  it('refuses to write a durableEnd that is not the end of the record', () => {
    const trailer = { ...sampleTrailer(11), durableEnd: SELF_OFFSET + 1499 };

    expect(() => encodeTrailerRecord(trailer)).toThrow(/durableEnd/);
  });

  it('rejects a durableEnd that is not the end of the record, behind a valid frame CRC', () => {
    const trailer = { ...sampleTrailer(11), durableEnd: SELF_OFFSET + 1499 };
    const record = new Uint8Array(TRAILER_RECORD_BYTES);
    record.set(
      encodeFrameStart(RECORD_KIND.TRAILER, encodeTrailerHeader(trailer), null),
    );

    expect(() => decodeTrailerRecord(record, options(trailer))).toThrow(
      /durableEnd/,
    );
  });

  it('rejects a record whose sync marker is not the file marker', () => {
    const trailer = sampleTrailer(12);
    const record = encodeTrailerRecord(trailer);

    expect(() =>
      decodeTrailerRecord(record, {
        offset: SELF_OFFSET,
        syncMarker: new Uint8Array(8).fill(1),
      }),
    ).toThrow(/syncMarker/);
  });

  it('rejects a record that is not 1,500 bytes', () => {
    const trailer = sampleTrailer(13);
    const record = encodeTrailerRecord(trailer);

    expect(() =>
      decodeTrailerRecord(record.subarray(0, 1499), options(trailer)),
    ).toThrow(/1500/);
  });
});
