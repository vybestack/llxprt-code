/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { utf8ByteLength, withinByteBound } from './jspBounds.js';

describe('utf8ByteLength', () => {
  it('counts ASCII as 1 byte per char', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });

  it('counts multibyte characters inclusively', () => {
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('𝕏')).toBe(4);
  });

  it('counts a mixed string by actual UTF-8 bytes', () => {
    expect(utf8ByteLength('aé€𝕏')).toBe(1 + 2 + 3 + 4);
  });
});

describe('withinByteBound', () => {
  it('accepts content at the inclusive limit', () => {
    const atLimit = 'a'.repeat(16 * 1024);
    expect(withinByteBound(atLimit, 16 * 1024)).toBe(true);
  });

  it('rejects content one byte over the limit', () => {
    const over = 'a'.repeat(16 * 1024 + 1);
    expect(withinByteBound(over, 16 * 1024)).toBe(false);
  });

  it('rejects a single multibyte char that crosses the byte limit', () => {
    const fill = 'a'.repeat(16 * 1024 - 1);
    expect(withinByteBound(fill + '€', 16 * 1024)).toBe(false);
  });

  it('counts inclusive bytes for todo text at 2 KiB', () => {
    const text = 'x'.repeat(2 * 1024);
    expect(withinByteBound(text, 2 * 1024)).toBe(true);
  });
});
