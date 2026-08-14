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
import sharp from 'sharp';
import {
  resolveImageDimensionBudget,
  checkImageDimensionBudget,
  checkImageDimensionBudgetFromBuffer,
  formatImageBudgetError,
  formatImageBudgetDisplay,
  type ImageDimensionBudget,
} from './imageDimensionBudget.js';

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
    // Guidance must tell the model how to fix it.
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
  // The buffer entry point must have IDENTICAL boundary behavior to the base64
  // checker so the file-processing path can avoid base64-encoding a full
  // payload just to inspect bounded dimensions, with no behavior change.
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
