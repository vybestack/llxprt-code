/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getTransformedImagePath,
  calculateTransformationsForLine,
  calculateTransformations,
  getTransformUnderCursor,
} from './transformations.js';

/**
 * Phase 2.4: Transformations Tests
 *
 * These tests verify image path transformation functions that will be moved to transformations.ts.
 * Part of Issue #1577 refactoring.
 */
describe('transformations', () => {
  describe('getTransformedImagePath', () => {
    it('should transform @path/image.png format', () => {
      const result = getTransformedImagePath('@path/to/image.png');
      expect(result).toBe('[Image image.png]');
    });

    it('should transform @file.jpg format', () => {
      const result = getTransformedImagePath('@file.jpg');
      expect(result).toBe('[Image file.jpg]');
    });

    it('should handle file with no extension', () => {
      const result = getTransformedImagePath('@path/to/file');
      expect(result).toContain('[Image');
    });

    it('should handle deeply nested paths', () => {
      const result = getTransformedImagePath(
        '@very/deep/nested/path/image.png',
      );
      expect(result).toBe('[Image image.png]');
    });

    it('should truncate long base names', () => {
      const longName = 'a'.repeat(50);
      const result = getTransformedImagePath(`@${longName}.png`);
      expect(result).not.toBe(`[Image ${longName}.png]`);
      expect(result).toContain('.png');
      expect(result.length).toBeLessThan(`[Image ${longName}.png]`.length);
    });

    it('should preserve extension in output', () => {
      const result = getTransformedImagePath('@test.gif');
      expect(result).toContain('.gif');
    });
  });

  describe('calculateTransformationsForLine', () => {
    it('should find image path in text', () => {
      const line = 'Check out @path/image.png here';
      const result = calculateTransformationsForLine(line);
      expect(result.length).toBe(1);
      expect(result[0].logicalText).toBe('@path/image.png');
    });

    it('should find multiple image paths', () => {
      const line = '@img1.png and @img2.jpg';
      const result = calculateTransformationsForLine(line);
      expect(result.length).toBe(2);
    });

    it('should return empty array for no matches', () => {
      const line = 'Just plain text';
      const result = calculateTransformationsForLine(line);
      expect(result).toEqual([]);
    });

    it('should calculate correct positions', () => {
      const line = 'Start @img.png end';
      const result = calculateTransformationsForLine(line);
      expect(result[0].logStart).toBe(6);
      expect(result[0].logicalText).toBe('@img.png');
    });

    it('should handle paths with escaped spaces', () => {
      const line = 'Image: @path/with\\ escaped/image.png';
      const result = calculateTransformationsForLine(line);
      expect(result.length).toBe(1);
    });
  });

  describe('calculateTransformations', () => {
    it('should process multiple lines', () => {
      const lines = ['@img1.png', 'plain text', '@img2.jpg'];
      const result = calculateTransformations(lines);
      expect(result.length).toBe(3);
      expect(result[0].length).toBe(1);
      expect(result[1].length).toBe(0);
      expect(result[2].length).toBe(1);
    });

    it('should return empty arrays for lines without images', () => {
      const lines = ['line 1', 'line 2'];
      const result = calculateTransformations(lines);
      expect(result[0]).toEqual([]);
      expect(result[1]).toEqual([]);
    });

    it('should handle empty lines array', () => {
      const result = calculateTransformations([]);
      expect(result).toEqual([]);
    });
  });

  describe('getTransformUnderCursor', () => {
    it('should find transform at cursor position', () => {
      const spansByLine = [
        [
          {
            logStart: 6,
            logEnd: 14,
            logicalText: '@img.png',
            collapsedText: '[Image img.png]',
          },
        ],
      ];
      const result = getTransformUnderCursor(0, 8, spansByLine);
      expect(result).not.toBeNull();
      expect(result?.logicalText).toBe('@img.png');
    });

    it('should return null when cursor outside transform', () => {
      const spansByLine = [
        [
          {
            logStart: 6,
            logEnd: 14,
            logicalText: '@img.png',
            collapsedText: '[Image img.png]',
          },
        ],
      ];
      const result = getTransformUnderCursor(0, 2, spansByLine);
      expect(result).toBeNull();
    });

    it('should return null for empty spans', () => {
      const spansByLine = [[]];
      const result = getTransformUnderCursor(0, 5, spansByLine);
      expect(result).toBeNull();
    });

    it('should handle cursor at exact boundaries', () => {
      const spansByLine = [
        [
          {
            logStart: 6,
            logEnd: 14,
            logicalText: '@img.png',
            collapsedText: '[Image img.png]',
          },
        ],
      ];
      expect(getTransformUnderCursor(0, 6, spansByLine)).not.toBeNull();
      expect(getTransformUnderCursor(0, 14, spansByLine)).not.toBeNull();
      expect(getTransformUnderCursor(0, 15, spansByLine)).toBeNull();
    });
  });
});
