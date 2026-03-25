/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { textBufferReducer } from './buffer-reducer.js';
import type { TextBufferState, TextBufferAction } from './buffer-types.js';

/**
 * Phase 2.6: Buffer Reducer Tests
 *
 * These tests verify reducer actions that will be moved to buffer-reducer.ts.
 * Part of Issue #1577 refactoring.
 */
describe('buffer-reducer', () => {
  const createState = (
    overrides: Partial<TextBufferState> = {},
  ): TextBufferState => ({
    lines: [''],
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
      visualLines: [''],
      logicalToVisualMap: [[[0, 0]]],
      visualToLogicalMap: [[0, 0]],
      transformedToLogicalMaps: [[]],
      visualToTransformedMap: [0],
    },
    transformationsByLine: [[]],
    ...overrides,
  });

  describe('set_text action', () => {
    it('should set text and move cursor to end', () => {
      const state = createState();
      const action: TextBufferAction = { type: 'set_text', payload: 'hello' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['hello']);
      expect(result.cursorRow).toBe(0);
      expect(result.cursorCol).toBe(5);
    });

    it('should handle multi-line text', () => {
      const state = createState();
      const action: TextBufferAction = {
        type: 'set_text',
        payload: 'hello\nworld',
      };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['hello', 'world']);
      expect(result.cursorRow).toBe(1);
      expect(result.cursorCol).toBe(5);
    });

    it('should not create undo snapshot if pushToUndo is false', () => {
      const state = createState();
      const action: TextBufferAction = {
        type: 'set_text',
        payload: 'test',
        pushToUndo: false,
      };
      const result = textBufferReducer(state, action);
      expect(result.undoStack).toHaveLength(0);
    });
  });

  describe('insert action', () => {
    it('should insert character', () => {
      const state = createState();
      const action: TextBufferAction = { type: 'insert', payload: 'a' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['a']);
      expect(result.cursorCol).toBe(1);
    });

    it('should insert multiple characters', () => {
      const state = createState();
      const action: TextBufferAction = { type: 'insert', payload: 'hello' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['hello']);
      expect(result.cursorCol).toBe(5);
    });

    it('should insert newline', () => {
      const state = createState({ lines: ['hello'] });
      const action: TextBufferAction = { type: 'insert', payload: '\n' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['', 'hello']);
      expect(result.cursorRow).toBe(1);
    });

    it('should create undo snapshot', () => {
      const state = createState();
      const action: TextBufferAction = { type: 'insert', payload: 'x' };
      const result = textBufferReducer(state, action);
      expect(result.undoStack).toHaveLength(1);
    });
  });

  describe('backspace action', () => {
    it('should delete character before cursor', () => {
      const state = createState({ lines: ['hello'], cursorCol: 5 });
      const action: TextBufferAction = { type: 'backspace' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['hell']);
      expect(result.cursorCol).toBe(4);
    });

    it('should join with previous line at line start', () => {
      const state = createState({
        lines: ['hello', 'world'],
        cursorRow: 1,
        cursorCol: 0,
      });
      const action: TextBufferAction = { type: 'backspace' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['helloworld']);
      expect(result.cursorRow).toBe(0);
      expect(result.cursorCol).toBe(5);
    });

    it('should do nothing at document start', () => {
      const state = createState();
      const action: TextBufferAction = { type: 'backspace' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['']);
    });
  });

  describe('delete action', () => {
    it('should delete character at cursor', () => {
      const state = createState({ lines: ['hello'], cursorCol: 0 });
      const action: TextBufferAction = { type: 'delete' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['ello']);
    });

    it('should join with next line at line end', () => {
      const state = createState({
        lines: ['hello', 'world'],
        cursorRow: 0,
        cursorCol: 5,
      });
      const action: TextBufferAction = { type: 'delete' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['helloworld']);
    });

    it('should do nothing at document end', () => {
      const state = createState({
        lines: ['hello'],
        cursorRow: 0,
        cursorCol: 5,
      });
      const action: TextBufferAction = { type: 'delete' };
      const result = textBufferReducer(state, action);
      expect(result.lines).toEqual(['hello']);
    });
  });

  describe('move action', () => {
    it('should handle move actions without throwing', () => {
      const state = createState({ lines: ['hello'], cursorCol: 3 });
      const leftAction: TextBufferAction = {
        type: 'move',
        payload: { dir: 'left' },
      };
      const rightAction: TextBufferAction = {
        type: 'move',
        payload: { dir: 'right' },
      };
      expect(() => textBufferReducer(state, leftAction)).not.toThrow();
      expect(() => textBufferReducer(state, rightAction)).not.toThrow();
    });
  });

  describe('undo/redo', () => {
    it('should undo insert', () => {
      let state = createState();
      state = textBufferReducer(state, { type: 'insert', payload: 'hello' });
      expect(state.lines).toEqual(['hello']);
      state = textBufferReducer(state, { type: 'undo' });
      expect(state.lines).toEqual(['']);
    });

    it('should redo undone action', () => {
      let state = createState();
      state = textBufferReducer(state, { type: 'insert', payload: 'hello' });
      state = textBufferReducer(state, { type: 'undo' });
      expect(state.lines).toEqual(['']);
      state = textBufferReducer(state, { type: 'redo' });
      expect(state.lines).toEqual(['hello']);
    });

    it('should clear redo stack on new action', () => {
      let state = createState();
      state = textBufferReducer(state, { type: 'insert', payload: 'a' });
      state = textBufferReducer(state, { type: 'undo' });
      expect(state.redoStack.length).toBe(1);
      state = textBufferReducer(state, { type: 'insert', payload: 'b' });
      expect(state.redoStack.length).toBe(0);
    });
  });

  describe('viewport actions', () => {
    it('should update viewport', () => {
      const state = createState();
      const action: TextBufferAction = {
        type: 'set_viewport',
        payload: { width: 100, height: 50 },
      };
      const result = textBufferReducer(state, action);
      expect(result.viewportWidth).toBe(100);
      expect(result.viewportHeight).toBe(50);
    });
  });
});
