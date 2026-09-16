/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal Windows BMP (BITMAPINFOHEADER) pixel decoder for the dominant
 * uncompressed BI_RGB 24/32-bit variants (#3693).
 *
 * sharp has no BMP input loader in the prebuilt libvips we ship, so BMP files
 * — the format Windows screenshots are made of — cannot be transcoded through
 * a plain sharp pipeline. This decoder extracts the raw RGB pixels and hands
 * them to sharp as `raw` input for PNG encoding, so BMP reads still normalize
 * through the same sharp output path as every other unsupported image mime.
 *
 * Returns `null` for anything outside the supported subset (palette BMPs,
 * RLE-compressed data, truncated files, non-BMP bytes); callers degrade those
 * to the binary placeholder path.
 */

export interface BmpRawImage {
  readonly width: number;
  readonly height: number;
  /** Tightly packed RGB pixels, 3 bytes per pixel, top-down row order. */
  readonly data: Buffer;
}

const BMP_FILE_HEADER_SIZE = 14;
const BITMAPINFOHEADER_SIZE = 40;

export function decodeBmpToRawRgb(content: Buffer): BmpRawImage | null {
  if (content.length < BMP_FILE_HEADER_SIZE + BITMAPINFOHEADER_SIZE) {
    return null;
  }
  if (content[0] !== 0x42 || content[1] !== 0x4d) {
    return null;
  }
  const pixelOffset = content.readUInt32LE(10);
  const headerSize = content.readUInt32LE(14);
  const width = content.readInt32LE(18);
  const heightRaw = content.readInt32LE(22);
  const planes = content.readUInt16LE(26);
  const bitsPerPixel = content.readUInt16LE(28);
  const compression = content.readUInt32LE(30);

  if (headerSize < BITMAPINFOHEADER_SIZE || planes !== 1) {
    return null;
  }
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    return null;
  }
  if (compression !== 0 || width <= 0 || heightRaw === 0) {
    return null;
  }

  const bottomUp = heightRaw > 0;
  const height = Math.abs(heightRaw);
  const bytesPerPixel = bitsPerPixel / 8;
  const sourceRowSize = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  if (pixelOffset + sourceRowSize * height > content.length) {
    return null;
  }

  const data = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row++) {
    const sourceRow = bottomUp ? height - 1 - row : row;
    const rowBase = pixelOffset + sourceRow * sourceRowSize;
    for (let col = 0; col < width; col++) {
      const source = rowBase + col * bytesPerPixel;
      const target = (row * width + col) * 3;
      // BMP stores pixels as BGR(A) little-endian.
      data[target] = content[source + 2];
      data[target + 1] = content[source + 1];
      data[target + 2] = content[source];
    }
  }
  return { width, height, data };
}
