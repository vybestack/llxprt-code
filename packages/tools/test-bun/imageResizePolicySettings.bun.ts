/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import sharp from 'sharp';
import {
  resolveImageResizePolicy,
  resizeImageIfNeeded,
} from '../src/utils/imageResize.js';
import { resolveImageDimensionBudget } from '../src/utils/imageDimensionBudget.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

/**
 * SettingsService.set() stores dotted keys as nested objects while alias
 * modelDefaults and hand-built maps use flat dotted keys. These tests pin
 * that the resize policy resolver reads both shapes (issue #3477: the
 * runtime path saw the nested shape only and images were never resized).
 */
describe('resolveImageResizePolicy settings shapes', () => {
  it('resolves limits written through a real SettingsService (nested storage)', () => {
    const service = new SettingsService();
    service.set('image-resize.maxLongEdge', 2000);
    service.set('image-resize.maxShortEdge', 2000);
    service.set('image-resize.maxPixels', 1_572_864);
    const all = service.getAllGlobalSettings();

    // The old reader indexed the flat dotted key and saw undefined here.
    expect(all['image-resize.maxLongEdge']).toBeUndefined();
    expect(all['image-resize']).toEqual({
      maxLongEdge: 2000,
      maxShortEdge: 2000,
      maxPixels: 1_572_864,
    });

    expect(resolveImageResizePolicy(all)).toEqual({
      maxLongEdge: 2000,
      maxShortEdge: 2000,
      maxPixels: 1_572_864,
    });
  });

  it('resolves limits from a flat dotted-key map', () => {
    const policy = resolveImageResizePolicy({
      'image-resize.maxLongEdge': 2000,
      'image-resize.maxShortEdge': 2000,
    });
    expect(policy).toEqual({ maxLongEdge: 2000, maxShortEdge: 2000 });
  });

  it('flat keys win when both shapes are present', () => {
    const policy = resolveImageResizePolicy({
      'image-resize.maxLongEdge': 1000,
      'image-resize': { maxLongEdge: 2000 },
    });
    expect(policy).toEqual({ maxLongEdge: 1000 });
  });

  it('honors image-resize.enabled=false written through SettingsService', () => {
    const service = new SettingsService();
    service.set('image-resize.enabled', false);
    service.set('image-resize.maxLongEdge', 2000);
    expect(
      resolveImageResizePolicy(service.getAllGlobalSettings()),
    ).toBeUndefined();
  });

  it('rejects invalid nested values the same as flat ones', () => {
    const service = new SettingsService();
    service.set('image-resize.maxLongEdge', -5);
    expect(() =>
      resolveImageResizePolicy(service.getAllGlobalSettings()),
    ).toThrow('image-resize.maxLongEdge');
  });

  it('enabled=true written nested requires at least one limit', () => {
    const service = new SettingsService();
    service.set('image-resize.enabled', true);
    expect(() =>
      resolveImageResizePolicy(service.getAllGlobalSettings()),
    ).toThrow('enabled resizing requires at least one limit');
  });

  it('returns undefined when no image-resize settings exist', () => {
    expect(
      resolveImageResizePolicy(new SettingsService().getAllGlobalSettings()),
    ).toBeUndefined();
  });

  it('resolveImageDimensionBudget reads undotted keys through SettingsService', () => {
    const service = new SettingsService();
    service.set('max-image-dimension', 1568);
    expect(resolveImageDimensionBudget(service.getAllGlobalSettings())).toEqual(
      { maxDimension: 1568, maxPixels: undefined },
    );
  });
});

describe('resizeImageIfNeeded with policy resolved from SettingsService', () => {
  it('resizes a real image using the nested settings shape', async () => {
    const original = await sharp({
      create: {
        width: 120,
        height: 60,
        channels: 3,
        background: { r: 200, g: 30, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const service = new SettingsService();
    service.set('image-resize.maxLongEdge', 60);
    const policy = resolveImageResizePolicy(service.getAllGlobalSettings());
    expect(policy).toEqual({ maxLongEdge: 60 });

    const resized = await resizeImageIfNeeded(
      original,
      'image/png',
      'big.png',
      policy,
    );
    const metadata = await sharp(resized).metadata();
    expect(metadata.width).toBe(60);
    expect(metadata.height).toBe(30);
  });
});
