/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import stripAnsi from 'strip-ansi';
import { act } from 'react';
import { renderHook } from '../../../test-utils/render.js';
import type {
  TextBuffer,
  TextBufferAction,
  TextBufferState,
  Viewport,
} from './text-buffer.js';
import {
  useTextBuffer,
  offsetToLogicalPos,
  textBufferReducer,
} from './text-buffer.js';
import {
  findWordEndInLine,
  findNextWordStartInLine,
  isWordCharStrict,
} from './word-navigation.js';
import { cpLen } from '../../utils/textUtils.js';

const viewport: Viewport = { width: 10, height: 3 };

const getBufferState = (result: { current: TextBuffer }) => {
  expect(result.current).toHaveOnlyValidCharacters();
  return {
    text: result.current.text,
    lines: [...result.current.lines],
    cursor: [...result.current.cursor] as [number, number],
    allVisualLines: [...result.current.allVisualLines],
    viewportVisualLines: [...result.current.viewportVisualLines],
    visualCursor: [...result.current.visualCursor] as [number, number],
    visualScrollRow: result.current.visualScrollRow,
    preferredCol: result.current.preferredCol,
  };
};

const createTestState = (
  lines: string[],
  cursorRow: number,
  cursorCol: number,
  viewportWidth = 80,
): TextBufferState => {
  const text = lines.join('\n');
  let state = textBufferReducer(
    {
      lines: [''],
      cursorRow: 0,
      cursorCol: 0,
      transformationsByLine: [],
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
        transformedToLogicalMaps: [[0]],
        visualToTransformedMap: [0],
      },
    },
    { type: 'set_text', payload: text },
  );
  state = textBufferReducer(state, {
    type: 'set_cursor',
    payload: { cursorRow, cursorCol, preferredCol: null },
  });
  state = textBufferReducer(state, {
    type: 'set_viewport',
    payload: { width: viewportWidth, height: 24 },
  });
  return state;
};

describe('Input Sanitization', () => {
  const createInput = (sequence: string) => ({
    name: '',
    ctrl: false,
    meta: false,
    shift: false,
    sequence,
  });

  it.each([
    {
      input: '\x1B[31mHello\x1B[0m \x1B[32mWorld\x1B[0m',
      expected: 'Hello World',
      desc: 'ANSI escape codes',
    },
    {
      input: 'H\x07e\x08l\x0Bl\x0Co',
      expected: 'Hello',
      desc: 'control characters',
    },
    {
      input: '\u001B[4mH\u001B[0mello',
      expected: 'Hello',
      desc: 'mixed ANSI and control characters',
    },
    {
      input: '\u001B[4mPasted\u001B[4m Text',
      expected: 'Pasted Text',
      desc: 'pasted text with ANSI',
    },
  ])('should strip $desc from input', ({ input, expected }) => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() => result.current.handleInput(createInput(input)));
    expect(getBufferState(result).text).toBe(expected);
  });

  it('should not strip standard characters or newlines', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    const validText = 'Hello World\nThis is a test.';
    act(() => result.current.handleInput(createInput(validText)));
    expect(getBufferState(result).text).toBe(validText);
  });

  it('should sanitize large text (>5000 chars) and strip unsafe characters', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    const unsafeChars = '\x07\x08\x0B\x0C';
    const largeTextWithUnsafe =
      'safe text'.repeat(600) + unsafeChars + 'more safe text';

    expect(largeTextWithUnsafe.length).toBeGreaterThan(5000);

    act(() =>
      result.current.handleInput({
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: largeTextWithUnsafe,
      }),
    );

    const resultText = getBufferState(result).text;
    expect(resultText).not.toContain('\x07');
    expect(resultText).not.toContain('\x08');
    expect(resultText).not.toContain('\x0B');
    expect(resultText).not.toContain('\x0C');
    expect(resultText).toContain('safe text');
    expect(resultText).toContain('more safe text');
  });

  it('should sanitize large ANSI text (>5000 chars) and strip escape codes', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    const largeTextWithAnsi =
      '\x1B[31m' +
      'red text'.repeat(800) +
      '\x1B[0m' +
      '\x1B[32m' +
      'green text'.repeat(200) +
      '\x1B[0m';

    expect(largeTextWithAnsi.length).toBeGreaterThan(5000);

    act(() =>
      result.current.handleInput({
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: largeTextWithAnsi,
      }),
    );

    const resultText = getBufferState(result).text;
    expect(resultText).not.toContain('\x1B[31m');
    expect(resultText).not.toContain('\x1B[32m');
    expect(resultText).not.toContain('\x1B[0m');
    expect(resultText).toContain('red text');
    expect(resultText).toContain('green text');
  });

  it('should not strip popular emojis', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    const emojis = '🐍🐳🦀🦄';
    act(() =>
      result.current.handleInput({
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: emojis,
      }),
    );
    expect(getBufferState(result).text).toBe(emojis);
  });
});

describe('inputFilter', () => {
  it('should filter input based on the provided filter function', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        inputFilter: (text) => text.replace(/[^0-9]/g, ''),
      }),
    );

    act(() => result.current.insert('a1b2c3'));
    expect(getBufferState(result).text).toBe('123');
  });

  it('should handle empty result from filter', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        inputFilter: (text) => text.replace(/[^0-9]/g, ''),
      }),
    );

    act(() => result.current.insert('abc'));
    expect(getBufferState(result).text).toBe('');
  });

  it('should filter pasted text', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        inputFilter: (text) => text.toUpperCase(),
      }),
    );

    act(() => result.current.insert('hello', { paste: true }));
    expect(getBufferState(result).text).toBe('HELLO');
  });

  it('should not filter newlines if they are allowed by the filter', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        inputFilter: (text) => text, // Allow everything including newlines
      }),
    );

    act(() => result.current.insert('a\nb'));
    // The insert function splits by newline and inserts separately if it detects them.
    // If the filter allows them, they should be handled correctly by the subsequent logic in insert.
    expect(getBufferState(result).text).toBe('a\nb');
  });

  it('should filter before newline check in insert', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        inputFilter: (text) => text.replace(/\n/g, ''), // Filter out newlines
      }),
    );

    act(() => result.current.insert('a\nb'));
    expect(getBufferState(result).text).toBe('ab');
  });
});

describe('stripAnsi', () => {
  it('should correctly strip ANSI escape codes', () => {
    const textWithAnsi = '\x1B[31mHello\x1B[0m World';
    expect(stripAnsi(textWithAnsi)).toBe('Hello World');
  });

  it('should handle multiple ANSI codes', () => {
    const textWithMultipleAnsi = '\x1B[1m\x1B[34mBold Blue\x1B[0m Text';
    expect(stripAnsi(textWithMultipleAnsi)).toBe('Bold Blue Text');
  });

  it('should not modify text without ANSI codes', () => {
    const plainText = 'Plain text';
    expect(stripAnsi(plainText)).toBe('Plain text');
  });

  it('should handle empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('Memoization', () => {
  it('should keep action references stable across re-renders', () => {
    // We pass a stable `isValidPath` so that callbacks that depend on it
    // are not recreated on every render.
    const isValidPath = () => false;
    const { result, rerender } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath }),
    );

    const initialInsert = result.current.insert;
    const initialBackspace = result.current.backspace;
    const initialMove = result.current.move;
    const initialHandleInput = result.current.handleInput;

    rerender();

    expect(result.current.insert).toBe(initialInsert);
    expect(result.current.backspace).toBe(initialBackspace);
    expect(result.current.move).toBe(initialMove);
    expect(result.current.handleInput).toBe(initialHandleInput);
  });

  it('should have memoized actions that operate on the latest state', () => {
    const isValidPath = () => false;
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath }),
    );

    // Store a reference to the memoized insert function.
    const memoizedInsert = result.current.insert;

    // Update the buffer state.
    act(() => {
      result.current.insert('hello');
    });
    expect(getBufferState(result).text).toBe('hello');

    // Now, call the original memoized function reference.
    act(() => {
      memoizedInsert(' world');
    });

    // It should have operated on the updated state.
    expect(getBufferState(result).text).toBe('hello world');
  });
});

describe('singleLine mode', () => {
  it('should not insert a newline character when singleLine is true', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        singleLine: true,
      }),
    );
    act(() => result.current.insert('\n'));
    const state = getBufferState(result);
    expect(state.text).toBe('');
    expect(state.lines).toStrictEqual(['']);
  });

  it('should not create a new line when newline() is called and singleLine is true', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'ab',
        viewport,
        isValidPath: () => false,
        singleLine: true,
      }),
    );
    act(() => result.current.move('end')); // cursor at [0,2]
    act(() => result.current.newline());
    const state = getBufferState(result);
    expect(state.text).toBe('ab');
    expect(state.lines).toStrictEqual(['ab']);
    expect(state.cursor).toStrictEqual([0, 2]);
  });

  it('should not handle "Enter" key as newline when singleLine is true', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        singleLine: true,
      }),
    );
    act(() =>
      result.current.handleInput({
        name: 'return',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\r',
      }),
    );
    expect(getBufferState(result).lines).toStrictEqual(['']);
  });

  it('should strip newlines from pasted text when singleLine is true', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        singleLine: true,
      }),
    );
    act(() => result.current.insert('hello\nworld', { paste: true }));
    const state = getBufferState(result);
    expect(state.text).toBe('helloworld');
    expect(state.lines).toStrictEqual(['helloworld']);
  });
});

describe('multi-line text', () => {
  const text = 'hello\nworld\n123';

  it.each([
    { offset: 0, expected: [0, 0], desc: 'start of first line' },
    { offset: 3, expected: [0, 3], desc: 'middle of first line' },
    { offset: 5, expected: [0, 5], desc: 'end of first line' },
    { offset: 6, expected: [1, 0], desc: 'start of second line' },
    { offset: 8, expected: [1, 2], desc: 'middle of second line' },
    { offset: 11, expected: [1, 5], desc: 'end of second line' },
    { offset: 12, expected: [2, 0], desc: 'start of third line' },
    { offset: 13, expected: [2, 1], desc: 'middle of third line' },
    { offset: 15, expected: [2, 3], desc: 'end of third line' },
    { offset: 20, expected: [2, 3], desc: 'beyond end' },
  ])(
    'should return $expected for $desc (offset $offset)',
    ({ offset, expected }) => {
      expect(offsetToLogicalPos(text, offset)).toStrictEqual(expected);
    },
  );
});

describe('vim_delete_line', () => {
  it('should delete a single line including newline in multi-line text', () => {
    const state = createTestState(['line1', 'line2', 'line3'], 1, 2);

    const action: TextBufferAction = {
      type: 'vim_delete_line',
      payload: { count: 1 },
    };

    const result = textBufferReducer(state, action);
    expect(result).toHaveOnlyValidCharacters();

    // After deleting line2, we should have line1 and line3, with cursor on line3 (now at index 1)
    expect(result.lines).toStrictEqual(['line1', 'line3']);
    expect(result.cursorRow).toBe(1);
    expect(result.cursorCol).toBe(0);
  });

  it('should delete multiple lines when count > 1', () => {
    const state = createTestState(['line1', 'line2', 'line3', 'line4'], 1, 0);

    const action: TextBufferAction = {
      type: 'vim_delete_line',
      payload: { count: 2 },
    };

    const result = textBufferReducer(state, action);
    expect(result).toHaveOnlyValidCharacters();

    // Should delete line2 and line3, leaving line1 and line4
    expect(result.lines).toStrictEqual(['line1', 'line4']);
    expect(result.cursorRow).toBe(1);
    expect(result.cursorCol).toBe(0);
  });

  it('should clear single line content when only one line exists', () => {
    const state = createTestState(['only line'], 0, 5);

    const action: TextBufferAction = {
      type: 'vim_delete_line',
      payload: { count: 1 },
    };

    const result = textBufferReducer(state, action);
    expect(result).toHaveOnlyValidCharacters();

    // Should clear the line content but keep the line
    expect(result.lines).toStrictEqual(['']);
    expect(result.cursorRow).toBe(0);
    expect(result.cursorCol).toBe(0);
  });

  it('should handle deleting the last line properly', () => {
    const state = createTestState(['line1', 'line2'], 1, 0);

    const action: TextBufferAction = {
      type: 'vim_delete_line',
      payload: { count: 1 },
    };

    const result = textBufferReducer(state, action);
    expect(result).toHaveOnlyValidCharacters();

    // Should delete the last line completely, not leave empty line
    expect(result.lines).toStrictEqual(['line1']);
    expect(result.cursorRow).toBe(0);
    expect(result.cursorCol).toBe(0);
  });

  it('should handle deleting all lines and maintain valid state for subsequent paste', () => {
    const state = createTestState(['line1', 'line2', 'line3', 'line4'], 0, 0);

    // Delete all 4 lines with 4dd
    const deleteAction: TextBufferAction = {
      type: 'vim_delete_line',
      payload: { count: 4 },
    };

    const afterDelete = textBufferReducer(state, deleteAction);
    expect(afterDelete).toHaveOnlyValidCharacters();

    // After deleting all lines, should have one empty line
    expect(afterDelete.lines).toStrictEqual(['']);
    expect(afterDelete.cursorRow).toBe(0);
    expect(afterDelete.cursorCol).toBe(0);

    // Now paste multiline content - this should work correctly
    const pasteAction: TextBufferAction = {
      type: 'insert',
      payload: 'new1\nnew2\nnew3\nnew4',
    };

    const afterPaste = textBufferReducer(afterDelete, pasteAction);
    expect(afterPaste).toHaveOnlyValidCharacters();

    // All lines including the first one should be present
    expect(afterPaste.lines).toStrictEqual(['new1', 'new2', 'new3', 'new4']);
    expect(afterPaste.cursorRow).toBe(3);
    expect(afterPaste.cursorCol).toBe(4);
  });
});

describe('findWordEndInLine with Unicode', () => {
  it('should handle combining characters', () => {
    // café with combining accent
    const cafeWithCombining = 'cafe\u0301';
    const result = findWordEndInLine(cafeWithCombining + ' test', 0);
    expect(result).toBe(3); // End of 'café' at base character 'e', not combining accent
  });

  it('should handle precomposed characters with diacritics', () => {
    // café with precomposed é (U+00E9)
    const cafePrecomposed = 'café';
    const result = findWordEndInLine(cafePrecomposed + ' test', 0);
    expect(result).toBe(3); // End of 'café' at precomposed character 'é'
  });

  it('should return null when no word end found', () => {
    const result = findWordEndInLine('   ', 0);
    expect(result).toBeNull(); // No word end found in whitespace-only string string
  });
});

describe('findNextWordStartInLine with Unicode', () => {
  it('should handle right-to-left text', () => {
    const result = findNextWordStartInLine('hello مرحبا world', 0);
    expect(result).toBe(6); // Start of Arabic word
  });

  it('should handle Chinese characters', () => {
    const result = findNextWordStartInLine('hello 你好 world', 0);
    expect(result).toBe(6); // Start of Chinese word
  });

  it('should return null at end of line', () => {
    const result = findNextWordStartInLine('hello', 10);
    expect(result).toBeNull();
  });

  it('should handle combining characters', () => {
    // café with combining accent + next word
    const textWithCombining = 'cafe\u0301 test';
    const result = findNextWordStartInLine(textWithCombining, 0);
    expect(result).toBe(6); // Start of 'test' after 'café ' (combining char makes string longer)
  });

  it('should handle precomposed characters with diacritics', () => {
    // café with precomposed é + next word
    const textPrecomposed = 'café test';
    const result = findNextWordStartInLine(textPrecomposed, 0);
    expect(result).toBe(5); // Start of 'test' after 'café '
  });
});

describe('isWordCharStrict with Unicode', () => {
  it('should return true for ASCII word characters', () => {
    expect(isWordCharStrict('a')).toBe(true);
    expect(isWordCharStrict('Z')).toBe(true);
    expect(isWordCharStrict('0')).toBe(true);
    expect(isWordCharStrict('_')).toBe(true);
  });

  it('should return false for punctuation', () => {
    expect(isWordCharStrict('.')).toBe(false);
    expect(isWordCharStrict(',')).toBe(false);
    expect(isWordCharStrict('!')).toBe(false);
  });

  it('should return true for non-Latin scripts', () => {
    expect(isWordCharStrict('你')).toBe(true); // Chinese character
    expect(isWordCharStrict('م')).toBe(true); // Arabic character
  });

  it('should return false for whitespace', () => {
    expect(isWordCharStrict(' ')).toBe(false);
    expect(isWordCharStrict('\t')).toBe(false);
  });
});

describe('cpLen with Unicode', () => {
  it('should handle combining characters', () => {
    expect(cpLen('é')).toBe(1); // Precomposed
    expect(cpLen('e\u0301')).toBe(2); // e + combining acute
  });

  it('should handle Chinese and Arabic text', () => {
    expect(cpLen('hello 你好 world')).toBe(14); // 5 + 1 + 2 + 1 + 5 = 14
    expect(cpLen('hello مرحبا world')).toBe(17);
  });
});
