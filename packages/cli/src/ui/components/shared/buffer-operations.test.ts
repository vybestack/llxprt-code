/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  replaceRangeInternal,
  pushUndo,
  offsetToLogicalPos,
  logicalPosToOffset,
} from './buffer-operations.js';
import type { TextBufferState } from './buffer-types.js';

/**
 * Phase 2.3: Buffer Operations Tests
 *
 * These tests verify buffer operations that will be moved to buffer-operations.ts.
 * Part of Issue #1577 refactoring.
 */
describe('buffer-operations', () => {
  const createState = (lines: string[]): TextBufferState => ({
    lines,
    cursorRow: 0,
    cursorCol: 0,
    preferredCol: null,
    undoStack: [],
    redoStack: [],
    clipboard: null,
    selectionAnchor: null,
    viewportWidth: 80,
    viewportHeight: 24,
    visualLayout: {
      visualLines: lines.length ? [lines[0]] : [''],
      logicalToVisualMap: [[[0, 0]]],
      visualToLogicalMap: [[0, 0]],
      transformedToLogicalMaps: [[]],
      visualToTransformedMap: [0],
    },
    transformationsByLine: [[]],
  });

  describe('replaceRangeInternal', () => {
    it('should replace text in same line', () => {
      const state = createState(['hello world']);
      const result = replaceRangeInternal(state, 0, 0, 0, 5, 'hi');
      expect(result.lines).toStrictEqual(['hi world']);
      expect(result.cursorCol).toBe(2);
    });

    it('should replace across multiple lines', () => {
      const state = createState(['hello', 'world', 'test']);
      const result = replaceRangeInternal(state, 0, 2, 2, 2, 'X');
      expect(result.lines).toStrictEqual(['heXst']);
    });

    it('should insert newlines', () => {
      const state = createState(['hello world']);
      const result = replaceRangeInternal(state, 0, 5, 0, 6, '\n');
      expect(result.lines).toStrictEqual(['hello', 'world']);
    });

    it('should handle empty replacement', () => {
      const state = createState(['hello world']);
      const result = replaceRangeInternal(state, 0, 5, 0, 6, '');
      expect(result.lines).toStrictEqual(['helloworld']);
    });

    it('should handle replacement at line boundaries', () => {
      const state = createState(['hello']);
      const result = replaceRangeInternal(state, 0, 0, 0, 5, 'X');
      expect(result.lines).toStrictEqual(['X']);
    });
  });

  describe('pushUndo', () => {
    it('should add current state to undo stack', () => {
      const state = createState(['hello']);
      state.cursorRow = 0;
      state.cursorCol = 3;
      const result = pushUndo(state);
      expect(result.undoStack).toHaveLength(1);
      expect(result.undoStack[0].lines).toStrictEqual(['hello']);
      expect(result.undoStack[0].cursorRow).toBe(0);
      expect(result.undoStack[0].cursorCol).toBe(3);
      expect(result.redoStack).toStrictEqual([]);
    });

    it('should limit undo stack size', () => {
      let state = createState(['test']);
      // Push 110 items to exceed the 100 limit
      for (let i = 0; i < 110; i++) {
        state = pushUndo(state);
        state.lines = [`test${i}`];
      }
      expect(state.undoStack.length).toBeLessThanOrEqual(100);
    });
  });

  describe('offsetToLogicalPos', () => {
    it('should convert offset to position', () => {
      const text = 'hello\nworld';
      const [row, col] = offsetToLogicalPos(text, 0);
      expect(row).toBe(0);
      expect(col).toBe(0);
    });

    it('should handle offset at newline', () => {
      const text = 'hello\nworld';
      const [row, col] = offsetToLogicalPos(text, 5);
      expect(row).toBe(0);
      expect(col).toBe(5);
    });

    it('should handle offset past newline', () => {
      const text = 'hello\nworld';
      const [row, col] = offsetToLogicalPos(text, 6);
      expect(row).toBe(1);
      expect(col).toBe(0);
    });

    it('should handle empty text', () => {
      const [row, col] = offsetToLogicalPos('', 0);
      expect(row).toBe(0);
      expect(col).toBe(0);
    });

    it('should handle offset beyond text', () => {
      const text = 'hi';
      const [row, col] = offsetToLogicalPos(text, 100);
      expect(row).toBe(0);
      expect(col).toBe(2);
    });
  });

  describe('logicalPosToOffset', () => {
    it('should convert position to offset', () => {
      const lines = ['hello', 'world'];
      const offset = logicalPosToOffset(lines, 0, 0);
      expect(offset).toBe(0);
    });

    it('should calculate offset across lines', () => {
      const lines = ['hello', 'world'];
      const offset = logicalPosToOffset(lines, 1, 0);
      expect(offset).toBe(6); // 'hello' + newline
    });

    it('should handle column within line', () => {
      const lines = ['hello', 'world'];
      const offset = logicalPosToOffset(lines, 1, 3);
      expect(offset).toBe(9); // 'hello' + newline + 'wor'
    });

    it('should clamp row to valid range', () => {
      const lines = ['hello'];
      const offset = logicalPosToOffset(lines, 10, 0);
      expect(offset).toBe(0); // Clamped to row 0
    });

    it('should handle empty lines array', () => {
      const offset = logicalPosToOffset([], 0, 0);
      expect(offset).toBe(0);
    });
  });
});
