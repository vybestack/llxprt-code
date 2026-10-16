/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { crc32 } from 'node:zlib';
import { JournalFormatError, JournalFrameError } from './errors.js';
import {
  BODY_CRC_BYTES,
  FRAME_HEAD_BYTES,
  decodeFrameStart,
  encodeFrameStart,
  frameLength,
  readFrameBody,
  readFrameHead,
  writeFrame,
} from './frame.js';
import {
  bufferReader,
  collect,
  collectingSink,
  splitInto,
} from './__tests__/support/memoryIo.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

const KIND = 0x01;

async function frameBytes(
  kindHeader: Uint8Array,
  body: Uint8Array | null,
  chunkSizes: readonly number[] = [4096],
): Promise<Uint8Array> {
  const out = collectingSink();
  await writeFrame(
    out.sink,
    KIND,
    kindHeader,
    body === null
      ? undefined
      : { length: body.length, chunks: splitInto(body, chunkSizes) },
  );
  return out.bytes();
}

async function readBack(
  bytes: Uint8Array,
  offset = 0,
): Promise<{ kindHeader: Uint8Array; body: Uint8Array }> {
  const reader = bufferReader(bytes);
  const head = await readFrameHead(reader, offset, bytes.length);
  return {
    kindHeader: head.kindHeader,
    body: await collect(readFrameBody(reader, head)),
  };
}

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
}

describe('frame layout', () => {
  it('is 16 bytes of head, the kind header, the body and a 4-byte body CRC', async () => {
    const kindHeader = new SeededRandom(1).bytes(21);
    const body = new SeededRandom(2).bytes(1000);
    const bytes = await frameBytes(kindHeader, body, [300]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    expect(FRAME_HEAD_BYTES).toBe(16);
    expect(BODY_CRC_BYTES).toBe(4);
    expect(frameLength(21, 1000)).toBe(16 + 21 + 1000 + 4);
    expect(bytes.length).toBe(frameLength(21, 1000));
    expect(bytes[0]).toBe(KIND);
    expect(bytes[1]).toBe(1);
    expect(view.getUint16(2, true)).toBe(21);
    expect(view.getBigUint64(4, true)).toBe(1000n);
    expect(view.getUint32(12, true)).toBe(
      crc32(kindHeader, crc32(bytes.subarray(0, 12))),
    );
    expect(Array.from(bytes.subarray(16, 37))).toStrictEqual(
      Array.from(kindHeader),
    );
    expect(Array.from(bytes.subarray(37, 1037))).toStrictEqual(
      Array.from(body),
    );
    expect(view.getUint32(1037, true)).toBe(crc32(body));
  });

  it('writes no body flag and a zero body CRC for a frame without a body', async () => {
    const kindHeader = new SeededRandom(3).bytes(30);
    const bytes = await frameBytes(kindHeader, null);

    expect(bytes[1]).toBe(0);
    expect(bytes.length).toBe(frameLength(30, 0));
    expect(Array.from(bytes.subarray(bytes.length - 4))).toStrictEqual([
      0, 0, 0, 0,
    ]);
    const back = await readBack(bytes);
    expect(Array.from(back.kindHeader)).toStrictEqual(Array.from(kindHeader));
    expect(back.body.length).toBe(0);
  });

  it('marks a present but empty body with the body flag', async () => {
    const bytes = await frameBytes(new Uint8Array(4), new Uint8Array(0));

    expect(bytes[1]).toBe(1);
    expect((await readBack(bytes)).body.length).toBe(0);
  });

  it('rejects a kind header longer than a u16 can describe', async () => {
    const out = collectingSink();

    await expect(
      writeFrame(out.sink, KIND, new Uint8Array(65536)),
    ).rejects.toThrow(JournalFormatError);
  });
});

describe('frame round trip', () => {
  it('reads back every body byte for assorted chunkings', async () => {
    const random = new SeededRandom(5);
    for (let round = 0; round < 40; round++) {
      const kindHeader = random.bytes(random.int(200));
      const body = random.bytes(random.int(5000));
      const chunkSizes = [1 + random.int(97), 1 + random.int(1300)];
      const bytes = await frameBytes(kindHeader, body, chunkSizes);

      const back = await readBack(bytes);

      expect(Array.from(back.kindHeader)).toStrictEqual(Array.from(kindHeader));
      expect(Array.from(back.body)).toStrictEqual(Array.from(body));
    }
  });

  it('reads a frame at a non-zero offset after other bytes', async () => {
    const prefix = new SeededRandom(6).bytes(77);
    const frame = await frameBytes(
      new Uint8Array([1, 2, 3]),
      new Uint8Array([9, 8, 7]),
    );

    const back = await readBack(Buffer.concat([prefix, frame]), 77);

    expect(Array.from(back.body)).toStrictEqual([9, 8, 7]);
  });

  it('has no 16 MiB ceiling', async () => {
    const body = new SeededRandom(8).bytes(17 * 1024 * 1024);
    const bytes = await frameBytes(new Uint8Array(8), body, [1024 * 1024]);

    const back = await readBack(bytes);

    expect(back.body.length).toBe(body.length);
    expect(Buffer.compare(back.body, body)).toBe(0);
  });

  it('carries a body length above 4 GiB in the 64-bit field', async () => {
    const bodyLen = 2 ** 40 + 5;
    const kindHeader = new Uint8Array([4, 5, 6]);
    const start = encodeFrameStart(KIND, kindHeader, bodyLen);
    const head = await readFrameHead(
      bufferReader(start),
      0,
      frameLength(3, bodyLen),
    );

    expect(head.bodyLen).toBe(bodyLen);
    expect(head.endOffset).toBe(frameLength(3, bodyLen));
  });

  it('round-trips a body that contains the sync marker bytes, also across chunk boundaries', async () => {
    const marker = new SeededRandom(9).bytes(8);
    const body = new Uint8Array(300);
    body.set(marker, 0);
    body.set(marker, 100);
    body.set(marker, 201);
    body.set(marker, 292);
    const bytes = await frameBytes(new Uint8Array(2), body, [102, 100, 99]);

    const back = await readBack(bytes);

    expect(Array.from(back.body)).toStrictEqual(Array.from(body));
  });
});

describe('frame validation', () => {
  it('detects every single bit flip in the head and kind header', async () => {
    const bytes = await frameBytes(
      new SeededRandom(12).bytes(40),
      new SeededRandom(13).bytes(64),
    );
    const protectedBytes = FRAME_HEAD_BYTES + 40;

    for (let bit = 0; bit < protectedBytes * 8; bit++) {
      const flipped = bytes.slice();
      flipped[bit >> 3] ^= 1 << (bit & 7);
      const error = await failureOf(() =>
        readFrameHead(bufferReader(flipped), 0, flipped.length),
      );
      expect(error).toBeInstanceOf(JournalFrameError);
      const code = error instanceof JournalFrameError ? error.code : '';
      expect(['does-not-fit', 'frame-crc-mismatch']).toContain(code);
    }
  });

  it('detects a bit flip in the body or in the stored body CRC while the body streams', async () => {
    const body = new SeededRandom(14).bytes(300);
    const bytes = await frameBytes(new Uint8Array(5), body, [64]);
    const bodyStart = FRAME_HEAD_BYTES + 5;

    for (const position of [
      bodyStart,
      bodyStart + 63,
      bodyStart + 64,
      bodyStart + 299,
      bodyStart + 300,
      bodyStart + 303,
    ]) {
      for (const mask of [0x01, 0x80]) {
        const flipped = bytes.slice();
        flipped[position] ^= mask;
        const reader = bufferReader(flipped);
        const head = await readFrameHead(reader, 0, flipped.length);

        const error = await failureOf(() =>
          collect(readFrameBody(reader, head, 64)),
        );

        expect(error).toBeInstanceOf(JournalFrameError);
        expect(error instanceof JournalFrameError && error.code).toBe(
          'body-crc-mismatch',
        );
      }
    }
  });

  it('names the frame offset in a failure', async () => {
    const frame = await frameBytes(new Uint8Array(3), new Uint8Array(10));
    const bytes = Buffer.concat([new Uint8Array(50), frame]);
    bytes[50 + 5] ^= 0x10;

    const error = await failureOf(() =>
      readFrameHead(bufferReader(bytes), 50, bytes.length),
    );

    expect(error instanceof JournalFrameError && error.offset).toBe(50);
  });

  it('calls a frame that does not fit in the file a torn tail, at every cut point', async () => {
    const frame = await frameBytes(
      new SeededRandom(15).bytes(25),
      new SeededRandom(16).bytes(40),
    );

    for (let size = 0; size < frame.length; size++) {
      const cut = frame.subarray(0, size);
      const error = await failureOf(() =>
        readFrameHead(bufferReader(cut), 0, size),
      );
      expect(error instanceof JournalFrameError && error.code).toBe(
        'does-not-fit',
      );
    }
  });

  it('rejects a body flag that disagrees with the body length, behind a valid frame CRC', () => {
    const head = new Uint8Array(16);
    const view = new DataView(head.buffer);
    head[0] = KIND;
    head[1] = 0;
    view.setUint16(2, 0, true);
    view.setBigUint64(4, 9n, true);
    view.setUint32(12, crc32(head.subarray(0, 12)), true);
    const record = Buffer.concat([head, new Uint8Array(9 + 4)]);

    expect(() => decodeFrameStart(record, 0)).toThrow(JournalFormatError);
  });

  it('rejects unknown frame flag bits, behind a valid frame CRC', () => {
    const head = new Uint8Array(16);
    const view = new DataView(head.buffer);
    head[0] = KIND;
    head[1] = 0b10;
    view.setUint32(12, crc32(head.subarray(0, 12)), true);
    const record = Buffer.concat([head, new Uint8Array(4)]);

    expect(() => decodeFrameStart(record, 0)).toThrow(JournalFormatError);
  });
});

describe('frame writing', () => {
  it('rejects a body that is shorter than the declared length', async () => {
    const out = collectingSink();

    await expect(
      writeFrame(out.sink, KIND, new Uint8Array(1), {
        length: 10,
        chunks: [new Uint8Array(4)],
      }),
    ).rejects.toThrow(/shorter/);
  });

  it('stops before writing the chunk that overruns the declared length', async () => {
    const out = collectingSink();

    await expect(
      writeFrame(out.sink, KIND, new Uint8Array(1), {
        length: 10,
        chunks: [new Uint8Array(8), new Uint8Array(8)],
      }),
    ).rejects.toThrow(/longer/);
    expect(out.bytes().length).toBe(FRAME_HEAD_BYTES + 1 + 8);
  });

  it('returns the number of bytes it wrote', async () => {
    const out = collectingSink();

    const written = await writeFrame(out.sink, KIND, new Uint8Array(7), {
      length: 3,
      chunks: [new Uint8Array(3)],
    });

    expect(written).toBe(frameLength(7, 3));
    expect(out.bytes().length).toBe(written);
  });
});
