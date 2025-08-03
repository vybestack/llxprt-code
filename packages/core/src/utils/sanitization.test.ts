/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { sanitizeForByteString, needsSanitization } from './sanitization.js';

describe('sanitization utilities', () => {
  describe('sanitizeForByteString', () => {
    it('should remove Unicode replacement characters', () => {
      const input = 'valid\uFFFDtext';
      const result = sanitizeForByteString(input);
      expect(result).toBe('validtext');
    });

    it('should remove control characters', () => {
      const input = 'hello\x00world\x1Ftest\x7F';
      const result = sanitizeForByteString(input);
      expect(result).toBe('helloworldtest');
    });

    it('should remove non-ASCII characters', () => {
      const input = 'hello\u0080world\uFFFF';
      const result = sanitizeForByteString(input);
      expect(result).toBe('helloworld');
    });

    it('should handle mixed problematic characters', () => {
      const input = 'valid\uFFFDtext\x00with\u0080issues';
      const result = sanitizeForByteString(input);
      expect(result).toBe('validtextwithissues');
    });

    it('should trim the result', () => {
      const input = '  valid text  ';
      const result = sanitizeForByteString(input);
      expect(result).toBe('valid text');
    });

    it('should handle empty strings', () => {
      expect(sanitizeForByteString('')).toBe('');
      expect(sanitizeForByteString('   ')).toBe('');
    });

    it('should preserve ASCII printable characters', () => {
      const input = 'ABCabc123!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const result = sanitizeForByteString(input);
      expect(result).toBe(input);
    });
  });

  describe('needsSanitization', () => {
    it('should return false for clean strings', () => {
      expect(needsSanitization('clean text')).toBe(false);
      expect(needsSanitization('ABC123')).toBe(false);
    });

    it('should return true for strings with Unicode replacement characters', () => {
      expect(needsSanitization('text\uFFFD')).toBe(true);
    });

    it('should return true for strings with control characters', () => {
      expect(needsSanitization('text\x00')).toBe(true);
      expect(needsSanitization('text\x1F')).toBe(true);
      expect(needsSanitization('text\x7F')).toBe(true);
    });

    it('should return true for strings with non-ASCII characters', () => {
      expect(needsSanitization('text\u0080')).toBe(true);
      expect(needsSanitization('text\uFFFF')).toBe(true);
    });

    it('should ignore leading/trailing whitespace when checking', () => {
      expect(needsSanitization('  clean text  ')).toBe(false);
      expect(needsSanitization('  text\uFFFD  ')).toBe(true);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle API keys with encoding issues', () => {
      const apiKey = 'sk-1234567890abcdef\uFFFDghijklmnop\x00';
      const sanitized = sanitizeForByteString(apiKey);
      expect(sanitized).toBe('sk-1234567890abcdefghijklmnop');
      expect(needsSanitization(apiKey)).toBe(true);
    });

    it('should handle file content with BOM and control chars', () => {
      const content = '\uFEFFvalid content\x1A';
      const sanitized = sanitizeForByteString(content);
      expect(sanitized).toBe('valid content');
    });
  });
});
