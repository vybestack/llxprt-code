/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseValue } from './setCommand.js';

describe('parseValue numeric edge cases', () => {
  it('parses integer strings as numbers', () => {
    expect(parseValue('42')).toBe(42);
    expect(parseValue('-7')).toBe(-7);
    expect(parseValue('0')).toBe(0);
  });

  it('parses decimal strings as numbers', () => {
    expect(parseValue('3.14')).toBe(3.14);
    expect(parseValue('-0.5')).toBe(-0.5);
  });

  it('returns trailing-dot values as strings (regression: "1." must not become 1)', () => {
    expect(parseValue('1.')).toBe('1.');
    expect(parseValue('-2.')).toBe('-2.');
  });

  it('parses leading-dot decimals as numbers (issue #2896)', () => {
    expect(parseValue('.5')).toBe(0.5);
    expect(parseValue('.95')).toBe(0.95);
    expect(parseValue('-.5')).toBe(-0.5);
  });

  it('parses exponent notation as numbers (issue #2896)', () => {
    expect(parseValue('1e-5')).toBe(1e-5);
    expect(parseValue('1.5e3')).toBe(1500);
    expect(parseValue('-2E+4')).toBe(-20000);
  });

  it('parses booleans', () => {
    expect(parseValue('true')).toBe(true);
    expect(parseValue('false')).toBe(false);
  });

  it('parses JSON objects', () => {
    expect(parseValue('{"a":1}')).toStrictEqual({ a: 1 });
  });

  it('returns non-JSON strings as-is', () => {
    expect(parseValue('hello')).toBe('hello');
  });

  it('rejects malformed numeric strings (issue #2896 A3)', () => {
    // Each must NOT become a number via looksNumeric — it falls through to
    // JSON.parse/string. Note: JSON.parse can convert some of these (e.g.
    // '1' with whitespace), but the numeric scanner itself must reject them.
    expect(parseValue('.')).toBe('.');
    expect(parseValue('-')).toBe('-');
    expect(parseValue('-.')).toBe('-.');
    expect(parseValue('1.2.3')).toBe('1.2.3');
    expect(parseValue('abc')).toBe('abc');
    expect(parseValue('1abc')).toBe('1abc');
    expect(parseValue('0x10')).toBe('0x10');
    expect(parseValue('Infinity')).toBe('Infinity');
    expect(parseValue('NaN')).toBe('NaN');
    expect(parseValue('1_000')).toBe('1_000');
    expect(parseValue('')).toBe('');
  });
});
