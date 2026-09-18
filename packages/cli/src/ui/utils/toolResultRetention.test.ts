/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { Buffer } from 'node:buffer';
import {
  boundResultDisplayForRetention,
  RETENTION_TRUNCATION_MARKER,
  stringifyForDisplay,
  TOOL_RESULT_RETENTION_CAP_BYTES,
} from './toolResultRetention.js';

const KIB = 1024;

function makeBody(bytes: number, seed: string): string {
  const chunk = `${seed}-abcdefghijklmnopqrstuvwxyz0123456789`;
  const repeats = Math.ceil(bytes / chunk.length);
  return chunk.repeat(repeats).slice(0, Math.floor(bytes / 2));
}

describe('TOOL_RESULT_RETENTION_CAP_BYTES', () => {
  it('is the stated 64 KiB per-result retention cap', () => {
    expect(TOOL_RESULT_RETENTION_CAP_BYTES).toBe(64 * 1024);
  });
});

describe('boundResultDisplayForRetention', () => {
  it('leaves short results untouched', () => {
    const text = 'small tool output';

    const bounded = boundResultDisplayForRetention(text);

    expect(bounded).toStrictEqual({
      text,
      wasCapped: false,
      originalLength: Buffer.byteLength(text, 'utf8'),
    });
  });

  it('caps a large result to head + marker + tail within the cap', () => {
    const body = makeBody(2 * 1024 * KIB, 'head-tail');

    const bounded = boundResultDisplayForRetention(body);

    expect(bounded.wasCapped).toBe(true);
    expect(bounded.originalLength).toBe(Buffer.byteLength(body, 'utf8'));
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBeLessThanOrEqual(
      TOOL_RESULT_RETENTION_CAP_BYTES,
    );
    expect(bounded.text).toContain(RETENTION_TRUNCATION_MARKER);
    // The head is the original prefix and the tail is the original suffix.
    const [head, tail] = bounded.text.split(RETENTION_TRUNCATION_MARKER);
    expect(body.startsWith(head)).toBe(true);
    expect(body.endsWith(tail)).toBe(true);
  });

  it('never splits a UTF-8 code point at a cap boundary', () => {
    // 4-byte emoji only: every byte boundary not aligned to 4 lands mid
    // code point, so a naive byte slice would produce U+FFFD.
    const body = '😀'.repeat(64 * 1024);

    const bounded = boundResultDisplayForRetention(body);

    expect(bounded.wasCapped).toBe(true);
    expect(bounded.text).not.toContain('\uFFFD');
    const [head, tail] = bounded.text.split(RETENTION_TRUNCATION_MARKER);
    expect(head.length % 2).toBe(0);
    expect(tail.length % 2).toBe(0);
    expect(body.startsWith(head)).toBe(true);
    expect(body.endsWith(tail)).toBe(true);
  });

  it('says in the marker where the full body lives', () => {
    const bounded = boundResultDisplayForRetention(
      makeBody(2 * 1024 * KIB, 'marker'),
    );

    expect(RETENTION_TRUNCATION_MARKER).toContain(
      'full text is in the session transcript',
    );
    expect(bounded.text).toContain('session transcript');
  });

  it('bounds the worst case at 32 KiB head + marker + 32 KiB tail', () => {
    const body = 'x'.repeat(10 * 1024 * KIB);

    const bounded = boundResultDisplayForRetention(body);

    const markerBytes = Buffer.byteLength(RETENTION_TRUNCATION_MARKER, 'utf8');
    const budget = TOOL_RESULT_RETENTION_CAP_BYTES - markerBytes;
    const expected =
      Math.ceil(budget / 2) + markerBytes + Math.floor(budget / 2);
    expect(Buffer.byteLength(bounded.text, 'utf8')).toBe(expected);
  });
});

describe('stringifyForDisplay', () => {
  it('pretty-prints small values exactly like JSON.stringify', () => {
    const value = {
      fileName: 'a.ts',
      lines: [1, 2, 3],
      nested: { ok: true, note: null },
      empty: {},
      list: [],
    };

    expect(stringifyForDisplay(value)).toBe(JSON.stringify(value, null, 2));
    expect(stringifyForDisplay('plain')).toBe('"plain"');
    expect(stringifyForDisplay(42)).toBe('42');
    expect(stringifyForDisplay(null)).toBe('null');
  });

  it('omits deeper levels past the depth cutoff instead of rendering them', () => {
    let value: unknown = { leaf: 'DEEP_SECRET' };
    for (let depth = 0; depth < 40; depth += 1) {
      value = { child: value };
    }

    const text = stringifyForDisplay(value);

    expect(text).not.toContain('DEEP_SECRET');
    expect(text).toContain('full result is in the session transcript');
  });

  it('stops serializing once the retention cap is reached', () => {
    const value = Object.fromEntries(
      Array.from({ length: 4000 }, (_, index) => [
        `key${index}`,
        `value-${index}-${'v'.repeat(100)}`,
      ]),
    );

    const text = stringifyForDisplay(value);

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      TOOL_RESULT_RETENTION_CAP_BYTES,
    );
    expect(text).toContain('full result is in the session transcript');
    expect(text).not.toContain(`value-3999-`);
  });

  it('truncates a single huge string value in place', () => {
    const value = { ok: true, content: 'B'.repeat(5 * 1024 * KIB) };

    const text = stringifyForDisplay(value);

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      TOOL_RESULT_RETENTION_CAP_BYTES,
    );
    expect(text).toContain('full result is in the session transcript');
    expect(text).toContain('"ok": true');
  });

  it('retains a truncated CJK string preview instead of discarding it', () => {
    // ~30,000 CJK chars are ~90,000 UTF-8 bytes but only ~30,000 UTF-16
    // code units: the fit check passed by code units while the emitter's
    // byte accounting rejected the chunk, which discarded the string
    // preview entirely.
    const value = { content: '中'.repeat(30_000) };

    const text = stringifyForDisplay(value);

    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
      TOOL_RESULT_RETENTION_CAP_BYTES,
    );
    // The preview survives: real CJK content is emitted, truncated in
    // place with the in-band omission markers, not thrown away.
    expect(text).toContain('中');
    expect(text).toContain('string truncated for display');
    expect(text).toContain('full result is in the session transcript');
    // ASCII behavior is unchanged: small values still pretty-print exactly.
    const small = { fileName: 'a.ts', lines: [1, 2, 3], ok: true };
    expect(stringifyForDisplay(small)).toBe(JSON.stringify(small, null, 2));
  });

  it('survives circular references without throwing', () => {
    const value: Record<string, unknown> = { name: 'cycle' };
    value.self = value;

    const text = stringifyForDisplay(value);

    expect(text).toContain('cycle');
    expect(text).toContain('[Circular]');
  });
});
