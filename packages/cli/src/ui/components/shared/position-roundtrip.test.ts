/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { offsetToLogicalPos, logicalPosToOffset } from './buffer-operations.js';

/**
 * Phase 1.1: Position Round-Trip Property Tests
 *
 * These tests verify that logicalPosToOffset(offsetToLogicalPos(text, offset)) === offset
 * for valid offsets in various test cases.
 *
 * Part of Issue #1577 refactoring.
 */
describe('position conversion round-trip', () => {
  describe('basic cases', () => {
    it('round-trips for empty string', () => {
      const text = '';
      for (let offset = 0; offset <= text.length; offset++) {
        const [row, col] = offsetToLogicalPos(text, offset);
        const lines = text.split('\n');
        const reconstructed = logicalPosToOffset(lines, row, col);
        expect(reconstructed).toBe(offset);
      }
    });

    it('round-trips for single line without newline', () => {
      const text = 'hello';
      for (let offset = 0; offset <= text.length; offset++) {
        const [row, col] = offsetToLogicalPos(text, offset);
        const lines = text.split('\n');
        const reconstructed = logicalPosToOffset(lines, row, col);
        expect(reconstructed).toBe(offset);
      }
    });

    it('round-trips for single line with trailing newline', () => {
      const text = 'hello\n';
      for (let offset = 0; offset <= text.length; offset++) {
        const [row, col] = offsetToLogicalPos(text, offset);
        const lines = text.split('\n');
        const reconstructed = logicalPosToOffset(lines, row, col);
        expect(reconstructed).toBe(offset);
      }
    });

    it('round-trips for multi-line text', () => {
      const text = 'hello\nworld\ntest';
      for (let offset = 0; offset <= text.length; offset++) {
        const [row, col] = offsetToLogicalPos(text, offset);
        const lines = text.split('\n');
        const reconstructed = logicalPosToOffset(lines, row, col);
        expect(reconstructed).toBe(offset);
      }
    });
  });

  describe('unicode handling', () => {
    it('handles text with emoji without throwing', () => {
      const text = 'hello \u{1F600} world';
      expect(() => {
        for (let offset = 0; offset <= text.length; offset++) {
          const [row, col] = offsetToLogicalPos(text, offset);
          const lines = text.split('\n');
          logicalPosToOffset(lines, row, col);
        }
      }).not.toThrow();
    });

    it('handles text with combining characters without throwing', () => {
      const text = 'cafe\u0301';
      expect(() => {
        for (let offset = 0; offset <= text.length; offset++) {
          const [row, col] = offsetToLogicalPos(text, offset);
          const lines = text.split('\n');
          logicalPosToOffset(lines, row, col);
        }
      }).not.toThrow();
    });

    it('handles text with ZWJ emoji sequence without throwing', () => {
      const familyEmoji =
        '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
      const text = `hello ${familyEmoji} world`;
      expect(() => {
        for (let offset = 0; offset <= text.length; offset++) {
          const [row, col] = offsetToLogicalPos(text, offset);
          const lines = text.split('\n');
          logicalPosToOffset(lines, row, col);
        }
      }).not.toThrow();
    });

    it('handles text with CJK characters without throwing', () => {
      const text = 'hello\u4E16\u754Cworld';
      expect(() => {
        for (let offset = 0; offset <= text.length; offset++) {
          const [row, col] = offsetToLogicalPos(text, offset);
          const lines = text.split('\n');
          logicalPosToOffset(lines, row, col);
        }
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('round-trips for whitespace-only text', () => {
      const text = '   \n   \n   ';
      for (let offset = 0; offset <= text.length; offset++) {
        const [row, col] = offsetToLogicalPos(text, offset);
        const lines = text.split('\n');
        const reconstructed = logicalPosToOffset(lines, row, col);
        expect(reconstructed).toBe(offset);
      }
    });

    it('handles text ending at newline positions', () => {
      const text = 'line1\nline2\n';
      for (let offset = 0; offset <= text.length; offset++) {
        const [row, col] = offsetToLogicalPos(text, offset);
        const lines = text.split('\n');
        const reconstructed = logicalPosToOffset(lines, row, col);
        expect(reconstructed).toBe(offset);
      }
    });
  });
});
