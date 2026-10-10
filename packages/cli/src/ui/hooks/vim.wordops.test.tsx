/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Key } from '../contexts/KeypressContext.js';
import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import type React from 'react';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import { useVim } from './vim.js';
import type {
  TextBuffer,
  TextBufferState,
} from '../components/shared/buffer-types.js';
import { textBufferReducer } from '../components/shared/buffer-reducer.js';
import { calculateTransformations } from '../components/shared/transformations.js';

// Mock the VimModeContext
const mockVimContext: {
  vimEnabled: boolean;
  vimMode: ReturnType<typeof useVim>['mode'];
  toggleVimEnabled: Mock<() => void>;
  setVimMode: Mock<(mode: ReturnType<typeof useVim>['mode']) => void>;
} = {
  vimEnabled: true,
  vimMode: 'NORMAL' satisfies ReturnType<typeof useVim>['mode'],
  toggleVimEnabled: vi.fn(),
  setVimMode: vi.fn(),
};

void vi.mock('../contexts/VimModeContext.js', () => ({
  useVimMode: () => mockVimContext,
  VimModeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Test constants

// Helper to create complete initial state for reducer tests
function createReducerState(
  lines: string[],
  cursorRow: number,
  cursorCol: number,
): TextBufferState {
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
      visualLines: lines,
      logicalToVisualMap: lines.map((_, row) => [[row, 0]]),
      transformedToLogicalMaps: lines.map((line) =>
        Array.from({ length: line.length + 1 }, (_, col) => col),
      ),

      visualToLogicalMap: lines.map((_, i) => [i, 0] as [number, number]),
      visualToTransformedMap: lines.map(() => 0),
    },
  };
}

function vimKey(sequence: string): Key {
  return { name: '', ctrl: false, meta: false, shift: false, sequence };
}

describe('useVim hook', () => {
  let mockBuffer: Partial<TextBuffer>;
  let mockHandleFinalSubmit: Mock<(value: string) => void>;

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
        const line = lines[row] || '';
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

  const exitInsertMode = (result: {
    current: {
      handleInput: ReturnType<typeof useVim>['handleInput'];
    };
  }) => {
    act(() => {
      result.current.handleInput({
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\u001b',
        name: 'escape',
      });
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHandleFinalSubmit = vi.fn<(value: string) => void>();
    mockBuffer = createMockBuffer();
    // Reset mock context to default state
    mockVimContext.vimEnabled = true;
    mockVimContext.vimMode = 'NORMAL';
    mockVimContext.toggleVimEnabled.mockClear();
    mockVimContext.setVimMode.mockClear();
  });

  describe('Vim word operations', () => {
    describe('dw (delete word forward)', () => {
      it('should delete from cursor to start of next word', () => {
        const testBuffer = createMockBuffer('hello world test', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('d'));
        });
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        expect(testBuffer.vimDeleteWordForward).toHaveBeenCalledWith(1);
      });

      it('should actually delete the complete word including trailing space', () => {
        // This test uses the real text-buffer reducer instead of mocks
        const initialState = createReducerState(['hello world test'], 0, 0);

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_word_forward',
          payload: { count: 1 },
        });

        // Should delete "hello " (word + space), leaving "world test"
        expect(result.lines).toStrictEqual(['world test']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(0);
      });

      it('should delete word from middle of word correctly', () => {
        const initialState = createReducerState(['hello world test'], 0, 2); // cursor on 'l' in "hello"

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_word_forward',
          payload: { count: 1 },
        });

        // Should delete "llo " (rest of word + space), leaving "he world test"
        expect(result.lines).toStrictEqual(['heworld test']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(2);
      });

      it('should handle dw at end of line', () => {
        const initialState = createReducerState(['hello world'], 0, 6); // cursor on 'w' in "world"

        const result = textBufferReducer(initialState, {
          type: 'vim_delete_word_forward',
          payload: { count: 1 },
        });

        // Should delete "world" (no trailing space at end), leaving "hello "
        expect(result.lines).toStrictEqual(['hello ']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(6);
      });

      it('should delete multiple words with count', () => {
        const testBuffer = createMockBuffer('one two three four', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('2'));
        });
        act(() => {
          result.current.handleInput(vimKey('d'));
        });
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        expect(testBuffer.vimDeleteWordForward).toHaveBeenCalledWith(2);
      });

      it('should record command for repeat with dot', () => {
        const testBuffer = createMockBuffer('hello world test', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        // Execute dw
        act(() => {
          result.current.handleInput(vimKey('d'));
        });
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        vi.clearAllMocks();

        // Execute dot repeat
        act(() => {
          result.current.handleInput(vimKey('.'));
        });

        expect(testBuffer.vimDeleteWordForward).toHaveBeenCalledWith(1);
      });
    });

    describe('de (delete word end)', () => {
      it('should delete from cursor to end of current word', () => {
        const testBuffer = createMockBuffer('hello world test', [0, 1]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('d'));
        });
        act(() => {
          result.current.handleInput(vimKey('e'));
        });

        expect(testBuffer.vimDeleteWordEnd).toHaveBeenCalledWith(1);
      });

      it('should handle count with de', () => {
        const testBuffer = createMockBuffer('one two three four', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('3'));
        });
        act(() => {
          result.current.handleInput(vimKey('d'));
        });
        act(() => {
          result.current.handleInput(vimKey('e'));
        });

        expect(testBuffer.vimDeleteWordEnd).toHaveBeenCalledWith(3);
      });
    });

    describe('cw (change word forward)', () => {
      it('should change from cursor to start of next word and enter INSERT mode', () => {
        const testBuffer = createMockBuffer('hello world test', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        expect(testBuffer.vimChangeWordForward).toHaveBeenCalledWith(1);
        expect(result.current.mode).toBe('INSERT');
        expect(mockVimContext.setVimMode).toHaveBeenCalledWith('INSERT');
      });

      it('should handle count with cw', () => {
        const testBuffer = createMockBuffer('one two three four', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('2'));
        });
        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        expect(testBuffer.vimChangeWordForward).toHaveBeenCalledWith(2);
        expect(result.current.mode).toBe('INSERT');
      });

      it('should be repeatable with dot', () => {
        const testBuffer = createMockBuffer('hello world test more', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        // Execute cw
        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        // Exit INSERT mode
        exitInsertMode(result);

        vi.clearAllMocks();
        mockVimContext.setVimMode.mockClear();

        // Execute dot repeat
        act(() => {
          result.current.handleInput(vimKey('.'));
        });

        expect(testBuffer.vimChangeWordForward).toHaveBeenCalledWith(1);
        expect(result.current.mode).toBe('INSERT');
      });
    });

    describe('ce (change word end)', () => {
      it('should change from cursor to end of word and enter INSERT mode', () => {
        const testBuffer = createMockBuffer('hello world test', [0, 1]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('e'));
        });

        expect(testBuffer.vimChangeWordEnd).toHaveBeenCalledWith(1);
        expect(result.current.mode).toBe('INSERT');
      });

      it('should handle count with ce', () => {
        const testBuffer = createMockBuffer('one two three four', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('2'));
        });
        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('e'));
        });

        expect(testBuffer.vimChangeWordEnd).toHaveBeenCalledWith(2);
        expect(result.current.mode).toBe('INSERT');
      });
    });

    describe('cc (change line)', () => {
      it('should change entire line and enter INSERT mode', () => {
        const testBuffer = createMockBuffer('hello world\nsecond line', [0, 5]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('c'));
        });

        expect(testBuffer.vimChangeLine).toHaveBeenCalledWith(1);
        expect(result.current.mode).toBe('INSERT');
      });

      it('should change multiple lines with count', () => {
        const testBuffer = createMockBuffer(
          'line1\nline2\nline3\nline4',
          [1, 0],
        );
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('3'));
        });
        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('c'));
        });

        expect(testBuffer.vimChangeLine).toHaveBeenCalledWith(3);
        expect(result.current.mode).toBe('INSERT');
      });

      it('should be repeatable with dot', () => {
        const testBuffer = createMockBuffer('line1\nline2\nline3', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        // Execute cc
        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('c'));
        });

        // Exit INSERT mode
        exitInsertMode(result);

        vi.clearAllMocks();
        mockVimContext.setVimMode.mockClear();

        // Execute dot repeat
        act(() => {
          result.current.handleInput(vimKey('.'));
        });

        expect(testBuffer.vimChangeLine).toHaveBeenCalledWith(1);
        expect(result.current.mode).toBe('INSERT');
      });
    });

    describe('db (delete word backward)', () => {
      it('should delete from cursor to start of previous word', () => {
        const testBuffer = createMockBuffer('hello world test', [0, 11]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('d'));
        });
        act(() => {
          result.current.handleInput(vimKey('b'));
        });

        expect(testBuffer.vimDeleteWordBackward).toHaveBeenCalledWith(1);
      });

      it('should handle count with db', () => {
        const testBuffer = createMockBuffer('one two three four', [0, 18]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('2'));
        });
        act(() => {
          result.current.handleInput(vimKey('d'));
        });
        act(() => {
          result.current.handleInput(vimKey('b'));
        });

        expect(testBuffer.vimDeleteWordBackward).toHaveBeenCalledWith(2);
      });
    });

    describe('cb (change word backward)', () => {
      it('should change from cursor to start of previous word and enter INSERT mode', () => {
        const testBuffer = createMockBuffer('hello world test', [0, 11]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('b'));
        });

        expect(testBuffer.vimChangeWordBackward).toHaveBeenCalledWith(1);
        expect(result.current.mode).toBe('INSERT');
      });

      it('should handle count with cb', () => {
        const testBuffer = createMockBuffer('one two three four', [0, 18]);
        const { result } = renderVimHook(testBuffer);

        act(() => {
          result.current.handleInput(vimKey('3'));
        });
        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('b'));
        });

        expect(testBuffer.vimChangeWordBackward).toHaveBeenCalledWith(3);
        expect(result.current.mode).toBe('INSERT');
      });
    });

    describe('Pending state handling', () => {
      it('should clear pending delete state after dw', () => {
        const testBuffer = createMockBuffer('hello world', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        // Press 'd' to enter pending delete state
        act(() => {
          result.current.handleInput(vimKey('d'));
        });

        // Complete with 'w'
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        // Next 'd' should start a new pending state, not continue the previous one
        act(() => {
          result.current.handleInput(vimKey('d'));
        });

        // This should trigger dd (delete line), not an error
        act(() => {
          result.current.handleInput(vimKey('d'));
        });

        expect(testBuffer.vimDeleteLine).toHaveBeenCalledWith(1);
      });

      it('should clear pending change state after cw', () => {
        const testBuffer = createMockBuffer('hello world', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        // Execute cw
        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        // Exit INSERT mode
        exitInsertMode(result);

        // Next 'c' should start a new pending state
        act(() => {
          result.current.handleInput(vimKey('c'));
        });
        act(() => {
          result.current.handleInput(vimKey('c'));
        });

        expect(testBuffer.vimChangeLine).toHaveBeenCalledWith(1);
      });

      it('should clear pending state with escape', () => {
        const testBuffer = createMockBuffer('hello world', [0, 0]);
        const { result } = renderVimHook(testBuffer);

        // Enter pending delete state
        act(() => {
          result.current.handleInput(vimKey('d'));
        });

        // Press escape to clear pending state
        act(() => {
          result.current.handleInput({
            sequence: '',
            ctrl: false,
            meta: false,
            shift: false,
            name: 'escape',
          });
        });

        // Now 'w' should just move cursor, not delete
        act(() => {
          result.current.handleInput(vimKey('w'));
        });

        expect(testBuffer.vimDeleteWordForward).not.toHaveBeenCalled();
        // w should move to next word after clearing pending state
        expect(testBuffer.vimMoveWordForward).toHaveBeenCalledWith(1);
      });
    });

    describe('NORMAL mode escape behavior', () => {
      it('should pass escape through when no pending operator is active', () => {
        mockVimContext.vimMode = 'NORMAL';
        const { result } = renderVimHook();

        const handled = result.current.handleInput({
          sequence: '',
          ctrl: false,
          meta: false,
          shift: false,
          name: 'escape',
        });

        expect(handled).toBe(false);
      });

      it('should handle escape and clear pending operator', () => {
        mockVimContext.vimMode = 'NORMAL';
        const { result } = renderVimHook();

        act(() => {
          result.current.handleInput(vimKey('d'));
        });

        let handled: boolean | undefined;
        act(() => {
          handled = result.current.handleInput({
            sequence: '',
            ctrl: false,
            meta: false,
            shift: false,
            name: 'escape',
          });
        });

        expect(handled).toBe(true);
      });
    });
  });
});
