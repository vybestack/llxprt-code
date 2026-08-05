/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  parseImageDimensions,
  parseImageDimensionsFromBase64,
} from '../src/utils/imageDimensions.js';

// --- Fixture builders (pure bytes; no binary files committed) ---

function buildPng(width: number, height: number): Uint8Array {
  const buf = Buffer.alloc(8 + 4 + 4 + 13);
  // PNG signature
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  // IHDR length (13) big-endian
  buf.writeUInt32BE(13, 8);
  // IHDR chunk type
  buf.write('IHDR', 12, 'ascii');
  // width / height big-endian
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function buildGif(
  width: number,
  height: number,
  version: '87a' | '89a' = '89a',
): Uint8Array {
  const buf = Buffer.alloc(13);
  buf.write(`GIF${version}`, 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

/**
 * Build a minimal JPEG with a single optional APP segment before the SOF0.
 * `appPayloadSize` is the number of throwaway bytes inside the APP segment so
 * the marker-walking logic must skip a large EXIF-like block.
 */
function buildJpeg(
  width: number,
  height: number,
  appPayloadSize = 0,
): Uint8Array {
  const segments: Buffer[] = [];
  // SOI
  segments.push(Buffer.from([0xff, 0xd8]));
  // Optional APP1 segment with arbitrary payload (proves marker walking)
  if (appPayloadSize > 0) {
    const payload = Buffer.alloc(appPayloadSize, 0x42);
    const len = payload.length + 2; // length includes its own 2 bytes
    const header = Buffer.alloc(4);
    header[0] = 0xff;
    header[1] = 0xe1; // APP1
    header.writeUInt16BE(len, 2);
    segments.push(Buffer.concat([header, payload]));
  }
  // SOF0 (baseline): marker, length, precision, height, width, Nf, component
  const sofLen = 2 + 1 + 2 + 2 + 1 + 3; // len + precision + h + w + Nf + 1 comp(3)
  const sof = Buffer.alloc(2 + sofLen);
  sof[0] = 0xff;
  sof[1] = 0xc0; // SOF0
  sof.writeUInt16BE(sofLen, 2);
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5); // height
  sof.writeUInt16BE(width, 7); // width
  sof[9] = 1; // number of components
  segments.push(sof);
  // SOS marker (signals start of scan; walking must stop here)
  segments.push(Buffer.from([0xff, 0xda]));
  return Buffer.concat(segments);
}

/** Build a minimal WEBP with the given chunk FourCC. */
function buildWebp(
  fourCc: 'VP8 ' | 'VP8L' | 'VP8X',
  width: number,
  height: number,
): Uint8Array {
  // RIFF header (12 bytes) + chunk FourCC + chunk body.
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(0, 4); // file size placeholder
  buf.write('WEBP', 8, 'ascii');
  buf.write(fourCc, 12, 'ascii');

  if (fourCc === 'VP8 ') {
    buf.writeUInt32LE(10, 16); // chunk size
    // 3-byte frame tag occupies 20-22; the keyframe start code follows at 23-25.
    buf[20] = 0x9d;
    buf[21] = 0x01;
    buf[22] = 0x2a;
    buf[23] = 0x9d;
    buf[24] = 0x01;
    buf[25] = 0x2a;
    buf.writeUInt16LE(width & 0x3fff, 26);
    buf.writeUInt16LE(height & 0x3fff, 28);
  } else if (fourCc === 'VP8L') {
    buf.writeUInt32LE(5, 16); // chunk size
    buf[20] = 0x2f; // signature
    const w14 = (width - 1) & 0x3fff;
    const h14 = ((height - 1) & 0x3fff) << 14;
    buf.writeUInt32LE(w14 | h14, 21);
  } else {
    // VP8X
    buf.writeUInt32LE(10, 16); // chunk size
    // canvas width/height are stored as 24-bit LE (value = dimension - 1)
    const wMinus1 = width - 1;
    const hMinus1 = height - 1;
    buf[24] = wMinus1 & 0xff;
    buf[25] = (wMinus1 >> 8) & 0xff;
    buf[26] = (wMinus1 >> 16) & 0xff;
    buf[27] = hMinus1 & 0xff;
    buf[28] = (hMinus1 >> 8) & 0xff;
    buf[29] = (hMinus1 >> 16) & 0xff;
  }
  return buf;
}

describe('parseImageDimensions', () => {
  it('reads PNG dimensions from the IHDR header', () => {
    expect(parseImageDimensions(buildPng(640, 480))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('reads PNG dimensions for a large square', () => {
    expect(parseImageDimensions(buildPng(1092, 1092))).toEqual({
      width: 1092,
      height: 1092,
    });
  });

  it('reads JPEG baseline SOF0 dimensions', () => {
    expect(parseImageDimensions(buildJpeg(1024, 1024))).toEqual({
      width: 1024,
      height: 1024,
    });

    expect(parseImageDimensions(buildJpeg(2048, 4096))).toEqual({
      width: 2048,
      height: 4096,
    });
  });

  it('walks past a large APP1/EXIF segment to reach the SOF', () => {
    expect(parseImageDimensions(buildJpeg(800, 600, 2048))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('skips standalone markers (RSTn) without a length field', () => {
    // Insert a standalone RST0 (FF D0) before the SOF to prove the walker
    // advances past markers that carry no length.
    const soi = Buffer.from([0xff, 0xd8]);
    const rst = Buffer.from([0xff, 0xd0]);
    const rest = buildJpeg(512, 512).subarray(2); // drop our SOI
    expect(parseImageDimensions(Buffer.concat([soi, rst, rest]))).toEqual({
      width: 512,
      height: 512,
    });
  });

  it('reads GIF87a dimensions (little-endian)', () => {
    expect(parseImageDimensions(buildGif(320, 200, '87a'))).toEqual({
      width: 320,
      height: 200,
    });
  });

  it('reads GIF89a dimensions (little-endian)', () => {
    expect(parseImageDimensions(buildGif(256, 256, '89a'))).toEqual({
      width: 256,
      height: 256,
    });
  });

  it('reads WEBP lossy (VP8 ) dimensions', () => {
    expect(parseImageDimensions(buildWebp('VP8 ', 1280, 720))).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('reads WEBP lossless (VP8L) dimensions', () => {
    expect(parseImageDimensions(buildWebp('VP8L', 400, 300))).toEqual({
      width: 400,
      height: 300,
    });
  });

  it('reads WEBP extended (VP8X) dimensions', () => {
    expect(parseImageDimensions(buildWebp('VP8X', 1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('rejects a WEBP whose VP8 keyframe start code is corrupt', () => {
    const corrupt = Buffer.from(buildWebp('VP8 ', 1280, 720));
    corrupt[23] = 0x00;
    expect(parseImageDimensions(corrupt)).toBeUndefined();
  });

  it('returns undefined for a truncated PNG (missing IHDR)', () => {
    const truncated = buildPng(100, 100).subarray(0, 14);
    expect(parseImageDimensions(truncated)).toBeUndefined();
  });

  it('returns undefined for random bytes', () => {
    expect(parseImageDimensions(Buffer.alloc(64, 0xab))).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(parseImageDimensions(new Uint8Array(0))).toBeUndefined();
  });

  it('never throws for corrupt input that resembles a header', () => {
    const corrupt = Buffer.alloc(8, 0);
    expect(() => parseImageDimensions(corrupt)).not.toThrow();
  });
});

describe('parseImageDimensionsFromBase64', () => {
  it('decodes a plain base64 PNG payload', () => {
    const png = buildPng(100, 50);
    const b64 = Buffer.from(png).toString('base64');
    expect(parseImageDimensionsFromBase64(b64)).toEqual({
      width: 100,
      height: 50,
    });
  });

  it('strips a data: URI prefix', () => {
    const png = buildPng(64, 64);
    const b64 = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    expect(parseImageDimensionsFromBase64(b64)).toEqual({
      width: 64,
      height: 64,
    });
  });

  it('tolerates whitespace-wrapped base64', () => {
    const png = buildPng(48, 36);
    const raw = Buffer.from(png).toString('base64');
    const spaced = raw.replace(/(.{8})/g, '$1\n');
    expect(parseImageDimensionsFromBase64(spaced)).toEqual({
      width: 48,
      height: 36,
    });
  });

  it('returns undefined for invalid base64', () => {
    expect(parseImageDimensionsFromBase64('!!!not base64!!!')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseImageDimensionsFromBase64('')).toBeUndefined();
  });

  it('reads an unpadded base64 header without dropping its final bytes', () => {
    const gif = buildGif(320, 200);
    const unpadded = Buffer.from(gif).toString('base64').replace(/=+$/, '');
    expect(parseImageDimensionsFromBase64(unpadded)).toEqual({
      width: 320,
      height: 200,
    });
  });

  it('reads the header of a payload far larger than the decode bound', () => {
    const header = Buffer.from(buildPng(1024, 768));
    const huge = Buffer.concat([header, Buffer.alloc(2_000_000, 0x11)]);
    expect(parseImageDimensionsFromBase64(huge.toString('base64'))).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it('reads JPEG dimensions from a base64 payload with a large APP1', () => {
    const jpeg = buildJpeg(600, 450, 1024);
    const b64 = Buffer.from(jpeg).toString('base64');
    expect(parseImageDimensionsFromBase64(b64)).toEqual({
      width: 600,
      height: 450,
    });
  });
});
