/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3216 — Behavioral tests for the shared image dimension/pixel budget
 * checker used by every built-in image-producing tool. Uses real image bytes
 * generated with sharp so header parsing is exercised, not mocked.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  resolveImageDimensionBudget,
  checkImageDimensionBudget,
  checkImageDimensionBudgetFromBuffer,
  checkImageFileDimensionBudget,
  checkImageFileBudgetMessage,
  formatImageBudgetError,
  formatImageBudgetDisplay,
  type ImageDimensionBudget,
} from './imageDimensionBudget.js';
import {
  parseJpegDimensionsFromReader,
  JPEG_SEGMENT_MAX_STEPS,
  type JpegSegmentReader,
} from './imageDimensions.js';

async function pngBase64(width: number, height: number): Promise<string> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 80, g: 120, b: 160, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  return buffer.toString('base64');
}

async function pngBytes(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 80, g: 120, b: 160, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe('resolveImageDimensionBudget (@issue:3216)', () => {
  it('returns undefined when no budget keys are set', () => {
    expect(resolveImageDimensionBudget({})).toBeUndefined();
    expect(resolveImageDimensionBudget({ other: 1 })).toBeUndefined();
  });

  it('reads max-image-dimension only', () => {
    const budget = resolveImageDimensionBudget({
      'max-image-dimension': 2000,
    });
    expect(budget).toEqual({ maxDimension: 2000 });
  });

  it('reads max-image-pixels only', () => {
    const budget = resolveImageDimensionBudget({
      'max-image-pixels': 4_000_000,
    });
    expect(budget).toEqual({ maxPixels: 4_000_000 });
  });

  it('reads both keys together', () => {
    const budget = resolveImageDimensionBudget({
      'max-image-dimension': 2000,
      'max-image-pixels': 4_000_000,
    });
    expect(budget).toEqual({ maxDimension: 2000, maxPixels: 4_000_000 });
  });

  it('throws on non-positive-integer values (fail fast)', () => {
    expect(() =>
      resolveImageDimensionBudget({ 'max-image-dimension': 0 }),
    ).toThrow(/positive integer/);
    expect(() =>
      resolveImageDimensionBudget({ 'max-image-dimension': -5 }),
    ).toThrow(/positive integer/);
    expect(() =>
      resolveImageDimensionBudget({ 'max-image-dimension': 1.5 }),
    ).toThrow(/positive integer/);
    expect(() =>
      resolveImageDimensionBudget({ 'max-image-pixels': 'big' }),
    ).toThrow(/positive integer/);
  });
});

describe('checkImageDimensionBudget (@issue:3216)', () => {
  it('passes an image below the dimension budget', async () => {
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    const data = await pngBase64(1800, 1800);
    expect(checkImageDimensionBudget(data, budget)).toBeUndefined();
  });

  it('passes an image exactly at the dimension boundary (inclusive)', async () => {
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    const data = await pngBase64(2000, 2000);
    expect(checkImageDimensionBudget(data, budget)).toBeUndefined();
  });

  it('flags an oversized width dimension', async () => {
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    const data = await pngBase64(3000, 1000);
    const violation = checkImageDimensionBudget(data, budget);
    expect(violation).toBeDefined();
    expect(violation!.width).toBe(3000);
    expect(violation!.height).toBe(1000);
    expect(violation!.exceededDimension).toBe(true);
    expect(violation!.exceededPixels).toBe(false);
    expect(violation!.maxDimension).toBe(2000);
  });

  it('flags an oversized height dimension', async () => {
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    const data = await pngBase64(1000, 3000);
    const violation = checkImageDimensionBudget(data, budget);
    expect(violation).toBeDefined();
    expect(violation!.height).toBe(3000);
    expect(violation!.exceededDimension).toBe(true);
  });

  it('flags an oversized total pixel count within the dimension budget', async () => {
    const budget: ImageDimensionBudget = {
      maxDimension: 2000,
      maxPixels: 3_000_000,
    };
    const data = await pngBase64(2000, 2000); // 4,000,000 pixels
    const violation = checkImageDimensionBudget(data, budget);
    expect(violation).toBeDefined();
    expect(violation!.pixels).toBe(4_000_000);
    expect(violation!.exceededPixels).toBe(true);
    expect(violation!.exceededDimension).toBe(false);
    expect(violation!.maxPixels).toBe(3_000_000);
  });

  it('returns undefined for unparseable/non-image bytes (never invents dimensions)', () => {
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    expect(checkImageDimensionBudget('', budget)).toBeUndefined();
    expect(
      checkImageDimensionBudget('not-an-image-at-all', budget),
    ).toBeUndefined();
  });
});

describe('formatImageBudgetError (@issue:3216)', () => {
  it('includes actual dimensions, the exceeded budget, and thumbnail/downscale guidance', () => {
    const violation = {
      width: 3000,
      height: 2000,
      pixels: 6_000_000,
      maxDimension: 2000,
      maxPixels: undefined,
      exceededDimension: true,
      exceededPixels: false,
    };
    const message = formatImageBudgetError(violation, 'big.png');
    expect(message).toContain('3000');
    expect(message).toContain('2000');
    expect(message).toContain('2000');
    expect(message).toContain('big.png');
    expect(/thumbnail|downscal|resize/i.test(message)).toBe(true);
  });

  it('mentions pixel budget when that was the exceeded dimension', () => {
    const violation = {
      width: 2000,
      height: 2000,
      pixels: 4_000_000,
      maxDimension: 2000,
      maxPixels: 3_000_000,
      exceededDimension: false,
      exceededPixels: true,
    };
    const message = formatImageBudgetError(violation);
    expect(message).toContain('4,000,000');
    expect(message).toContain('3,000,000');
  });
});

describe('checkImageDimensionBudgetFromBuffer vs base64 checker (@issue:3216)', () => {
  // The buffer entry point must have identical boundary behavior to the
  // base64 checker so the file path avoids base64-encoding the full payload.
  const budgets = {
    none: undefined,
    dimensionOnly: { maxDimension: 2000 } as ImageDimensionBudget,
    pixelsOnly: { maxPixels: 3_000_000 } as ImageDimensionBudget,
    both: {
      maxDimension: 2000,
      maxPixels: 3_000_000,
    } as ImageDimensionBudget,
  };

  it.each([
    ['below budget', 1800, 1800, budgets.dimensionOnly],
    ['exactly at dimension boundary', 2000, 2000, budgets.dimensionOnly],
    ['oversized width', 3000, 1000, budgets.dimensionOnly],
    ['oversized height', 1000, 3000, budgets.dimensionOnly],
    ['pixels-only violation', 2000, 2000, budgets.pixelsOnly],
    ['both boundaries set', 2000, 2000, budgets.both],
  ] as const)(
    'produces identical result for %s',
    async (_label, w, h, budget) => {
      const bytes = await pngBytes(w, h);
      const base64 = bytes.toString('base64');
      const fromBuffer = checkImageDimensionBudgetFromBuffer(bytes, budget);
      const fromBase64 = checkImageDimensionBudget(base64, budget);
      expect(fromBuffer).toEqual(fromBase64);
    },
  );

  it('returns undefined for empty bytes (matches base64 empty)', () => {
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    expect(
      checkImageDimensionBudgetFromBuffer(new Uint8Array(0), budget),
    ).toBeUndefined();
    expect(checkImageDimensionBudget('', budget)).toBeUndefined();
  });

  it('returns undefined for unparseable bytes (matches base64)', () => {
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    const junk = new Uint8Array([1, 2, 3, 4, 5]);
    expect(checkImageDimensionBudgetFromBuffer(junk, budget)).toBeUndefined();
    expect(
      checkImageDimensionBudget('not-an-image-at-all', budget),
    ).toBeUndefined();
  });

  it('accepts a Uint8Array view over the same buffer', async () => {
    const budget: ImageDimensionBudget = { maxDimension: 2000 };
    const bytes = await pngBytes(3000, 2000);
    const view = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    const fromView = checkImageDimensionBudgetFromBuffer(view, budget);
    const fromBase64 = checkImageDimensionBudget(
      bytes.toString('base64'),
      budget,
    );
    expect(fromView).toEqual(fromBase64);
    expect(fromView).toBeDefined();
  });
});

describe('formatImageBudgetDisplay (@issue:3216)', () => {
  it('wraps a message in the shared dimension-limit heading', () => {
    const message = 'Image big.png is 3000x3000 pixels (9,000,000 total).';
    const display = formatImageBudgetDisplay(message);
    expect(display).toBe(`## Image Dimension Limit

${message}`);
    expect(display.startsWith('## Image Dimension Limit')).toBe(true);
  });
});

/**
 * Build a raw JPEG buffer with a large APP1 metadata segment that pushes the
 * SOF marker past a given offset. Uses the real JPEG segment framing
 * (marker + big-endian length that includes the length field itself) so the
 * segment walker exercises actual marker semantics, not mocked structure.
 */
function buildSofSegment(width: number, height: number): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(17, 0);
  const h = Buffer.alloc(2);
  h.writeUInt16BE(height, 0);
  const w = Buffer.alloc(2);
  w.writeUInt16BE(width, 0);
  return Buffer.concat([
    len,
    Buffer.from([0x08]),
    h,
    w,
    Buffer.from([0x03]),
    Buffer.from([0x01, 0x22, 0x00]),
    Buffer.from([0x02, 0x11, 0x11]),
    Buffer.from([0x03, 0x11, 0x11]),
  ]);
}

function buildJpegWithDelayedSof(
  appPayloadSize: number,
  width: number,
  height: number,
  tailBytes = 64,
): Buffer {
  const parts: Buffer[] = [];
  // SOI
  parts.push(Buffer.from([0xff, 0xd8]));
  // APP1 segment with a large payload: marker(2) + Ls(2) + payload(Ls-2).
  const appLength = appPayloadSize + 2;
  const len = Buffer.alloc(2);
  len.writeUInt16BE(appLength, 0);
  parts.push(Buffer.from([0xff, 0xe1]));
  parts.push(len);
  parts.push(Buffer.alloc(appPayloadSize, 0x20));
  parts.push(Buffer.from([0xff, 0xc0]));
  parts.push(buildSofSegment(width, height));
  // Minimal SOS + dummy scan data + EOI so the file has a plausible tail.
  parts.push(
    Buffer.from([
      0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00,
      0x3f, 0x00,
    ]),
  );
  parts.push(Buffer.alloc(tailBytes, 0x80));
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

/** In-memory JpegSegmentReader backed by a buffer, for unit tests. */
function readerFromBuffer(buf: Uint8Array): JpegSegmentReader {
  return (offset: number, length: number): Promise<Uint8Array> => {
    const slice = buf.subarray(offset, offset + length);
    return Promise.resolve(new Uint8Array(slice));
  };
}

describe('parseJpegDimensionsFromReader — bounded JPEG SOF preflight (@issue:3216)', () => {
  it('locates SOF beyond the 8192-byte prefix in a valid oversized JPEG', async () => {
    // APP1 payload of 8298 bytes pushes SOF to ~offset 8304 > 8192.
    const jpeg = buildJpegWithDelayedSof(8_298, 3_000, 3_000);
    expect(jpeg.length).toBeGreaterThan(8_192);
    const dims = await parseJpegDimensionsFromReader(readerFromBuffer(jpeg));
    expect(dims).toEqual({ width: 3_000, height: 3_000 });
  });

  it('locates SOF for a within-budget JPEG with delayed SOF', async () => {
    const jpeg = buildJpegWithDelayedSof(8_298, 1_800, 1_800);
    const dims = await parseJpegDimensionsFromReader(readerFromBuffer(jpeg));
    expect(dims).toEqual({ width: 1_800, height: 1_800 });
  });

  it('returns undefined for a non-JPEG input', async () => {
    const png = await pngBytes(3000, 2000);
    const dims = await parseJpegDimensionsFromReader(readerFromBuffer(png));
    expect(dims).toBeUndefined();
  });

  it('returns undefined for an empty input', async () => {
    const dims = await parseJpegDimensionsFromReader(
      readerFromBuffer(new Uint8Array(0)),
    );
    expect(dims).toBeUndefined();
  });

  it('is bounded: an oversized metadata declaration cannot force unbounded reads', async () => {
    // A malicious segment declares length 0xFFFF but the file ends at once.
    const malicious = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xe1]),
      Buffer.from([0xff, 0xff]),
      Buffer.from([0x00]),
    ]);
    const dims = await parseJpegDimensionsFromReader(
      readerFromBuffer(malicious),
    );
    expect(dims).toBeUndefined();
  });

  it('enforces an explicit inspection bound: SOF beyond the bound is not found', async () => {
    // Two chained large APP segments push SOF past a small bound.
    const segPayload = 60_000;
    const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
    for (let i = 0; i < 2; i++) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(segPayload + 2, 0);
      parts.push(
        Buffer.from([0xff, 0xe1]),
        len,
        Buffer.alloc(segPayload, 0x20),
      );
    }
    const sofLen = Buffer.alloc(2);
    sofLen.writeUInt16BE(17, 0);
    const h = Buffer.alloc(2);
    h.writeUInt16BE(3_000, 0);
    const w = Buffer.alloc(2);
    w.writeUInt16BE(3_000, 0);
    parts.push(
      Buffer.from([0xff, 0xc0]),
      sofLen,
      Buffer.from([0x08]),
      h,
      w,
      Buffer.from([0x03]),
      Buffer.from([0x01, 0x22, 0x00]),
      Buffer.from([0x02, 0x11, 0x11]),
      Buffer.from([0x03, 0x11, 0x11]),
    );
    const jpeg = Buffer.concat(parts);
    // With a bound of 50_000, the walker stops before reaching SOF at
    // ~offset 120_006.
    const dims = await parseJpegDimensionsFromReader(
      readerFromBuffer(jpeg),
      50_000,
    );
    expect(dims).toBeUndefined();
    // With the default bound, the same file is parsed.
    const dimsFull = await parseJpegDimensionsFromReader(
      readerFromBuffer(jpeg),
    );
    expect(dimsFull).toEqual({ width: 3_000, height: 3_000 });
  });

  it('finds a marker whose FF prefix is the last byte of a reader chunk', async () => {
    // The first walk chunk after SOI covers bytes 2..9; byte 9 is the FF
    // prefix and byte 10 the SOF0 code, so the marker straddles the chunk
    // boundary.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.alloc(7, 0x20),
      Buffer.from([0xff, 0xc0]),
      buildSofSegment(3_000, 3_000),
    ]);
    const dims = await parseJpegDimensionsFromReader(readerFromBuffer(jpeg));
    expect(dims).toEqual({ width: 3_000, height: 3_000 });
  });

  it('finds a marker after an FF fill run crossing a reader chunk boundary', async () => {
    // Bytes 7..9 are FF fill and byte 10 the SOF0 code: the fill run ends on
    // the chunk boundary and the code byte sits in the next chunk.
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.alloc(5, 0x20),
      Buffer.from([0xff, 0xff, 0xff]),
      Buffer.from([0xc0]),
      buildSofSegment(1_800, 1_800),
    ]);
    const dims = await parseJpegDimensionsFromReader(readerFromBuffer(jpeg));
    expect(dims).toEqual({ width: 1_800, height: 1_800 });
  });

  it('stops within the explicit step bound on repeated standalone markers', async () => {
    // 100_000 RSTn standalone markers: each walk step consumes one marker,
    // far exceeding the step bound. The scan must stop within the bound
    // rather than issuing one read per marker.
    const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
    for (let i = 0; i < 100_000; i++) {
      parts.push(Buffer.from([0xff, 0xd0 | i % 8]));
    }
    const jpeg = Buffer.concat(parts);
    let readCalls = 0;
    const reader: JpegSegmentReader = async (offset, length) => {
      readCalls++;
      return new Uint8Array(jpeg.subarray(offset, offset + length));
    };
    const dims = await parseJpegDimensionsFromReader(reader);
    expect(dims).toBeUndefined();
    // One read per walk step plus the signature read.
    expect(readCalls).toBeLessThanOrEqual(JPEG_SEGMENT_MAX_STEPS + 1);
  });

  it('propagates reader I/O errors instead of treating them as malformed input', async () => {
    const jpeg = buildJpegWithDelayedSof(8_298, 3_000, 3_000);
    const failing: JpegSegmentReader = async (offset, length) => {
      if (offset > 0) throw new Error('EIO: read failure');
      return new Uint8Array(jpeg.subarray(offset, offset + length));
    };
    await expect(parseJpegDimensionsFromReader(failing)).rejects.toThrow('EIO');
  });
});

describe('checkImageFileDimensionBudget prefix-only path (@issue:3216)', () => {
  it('returns undefined when the fixed prefix cannot reach SOF', async () => {
    // SOF sits beyond 8192 bytes, so the prefix-only check cannot see it.
    const jpeg = buildJpegWithDelayedSof(8_298, 3_000, 3_000);
    let maxRequested = 0;
    const readPrefix = async (maxBytes: number): Promise<Uint8Array> => {
      maxRequested = Math.max(maxRequested, maxBytes);
      return new Uint8Array(jpeg.subarray(0, maxBytes));
    };
    const budget: ImageDimensionBudget = { maxDimension: 2_000 };
    expect(
      await checkImageFileDimensionBudget(readPrefix, budget),
    ).toBeUndefined();
    expect(maxRequested).toBeLessThanOrEqual(8_192 + 1);
  });
});

describe('checkImageFileBudgetMessage file-path JPEG fallback (@issue:3216)', () => {
  it('flags a delayed-SOF oversized JPEG through the real file path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-jpegwalk-'));
    try {
      const jpeg = buildJpegWithDelayedSof(8_298, 3_000, 3_000);
      const file = join(dir, 'delayed.jpg');
      writeFileSync(file, jpeg);
      const message = await checkImageFileBudgetMessage(
        file,
        { maxDimension: 2_000 },
        'delayed.jpg',
      );
      expect(message).toBeDefined();
      expect(message).toContain('3000');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined for a within-budget delayed-SOF JPEG through the real file path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llxprt-jpegwalk-'));
    try {
      const jpeg = buildJpegWithDelayedSof(8_298, 1_800, 1_800);
      const file = join(dir, 'ok.jpg');
      writeFileSync(file, jpeg);
      expect(
        await checkImageFileBudgetMessage(
          file,
          { maxDimension: 2_000 },
          'ok.jpg',
        ),
      ).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
