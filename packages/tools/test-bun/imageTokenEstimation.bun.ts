/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_IMAGE_TOKEN_ESTIMATE,
  resolveImageTokenProviderFamily,
  estimateImageTokens,
  estimateNonTextPartTokens,
} from '../src/utils/imageTokenEstimation.js';

function buildPngBase64(width: number, height: number): string {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf.toString('base64');
}

describe('resolveImageTokenProviderFamily', () => {
  it('maps anthropic names to the anthropic family', () => {
    expect(resolveImageTokenProviderFamily('anthropic')).toBe('anthropic');
    expect(resolveImageTokenProviderFamily('claude')).toBe('anthropic');
  });

  it('maps openai names to the openai family', () => {
    expect(resolveImageTokenProviderFamily('openai')).toBe('openai');
  });

  it('maps gemini/google names to the gemini family', () => {
    expect(resolveImageTokenProviderFamily('gemini')).toBe('gemini');
    expect(resolveImageTokenProviderFamily('google')).toBe('gemini');
  });

  it('falls back to default for unknown, empty, or undefined providers', () => {
    expect(resolveImageTokenProviderFamily(undefined)).toBe('default');
    expect(resolveImageTokenProviderFamily('')).toBe('default');
    expect(resolveImageTokenProviderFamily('stepfun')).toBe('default');
  });

  it('maps alias providers to the platform they proxy', () => {
    expect(resolveImageTokenProviderFamily('claudecode')).toBe('anthropic');
    expect(resolveImageTokenProviderFamily('claude-code')).toBe('anthropic');
    expect(resolveImageTokenProviderFamily('codex')).toBe('openai');
    expect(resolveImageTokenProviderFamily('azure-openai')).toBe('openai');
    expect(resolveImageTokenProviderFamily('google-vertex-gemini')).toBe(
      'gemini',
    );
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveImageTokenProviderFamily('  Claude  ')).toBe('anthropic');
    expect(resolveImageTokenProviderFamily('GOOGLE')).toBe('gemini');
    expect(resolveImageTokenProviderFamily('OpenAI')).toBe('openai');
  });
});

describe('estimateImageTokens — anthropic reference values', () => {
  it('produces 1590 for 1092x1092 (Anthropic docs)', () => {
    expect(
      estimateImageTokens({
        provider: 'anthropic',
        dimensions: { width: 1092, height: 1092 },
      }),
    ).toBe(1590);
  });

  it('produces 54 for 200x200 (Anthropic docs)', () => {
    expect(
      estimateImageTokens({
        provider: 'anthropic',
        dimensions: { width: 200, height: 200 },
      }),
    ).toBe(54);
  });

  it('never charges more than the largest accepted image', () => {
    // Every oversized image is downscaled to at most 1092x1092 worth of pixels.
    for (const dims of [
      { width: 1568, height: 1568 },
      { width: 3136, height: 1568 },
      { width: 8000, height: 6000 },
      { width: 20000, height: 100 },
    ]) {
      expect(
        estimateImageTokens({ provider: 'anthropic', dimensions: dims }),
      ).toBeLessThanOrEqual(1590);
    }
    expect(
      estimateImageTokens({
        provider: 'anthropic',
        dimensions: { width: 1568, height: 1568 },
      }),
    ).toBe(1590);
  });

  it('never upscales an image below the limits', () => {
    expect(
      estimateImageTokens({
        provider: 'anthropic',
        dimensions: { width: 10, height: 10 },
      }),
    ).toBe(1);
    expect(
      estimateImageTokens({
        provider: 'anthropic',
        dimensions: { width: 800, height: 600 },
      }),
    ).toBe(640);
  });
});

describe('estimateImageTokens — openai reference values', () => {
  it('produces 765 for 1024x1024 (OpenAI docs high detail)', () => {
    expect(
      estimateImageTokens({
        provider: 'openai',
        dimensions: { width: 1024, height: 1024 },
      }),
    ).toBe(765);
  });

  it('produces 1105 for 2048x4096 (OpenAI docs high detail)', () => {
    expect(
      estimateImageTokens({
        provider: 'openai',
        dimensions: { width: 2048, height: 4096 },
      }),
    ).toBe(1105);
  });

  it('normalises the shortest side to 768 and rounds into 512 tiles', () => {
    // A square 768x768 yields exactly 4 tiles -> 170*4 + 85 = 765.
    expect(
      estimateImageTokens({
        provider: 'openai',
        dimensions: { width: 768, height: 768 },
      }),
    ).toBe(765);
  });

  it('counts a partial tile just past a 512-pixel boundary', () => {
    // 4001x3000 normalises to ~1024.26x768, which needs a third tile column.
    expect(
      estimateImageTokens({
        provider: 'openai',
        dimensions: { width: 4001, height: 3000 },
      }),
    ).toBe(1105);
    // 4000x3000 normalises to exactly 1024x768 and stays at two columns.
    expect(
      estimateImageTokens({
        provider: 'openai',
        dimensions: { width: 4000, height: 3000 },
      }),
    ).toBe(765);
  });

  it('charges wide panoramas for every tile column', () => {
    expect(
      estimateImageTokens({
        provider: 'openai',
        dimensions: { width: 4096, height: 1024 },
      }),
    ).toBe(2125);
  });
});

describe('estimateImageTokens — gemini and default families', () => {
  it('returns the flat 3000 for gemini regardless of dimensions', () => {
    for (const dims of [
      { width: 100, height: 100 },
      { width: 4096, height: 4096 },
      { width: 1, height: 1 },
    ]) {
      expect(
        estimateImageTokens({ provider: 'gemini', dimensions: dims }),
      ).toBe(3000);
    }
  });

  it('returns 3000 for gemini when dimensions are unknown', () => {
    expect(estimateImageTokens({ provider: 'gemini' })).toBe(3000);
  });

  it('returns the flat 1000 default for unknown provider', () => {
    expect(
      estimateImageTokens({ dimensions: { width: 500, height: 500 } }),
    ).toBe(1000);
    expect(estimateImageTokens({})).toBe(DEFAULT_IMAGE_TOKEN_ESTIMATE);
  });
});

describe('estimateImageTokens — unknown-dimension constants', () => {
  it('anthropic unknown dimensions -> 1590', () => {
    expect(estimateImageTokens({ provider: 'anthropic' })).toBe(1590);
  });

  it('the anthropic unknown fallback is never below a known estimate', () => {
    const fallback = estimateImageTokens({ provider: 'anthropic' });
    for (const dims of [
      { width: 1, height: 1 },
      { width: 1092, height: 1092 },
      { width: 4096, height: 4096 },
      { width: 30000, height: 30000 },
    ]) {
      expect(
        estimateImageTokens({ provider: 'anthropic', dimensions: dims }),
      ).toBeLessThanOrEqual(fallback);
    }
  });

  it('openai unknown dimensions -> 1105', () => {
    expect(estimateImageTokens({ provider: 'openai' })).toBe(1105);
  });

  it('gemini unknown dimensions -> 3000', () => {
    expect(estimateImageTokens({ provider: 'gemini' })).toBe(3000);
  });

  it('default unknown dimensions -> 1000', () => {
    expect(estimateImageTokens({})).toBe(1000);
  });
});

describe('estimateImageTokens — degenerate dimensions treated as unknown', () => {
  it('treats zero dimensions as unknown', () => {
    expect(
      estimateImageTokens({
        provider: 'anthropic',
        dimensions: { width: 0, height: 0 },
      }),
    ).toBe(1590);
  });

  it('treats negative dimensions as unknown', () => {
    expect(
      estimateImageTokens({
        provider: 'openai',
        dimensions: { width: -10, height: 100 },
      }),
    ).toBe(1105);
  });

  it('treats NaN dimensions as unknown', () => {
    expect(
      estimateImageTokens({
        provider: 'gemini',
        dimensions: { width: Number.NaN, height: 100 },
      }),
    ).toBe(3000);
  });

  it('treats Infinity dimensions as unknown', () => {
    expect(
      estimateImageTokens({
        provider: 'anthropic',
        dimensions: { width: Number.POSITIVE_INFINITY, height: 100 },
      }),
    ).toBe(1590);
  });

  it('always returns a positive integer', () => {
    const result = estimateImageTokens({
      provider: 'openai',
      dimensions: { width: 1024, height: 1024 },
    });
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });
});

describe('estimateNonTextPartTokens', () => {
  it('measures images from their parsed header dimensions', () => {
    expect(
      estimateNonTextPartTokens(
        'image/png',
        buildPngBase64(1092, 1092),
        'anthropic',
      ),
    ).toBe(1590);
    expect(
      estimateNonTextPartTokens(
        'image/png',
        buildPngBase64(1024, 1024),
        'openai',
      ),
    ).toBe(765);
  });

  it('uses the unknown-dimension estimate when the payload is unparseable', () => {
    expect(
      estimateNonTextPartTokens('image/png', 'not-a-real-png', 'anthropic'),
    ).toBe(1590);
    expect(estimateNonTextPartTokens('image/png', undefined, 'openai')).toBe(
      1105,
    );
  });

  it('returns the flat default for non-image binary payloads', () => {
    expect(
      estimateNonTextPartTokens('application/pdf', 'JVBERi0=', 'anthropic'),
    ).toBe(DEFAULT_IMAGE_TOKEN_ESTIMATE);
    expect(estimateNonTextPartTokens('audio/mpeg', 'AAAA', 'openai')).toBe(
      DEFAULT_IMAGE_TOKEN_ESTIMATE,
    );
    expect(estimateNonTextPartTokens(undefined, undefined)).toBe(
      DEFAULT_IMAGE_TOKEN_ESTIMATE,
    );
  });

  it('is case-insensitive on the image MIME type', () => {
    expect(
      estimateNonTextPartTokens(
        'IMAGE/PNG',
        buildPngBase64(200, 200),
        'anthropic',
      ),
    ).toBe(54);
  });

  it('falls back to the default family when no provider is supplied', () => {
    expect(
      estimateNonTextPartTokens('image/png', buildPngBase64(1024, 1024)),
    ).toBe(DEFAULT_IMAGE_TOKEN_ESTIMATE);
  });
});
