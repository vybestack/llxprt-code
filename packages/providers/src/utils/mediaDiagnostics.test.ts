/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { sanitizeDiagnosticData } from './mediaDiagnostics.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('sanitizeDiagnosticData media handling', () => {
  it('hashes long base64 media while preserving decoded-byte identity and redaction', () => {
    const bytes = Buffer.alloc(256 * 1024, 0x5a);
    const base64 = bytes.toString('base64');
    const expectedId = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

    const sanitized = sanitizeDiagnosticData({
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png',
      data: base64,
      sourcePath: '/private/image.png',
    });

    expect(sanitized).toStrictEqual({
      contentId: expectedId,
      byteCount: bytes.byteLength,
      mimeType: 'image/png',
      transportMode: 'full',
    });
    expect(JSON.stringify(sanitized)).not.toContain(base64);
  });

  it('does not compute and discard a media diagnostic in explicit raw mode', () => {
    const base64 = Buffer.from([1, 2, 3, 4]).toString('base64');
    let dataReads = 0;
    const media: Record<string, unknown> = {
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png',
      sourcePath: '/private/image.png',
    };
    Object.defineProperty(media, 'data', {
      enumerable: true,
      get(): string {
        dataReads += 1;
        if (dataReads > 1) throw new Error('media data was read twice');
        return base64;
      },
    });

    const sanitized = sanitizeDiagnosticData(media, { media: 'raw' });
    if (!isRecord(sanitized)) throw new Error('expected a sanitized record');

    expect(sanitized['data']).toBe(base64);
    expect(sanitized['sourcePath']).toBeUndefined();
    expect(dataReads).toBe(1);
  });
});
