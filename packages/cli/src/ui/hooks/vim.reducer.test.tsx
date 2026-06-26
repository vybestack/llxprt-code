/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useVim } from './vim.js';
import type { TextBuffer } from '../components/shared/buffer-types.js';
import { textBufferReducer } from '../components/shared/buffer-reducer.js';
import { calculateTransformations } from '../components/shared/transformations.js';

// Mock the VimModeContext
const mockVimContext = {
  vimEnabled: true,
  vimMode: 'NORMAL' as const,
  toggleVimEnabled: vi.fn(),
  setVimMode: vi.fn(),
};

vi.mock('../contexts/VimModeContext.js', () => ({
  useVimMode: () => mockVimContext,
  VimModeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Test constants

// Helper to create complete initial state for reducer tests
function createReducerState(
  lines: string[],
  cursorRow: number,
  cursorCol: number,
) {
  return {
    lines,
    cursorRow,
    cursorCol,
    preferredCol: null,
    undoStack: [],
    redoStack: [],
    clipboard: null,
    selectionAnchor: null,
    transformationsByLine: calculateTransformations(lines),
    viewportWidth: 80,
    viewportHeight: 24,
    visualLayout: {
      allVisualLines: lines,
      viewportVisualLines: lines,
      visualCursor: [cursorRow, cursorCol],
      visualScrollRow: 0,
      visualToLogicalMap: lines.map((_, i) => [i, 0] as [number, number]),
      visualToTransformedMap: lines.map(() => 0),
    },
  };
}

describe('useVim hook', () => {
  let mockBuffer: Partial<TextBuffer>;
  let mockHandleFinalSubmit: vi.Mock;

  const createMockBuffer = (
    text = 'hello world',
    cursor: [number, number] = [0, 5],
  ) => {
    const cursorState = { pos: cursor };
    const lines = text.split('\n');

    return {
      lines,
      get cursor() {
        return cursorState.pos;
      },
      set cursor(newPos: [number, number]) {
        cursorState.pos = newPos;
      },
      text,
      move: vi.fn().mockImplementation((direction: string) => {
        let [row, col] = cursorState.pos;
        const _line = lines[row] || '';
        if (direction === 'left') {
          col = Math.max(0, col - 1);
        } else if (direction === 'right') {
          col = Math.min(line.length, col + 1);
        } else if (direction === 'home') {
          col = 0;
        } else if (direction === 'end') {
          col = line.length;
        }
        cursorState.pos = [row, col];
      }),
      del: vi.fn(),
      moveToOffset: vi.fn(),
      insert: vi.fn(),
      newline: vi.fn(),
      replaceRangeByOffset: vi.fn(),
      handleInput: vi.fn(),
      setText: vi.fn(),
      // Vim-specific methods
      vimDeleteWordForward: vi.fn(),
      vimDeleteWordBackward: vi.fn(),
      vimDeleteWordEnd: vi.fn(),
      vimChangeWordForward: vi.fn(),
      vimChangeWordBackward: vi.fn(),
      vimChangeWordEnd: vi.fn(),
      vimDeleteLine: vi.fn(),
      vimChangeLine: vi.fn(),
      vimDeleteToEndOfLine: vi.fn(),
      vimChangeToEndOfLine: vi.fn(),
      vimChangeMovement: vi.fn(),
      vimMoveLeft: vi.fn(),
      vimMoveRight: vi.fn(),
      vimMoveUp: vi.fn(),
      vimMoveDown: vi.fn(),
      vimMoveWordForward: vi.fn(),
      vimMoveWordBackward: vi.fn(),
      vimMoveWordEnd: vi.fn(),
      vimDeleteChar: vi.fn(),
      vimInsertAtCursor: vi.fn(),
      vimAppendAtCursor: vi.fn().mockImplementation(() => {
        // Append moves cursor right (vim 'a' behavior - position after current char)
        const [row, col] = cursorState.pos;
        const _line = lines[row] || '';
        // In vim, 'a' moves cursor to position after current character
        // This allows inserting at the end of the line
        cursorState.pos = [row, col + 1];
      }),
      vimOpenLineBelow: vi.fn(),
      vimOpenLineAbove: vi.fn(),
      vimAppendAtLineEnd: vi.fn(),
      vimInsertAtLineStart: vi.fn(),
      vimMoveToLineStart: vi.fn(),
      vimMoveToLineEnd: vi.fn(),
      vimMoveToFirstNonWhitespace: vi.fn(),
      vimMoveToFirstLine: vi.fn(),
      vimMoveToLastLine: vi.fn(),
      vimMoveToLine: vi.fn(),
      vimEscapeInsertMode: vi.fn().mockImplementation(() => {
        // Escape moves cursor left unless at beginning of line
        const [row, col] = cursorState.pos;
        if (col > 0) {
          cursorState.pos = [row, col - 1];
        }
      }),
    };
  };

  const renderVimHook = (buffer?: Partial<TextBuffer>) =>
    renderHook(() =>
      useVim((buffer ?? mockBuffer) as TextBuffer, mockHandleFinalSubmit),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleFinalSubmit = vi.fn();
    mockBuffer = createMockBuffer();
    // Reset mock context to default state
    mockVimContext.vimEnabled = true;
    mockVimContext.vimMode = 'NORMAL';
    mockVimContext.toggleVimEnabled.mockClear();
    mockVimContext.setVimMode.mockClear();
  });

  describe('Shell command pass-through', () => {
    it('should pass through ctrl+r in INSERT mode', () => {
      mockVimContext.vimMode = 'INSERT';
      const { result } = renderVimHook();

      const handled = result.current.handleInput({ name: 'r', ctrl: true });

      expect(handled).toBe(false);
    });

    it('should pass through ! in INSERT mode when buffer is empty', () => {
      mockVimContext.vimMode = 'INSERT';
      const emptyBuffer = createMockBuffer('');
      const { result } = renderVimHook(emptyBuffer);

      const handled = result.current.handleInput({ sequence: '!' });

      expect(handled).toBe(false);
    });

    it('should handle ! as input in INSERT mode when buffer is not empty', () => {
      mockVimContext.vimMode = 'INSERT';
      const nonEmptyBuffer = createMockBuffer('not empty');
      const { result } = renderVimHook(nonEmptyBuffer);
      const key = { sequence: '!', name: '!' };

      act(() => {
        result.current.handleInput(key);
      });

      expect(nonEmptyBuffer.handleInput).toHaveBeenCalledWith(
        expect.objectContaining(key),
      );
    });
  });
  describe('Reducer-based integration tests', () => {
    describe('de (delete word end)', () => {
      it('should delete from cursor to end of current word', () => {
        const initialState = createReducerState(['hello world test'], 0, 1); // cursor on 'e' in "hello"

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_word_end',
          payload: { count: 1 },
        });

        // Should delete "ello" (from cursor to end of word), leaving "h world test"
        expect(result.lines).toStrictEqual(['h world test']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(1);
      });

      it('should delete multiple word ends with count', () => {
        const initialState = createReducerState(
          ['hello world test more'],
          0,
          1,
        ); // cursor on 'e' in "hello"

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_word_end',
          payload: { count: 2 },
        });

        // Should delete "ello world" (to end of second word), leaving "h test more"
        expect(result.lines).toStrictEqual(['h test more']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(1);
      });
    });

    describe('db (delete word backward)', () => {
      it('should delete from cursor to start of previous word', () => {
        const initialState = createReducerState(['hello world test'], 0, 11); // cursor on 't' in "test"

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_word_backward',
          payload: { count: 1 },
        });

        // Should delete "world" (previous word only), leaving "hello  test"
        expect(result.lines).toStrictEqual(['hello  test']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(6);
      });

      it('should delete multiple words backward with count', () => {
        const initialState = createReducerState(
          ['hello world test more'],
          0,
          17,
        ); // cursor on 'm' in "more"

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_word_backward',
          payload: { count: 2 },
        });

        // Should delete "world test " (two words backward), leaving "hello more"
        expect(result.lines).toStrictEqual(['hello more']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(6);
      });
    });

    describe('cw (change word forward)', () => {
      it('should delete from cursor to start of next word', () => {
        const initialState = createReducerState(['hello world test'], 0, 0); // cursor on 'h' in "hello"

        const result = textBufferReducer(initialState, {
          type: 'vim_change_word_forward',
          payload: { count: 1 },
        });

        // Should delete "hello " (word + space), leaving "world test"
        expect(result.lines).toStrictEqual(['world test']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(0);
      });

      it('should change multiple words with count', () => {
        const initialState = createReducerState(
          ['hello world test more'],
          0,
          0,
        );

        const result = textBufferReducer(initialState, {
          type: 'vim_change_word_forward',
          payload: { count: 2 },
        });

        // Should delete "hello world " (two words), leaving "test more"
        expect(result.lines).toStrictEqual(['test more']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(0);
      });
    });

    describe('ce (change word end)', () => {
      it('should change from cursor to end of current word', () => {
        const initialState = createReducerState(['hello world test'], 0, 1); // cursor on 'e' in "hello"

        const result = textBufferReducer(initialState, {
          type: 'vim_change_word_end',
          payload: { count: 1 },
        });

        // Should delete "ello" (from cursor to end of word), leaving "h world test"
        expect(result.lines).toStrictEqual(['h world test']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(1);
      });

      it('should change multiple word ends with count', () => {
        const initialState = createReducerState(['hello world test'], 0, 1); // cursor on 'e' in "hello"

        const result = textBufferReducer(initialState, {
          type: 'vim_change_word_end',
          payload: { count: 2 },
        });

        // Should delete "ello world" (to end of second word), leaving "h test"
        expect(result.lines).toStrictEqual(['h test']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(1);
      });
    });

    describe('cb (change word backward)', () => {
      it('should change from cursor to start of previous word', () => {
        const initialState = createReducerState(['hello world test'], 0, 11); // cursor on 't' in "test"

        const result = textBufferReducer(initialState, {
          type: 'vim_change_word_backward',
          payload: { count: 1 },
        });

        // Should delete "world" (previous word only), leaving "hello  test"
        expect(result.lines).toStrictEqual(['hello  test']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(6);
      });
    });

    describe('cc (change line)', () => {
      it('should clear the line and place cursor at the start', () => {
        const initialState = createReducerState(['  hello world'], 0, 5); // cursor on 'o'

        const result = textBufferReducer(initialState, {
          type: 'vim_change_line',
          payload: { count: 1 },
        });

        expect(result.lines).toStrictEqual(['']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(0);
      });
    });

    describe('dd (delete line)', () => {
      it('should delete the current line', () => {
        const initialState = createReducerState(
          ['line1', 'line2', 'line3'],
          1,
          2,
        );

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_line',
          payload: { count: 1 },
        });

        expect(result.lines).toStrictEqual(['line1', 'line3']);
        expect(result.cursorRow).toBe(1);
        expect(result.cursorCol).toBe(0);
      });

      it('should delete multiple lines with count', () => {
        const initialState = createReducerState(
          ['line1', 'line2', 'line3', 'line4'],
          1,
          2,
        );

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_line',
          payload: { count: 2 },
        });

        // Should delete lines 1 and 2
        expect(result.lines).toStrictEqual(['line1', 'line4']);
        expect(result.cursorRow).toBe(1);
        expect(result.cursorCol).toBe(0);
      });

      it('should handle deleting last line', () => {
        const initialState = createReducerState(['only line'], 0, 3);

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_line',
          payload: { count: 1 },
        });

        // Should leave an empty line when deleting the only line
        expect(result.lines).toStrictEqual(['']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(0);
      });
    });

    describe('D (delete to end of line)', () => {
      it('should delete from cursor to end of line', () => {
        const initialState = createReducerState(['hello world test'], 0, 6); // cursor on 'w' in "world"

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_to_end_of_line',
        });

        // Should delete "world test", leaving "hello "
        expect(result.lines).toStrictEqual(['hello ']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(6);
      });

      it('should handle D at end of line', () => {
        const initialState = createReducerState(['hello world'], 0, 11); // cursor at end

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_to_end_of_line',
        });

        // Should not change anything when at end of line
        expect(result.lines).toStrictEqual(['hello world']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(11);
      });
    });

    describe('C (change to end of line)', () => {
      it('should change from cursor to end of line', () => {
        const initialState = createReducerState(['hello world test'], 0, 6); // cursor on 'w' in "world"

        const result = textBufferReducer(initialState, {
          type: 'vim_change_to_end_of_line',
        });

        // Should delete "world test", leaving "hello "
        expect(result.lines).toStrictEqual(['hello ']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(6);
      });

      it('should handle C at beginning of line', () => {
        const initialState = createReducerState(['hello world'], 0, 0);

        const result = textBufferReducer(initialState, {
          type: 'vim_change_to_end_of_line',
        });

        // Should delete entire line content
        expect(result.lines).toStrictEqual(['']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(0);
      });
    });
  });
});
