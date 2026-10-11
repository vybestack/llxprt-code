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
import type { TextBuffer } from '../components/shared/buffer-types.js';

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
const TEST_SEQUENCES = {
  ESCAPE: {
    ctrl: false,
    meta: false,
    shift: false,
    sequence: '\u001b',
    name: 'escape',
  },
  LEFT: vimKey('h'),
  RIGHT: vimKey('l'),
  UP: vimKey('k'),
  DOWN: vimKey('j'),
  INSERT: vimKey('i'),
  APPEND: vimKey('a'),
  DELETE_CHAR: vimKey('x'),
  DELETE: vimKey('d'),
  CHANGE: vimKey('c'),
  WORD_FORWARD: vimKey('w'),
  WORD_BACKWARD: vimKey('b'),
  WORD_END: vimKey('e'),
  LINE_START: vimKey('0'),
  LINE_END: vimKey('$'),
  REPEAT: vimKey('.'),
} as const;

// Helper to create complete initial state for reducer tests

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

  describe('Mode switching', () => {
    it('should start in NORMAL mode', () => {
      const { result } = renderVimHook();
      expect(result.current.mode).toBe('NORMAL');
    });

    it('should switch to INSERT mode with i command', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(TEST_SEQUENCES.INSERT);
      });

      expect(result.current.mode).toBe('INSERT');
      expect(mockVimContext.setVimMode).toHaveBeenCalledWith('INSERT');
    });

    it('should switch back to NORMAL mode with Escape', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(TEST_SEQUENCES.INSERT);
      });
      expect(result.current.mode).toBe('INSERT');

      exitInsertMode(result);
      expect(result.current.mode).toBe('NORMAL');
    });

    it('should properly handle escape followed immediately by a command', () => {
      const testBuffer = createMockBuffer('hello world test', [0, 6]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('i'));
      });
      expect(result.current.mode).toBe('INSERT');

      vi.clearAllMocks();

      exitInsertMode(result);
      expect(result.current.mode).toBe('NORMAL');

      act(() => {
        result.current.handleInput(vimKey('b'));
      });

      expect(testBuffer.vimMoveWordBackward).toHaveBeenCalledWith(1);
    });
  });
  describe('Navigation commands', () => {
    it('should handle h (left movement)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('h'));
      });

      expect(mockBuffer.vimMoveLeft).toHaveBeenCalledWith(1);
    });

    it('should handle l (right movement)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('l'));
      });

      expect(mockBuffer.vimMoveRight).toHaveBeenCalledWith(1);
    });

    it('should handle j (down movement)', () => {
      const testBuffer = createMockBuffer('first line\nsecond line');
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('j'));
      });

      expect(testBuffer.vimMoveDown).toHaveBeenCalledWith(1);
    });

    it('should handle k (up movement)', () => {
      const testBuffer = createMockBuffer('first line\nsecond line');
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('k'));
      });

      expect(testBuffer.vimMoveUp).toHaveBeenCalledWith(1);
    });

    it('should handle 0 (move to start of line)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('0'));
      });

      expect(mockBuffer.vimMoveToLineStart).toHaveBeenCalled();
    });

    it('should handle $ (move to end of line)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('$'));
      });

      expect(mockBuffer.vimMoveToLineEnd).toHaveBeenCalled();
    });
  });
  describe('Mode switching commands', () => {
    it('should handle a (append after cursor)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('a'));
      });

      expect(mockBuffer.vimAppendAtCursor).toHaveBeenCalled();
      expect(result.current.mode).toBe('INSERT');
    });

    it('should handle A (append at end of line)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('A'));
      });

      expect(mockBuffer.vimAppendAtLineEnd).toHaveBeenCalled();
      expect(result.current.mode).toBe('INSERT');
    });

    it('should handle o (open line below)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('o'));
      });

      expect(mockBuffer.vimOpenLineBelow).toHaveBeenCalled();
      expect(result.current.mode).toBe('INSERT');
    });

    it('should handle O (open line above)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('O'));
      });

      expect(mockBuffer.vimOpenLineAbove).toHaveBeenCalled();
      expect(result.current.mode).toBe('INSERT');
    });
  });
  describe('Edit commands', () => {
    it('should handle x (delete character)', () => {
      const { result } = renderVimHook();
      vi.clearAllMocks();

      act(() => {
        result.current.handleInput(vimKey('x'));
      });

      expect(mockBuffer.vimDeleteChar).toHaveBeenCalledWith(1);
    });

    it('should move cursor left when deleting last character on line (vim behavior)', () => {
      const testBuffer = createMockBuffer('hello', [0, 4]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('x'));
      });

      expect(testBuffer.vimDeleteChar).toHaveBeenCalledWith(1);
    });

    it('should handle first d key (sets pending state)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('d'));
      });

      expect(mockBuffer.replaceRangeByOffset).not.toHaveBeenCalled();
    });
  });
  describe('Count handling', () => {
    it('should handle count input and return to count 0 after command', () => {
      const { result } = renderVimHook();

      act(() => {
        const handled = result.current.handleInput(vimKey('3'));
        expect(handled).toBe(true);
      });

      act(() => {
        const handled = result.current.handleInput(vimKey('h'));
        expect(handled).toBe(true);
      });

      expect(mockBuffer.vimMoveLeft).toHaveBeenCalledWith(3);
    });

    it('should only delete 1 character with x command when no count is specified', () => {
      const testBuffer = createMockBuffer();
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('x'));
      });

      expect(testBuffer.vimDeleteChar).toHaveBeenCalledWith(1);
    });
  });
  describe('Word movement', () => {
    it('should properly initialize vim hook with word movement support', () => {
      const testBuffer = createMockBuffer('cat elephant mouse', [0, 0]);
      const { result } = renderVimHook(testBuffer);

      expect(result.current.vimModeEnabled).toBe(true);
      expect(result.current.mode).toBe('NORMAL');
      expect(result.current.handleInput).toBeDefined();
    });

    it('should support vim mode and basic operations across multiple lines', () => {
      const testBuffer = createMockBuffer(
        'first line word\nsecond line word',
        [0, 11],
      );
      const { result } = renderVimHook(testBuffer);

      expect(result.current.vimModeEnabled).toBe(true);
      expect(result.current.mode).toBe('NORMAL');
      expect(result.current.handleInput).toBeDefined();
      expect(testBuffer.replaceRangeByOffset).toBeDefined();
      expect(testBuffer.moveToOffset).toBeDefined();
    });

    it('should handle w (next word)', () => {
      const testBuffer = createMockBuffer('hello world test');
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('w'));
      });

      expect(testBuffer.vimMoveWordForward).toHaveBeenCalledWith(1);
    });

    it('should handle b (previous word)', () => {
      const testBuffer = createMockBuffer('hello world test', [0, 6]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('b'));
      });

      expect(testBuffer.vimMoveWordBackward).toHaveBeenCalledWith(1);
    });

    it('should handle e (end of word)', () => {
      const testBuffer = createMockBuffer('hello world test');
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('e'));
      });

      expect(testBuffer.vimMoveWordEnd).toHaveBeenCalledWith(1);
    });

    it('should handle w when cursor is on the last word', () => {
      const testBuffer = createMockBuffer('hello world', [0, 8]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('w'));
      });

      expect(testBuffer.vimMoveWordForward).toHaveBeenCalledWith(1);
    });

    it('should handle first c key (sets pending change state)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('c'));
      });

      expect(result.current.mode).toBe('NORMAL');
      expect(mockBuffer.del).not.toHaveBeenCalled();
    });

    it('should clear pending state on invalid command sequence (df)', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('d'));
        result.current.handleInput(vimKey('f'));
      });

      expect(mockBuffer.replaceRangeByOffset).not.toHaveBeenCalled();
      expect(mockBuffer.del).not.toHaveBeenCalled();
    });

    it('should clear pending state with Escape in NORMAL mode', () => {
      const { result } = renderVimHook();

      act(() => {
        result.current.handleInput(vimKey('d'));
      });

      exitInsertMode(result);

      expect(mockBuffer.replaceRangeByOffset).not.toHaveBeenCalled();
    });
  });
  describe('Disabled vim mode', () => {
    it('should not respond to vim commands when disabled', () => {
      mockVimContext.vimEnabled = false;
      const { result } = renderVimHook(mockBuffer);

      act(() => {
        result.current.handleInput(vimKey('h'));
      });

      expect(mockBuffer.move).not.toHaveBeenCalled();
    });
  });
  describe('Command repeat system', () => {
    it('should repeat x command from current cursor position', () => {
      const testBuffer = createMockBuffer('abcd\nefgh\nijkl', [0, 1]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('x'));
      });
      expect(testBuffer.vimDeleteChar).toHaveBeenCalledWith(1);

      testBuffer.cursor = [1, 2];

      act(() => {
        result.current.handleInput(vimKey('.'));
      });
      expect(testBuffer.vimDeleteChar).toHaveBeenCalledWith(1);
    });

    it('should repeat dd command from current position', () => {
      const testBuffer = createMockBuffer('line1\nline2\nline3', [1, 0]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('d'));
      });
      act(() => {
        result.current.handleInput(vimKey('d'));
      });
      expect(testBuffer.vimDeleteLine).toHaveBeenCalledTimes(1);

      testBuffer.cursor = [0, 0];

      act(() => {
        result.current.handleInput(vimKey('.'));
      });

      expect(testBuffer.vimDeleteLine).toHaveBeenCalledTimes(2);
    });

    it('should repeat ce command from current position', () => {
      const testBuffer = createMockBuffer('word', [0, 0]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('c'));
      });
      act(() => {
        result.current.handleInput(vimKey('e'));
      });
      expect(testBuffer.vimChangeWordEnd).toHaveBeenCalledTimes(1);

      // Exit INSERT mode to complete the command
      exitInsertMode(result);

      testBuffer.cursor = [0, 2];

      act(() => {
        result.current.handleInput(vimKey('.'));
      });

      expect(testBuffer.vimChangeWordEnd).toHaveBeenCalledTimes(2);
    });

    it('should repeat cc command from current position', () => {
      const testBuffer = createMockBuffer('line1\nline2\nline3', [1, 2]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('c'));
      });
      act(() => {
        result.current.handleInput(vimKey('c'));
      });
      expect(testBuffer.vimChangeLine).toHaveBeenCalledTimes(1);

      // Exit INSERT mode to complete the command
      exitInsertMode(result);

      testBuffer.cursor = [0, 1];

      act(() => {
        result.current.handleInput(vimKey('.'));
      });

      expect(testBuffer.vimChangeLine).toHaveBeenCalledTimes(2);
    });

    it('should repeat cw command from current position', () => {
      const testBuffer = createMockBuffer('hello world test', [0, 6]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('c'));
      });
      act(() => {
        result.current.handleInput(vimKey('w'));
      });
      expect(testBuffer.vimChangeWordForward).toHaveBeenCalledTimes(1);

      // Exit INSERT mode to complete the command
      exitInsertMode(result);

      testBuffer.cursor = [0, 0];

      act(() => {
        result.current.handleInput(vimKey('.'));
      });

      expect(testBuffer.vimChangeWordForward).toHaveBeenCalledTimes(2);
    });

    it('should repeat D command from current position', () => {
      const testBuffer = createMockBuffer('hello world test', [0, 6]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('D'));
      });
      expect(testBuffer.vimDeleteToEndOfLine).toHaveBeenCalledTimes(1);

      testBuffer.cursor = [0, 2];
      vi.clearAllMocks(); // Clear all mocks instead of just one method

      act(() => {
        result.current.handleInput(vimKey('.'));
      });

      expect(testBuffer.vimDeleteToEndOfLine).toHaveBeenCalledTimes(1);
    });

    it('should repeat C command from current position', () => {
      const testBuffer = createMockBuffer('hello world test', [0, 6]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('C'));
      });
      expect(testBuffer.vimChangeToEndOfLine).toHaveBeenCalledTimes(1);

      // Exit INSERT mode to complete the command
      exitInsertMode(result);

      testBuffer.cursor = [0, 2];

      act(() => {
        result.current.handleInput(vimKey('.'));
      });

      expect(testBuffer.vimChangeToEndOfLine).toHaveBeenCalledTimes(2);
    });

    it('should repeat command after cursor movement', () => {
      const testBuffer = createMockBuffer('test text', [0, 0]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('x'));
      });
      expect(testBuffer.vimDeleteChar).toHaveBeenCalledWith(1);

      testBuffer.cursor = [0, 2];

      act(() => {
        result.current.handleInput(vimKey('.'));
      });
      expect(testBuffer.vimDeleteChar).toHaveBeenCalledWith(1);
    });

    it('should move cursor to the correct position after exiting INSERT mode with "a"', () => {
      const testBuffer = createMockBuffer('hello world', [0, 10]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('a'));
      });
      expect(result.current.mode).toBe('INSERT');
      expect(testBuffer.cursor).toStrictEqual([0, 11]);

      exitInsertMode(result);
      expect(result.current.mode).toBe('NORMAL');
      expect(testBuffer.cursor).toStrictEqual([0, 10]);
    });
  });
  describe('Special characters and edge cases', () => {
    it('should handle ^ (move to first non-whitespace character)', () => {
      const testBuffer = createMockBuffer('   hello world', [0, 5]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('^'));
      });

      expect(testBuffer.vimMoveToFirstNonWhitespace).toHaveBeenCalled();
    });

    it('should handle G without count (go to last line)', () => {
      const testBuffer = createMockBuffer('line1\nline2\nline3', [0, 0]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('G'));
      });

      expect(testBuffer.vimMoveToLastLine).toHaveBeenCalled();
    });

    it('should handle gg (go to first line)', () => {
      const testBuffer = createMockBuffer('line1\nline2\nline3', [2, 0]);
      const { result } = renderVimHook(testBuffer);

      // First 'g' sets pending state
      act(() => {
        result.current.handleInput(vimKey('g'));
      });

      // Second 'g' executes the command
      act(() => {
        result.current.handleInput(vimKey('g'));
      });

      expect(testBuffer.vimMoveToFirstLine).toHaveBeenCalled();
    });

    it('should handle count with movement commands', () => {
      const testBuffer = createMockBuffer('hello world test', [0, 0]);
      const { result } = renderVimHook(testBuffer);

      act(() => {
        result.current.handleInput(vimKey('3'));
      });

      act(() => {
        result.current.handleInput(TEST_SEQUENCES.WORD_FORWARD);
      });

      expect(testBuffer.vimMoveWordForward).toHaveBeenCalledWith(3);
    });
  });
});
