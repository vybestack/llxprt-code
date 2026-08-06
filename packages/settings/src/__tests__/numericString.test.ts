/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { isStrictNumericString } from '../settings/numericString.js';

describe('isStrictNumericString', () => {
  describe('accepts valid numeric strings', () => {
    it.each([
      ['12', true],
      ['-7', true],
      ['0', true],
      ['0.95', true],
      ['-0.95', true],
      ['.95', true],
      ['-.5', true],
      ['1e-5', true],
      ['1.5e3', true],
      ['-2E+4', true],
      ['3.14', true],
      ['-0.5', true],
    ])('accepts %s', (input, expected) => {
      expect(isStrictNumericString(input)).toBe(expected);
    });
  });

  describe('rejects invalid numeric strings', () => {
    it.each([
      ['', false],
      ['.', false],
      ['-', false],
      ['-.', false],
      ['1.', false],
      ['-2.', false],
      ['1.2.3', false],
      ['abc', false],
      ['1abc', false],
      ['0x10', false],
      ['Infinity', false],
      ['NaN', false],
      ['1_000', false],
      [' 1', false],
      ['1 ', false],
      ['  ', false],
      ['+1.5', false],
      ['+3', false],
      ['+.5', false],
    ])('rejects %s', (input, expected) => {
      expect(isStrictNumericString(input)).toBe(expected);
    });
  });
});
