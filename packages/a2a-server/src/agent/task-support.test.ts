/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { applyReplacement } from './task-support.js';

describe('applyReplacement', () => {
  describe('isNewFile behavior', () => {
    it('should return newString if isNewFile is true', () => {
      expect(applyReplacement(null, 'old', 'new', true)).toBe('new');
      expect(applyReplacement('existing', 'old', 'new', true)).toBe('new');
    });
  });

  describe('null currentContent handling', () => {
    it('should return newString if currentContent is null and oldString is empty (defensive)', () => {
      expect(applyReplacement(null, '', 'new', false)).toBe('new');
    });

    it('should return empty string if currentContent is null and oldString is not empty (defensive)', () => {
      expect(applyReplacement(null, 'old', 'new', false)).toBe('');
    });
  });

  describe('empty oldString handling', () => {
    it('should return currentContent if oldString is empty and not a new file', () => {
      expect(applyReplacement('hello world', '', 'new', false)).toBe(
        'hello world',
      );
    });
  });

  describe('single replacement (default)', () => {
    it('should replace only the first occurrence with default expectedReplacements=1', () => {
      expect(applyReplacement('hello old world old', 'old', 'new', false)).toBe(
        'hello new world old',
      );
    });

    it('should handle text with special characters', () => {
      expect(
        applyReplacement(
          'path/to/file path/to/other',
          'path/to',
          'new/path',
          false,
        ),
      ).toBe('new/path/file path/to/other');
    });
  });

  describe('multiple replacements', () => {
    it('should replace all occurrences when expectedReplacements > 1', () => {
      expect(
        applyReplacement('hello old world old', 'old', 'new', false, 2),
      ).toBe('hello new world new');
    });

    it('should replace all occurrences with replaceAll when expectedReplacements is large', () => {
      expect(applyReplacement('a b a b a', 'a', 'X', false, 10)).toBe(
        'X b X b X',
      );
    });
  });

  describe('edge cases', () => {
    it('should handle replacement when oldString not found', () => {
      expect(applyReplacement('hello world', 'notfound', 'new', false)).toBe(
        'hello world',
      );
    });

    it('should handle replacement with identical old and new strings', () => {
      expect(applyReplacement('hello world', 'hello', 'hello', false)).toBe(
        'hello world',
      );
    });

    it('should handle empty newString (deletion)', () => {
      expect(applyReplacement('hello world', ' world', '', false)).toBe(
        'hello',
      );
    });

    it('should handle oldString containing special regex characters literally', () => {
      // Test that $ is treated literally, not as a regex special character
      expect(applyReplacement('price: $100 price: $200', '$', '€', false)).toBe(
        'price: €100 price: $200',
      );

      expect(
        applyReplacement('price: $100 price: $200', '$', '€', false, 2),
      ).toBe('price: €100 price: €200');
    });
  });
});
