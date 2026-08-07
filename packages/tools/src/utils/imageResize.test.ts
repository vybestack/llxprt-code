/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import sharp from 'sharp';
import {
  resolveImageResizePolicy,
  resizeImageIfNeeded,
  type ImageResizePolicy,
} from './imageResize.js';

async function createImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp',
): Promise<Buffer> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 80, g: 120, b: 160, alpha: 0.75 },
    },
  });
  switch (format) {
    case 'jpeg':
      return image.jpeg().toBuffer();
    case 'png':
      return image.png().toBuffer();
    case 'webp':
      return image.webp().toBuffer();
    default:
      throw new Error(`Unsupported test image format: ${format}`);
  }
}

async function createAnimatedImage(format: 'gif' | 'webp'): Promise<Buffer> {
  const red = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const blue = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const animation = sharp([red, blue], { join: { animated: true } });
  return format === 'gif'
    ? animation.gif({ delay: [100, 150], loop: 0 }).toBuffer()
    : animation.webp({ delay: [100, 150], loop: 0 }).toBuffer();
}

async function getDisplayedDimensions(
  content: Buffer,
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(content, { animated: true }).metadata();
  const width = metadata.autoOrient.width;
  const totalHeight = metadata.autoOrient.height;
  const pages = metadata.pages ?? 1;
  const height = metadata.pageHeight ?? totalHeight / pages;
  return { width, height };
}

const EDGE_POLICY: ImageResizePolicy = {
  maxLongEdge: 100,
  maxShortEdge: 60,
};

describe('resizeImageIfNeeded', () => {
  it('returns compliant image bytes without re-encoding or upscaling', async () => {
    const original = await createImage(80, 40, 'png');

    const resized = await resizeImageIfNeeded(
      original,
      'image/png',
      'small.png',
      EDGE_POLICY,
    );

    expect(resized).toBe(original);
  });

  it('returns original bytes without decoding when no limit is configured', async () => {
    const original = Buffer.from('not an image');

    const result = await resizeImageIfNeeded(
      original,
      'image/png',
      'legacy.png',
    );

    expect(result).toBe(original);
  });

  it('fits proportionally within edge and pixel limits', async () => {
    const original = await createImage(400, 200, 'jpeg');

    const resized = await resizeImageIfNeeded(
      original,
      'image/jpeg',
      'large.jpg',
      { maxLongEdge: 180, maxShortEdge: 120, maxPixels: 12_000 },
    );
    const dimensions = await getDisplayedDimensions(resized);
    const metadata = await sharp(resized).metadata();

    expect(dimensions).toEqual({ width: 154, height: 77 });
    expect(metadata.format).toBe('jpeg');
  });

  it('applies limits to orientation-aware displayed dimensions', async () => {
    const original = await sharp({
      create: {
        width: 120,
        height: 60,
        channels: 3,
        background: { r: 20, g: 100, b: 180 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const resized = await resizeImageIfNeeded(
      original,
      'image/jpeg',
      'rotated.jpg',
      { maxLongEdge: 80 },
    );

    expect(await getDisplayedDimensions(resized)).toEqual({
      width: 40,
      height: 80,
    });
  });

  it.each(['gif', 'webp'] as const)(
    'preserves animation and container when resizing %s',
    async (format) => {
      const original = await createAnimatedImage(format);

      const resized = await resizeImageIfNeeded(
        original,
        `image/${format}`,
        `animated.${format}`,
        { maxLongEdge: 60 },
      );
      const metadata = await sharp(resized, { animated: true }).metadata();

      expect(metadata.format).toBe(format);
      expect(metadata.pages).toBe(2);
      expect(await getDisplayedDimensions(resized)).toEqual({
        width: 60,
        height: 40,
      });
    },
  );

  it('counts every animated frame against maxPixels', async () => {
    const original = await createAnimatedImage('gif');

    const resized = await resizeImageIfNeeded(
      original,
      'image/gif',
      'aggregate.gif',
      { maxPixels: 10_000 },
    );
    const metadata = await sharp(resized, { animated: true }).metadata();
    const dimensions = await getDisplayedDimensions(resized);

    expect(
      (metadata.pages ?? 1) * dimensions.width * dimensions.height,
    ).toBeLessThanOrEqual(10_000);
    expect(metadata.pages).toBe(2);
  });

  it('fails clearly when a configured image cannot be decoded', async () => {
    await expect(
      resizeImageIfNeeded(
        Buffer.from('corrupt image bytes'),
        'image/png',
        'broken.png',
        { maxLongEdge: 100 },
      ),
    ).rejects.toThrow('Unable to resize image broken.png');
  });

  it('fails clearly for a real unsupported source container', async () => {
    const unsupported = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .tiff()
      .toBuffer();

    await expect(
      resizeImageIfNeeded(unsupported, 'image/tiff', 'large.tiff', {
        maxLongEdge: 100,
      }),
    ).rejects.toThrow('Unable to resize image large.tiff');
  });

  it('rejects a supported declared MIME that mismatches the decoded container', async () => {
    const png = await createImage(80, 40, 'png');

    await expect(
      resizeImageIfNeeded(png, 'image/jpeg', 'mismatch.jpg', {
        maxLongEdge: 100,
      }),
    ).rejects.toThrow('Unable to resize image mismatch.jpg');
  });
});

describe('resolveImageResizePolicy', () => {
  it('returns configured limits when automatic resizing is enabled', () => {
    expect(
      resolveImageResizePolicy({
        'image-resize.enabled': true,
        'image-resize.maxLongEdge': 2048,
        'image-resize.maxPixels': 1_572_864,
      }),
    ).toEqual({ maxLongEdge: 2048, maxPixels: 1_572_864 });
  });

  it('preserves legacy behavior when limits are absent or disabled', () => {
    expect(resolveImageResizePolicy({})).toBeUndefined();
    expect(
      resolveImageResizePolicy({
        'image-resize.enabled': false,
        'image-resize.maxLongEdge': 100,
      }),
    ).toBeUndefined();
  });

  it('honors the per-call opt-out before resolving profile values', () => {
    expect(
      resolveImageResizePolicy({ 'image-resize.maxLongEdge': 'invalid' }, true),
    ).toBeUndefined();
  });

  it.each([
    { 'image-resize.enabled': 'yes' },
    { 'image-resize.enabled': true },
    { 'image-resize.maxLongEdge': 0 },
    { 'image-resize.maxShortEdge': 1.5 },
    { 'image-resize.maxPixels': 'large' },
  ])('rejects malformed direct profile values: %j', (settings) => {
    expect(() => resolveImageResizePolicy(settings)).toThrow(
      'Invalid image resize settings',
    );
  });
});
