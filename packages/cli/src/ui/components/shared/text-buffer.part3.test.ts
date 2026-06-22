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
import { useTextBuffer, offsetToLogicalPos } from './text-buffer.js';

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

describe('handleInput', () => {
  it('should insert printable characters', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() =>
      result.current.handleInput({
        name: 'h',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: 'h',
      }),
    );
    act(() =>
      result.current.handleInput({
        name: 'i',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: 'i',
      }),
    );
    expect(getBufferState(result).text).toBe('hi');
  });

  it('should handle "Enter" key as newline', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
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
    expect(getBufferState(result).lines).toStrictEqual(['', '']);
  });

  it('should handle Ctrl+J as newline', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() =>
      result.current.handleInput({
        name: 'j',
        ctrl: true,
        meta: false,
        shift: false,
        insertable: false,
        sequence: '\n',
      }),
    );
    expect(getBufferState(result).lines).toStrictEqual(['', '']);
  });

  it('should do nothing for a tab key press', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() =>
      result.current.handleInput({
        name: 'tab',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\t',
      }),
    );
    expect(getBufferState(result).text).toBe('');
  });

  it('should do nothing for a shift tab key press', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() =>
      result.current.handleInput({
        name: 'tab',
        ctrl: false,
        meta: false,
        shift: true,
        sequence: '\u001b[9;2u',
      }),
    );
    expect(getBufferState(result).text).toBe('');
  });

  it('should handle "Backspace" key', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'a',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('end'));
    act(() =>
      result.current.handleInput({
        name: 'backspace',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x7f',
      }),
    );
    expect(getBufferState(result).text).toBe('');
  });

  it('should handle multiple delete characters in one input', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'abcde',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('end')); // cursor at the end
    expect(getBufferState(result).cursor).toStrictEqual([0, 5]);

    act(() => {
      result.current.handleInput({
        name: 'backspace',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x7f',
      });
      result.current.handleInput({
        name: 'backspace',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x7f',
      });
      result.current.handleInput({
        name: 'backspace',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x7f',
      });
    });
    expect(getBufferState(result).text).toBe('ab');
    expect(getBufferState(result).cursor).toStrictEqual([0, 2]);
  });

  it('should handle inserts that contain delete characters', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'abcde',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('end')); // cursor at the end
    expect(getBufferState(result).cursor).toStrictEqual([0, 5]);

    act(() => {
      result.current.insert('\x7f\x7f\x7f');
    });
    expect(getBufferState(result).text).toBe('ab');
    expect(getBufferState(result).cursor).toStrictEqual([0, 2]);
  });

  it('should handle inserts with a mix of regular and delete characters', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'abcde',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('end')); // cursor at the end
    expect(getBufferState(result).cursor).toStrictEqual([0, 5]);

    act(() => {
      result.current.insert('\x7fI\x7f\x7fNEW');
    });
    expect(getBufferState(result).text).toBe('abcNEW');
    expect(getBufferState(result).cursor).toStrictEqual([0, 6]);
  });

  it('should handle arrow keys for movement', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'ab',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('end')); // cursor [0,2]
    act(() =>
      result.current.handleInput({
        name: 'left',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x1b[D',
      }),
    ); // cursor [0,1]
    expect(getBufferState(result).cursor).toStrictEqual([0, 1]);
    act(() =>
      result.current.handleInput({
        name: 'right',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x1b[C',
      }),
    ); // cursor [0,2]
    expect(getBufferState(result).cursor).toStrictEqual([0, 2]);
  });

  it('should handle up/down arrow keys for vertical movement via handleInput', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'abc\ndef\nghi',
        viewport,
        isValidPath: () => false,
      }),
    );
    // Start at [0,0], move down twice then up
    act(() =>
      result.current.handleInput({
        name: 'down',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x1b[B',
      }),
    );
    expect(getBufferState(result).cursor).toStrictEqual([1, 0]);
    act(() =>
      result.current.handleInput({
        name: 'down',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x1b[B',
      }),
    );
    expect(getBufferState(result).cursor).toStrictEqual([2, 0]);
    act(() =>
      result.current.handleInput({
        name: 'up',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x1b[A',
      }),
    );
    expect(getBufferState(result).cursor).toStrictEqual([1, 0]);
  });

  it('should use keyMatchers for MOVE_UP/MOVE_DOWN (honors command mapping)', () => {
    // The default MOVE_UP binding is { key: 'up', ctrl: false, command: false },
    // so pressing up with meta/command held should NOT trigger move('up').
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'abc\ndef',
        viewport,
        isValidPath: () => false,
      }),
    );
    // Move to line 1
    act(() => result.current.move('down'));
    expect(getBufferState(result).cursor).toStrictEqual([1, 0]);

    // Press up with meta (command) held — should NOT move up because
    // the default binding requires command=false.
    act(() =>
      result.current.handleInput({
        name: 'up',
        ctrl: false,
        meta: true,
        shift: false,
        sequence: '\x1b[A',
      }),
    );
    expect(getBufferState(result).cursor).toStrictEqual([1, 0]); // Still on line 1

    // Press plain up — should move up
    act(() =>
      result.current.handleInput({
        name: 'up',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x1b[A',
      }),
    );
    expect(getBufferState(result).cursor).toStrictEqual([0, 0]);

    // Press down with ctrl held — should NOT move down because
    // the default binding requires ctrl=false.
    act(() =>
      result.current.handleInput({
        name: 'down',
        ctrl: true,
        meta: false,
        shift: false,
        sequence: '\x1b[B',
      }),
    );
    expect(getBufferState(result).cursor).toStrictEqual([0, 0]); // Still on line 0

    // Press plain down — should move down
    act(() =>
      result.current.handleInput({
        name: 'down',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: '\x1b[B',
      }),
    );
    expect(getBufferState(result).cursor).toStrictEqual([1, 0]);
  });

  it('should strip ANSI escape codes when pasting text', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    const textWithAnsi = '\x1B[31mHello\x1B[0m \x1B[32mWorld\x1B[0m';
    // Simulate pasting by calling handleInput with a string longer than 1 char
    act(() =>
      result.current.handleInput({
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: textWithAnsi,
      }),
    );
    expect(getBufferState(result).text).toBe('Hello World');
  });

  it('should handle VSCode terminal Shift+Enter as newline', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() =>
      result.current.handleInput({
        name: 'return',
        ctrl: false,
        meta: false,
        shift: true,
        sequence: '\r',
      }),
    ); // Simulates Shift+Enter in VSCode terminal
    expect(getBufferState(result).lines).toStrictEqual(['', '']);
  });

  it('should correctly handle repeated pasting of long text', () => {
    const longText = `not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lorem Ipsum passages, and more recently with desktop publishing software like Aldus PageMaker including versions of Lorem Ipsum.

Why do we use it?
It is a long established fact that a reader will be distracted by the readable content of a page when looking at its layout. The point of using Lorem Ipsum is that it has a more-or-less normal distribution of letters, as opposed to using 'Content here, content here', making it look like readable English. Many desktop publishing packages and web page editors now use Lorem Ipsum as their default model text, and a search for 'lorem ipsum' will uncover many web sites still in their infancy. Various versions have evolved over the years, sometimes by accident, sometimes on purpose (injected humour and the like).

Where does it come from?
Contrary to popular belief, Lorem Ipsum is not simply random text. It has roots in a piece of classical Latin literature from 45 BC, making it over 2000 years old. Richard McClintock, a Latin professor at Hampden-Sydney College in Virginia, looked up one of the more obscure Latin words, consectetur, from a Lore
`;
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );

    // Simulate pasting the long text multiple times
    act(() => {
      result.current.insert(longText, { paste: true });
      result.current.insert(longText, { paste: true });
      result.current.insert(longText, { paste: true });
    });

    const state = getBufferState(result);
    // Check that the text is the result of three concatenations.
    expect(state.lines).toStrictEqual(
      (longText + longText + longText).split('\n'),
    );
    const expectedCursorPos = offsetToLogicalPos(state.text, state.text.length);
    expect(state.cursor).toStrictEqual(expectedCursorPos);
  });
});

describe('replaceRange', () => {
  it('should replace a single-line range with single-line text', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: '@pac',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.replaceRange(0, 1, 0, 4, 'packages'));
    const state = getBufferState(result);
    expect(state.text).toBe('@packages');
    expect(state.cursor).toStrictEqual([0, 9]); // cursor after 'typescript'
  });

  it('should replace a multi-line range with single-line text', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'hello\nworld\nagain',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.replaceRange(0, 2, 1, 3, ' new ')); // replace 'llo\nwor' with ' new '
    const state = getBufferState(result);
    expect(state.text).toBe('he new ld\nagain');
    expect(state.cursor).toStrictEqual([0, 7]); // cursor after ' new '
  });

  it('should delete a range when replacing with an empty string', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'hello world',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.replaceRange(0, 5, 0, 11, '')); // delete ' world'
    const state = getBufferState(result);
    expect(state.text).toBe('hello');
    expect(state.cursor).toStrictEqual([0, 5]);
  });

  it('should handle replacing at the beginning of the text', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'world',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.replaceRange(0, 0, 0, 0, 'hello '));
    const state = getBufferState(result);
    expect(state.text).toBe('hello world');
    expect(state.cursor).toStrictEqual([0, 6]);
  });

  it('should handle replacing at the end of the text', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'hello',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.replaceRange(0, 5, 0, 5, ' world'));
    const state = getBufferState(result);
    expect(state.text).toBe('hello world');
    expect(state.cursor).toStrictEqual([0, 11]);
  });

  it('should handle replacing the entire buffer content', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'old text',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.replaceRange(0, 0, 0, 8, 'new text'));
    const state = getBufferState(result);
    expect(state.text).toBe('new text');
    expect(state.cursor).toStrictEqual([0, 8]);
  });

  it('should correctly replace with unicode characters', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'hello *** world',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.replaceRange(0, 6, 0, 9, '你好'));
    const state = getBufferState(result);
    expect(state.text).toBe('hello 你好 world');
    expect(state.cursor).toStrictEqual([0, 8]); // after '你好'
  });

  it('should handle invalid range by returning false and not changing text', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'test',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => {
      result.current.replaceRange(0, 5, 0, 3, 'fail'); // startCol > endCol in same line
    });

    expect(getBufferState(result).text).toBe('test');

    act(() => {
      result.current.replaceRange(1, 0, 0, 0, 'fail'); // startRow > endRow
    });
    expect(getBufferState(result).text).toBe('test');
  });

  it('replaceRange: multiple lines with a single character', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'first\nsecond\nthird',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.replaceRange(0, 2, 2, 3, 'X')); // Replace 'rst\nsecond\nthi'
    const state = getBufferState(result);
    expect(state.text).toBe('fiXrd');
    expect(state.cursor).toStrictEqual([0, 3]); // After 'X'
  });

  it('should replace a single-line range with multi-line text', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'one two three',
        viewport,
        isValidPath: () => false,
      }),
    );
    // Replace "two" with "new\nline"
    act(() => result.current.replaceRange(0, 4, 0, 7, 'new\nline'));
    const state = getBufferState(result);
    expect(state.lines).toStrictEqual(['one new', 'line three']);
    expect(state.text).toBe('one new\nline three');
    expect(state.cursor).toStrictEqual([1, 4]); // cursor after 'line'
  });
});
