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

  it('returns leading-dot values as strings', () => {
    expect(parseValue('.5')).toBe('.5');
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
});
