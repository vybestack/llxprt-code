/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { JournalFormatError } from './errors.js';
import {
  BLOCK_DIR_ENTRY_BYTES,
  CHRONOLOGY_SEQ_NONE,
  ID_TUPLE_BYTES,
  MAX_ROW_HEADER_BYTES,
  ROW_FIXED_BYTES,
  ROW_FLAG,
  ROW_ID_KIND,
  ROW_SPEAKER,
  decodeIdPiece,
  decodeRowHeader,
  encodeIdPiece,
  encodeRowHeader,
  hashId,
  rowHeaderBytes,
  validateRowAgainstBody,
  type RowBlockEntry,
  type RowHeader,
  type RowIdTuple,
} from './rowRecord.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

const U64_MAX = (1n << 64n) - 1n;

function randomBlocks(random: SeededRandom, count: number): RowBlockEntry[] {
  return Array.from({ length: count }, () => ({
    offset: random.bits(53),
    length: random.bits(40),
    type: random.int(256),
  }));
}

function randomIds(
  random: SeededRandom,
  count: number,
  blocks: number,
): RowIdTuple[] {
  return Array.from({ length: count }, () => ({
    idHash: random.bytes(16),
    kind: random.int(2) === 0 ? ROW_ID_KIND.call : ROW_ID_KIND.response,
    block: random.mixed(Math.max(blocks, 1)),
    score: random.int(256),
    nameLen: random.mixed(65536),
  }));
}

function randomRow(random: SeededRandom): RowHeader {
  const blockCount = random.mixed(60);
  const idCount = random.mixed(60);
  return {
    label: random.int(5) === 0 ? U64_MAX : random.bigBits(64),
    owner: random.mixed(2 ** 32),
    speaker: random.int(3),
    flags: random.int(65536),
    idsLen: random.mixed(2 ** 32),
    metaLen: random.mixed(2 ** 32),
    chronologySeq:
      random.int(4) === 0 ? CHRONOLOGY_SEQ_NONE : random.bigBits(64),
    chronologyUserTurn: random.mixed(2 ** 32),
    chronologyStep: random.mixed(2 ** 32),
    chronologyRecordedAt: random.bits(53),
    parentEndpoint: random.int(3) === 0 ? 0n : random.bigBits(64),
    blocks: randomBlocks(random, blockCount),
    ids: randomIds(random, idCount, blockCount),
  };
}

function sampleRow(overrides: Partial<RowHeader> = {}): RowHeader {
  return {
    label: 1n << 20n,
    owner: 0,
    speaker: ROW_SPEAKER.ai,
    flags: 0,
    idsLen: 0,
    metaLen: 0,
    chronologySeq: CHRONOLOGY_SEQ_NONE,
    chronologyUserTurn: 0,
    chronologyStep: 0,
    chronologyRecordedAt: 0,
    parentEndpoint: 0n,
    blocks: [],
    ids: [],
    ...overrides,
  };
}

describe('ROW kind header', () => {
  it('has the field offsets of design section 2.4', () => {
    const row = sampleRow({
      label: 0x0102030405060708n,
      owner: 0x0a0b0c0d,
      speaker: ROW_SPEAKER.tool,
      flags: 0x0e0f,
      idsLen: 0x11121314,
      metaLen: 0x15161718,
      chronologySeq: 0x2122232425262728n,
      chronologyUserTurn: 0x31323334,
      chronologyStep: 0x41424344,
      chronologyRecordedAt: 0x0011525354555657,
      parentEndpoint: 0x6162636465666768n,
      blocks: [{ offset: 9, length: 10, type: 3 }],
      ids: [
        {
          idHash: new Uint8Array(16).fill(0x77),
          kind: ROW_ID_KIND.response,
          block: 0,
          score: 5,
          nameLen: 0x0102,
        },
      ],
    });
    const bytes = encodeRowHeader(row);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(view.getBigUint64(0, true)).toBe(row.label);
    expect(view.getUint32(8, true)).toBe(row.owner);
    expect(bytes[12]).toBe(2);
    expect(bytes[13]).toBe(0);
    expect(view.getUint16(14, true)).toBe(row.flags);
    expect(view.getUint16(16, true)).toBe(1);
    expect(view.getUint16(18, true)).toBe(1);
    expect(view.getUint32(20, true)).toBe(row.idsLen);
    expect(view.getUint32(24, true)).toBe(row.metaLen);
    expect(view.getBigUint64(28, true)).toBe(row.chronologySeq);
    expect(view.getUint32(36, true)).toBe(row.chronologyUserTurn);
    expect(view.getUint32(40, true)).toBe(row.chronologyStep);
    expect(view.getBigUint64(44, true)).toBe(BigInt(row.chronologyRecordedAt));
    expect(view.getBigUint64(52, true)).toBe(row.parentEndpoint);
    expect(view.getBigUint64(60, true)).toBe(9n);
    expect(view.getBigUint64(68, true)).toBe(10n);
    expect(bytes[76]).toBe(3);
    expect(Array.from(bytes.subarray(77, 93))).toStrictEqual(
      new Array(16).fill(0x77),
    );
    expect(bytes[93]).toBe(1);
    expect(view.getUint16(94, true)).toBe(0);
    expect(bytes[96]).toBe(5);
    expect(view.getUint16(97, true)).toBe(0x0102);
    expect(bytes.length).toBe(99);
  });

  it('has the encoded size 60 + 17 per block + 22 per id', () => {
    expect(ROW_FIXED_BYTES).toBe(60);
    expect(BLOCK_DIR_ENTRY_BYTES).toBe(17);
    expect(ID_TUPLE_BYTES).toBe(22);
    expect(encodeRowHeader(sampleRow()).length).toBe(60);
    const random = new SeededRandom(21);
    for (let round = 0; round < 50; round++) {
      const blockCount = random.int(40);
      const idCount = random.int(40);
      const row = sampleRow({
        blocks: randomBlocks(random, blockCount),
        ids: randomIds(random, idCount, blockCount),
      });
      expect(encodeRowHeader(row).length).toBe(
        60 + 17 * blockCount + 22 * idCount,
      );
      expect(rowHeaderBytes(blockCount, idCount)).toBe(
        60 + 17 * blockCount + 22 * idCount,
      );
    }
  });

  it('round-trips randomized rows', () => {
    const random = new SeededRandom(2026);
    for (let round = 0; round < 300; round++) {
      const row = randomRow(random);
      expect(decodeRowHeader(encodeRowHeader(row))).toStrictEqual(row);
    }
  });

  it('names the flag bits in the order of the design', () => {
    expect(ROW_FLAG).toStrictEqual({
      curated: 1 << 0,
      hasThinking: 1 << 1,
      hasToolCall: 1 << 2,
      hasToolResponse: 1 << 3,
      hasMedia: 1 << 4,
      hasImage: 1 << 5,
      hasCacheableBlock: 1 << 6,
      cacheAnchor: 1 << 7,
      synthetic: 1 << 8,
      invalidateResponses: 1 << 9,
      responseParent: 1 << 10,
    });
  });

  it('refuses a header that would not fit the u16 headerLen of the frame', () => {
    const blocks = randomBlocks(new SeededRandom(1), 3852);
    const fits = sampleRow({ blocks: blocks.slice(0, 3851) });

    expect(MAX_ROW_HEADER_BYTES).toBe(65535);
    expect(encodeRowHeader(fits).length).toBe(60 + 17 * 3851);
    expect(() => encodeRowHeader(sampleRow({ blocks }))).toThrow(
      JournalFormatError,
    );
  });

  it('refuses values that do not fit their field', () => {
    expect(() => encodeRowHeader(sampleRow({ owner: 2 ** 32 }))).toThrow(
      /owner/,
    );
    expect(() => encodeRowHeader(sampleRow({ label: -1n }))).toThrow(/label/);
    expect(() => encodeRowHeader(sampleRow({ label: 1n << 64n }))).toThrow(
      /label/,
    );
    expect(() => encodeRowHeader(sampleRow({ speaker: 3 }))).toThrow(/speaker/);
    expect(() => encodeRowHeader(sampleRow({ flags: 65536 }))).toThrow(/flags/);
    expect(() =>
      encodeRowHeader(
        sampleRow({
          ids: [
            {
              idHash: new Uint8Array(15),
              kind: 0,
              block: 0,
              score: 0,
              nameLen: 0,
            },
          ],
        }),
      ),
    ).toThrow(/idHash/);
  });

  it('rejects a header whose length disagrees with its counts', () => {
    const bytes = encodeRowHeader(
      sampleRow({ blocks: randomBlocks(new SeededRandom(2), 2) }),
    );

    expect(() => decodeRowHeader(bytes.subarray(0, bytes.length - 1))).toThrow(
      JournalFormatError,
    );
    expect(() =>
      decodeRowHeader(Buffer.concat([bytes, new Uint8Array(1)])),
    ).toThrow(JournalFormatError);
    expect(() => decodeRowHeader(bytes.subarray(0, 59))).toThrow(
      JournalFormatError,
    );
  });

  it('rejects nonzero reserved bytes, an unknown speaker and an unknown id kind', () => {
    const base = encodeRowHeader(
      sampleRow({
        ids: [
          {
            idHash: new Uint8Array(16),
            kind: 0,
            block: 0,
            score: 0,
            nameLen: 0,
          },
        ],
      }),
    );

    const reserved = base.slice();
    reserved[13] = 1;
    const speaker = base.slice();
    speaker[12] = 3;
    const kind = base.slice();
    kind[60 + 16] = 2;

    expect(() => decodeRowHeader(reserved)).toThrow(/reserved/);
    expect(() => decodeRowHeader(speaker)).toThrow(/speaker/);
    expect(() => decodeRowHeader(kind)).toThrow(/kind/);
  });
});

describe('ROW body', () => {
  it('accepts block ranges that lie after the id and metadata pieces', () => {
    const row = sampleRow({
      idsLen: 10,
      metaLen: 20,
      blocks: [
        { offset: 30, length: 5, type: 1 },
        { offset: 35, length: 0, type: 1 },
        { offset: 35, length: 15, type: 2 },
      ],
    });

    expect(() => validateRowAgainstBody(row, 50)).not.toThrow();
  });

  it('rejects pieces that run past the body, overlap the pieces or leave the body', () => {
    const base = sampleRow({ idsLen: 10, metaLen: 20 });

    expect(() => validateRowAgainstBody(base, 29)).toThrow(/pieces/);
    expect(() =>
      validateRowAgainstBody(
        { ...base, blocks: [{ offset: 29, length: 1, type: 0 }] },
        50,
      ),
    ).toThrow(/block 0/);
    expect(() =>
      validateRowAgainstBody(
        { ...base, blocks: [{ offset: 30, length: 21, type: 0 }] },
        50,
      ),
    ).toThrow(/block 0/);
  });
});

describe('id piece', () => {
  it('round-trips ids of 0, 1, 12, 40 and 100,000 bytes', () => {
    const ids = [0, 1, 12, 40, 100_000].map((length) => 'a'.repeat(length));

    const piece = encodeIdPiece(ids);

    expect(piece.length).toBe(ids.length * 4 + 0 + 1 + 12 + 40 + 100_000);
    expect(decodeIdPiece(piece, ids.length)).toStrictEqual(ids);
  });

  it('stores each id as a u32 length and UTF-8 bytes, so length is in bytes', () => {
    const piece = encodeIdPiece(['call_é']);
    const view = new DataView(piece.buffer, piece.byteOffset, piece.byteLength);

    expect(view.getUint32(0, true)).toBe(7);
    expect(new TextDecoder().decode(piece.subarray(4))).toBe('call_é');
  });

  it('round-trips random unicode ids', () => {
    const random = new SeededRandom(33);
    const alphabet = ['a', 'Z', '_', '-', '0', 'é', '日', '😀'];
    for (let round = 0; round < 100; round++) {
      const ids = Array.from({ length: random.int(12) }, () =>
        Array.from(
          { length: random.int(30) },
          () => alphabet[random.int(alphabet.length)],
        ).join(''),
      );
      expect(decodeIdPiece(encodeIdPiece(ids), ids.length)).toStrictEqual(ids);
    }
  });

  it('rejects the wrong id count, trailing bytes and truncated pieces', () => {
    const piece = encodeIdPiece(['one', 'two']);

    expect(() => decodeIdPiece(piece, 3)).toThrow(JournalFormatError);
    expect(() => decodeIdPiece(piece, 1)).toThrow(/trailing/);
    expect(() => decodeIdPiece(piece.subarray(0, piece.length - 1), 2)).toThrow(
      JournalFormatError,
    );
  });

  it('rejects ids that are not valid UTF-8 and strings that UTF-8 cannot carry', () => {
    const broken = new Uint8Array([1, 0, 0, 0, 0xff]);

    expect(() => decodeIdPiece(broken, 1)).toThrow(JournalFormatError);
    expect(() => encodeIdPiece(['bad\ud800'])).toThrow(JournalFormatError);
  });

  it('hashes an id to the first 128 bits of its SHA-256', () => {
    expect(Buffer.from(hashId('abc')).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223',
    );
    expect(Array.from(hashId('toolu_01A'))).toStrictEqual(
      Array.from(
        createHash('sha256').update('toolu_01A').digest().subarray(0, 16),
      ),
    );
  });
});
