/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  isWordCharStrict,
  isWhitespace,
  isCombiningMark,
  isWordCharWithCombining,
  findNextWordStartInLine,
  findPrevWordStartInLine,
  findWordEndInLine,
  findNextWordAcrossLines,
  findPrevWordAcrossLines,
} from './text-buffer.js';

/**
 * Phase 2.2: Word Navigation Tests
 *
 * These tests verify word navigation functions that will be moved to word-navigation.ts.
 * Part of Issue #1577 refactoring.
 */
describe('word-navigation', () => {
  describe('isWordCharStrict', () => {
    it('should return true for alphanumeric characters', () => {
      expect(isWordCharStrict('a')).toBe(true);
      expect(isWordCharStrict('Z')).toBe(true);
      expect(isWordCharStrict('5')).toBe(true);
      expect(isWordCharStrict('_')).toBe(true);
    });

    it('should return false for whitespace', () => {
      expect(isWordCharStrict(' ')).toBe(false);
      expect(isWordCharStrict('\t')).toBe(false);
      expect(isWordCharStrict('\n')).toBe(false);
    });

    it('should return false for punctuation', () => {
      expect(isWordCharStrict('.')).toBe(false);
      expect(isWordCharStrict(',')).toBe(false);
      expect(isWordCharStrict('!')).toBe(false);
    });

    it('should return true for Unicode letters', () => {
      expect(isWordCharStrict('\u00E9')).toBe(true); // é
      expect(isWordCharStrict('\u4E2D')).toBe(true); // Chinese character
    });
  });

  describe('isWhitespace', () => {
    it('should return true for whitespace characters', () => {
      expect(isWhitespace(' ')).toBe(true);
      expect(isWhitespace('\t')).toBe(true);
      expect(isWhitespace('\n')).toBe(true);
      expect(isWhitespace('\r')).toBe(true);
    });

    it('should return false for non-whitespace', () => {
      expect(isWhitespace('a')).toBe(false);
      expect(isWhitespace('1')).toBe(false);
      expect(isWhitespace('.')).toBe(false);
    });
  });

  describe('isCombiningMark', () => {
    it('should return true for combining marks', () => {
      expect(isCombiningMark('\u0301')).toBe(true); // combining acute accent
      expect(isCombiningMark('\u0300')).toBe(true); // combining grave accent
    });

    it('should return false for base characters', () => {
      expect(isCombiningMark('a')).toBe(false);
      expect(isCombiningMark('e')).toBe(false);
    });
  });

  describe('isWordCharWithCombining', () => {
    it('should return true for word characters', () => {
      expect(isWordCharWithCombining('a')).toBe(true);
      expect(isWordCharWithCombining('5')).toBe(true);
    });

    it('should return true for combining marks', () => {
      expect(isWordCharWithCombining('\u0301')).toBe(true);
    });

    it('should return false for whitespace', () => {
      expect(isWordCharWithCombining(' ')).toBe(false);
    });
  });

  describe('findNextWordStartInLine', () => {
    it('should find next word start in same line', () => {
      const line = 'hello world';
      const result = findNextWordStartInLine(line, 0);
      expect(result).toBe(6); // Start of 'world'
    });

    it('should skip multiple spaces', () => {
      const line = 'hello   world';
      const result = findNextWordStartInLine(line, 2);
      expect(result).toBe(8); // Start of 'world'
    });

    it('should return null if no next word', () => {
      const line = 'hello ';
      const result = findNextWordStartInLine(line, 3);
      expect(result).toBeNull();
    });

    it('should handle empty line', () => {
      const line = '';
      const result = findNextWordStartInLine(line, 0);
      expect(result).toBeNull();
    });
  });

  describe('findPrevWordStartInLine', () => {
    it('should find previous word start', () => {
      const line = 'hello world';
      const result = findPrevWordStartInLine(line, 8);
      expect(result).toBe(6); // Start of 'world'
    });

    it('should skip whitespace', () => {
      const line = 'hello   world';
      const result = findPrevWordStartInLine(line, 10);
      expect(result).toBe(8); // Start of 'world'
    });

    it('should return null at line start', () => {
      const line = 'hello';
      const result = findPrevWordStartInLine(line, 0);
      expect(result).toBeNull();
    });
  });

  describe('findWordEndInLine', () => {
    it('should find word end', () => {
      const line = 'hello world';
      const result = findWordEndInLine(line, 0);
      expect(result).toBe(4); // End of 'hello'
    });

    it('should handle starting in middle of word', () => {
      const line = 'hello world';
      const result = findWordEndInLine(line, 2);
      expect(result).toBe(4); // End of 'hello'
    });

    it('should return null if at end', () => {
      const line = 'hello';
      const result = findWordEndInLine(line, 5);
      expect(result).toBeNull();
    });
  });

  describe('findNextWordAcrossLines', () => {
    it('should find next word on same line', () => {
      const lines = ['hello world', 'second line'];
      const result = findNextWordAcrossLines(lines, 0, 0, true);
      expect(result).toEqual({ row: 0, col: 6 });
    });

    it('should find word on next line', () => {
      const lines = ['hello ', 'world'];
      const result = findNextWordAcrossLines(lines, 0, 6, true);
      expect(result).toEqual({ row: 1, col: 0 });
    });

    it('should return null if no more words', () => {
      const lines = ['hello ', '   '];
      const result = findNextWordAcrossLines(lines, 0, 6, true);
      expect(result).toBeNull();
    });
  });

  describe('findPrevWordAcrossLines', () => {
    it('should find previous word on same line', () => {
      const lines = ['hello world'];
      const result = findPrevWordAcrossLines(lines, 0, 8);
      expect(result).toEqual({ row: 0, col: 6 }); // Start of 'world'
    });

    it('should find word on previous line', () => {
      const lines = ['hello', ' world'];
      const result = findPrevWordAcrossLines(lines, 1, 1);
      expect(result).toEqual({ row: 0, col: 0 }); // Start of 'hello'
    });

    it('should return null at document start', () => {
      const lines = ['hello'];
      const result = findPrevWordAcrossLines(lines, 0, 0);
      expect(result).toBeNull();
    });
  });
});
