/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for image format normalization in the file read path
 * (#3693): every image the tools return inline must be in a format vision
 * endpoints accept ({png, jpeg, gif, webp}); anything else is transcoded to
 * PNG, and undecodable image-signature files degrade to the binary
 * placeholder. All cases read real files through `processSingleFileContent`
 * with real mime lookup — no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import sharp from 'sharp';
import { processSingleFileContent } from './fileUtils.js';
import type { ProcessedFileReadResult } from './fileUtils.js';

/** Hand-encode a minimal uncompressed 24/32-bit BMP (sharp cannot encode BMP). */
function makeBmp(
  options: {
    width?: number;
    height?: number;
    bitsPerPixel?: number;
    fill?: [number, number, number];
    topDown?: boolean;
    compression?: number;
    truncatePixels?: boolean;
  } = {},
): Buffer {
  const width = options.width ?? 64;
  const height = options.height ?? 48;
  const bitsPerPixel = options.bitsPerPixel ?? 24;
  const [b, g, r] = options.fill ?? [40, 30, 200];
  const bytesPerPixel = bitsPerPixel / 8;
  const rowSize = Math.floor((bitsPerPixel * width + 31) / 32) * 4;
  const pixelDataSize = rowSize * height;
  const headerSize = 14 + 40;
  const buf = Buffer.alloc(
    headerSize +
      (options.truncatePixels === true
        ? Math.floor(pixelDataSize / 2)
        : pixelDataSize),
  );
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(headerSize, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(options.topDown === true ? -height : height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bitsPerPixel, 28);
  buf.writeUInt32LE(options.compression ?? 0, 30);
  buf.writeUInt32LE(pixelDataSize, 34);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const off = headerSize + row * rowSize + col * bytesPerPixel;
      buf[off] = b;
      buf[off + 1] = g;
      buf[off + 2] = r;
    }
  }
  return buf;
}

/**
 * Build a two-frame animated 1x1 GIF by splicing sharp's own (valid) static
 * GIF frame into a NETSCAPE looping container — sharp cannot create animated
 * output from static input. Validated by decoding with sharp in the tests
 * that use it.
 */
async function makeAnimatedGif(): Promise<Buffer> {
  const staticGif = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .gif()
    .toBuffer();
  const descriptorIndex = staticGif.indexOf(0x2c);
  const head = staticGif.subarray(0, descriptorIndex);
  const frame = staticGif.subarray(descriptorIndex, staticGif.length - 1);
  const graphicControl = Buffer.from([
    0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00,
  ]);
  const netscapeLoop = Buffer.concat([
    Buffer.from([0x21, 0xff, 0x0b]),
    Buffer.from('NETSCAPE2.0', 'ascii'),
    Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]),
  ]);
  return Buffer.concat([
    head,
    netscapeLoop,
    graphicControl,
    frame,
    graphicControl,
    frame,
    Buffer.from([0x3b]),
  ]);
}

async function writeFixture(dir: string, name: string, bytes: Buffer) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

async function pngBytes(
  width: number,
  height: number,
  fill: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: fill },
  })
    .png()
    .toBuffer();
}

function expectInlineImage(result: ProcessedFileReadResult) {
  if (typeof result.llmContent === 'string') {
    throw new Error(`expected inline media, got text: ${result.llmContent}`);
  }
  const inline = result.llmContent.inlineData;
  if (inline === undefined) {
    throw new Error('expected inlineData on the media result');
  }
  if (inline.data === undefined || inline.data === '') {
    throw new Error('expected base64 data on the inline media result');
  }
  return { ...inline, data: inline.data };
}

describe('processSingleFileContent image format normalization (#3693)', () => {
  let tempDir = '';
  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tools-fileUtils-format-test-'),
    );
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const getDir = (): string => tempDir;

  describe('unsupported image formats transcode to image/png', () => {
    it('returns a decoded image/png block for a 24-bit BMP screenshot', async () => {
      const filePath = await writeFixture(
        getDir(),
        'screenshot.bmp',
        makeBmp(),
      );

      const result = await processSingleFileContent(filePath, getDir());
      const inline = expectInlineImage(result);

      expect(inline.mimeType).toBe('image/png');
      const decoded = Buffer.from(inline.data, 'base64');
      const metadata = await sharp(decoded).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(48);
      // BGR fill (40, 30, 200) must land as RGB (200, 30, 40) in the PNG.
      const pixels = await sharp(decoded).raw().toBuffer();
      expect([pixels[0], pixels[1], pixels[2]]).toStrictEqual([200, 30, 40]);
    });

    it('transcodes a 32-bit BMP and a top-down BMP', async () => {
      for (const variant of [
        { label: '32bit', bytes: makeBmp({ bitsPerPixel: 32 }) },
        { label: 'topDown', bytes: makeBmp({ topDown: true }) },
      ]) {
        const filePath = await writeFixture(
          getDir(),
          `shot-${variant.label}.bmp`,
          variant.bytes,
        );
        const result = await processSingleFileContent(filePath, getDir());
        const inline = expectInlineImage(result);
        expect(inline.mimeType).toBe('image/png');
        const metadata = await sharp(
          Buffer.from(inline.data, 'base64'),
        ).metadata();
        expect(`${metadata.format} ${metadata.width}x${metadata.height}`).toBe(
          'png 64x48',
        );
      }
    });

    it('transcodes TIFF to image/png', async () => {
      const tiff = await sharp(await pngBytes(32, 24, { r: 10, g: 200, b: 60 }))
        .tiff()
        .toBuffer();
      const filePath = await writeFixture(getDir(), 'scan.tiff', tiff);

      const result = await processSingleFileContent(filePath, getDir());
      const inline = expectInlineImage(result);

      expect(inline.mimeType).toBe('image/png');
      const metadata = await sharp(
        Buffer.from(inline.data, 'base64'),
      ).metadata();
      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(32);
    });

    it('transcodes AVIF to image/png', async () => {
      const avif = await sharp(await pngBytes(32, 24, { r: 5, g: 100, b: 220 }))
        .avif()
        .toBuffer();
      const filePath = await writeFixture(getDir(), 'photo.avif', avif);

      const result = await processSingleFileContent(filePath, getDir());
      const inline = expectInlineImage(result);

      expect(inline.mimeType).toBe('image/png');
      const metadata = await sharp(
        Buffer.from(inline.data, 'base64'),
      ).metadata();
      expect(metadata.format).toBe('png');
    });

    it('adds no source-provenance metadata for a pure transcode', async () => {
      const filePath = await writeFixture(getDir(), 'plain.bmp', makeBmp());

      const result = await processSingleFileContent(filePath, getDir());
      const inline = expectInlineImage(result);

      expect(inline.originalData).toBeUndefined();
      expect(inline.transformation).toBeUndefined();
    });

    it('applies the resize policy after transcoding, with resize-only provenance', async () => {
      const filePath = await writeFixture(getDir(), 'big.bmp', makeBmp());

      const result = await processSingleFileContent(
        filePath,
        getDir(),
        undefined,
        undefined,
        { maxLongEdge: 32 },
      );
      const inline = expectInlineImage(result);

      expect(inline.mimeType).toBe('image/png');
      const metadata = await sharp(
        Buffer.from(inline.data, 'base64'),
      ).metadata();
      expect(metadata.width).toBe(32);
      expect(metadata.height).toBe(24);
      // Provenance tracks the resize step: the original is the transcoded
      // full-size PNG, never the BMP bytes.
      const original = Buffer.from(inline.originalData ?? '', 'base64');
      const originalMetadata = await sharp(original).metadata();
      expect(originalMetadata.format).toBe('png');
      expect(`${originalMetadata.width}x${originalMetadata.height}`).toBe(
        '64x48',
      );
      expect(inline.transformation).toStrictEqual({
        policyId: 'image-resize',
        policyVersion: 1,
        parameters: { maxLongEdge: 32 },
      });
    });
  });

  describe('supported image formats pass through byte-identically', () => {
    it.each(['png', 'jpg', 'gif', 'webp'] as const)(
      'returns the original %s bytes untouched',
      async (format) => {
        const source = await pngBytes(48, 32, { r: 90, g: 20, b: 200 });
        const sharpFormat = format === 'jpg' ? 'jpeg' : format;
        const encoded =
          format === 'png'
            ? source
            : await sharp(source).toFormat(sharpFormat).toBuffer();
        const filePath = await writeFixture(
          getDir(),
          `image.${format}`,
          encoded,
        );

        const result = await processSingleFileContent(filePath, getDir());
        const inline = expectInlineImage(result);

        expect(inline.mimeType).toBe(
          `image/${format === 'jpg' ? 'jpeg' : format}`,
        );
        expect(Buffer.from(inline.data, 'base64').equals(encoded)).toBe(true);
        expect(inline.originalData).toBeUndefined();
        expect(inline.transformation).toBeUndefined();
      },
    );

    it('keeps an animated GIF byte-identical (no re-encode)', async () => {
      const animated = await makeAnimatedGif();
      const gifMetadata = await sharp(animated, { animated: true }).metadata();
      expect(gifMetadata.format).toBe('gif');
      expect(gifMetadata.pages).toBe(2);

      const filePath = await writeFixture(getDir(), 'spinner.gif', animated);
      const result = await processSingleFileContent(filePath, getDir());
      const inline = expectInlineImage(result);

      expect(inline.mimeType).toBe('image/gif');
      expect(Buffer.from(inline.data, 'base64').equals(animated)).toBe(true);
    });
  });

  describe('undecodable image-signature files degrade to the binary placeholder', () => {
    it('replaces a BMP whose pixels are truncated', async () => {
      const filePath = await writeFixture(
        getDir(),
        'truncated.bmp',
        makeBmp({ truncatePixels: true }),
      );

      const result = await processSingleFileContent(filePath, getDir());

      expect(result.llmContent).toBe(
        'Cannot display content of binary file: truncated.bmp',
      );
    });

    it('replaces an RLE-compressed BMP (unsupported subset)', async () => {
      const filePath = await writeFixture(
        getDir(),
        'rle.bmp',
        makeBmp({ compression: 2 }),
      );

      const result = await processSingleFileContent(filePath, getDir());

      expect(result.llmContent).toBe(
        'Cannot display content of binary file: rle.bmp',
      );
    });

    it('replaces an ICO file (sharp cannot decode ICO)', async () => {
      // Valid ICO directory header pointing at 16x16 32-bit BMP data, but the
      // payload bytes are zero — no decoder accepts it.
      const ico = Buffer.alloc(22 + 40, 0);
      ico.writeUInt16LE(0, 0);
      ico.writeUInt16LE(1, 2);
      ico.writeUInt16LE(1, 4);
      ico[6] = 16;
      ico[7] = 16;
      ico.writeUInt16LE(32, 12);
      const filePath = await writeFixture(getDir(), 'icon.ico', ico);

      const result = await processSingleFileContent(filePath, getDir());

      expect(result.llmContent).toBe(
        'Cannot display content of binary file: icon.ico',
      );
    });
  });
});
