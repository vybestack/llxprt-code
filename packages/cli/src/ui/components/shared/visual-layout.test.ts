/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import '../../../test-utils/customMatchers.js';
import type { VisualLayout } from './text-buffer.js';

describe('visual-layout', () => {
  describe('VisualLayout type', () => {
    it('should accept valid VisualLayout structure', () => {
      const layout: VisualLayout = {
        visualLines: ['hello', 'world'],
        logicalToVisualMap: [[[0, 0]], [[1, 0]]],
        visualToLogicalMap: [
          [0, 0],
          [1, 0],
        ],
        transformedToLogicalMaps: [[], []],
        visualToTransformedMap: [0, 0],
      };
      expect(layout.visualLines).toHaveLength(2);
    });

    it('should handle empty layout', () => {
      const layout: VisualLayout = {
        visualLines: [''],
        logicalToVisualMap: [[[0, 0]]],
        visualToLogicalMap: [[0, 0]],
        transformedToLogicalMaps: [[]],
        visualToTransformedMap: [0],
      };
      expect(layout.visualLines[0]).toBe('');
    });
  });

  describe('layout invariants', () => {
    it('should maintain visualLines array structure', () => {
      const layout: VisualLayout = {
        visualLines: ['line1', 'line2'],
        logicalToVisualMap: [[[0, 0]], [[0, 6]]],
        visualToLogicalMap: [
          [0, 0],
          [0, 6],
        ],
        transformedToLogicalMaps: [
          [0, 1, 2, 3, 4, 5],
          [0, 1, 2, 3, 4, 5],
        ],
        visualToTransformedMap: [0, 0],
      };
      // visualLines length should match visualToLogicalMap length
      expect(layout.visualLines.length).toBe(layout.visualToLogicalMap.length);
    });

    it('should maintain mapping consistency', () => {
      const layout: VisualLayout = {
        visualLines: ['test'],
        logicalToVisualMap: [[[0, 0]]],
        visualToLogicalMap: [[0, 0]],
        transformedToLogicalMaps: [[0, 1, 2, 3]],
        visualToTransformedMap: [0],
      };
      // Each visual line should have a corresponding logical mapping
      for (let i = 0; i < layout.visualLines.length; i++) {
        expect(layout.visualToLogicalMap[i]).toBeDefined();
      }
    });
  });
});
