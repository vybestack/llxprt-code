/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { crc32 } from 'node:zlib';
import {
  JOURNAL_FORMAT_VERSION,
  JOURNAL_HEADER_BYTES,
  JOURNAL_MAGIC,
  createJournalHeader,
  decodeJournalHeader,
  encodeJournalHeader,
  type JournalHeader,
} from './fileHeader.js';
import { JournalFormatError } from './errors.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

function sampleHeader(seed: number): JournalHeader {
  const random = new SeededRandom(seed);
  return {
    fileId: random.bytes(16),
    syncMarker: random.bytes(8),
    createdAtMs: random.bits(48),
  };
}

describe('journal file header', () => {
  it('is 64 bytes with the layout of design section 2.1', () => {
    const header = sampleHeader(1);
    const bytes = encodeJournalHeader(header);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(JOURNAL_HEADER_BYTES).toBe(64);
    expect(bytes.length).toBe(64);
    expect(new TextDecoder().decode(bytes.subarray(0, 7))).toBe('LLXJRNL');
    expect(bytes[7]).toBe(0);
    expect(Array.from(JOURNAL_MAGIC)).toStrictEqual(
      Array.from(bytes.subarray(0, 8)),
    );
    expect(view.getUint32(8, true)).toBe(5);
    expect(JOURNAL_FORMAT_VERSION).toBe(5);
    expect(view.getUint32(12, true)).toBe(0);
    expect(Array.from(bytes.subarray(16, 32))).toStrictEqual(
      Array.from(header.fileId),
    );
    expect(Array.from(bytes.subarray(32, 40))).toStrictEqual(
      Array.from(header.syncMarker),
    );
    expect(Number(view.getBigUint64(40, true))).toBe(header.createdAtMs);
    expect(Array.from(bytes.subarray(48, 60))).toStrictEqual(
      new Array(12).fill(0),
    );
    expect(view.getUint32(60, true)).toBe(crc32(bytes.subarray(0, 60)));
  });

  it('refuses version 3 headers even with a valid CRC because they lack contribution metadata', () => {
    const bytes = encodeJournalHeader(sampleHeader(19));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(8, 3, true);
    view.setUint32(60, crc32(bytes.subarray(0, 60)), true);
    expect(() => decodeJournalHeader(bytes)).toThrow('format version mismatch');
  });

  it('refuses version 4 journals whose normalized namespaces were not maintained', () => {
    const bytes = encodeJournalHeader(sampleHeader(20));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(8, 4, true);
    view.setUint32(60, crc32(bytes.subarray(0, 60)), true);
    expect(() => decodeJournalHeader(bytes)).toThrow('format version mismatch');
  });

  it('round-trips random headers', () => {
    for (let seed = 0; seed < 100; seed++) {
      const header = sampleHeader(seed);
      expect(decodeJournalHeader(encodeJournalHeader(header))).toStrictEqual(
        header,
      );
    }
  });

  it('detects every single bit flip', () => {
    const bytes = encodeJournalHeader(sampleHeader(7));

    for (let bit = 0; bit < JOURNAL_HEADER_BYTES * 8; bit++) {
      const flipped = bytes.slice();
      flipped[bit >> 3] ^= 1 << (bit & 7);
      expect(() => decodeJournalHeader(flipped)).toThrow(JournalFormatError);
    }
  });

  it('rejects a header that is not exactly 64 bytes', () => {
    const bytes = encodeJournalHeader(sampleHeader(3));

    expect(() => decodeJournalHeader(bytes.subarray(0, 63))).toThrow(
      /64 bytes/,
    );
    expect(() => decodeJournalHeader(new Uint8Array(65))).toThrow(/64 bytes/);
  });

  it('refuses to encode a malformed header', () => {
    const good = sampleHeader(4);

    expect(() =>
      encodeJournalHeader({ ...good, fileId: new Uint8Array(15) }),
    ).toThrow(/fileId/);
    expect(() =>
      encodeJournalHeader({ ...good, syncMarker: new Uint8Array(9) }),
    ).toThrow(/syncMarker/);
    expect(() => encodeJournalHeader({ ...good, createdAtMs: -1 })).toThrow(
      /createdAtMs/,
    );
  });

  it('creates headers with fresh random identity and the clock time', () => {
    const first = createJournalHeader(() => 1_700_000_000_123);
    const second = createJournalHeader(() => 1_700_000_000_123);

    expect(first.fileId.length).toBe(16);
    expect(first.syncMarker.length).toBe(8);
    expect(first.createdAtMs).toBe(1_700_000_000_123);
    expect(Array.from(first.fileId)).not.toStrictEqual(
      Array.from(second.fileId),
    );
    expect(Array.from(first.syncMarker)).not.toStrictEqual(
      Array.from(second.syncMarker),
    );
  });
});
