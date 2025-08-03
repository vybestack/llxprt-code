/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeUnicodeReplacements,
  hasUnicodeReplacements,
  ensureJsonSafe,
  cleanCp932Artifacts,
} from './unicodeUtils.js';

describe('Unicode utilities regression tests', () => {
  describe('sanitizeUnicodeReplacements', () => {
    it('should remove Unicode replacement characters', () => {
      const input = 'Hello\uFFFDWorld\uFFFD!';
      const result = sanitizeUnicodeReplacements(input);
      expect(result).toBe('Hello?World?!');
      expect(result).not.toContain('\uFFFD');
    });

    it('should use custom replacement when specified', () => {
      const input = 'Data\uFFFDCorrupted';
      const result = sanitizeUnicodeReplacements(input, '[INVALID]');
      expect(result).toBe('Data[INVALID]Corrupted');
    });

    it('should handle multiple consecutive replacement characters', () => {
      const input = 'Test\uFFFD\uFFFD\uFFFDEnd';
      const result = sanitizeUnicodeReplacements(input);
      expect(result).toBe('Test???End');
    });
  });

  describe('hasUnicodeReplacements', () => {
    it('should detect Unicode replacement characters', () => {
      expect(hasUnicodeReplacements('Normal text')).toBe(false);
      expect(hasUnicodeReplacements('Text with \uFFFD')).toBe(true);
      expect(hasUnicodeReplacements('\uFFFD')).toBe(true);
    });
  });

  describe('ensureJsonSafe', () => {
    it('should remove control characters except tab, newline, and carriage return', () => {
      const input = 'Text\x00with\x01control\x02chars\nkeep\ttabs\r';
      const result = ensureJsonSafe(input);
      expect(result).toBe('Textwithcontrolchars\nkeep\ttabs\r');
      expect(result).toContain('\n');
      expect(result).toContain('\t');
      expect(result).toContain('\r');
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('\x01');
      expect(result).not.toContain('\x02');
    });

    it('should handle Unicode replacement characters', () => {
      const input = 'JSON\uFFFDSafe';
      const result = ensureJsonSafe(input);
      expect(result).toBe('JSON?Safe');
    });

    it('should fix invalid surrogate pairs', () => {
      // Unpaired high surrogate
      const input1 = 'Test\uD800End';
      const result1 = ensureJsonSafe(input1);
      expect(result1).toBe('Test?End');

      // Unpaired low surrogate
      const input2 = 'Test\uDC00End';
      const result2 = ensureJsonSafe(input2);
      expect(result2).toBe('Test?End');

      // Valid surrogate pair (should be preserved)
      const input3 = 'Test\uD83D\uDE00End'; // 😀
      const result3 = ensureJsonSafe(input3);
      expect(result3).toBe('Test😀End');
    });

    it('should handle mixed issues in one string', () => {
      const input = 'Mixed\x00\uFFFD\uD800issues\x7F';
      const result = ensureJsonSafe(input);
      expect(result).toBe('Mixed??issues');
    });
  });

  describe('cleanCp932Artifacts', () => {
    it('should clean common cp932 decoding artifacts', () => {
      const input = '髮｢繧ｳ繝ｼ繝｡繝ｳ繝医';
      const result = cleanCp932Artifacts(input);
      expect(result).toBe('陰コーメント');
    });

    it('should handle multiple artifacts in one string', () => {
      const input = '邨ｱ髮｢';
      const result = cleanCp932Artifacts(input);
      expect(result).toBe('結陰');
    });

    it('should leave non-artifact text unchanged', () => {
      const input = 'Normal Japanese text: こんにちは';
      const result = cleanCp932Artifacts(input);
      expect(result).toBe(input);
    });

    it('should handle mixed artifact and normal text', () => {
      const input = 'Before 髮｢ after 繧ｳ end';
      const result = cleanCp932Artifacts(input);
      expect(result).toBe('Before 陰 after コ end');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle API key with encoding issues', () => {
      // Simulate an API key read from a file with encoding issues
      const apiKey = 'sk-1234567890abcdef\uFFFDghijklmnop\x00';
      const cleaned = ensureJsonSafe(apiKey);
      expect(cleaned).toBe('sk-1234567890abcdef?ghijklmnop');
      expect(cleaned).not.toContain('\uFFFD');
      expect(cleaned).not.toContain('\x00');
    });

    it('should handle shell output with cp932 artifacts', () => {
      // Simulate garbled Japanese error message from Windows shell
      // Using artifacts we have mappings for
      const shellOutput = 'Error: 繧ｳ繝ｼ繝｡繝ｳ繝医′髮｢';
      const cleaned = cleanCp932Artifacts(shellOutput);
      // Should clean to: "Error: コーメントが陰"
      expect(cleaned).not.toBe(shellOutput);
      expect(cleaned).toContain('コーメント');
    });

    it('should make API request content safe', () => {
      const userInput =
        'User message with\uFFFDencoding issues\x00and control chars';
      const safe = ensureJsonSafe(userInput);

      // Should be safe to JSON stringify
      expect(() => JSON.stringify({ content: safe })).not.toThrow();
      expect(safe).toBe('User message with?encoding issuesand control chars');
    });
  });
});
