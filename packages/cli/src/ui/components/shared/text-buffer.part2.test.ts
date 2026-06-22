/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../test-utils/render.js';
import type { TextBuffer, Viewport } from './text-buffer.js';
import { useTextBuffer } from './text-buffer.js';

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

describe('Drag and Drop File Paths', () => {
  it('should prepend @ to a valid file path on insert', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => true }),
    );
    const filePath = '/path/to/a/valid/file.txt';
    act(() => result.current.insert(filePath, { paste: true }));
    expect(getBufferState(result).text).toBe(`@${filePath} `);
  });

  it('should not prepend @ to an invalid file path on insert', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    const notAPath = 'this is just some long text';
    act(() => result.current.insert(notAPath, { paste: true }));
    expect(getBufferState(result).text).toBe(notAPath);
  });

  it('should handle quoted paths', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => true }),
    );
    const filePath = "'/path/to/a/valid/file.txt'";
    act(() => result.current.insert(filePath, { paste: true }));
    expect(getBufferState(result).text).toBe(`@/path/to/a/valid/file.txt `);
  });

  it('should not prepend @ to short text that is not a path', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => true }),
    );
    const shortText = 'ab';
    act(() => result.current.insert(shortText, { paste: true }));
    expect(getBufferState(result).text).toBe(shortText);
  });

  it('should prepend @ to multiple valid file paths on insert', () => {
    const validPaths = new Set(['/path/to/file1.txt', '/path/to/file2.txt']);
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: (p) => validPaths.has(p) }),
    );
    const filePaths = '/path/to/file1.txt /path/to/file2.txt';
    act(() => result.current.insert(filePaths, { paste: true }));
    expect(getBufferState(result).text).toBe(
      '@/path/to/file1.txt @/path/to/file2.txt ',
    );
  });

  it('should handle multiple paths with escaped spaces', () => {
    const validPaths = new Set(['/path/to/my file.txt', '/other/path.txt']);
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: (p) => validPaths.has(p) }),
    );
    const filePaths = '/path/to/my\\\\ file.txt /other/path.txt';
    act(() => result.current.insert(filePaths, { paste: true }));
    expect(getBufferState(result).text).toBe(
      '@/path/to/my\\\\ file.txt @/other/path.txt ',
    );
  });

  it('should only prepend @ to valid paths in multi-path paste', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: (p) => p.endsWith('.txt'),
      }),
    );
    const filePaths = '/valid/file.txt /invalid/file.jpg';
    act(() => result.current.insert(filePaths, { paste: true }));
    expect(getBufferState(result).text).toBe(
      '@/valid/file.txt /invalid/file.jpg ',
    );
  });
});

describe('Shell Mode Behavior', () => {
  it('should not prepend @ to valid file paths when shellModeActive is true', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => true,
        shellModeActive: true,
      }),
    );
    const filePath = '/path/to/a/valid/file.txt';
    act(() => result.current.insert(filePath, { paste: true }));
    expect(getBufferState(result).text).toBe(filePath); // No @ prefix
  });

  it('should not prepend @ to quoted paths when shellModeActive is true', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => true,
        shellModeActive: true,
      }),
    );
    const quotedFilePath = "'/path/to/a/valid/file.txt'";
    act(() => result.current.insert(quotedFilePath, { paste: true }));
    expect(getBufferState(result).text).toBe(quotedFilePath); // No @ prefix, keeps quotes
  });

  it('should behave normally with invalid paths when shellModeActive is true', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => false,
        shellModeActive: true,
      }),
    );
    const notAPath = 'this is just some text';
    act(() => result.current.insert(notAPath, { paste: true }));
    expect(getBufferState(result).text).toBe(notAPath);
  });

  it('should behave normally with short text when shellModeActive is true', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport,
        isValidPath: () => true,
        shellModeActive: true,
      }),
    );
    const shortText = 'ls';
    act(() => result.current.insert(shortText, { paste: true }));
    expect(getBufferState(result).text).toBe(shortText); // No @ prefix for short text
  });
});

describe('Cursor Movement', () => {
  it('move: left/right should work within and across visual lines (due to wrapping)', () => {
    // Text: "long line1next line2" (20 chars)
    // Viewport width 5. Word wrapping should produce:
    // "long " (5)
    // "line1" (5)
    // "next " (5)
    // "line2" (5)
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'long line1next line2', // Corrected: was 'long line1next line2'
        viewport: { width: 5, height: 4 },
        isValidPath: () => false,
      }),
    );
    // Initial cursor [0,0] logical, visual [0,0] ("l" of "long ")

    act(() => result.current.move('right')); // visual [0,1] ("o")
    expect(getBufferState(result).visualCursor).toStrictEqual([0, 1]);
    act(() => result.current.move('right')); // visual [0,2] ("n")
    act(() => result.current.move('right')); // visual [0,3] ("g")
    act(() => result.current.move('right')); // visual [0,4] (" ")
    expect(getBufferState(result).visualCursor).toStrictEqual([0, 4]);

    act(() => result.current.move('right')); // visual [1,0] ("l" of "line1")
    expect(getBufferState(result).visualCursor).toStrictEqual([1, 0]);
    expect(getBufferState(result).cursor).toStrictEqual([0, 5]); // logical cursor

    act(() => result.current.move('left')); // visual [0,4] (" " of "long ")
    expect(getBufferState(result).visualCursor).toStrictEqual([0, 4]);
    expect(getBufferState(result).cursor).toStrictEqual([0, 4]); // logical cursor
  });

  it('move: up/down should preserve preferred visual column', () => {
    const text = 'abcde\nxy\n12345';
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: text,
        viewport,
        isValidPath: () => false,
      }),
    );
    expect(result.current.allVisualLines).toStrictEqual([
      'abcde',
      'xy',
      '12345',
    ]);
    // Place cursor at the end of "abcde" -> logical [0,5]
    act(() => {
      result.current.move('home'); // to [0,0]
    });
    for (let i = 0; i < 5; i++) {
      act(() => {
        result.current.move('right'); // to [0,5]
      });
    }
    expect(getBufferState(result).cursor).toStrictEqual([0, 5]);
    expect(getBufferState(result).visualCursor).toStrictEqual([0, 5]);

    // Set preferredCol by moving up then down to the same spot, then test.
    act(() => {
      result.current.move('down'); // to xy, logical [1,2], visual [1,2], preferredCol should be 5
    });
    let state = getBufferState(result);
    expect(state.cursor).toStrictEqual([1, 2]); // Logical cursor at end of 'xy'
    expect(state.visualCursor).toStrictEqual([1, 2]); // Visual cursor at end of 'xy'
    expect(state.preferredCol).toBe(5);

    act(() => result.current.move('down')); // to '12345', preferredCol=5.
    state = getBufferState(result);
    expect(state.cursor).toStrictEqual([2, 5]); // Logical cursor at end of '12345'
    expect(state.visualCursor).toStrictEqual([2, 5]); // Visual cursor at end of '12345'
    expect(state.preferredCol).toBe(5); // Preferred col is maintained

    act(() => result.current.move('left')); // preferredCol should reset
    state = getBufferState(result);
    expect(state.preferredCol).toBe(null);
  });

  it('move: home/end should go to visual line start/end', () => {
    const initialText = 'line one\nsecond line';
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText,
        viewport: { width: 5, height: 5 },
        isValidPath: () => false,
      }),
    );
    expect(result.current.allVisualLines).toStrictEqual([
      'line',
      'one',
      'secon',
      'd',
      'line',
    ]);
    // Initial cursor [0,0] (start of "line")
    act(() => result.current.move('down')); // visual cursor from [0,0] to [1,0] ("o" of "one")
    act(() => result.current.move('right')); // visual cursor to [1,1] ("n" of "one")
    expect(getBufferState(result).visualCursor).toStrictEqual([1, 1]);

    act(() => result.current.move('home')); // visual cursor to [1,0] (start of "one")
    expect(getBufferState(result).visualCursor).toStrictEqual([1, 0]);

    act(() => result.current.move('end')); // visual cursor to [1,3] (end of "one")
    expect(getBufferState(result).visualCursor).toStrictEqual([1, 3]); // "one" is 3 chars
  });
});

describe('Visual Layout & Viewport', () => {
  it('should wrap long lines correctly into visualLines', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'This is a very long line of text.', // 33 chars
        viewport: { width: 10, height: 5 },
        isValidPath: () => false,
      }),
    );
    const state = getBufferState(result);
    // Expected visual lines with word wrapping (viewport width 10):
    // "This is a"
    // "very long"
    // "line of"
    // "text."
    expect(state.allVisualLines.length).toBe(4);
    expect(state.allVisualLines[0]).toBe('This is a');
    expect(state.allVisualLines[1]).toBe('very long');
    expect(state.allVisualLines[2]).toBe('line of');
    expect(state.allVisualLines[3]).toBe('text.');
  });

  it('should update visualScrollRow when visualCursor moves out of viewport', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'l1\nl2\nl3\nl4\nl5',
        viewport: { width: 5, height: 3 }, // Can show 3 visual lines
        isValidPath: () => false,
      }),
    );
    // Initial: l1, l2, l3 visible. visualScrollRow = 0. visualCursor = [0,0]
    expect(getBufferState(result).visualScrollRow).toBe(0);
    expect(getBufferState(result).allVisualLines).toStrictEqual([
      'l1',
      'l2',
      'l3',
      'l4',
      'l5',
    ]);
    expect(getBufferState(result).viewportVisualLines).toStrictEqual([
      'l1',
      'l2',
      'l3',
    ]);

    act(() => result.current.move('down')); // vc=[1,0]
    act(() => result.current.move('down')); // vc=[2,0] (l3)
    expect(getBufferState(result).visualScrollRow).toBe(0);

    act(() => result.current.move('down')); // vc=[3,0] (l4) - scroll should happen
    // Now: l2, l3, l4 visible. visualScrollRow = 1.
    let state = getBufferState(result);
    expect(state.visualScrollRow).toBe(1);
    expect(state.allVisualLines).toStrictEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(state.viewportVisualLines).toStrictEqual(['l2', 'l3', 'l4']);
    expect(state.visualCursor).toStrictEqual([3, 0]);

    act(() => result.current.move('up')); // vc=[2,0] (l3)
    act(() => result.current.move('up')); // vc=[1,0] (l2)
    expect(getBufferState(result).visualScrollRow).toBe(1);

    act(() => result.current.move('up')); // vc=[0,0] (l1) - scroll up
    // Now: l1, l2, l3 visible. visualScrollRow = 0
    state = getBufferState(result); // Assign to the existing `state` variable
    expect(state.visualScrollRow).toBe(0);
    expect(state.allVisualLines).toStrictEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    expect(state.viewportVisualLines).toStrictEqual(['l1', 'l2', 'l3']);
    expect(state.visualCursor).toStrictEqual([0, 0]);
  });
});

describe('Undo/Redo', () => {
  it('should undo and redo an insert operation', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() => result.current.insert('a'));
    expect(getBufferState(result).text).toBe('a');

    act(() => result.current.undo());
    expect(getBufferState(result).text).toBe('');
    expect(getBufferState(result).cursor).toStrictEqual([0, 0]);

    act(() => result.current.redo());
    expect(getBufferState(result).text).toBe('a');
    expect(getBufferState(result).cursor).toStrictEqual([0, 1]);
  });

  it('should undo and redo a newline operation', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'test',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('end'));
    act(() => result.current.newline());
    expect(getBufferState(result).text).toBe('test\n');

    act(() => result.current.undo());
    expect(getBufferState(result).text).toBe('test');
    expect(getBufferState(result).cursor).toStrictEqual([0, 4]);

    act(() => result.current.redo());
    expect(getBufferState(result).text).toBe('test\n');
    expect(getBufferState(result).cursor).toStrictEqual([1, 0]);
  });
});

describe('Unicode Handling', () => {
  it('insert: should correctly handle multi-byte unicode characters', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() => result.current.insert('你好'));
    const state = getBufferState(result);
    expect(state.text).toBe('你好');
    expect(state.cursor).toStrictEqual([0, 2]); // Cursor is 2 (char count)
    expect(state.visualCursor).toStrictEqual([0, 2]);
  });

  it('backspace: should correctly delete multi-byte unicode characters', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: '你好',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('end')); // cursor at [0,2]
    act(() => result.current.backspace()); // delete '好'
    let state = getBufferState(result);
    expect(state.text).toBe('你');
    expect(state.cursor).toStrictEqual([0, 1]);

    act(() => result.current.backspace()); // delete '你'
    state = getBufferState(result);
    expect(state.text).toBe('');
    expect(state.cursor).toStrictEqual([0, 0]);
  });

  it('move: left/right should treat multi-byte chars as single units for visual cursor', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: '🐶🐱',
        viewport: { width: 5, height: 1 },
        isValidPath: () => false,
      }),
    );
    // Initial: visualCursor [0,0]
    act(() => result.current.move('right')); // visualCursor [0,1] (after 🐶)
    let state = getBufferState(result);
    expect(state.cursor).toStrictEqual([0, 1]);
    expect(state.visualCursor).toStrictEqual([0, 1]);

    act(() => result.current.move('right')); // visualCursor [0,2] (after 🐱)
    state = getBufferState(result);
    expect(state.cursor).toStrictEqual([0, 2]);
    expect(state.visualCursor).toStrictEqual([0, 2]);

    act(() => result.current.move('left')); // visualCursor [0,1] (before 🐱 / after 🐶)
    state = getBufferState(result);
    expect(state.cursor).toStrictEqual([0, 1]);
    expect(state.visualCursor).toStrictEqual([0, 1]);
  });

  it('moveToVisualPosition: should correctly handle wide characters (Chinese)', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: '你好', // 2 chars, width 4
        viewport: { width: 10, height: 1 },
        isValidPath: () => false,
      }),
    );

    // '你' (width 2): visual 0-1. '好' (width 2): visual 2-3.

    // Click on '你' (first half, x=0) -> index 0
    act(() => result.current.moveToVisualPosition(0, 0));
    expect(getBufferState(result).cursor).toStrictEqual([0, 0]);

    // Click on '你' (second half, x=1) -> index 1 (after first char)
    act(() => result.current.moveToVisualPosition(0, 1));
    expect(getBufferState(result).cursor).toStrictEqual([0, 1]);

    // Click on '好' (first half, x=2) -> index 1 (before second char)
    act(() => result.current.moveToVisualPosition(0, 2));
    expect(getBufferState(result).cursor).toStrictEqual([0, 1]);

    // Click on '好' (second half, x=3) -> index 2 (after second char)
    act(() => result.current.moveToVisualPosition(0, 3));
    expect(getBufferState(result).cursor).toStrictEqual([0, 2]);
  });
});
