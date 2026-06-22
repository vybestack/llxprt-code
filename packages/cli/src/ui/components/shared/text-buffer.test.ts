/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../test-utils/render.js';
import type {
  TextBufferState,
  TextBufferAction,
  VisualLayout,
  TextBufferOptions,
} from './text-buffer.js';
import { useTextBuffer, textBufferReducer } from './text-buffer.js';

const defaultVisualLayout: VisualLayout = {
  visualLines: [''],
  logicalToVisualMap: [[[0, 0]]],
  visualToLogicalMap: [[0, 0]],
};

const initialState: TextBufferState = {
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
  visualLayout: defaultVisualLayout,
};

describe('set_text action', () => {
  it('should set new text and move cursor to the end', () => {
    const action: TextBufferAction = {
      type: 'set_text',
      payload: 'hello\nworld',
    };
    const state = textBufferReducer(initialState, action);
    expect(state).toHaveOnlyValidCharacters();
    expect(state.lines).toStrictEqual(['hello', 'world']);
    expect(state.cursorRow).toBe(1);
    expect(state.cursorCol).toBe(5);
    expect(state.undoStack.length).toBe(1);
  });

  it('should not create an undo snapshot if pushToUndo is false', () => {
    const action: TextBufferAction = {
      type: 'set_text',
      payload: 'no undo',
      pushToUndo: false,
    };
    const state = textBufferReducer(initialState, action);
    expect(state).toHaveOnlyValidCharacters();
    expect(state.lines).toStrictEqual(['no undo']);
    expect(state.undoStack.length).toBe(0);
  });
});

describe('insert action', () => {
  it('should insert a character', () => {
    const action: TextBufferAction = { type: 'insert', payload: 'a' };
    const state = textBufferReducer(initialState, action);
    expect(state).toHaveOnlyValidCharacters();
    expect(state.lines).toStrictEqual(['a']);
    expect(state.cursorCol).toBe(1);
  });

  it('should insert a newline', () => {
    const stateWithText = { ...initialState, lines: ['hello'] };
    const action: TextBufferAction = { type: 'insert', payload: '\n' };
    const state = textBufferReducer(stateWithText, action);
    expect(state).toHaveOnlyValidCharacters();
    expect(state.lines).toStrictEqual(['', 'hello']);
    expect(state.cursorRow).toBe(1);
    expect(state.cursorCol).toBe(0);
  });
});

describe('insert action with options', () => {
  it('should filter input using inputFilter option', () => {
    const action: TextBufferAction = { type: 'insert', payload: 'a1b2c3' };
    const options: TextBufferOptions = {
      inputFilter: (text) => text.replace(/[0-9]/g, ''),
    };
    const state = textBufferReducer(initialState, action, options);
    expect(state.lines).toStrictEqual(['abc']);
    expect(state.cursorCol).toBe(3);
  });

  it('should strip newlines when singleLine option is true', () => {
    const action: TextBufferAction = {
      type: 'insert',
      payload: 'hello\nworld',
    };
    const options: TextBufferOptions = { singleLine: true };
    const state = textBufferReducer(initialState, action, options);
    expect(state.lines).toStrictEqual(['helloworld']);
    expect(state.cursorCol).toBe(10);
  });

  it('should apply both inputFilter and singleLine options', () => {
    const action: TextBufferAction = {
      type: 'insert',
      payload: 'h\ne\nl\nl\no\n1\n2\n3',
    };
    const options: TextBufferOptions = {
      singleLine: true,
      inputFilter: (text) => text.replace(/[0-9]/g, ''),
    };
    const state = textBufferReducer(initialState, action, options);
    expect(state.lines).toStrictEqual(['hello']);
    expect(state.cursorCol).toBe(5);
  });
});

describe('backspace action', () => {
  it('should remove a character', () => {
    const stateWithText: TextBufferState = {
      ...initialState,
      lines: ['a'],
      cursorRow: 0,
      cursorCol: 1,
    };
    const action: TextBufferAction = { type: 'backspace' };
    const state = textBufferReducer(stateWithText, action);
    expect(state).toHaveOnlyValidCharacters();
    expect(state.lines).toStrictEqual(['']);
    expect(state.cursorCol).toBe(0);
  });

  it('should join lines if at the beginning of a line', () => {
    const stateWithText: TextBufferState = {
      ...initialState,
      lines: ['hello', 'world'],
      cursorRow: 1,
      cursorCol: 0,
    };
    const action: TextBufferAction = { type: 'backspace' };
    const state = textBufferReducer(stateWithText, action);
    expect(state).toHaveOnlyValidCharacters();
    expect(state.lines).toStrictEqual(['helloworld']);
    expect(state.cursorRow).toBe(0);
    expect(state.cursorCol).toBe(5);
  });
});

describe('undo/redo actions', () => {
  it('should undo and redo a change', () => {
    // 1. Insert text
    const insertAction: TextBufferAction = {
      type: 'insert',
      payload: 'test',
    };
    const stateAfterInsert = textBufferReducer(initialState, insertAction);
    expect(stateAfterInsert).toHaveOnlyValidCharacters();
    expect(stateAfterInsert.lines).toStrictEqual(['test']);
    expect(stateAfterInsert.undoStack.length).toBe(1);

    // 2. Undo
    const undoAction: TextBufferAction = { type: 'undo' };
    const stateAfterUndo = textBufferReducer(stateAfterInsert, undoAction);
    expect(stateAfterUndo).toHaveOnlyValidCharacters();
    expect(stateAfterUndo.lines).toStrictEqual(['']);
    expect(stateAfterUndo.undoStack.length).toBe(0);
    expect(stateAfterUndo.redoStack.length).toBe(1);

    // 3. Redo
    const redoAction: TextBufferAction = { type: 'redo' };
    const stateAfterRedo = textBufferReducer(stateAfterUndo, redoAction);
    expect(stateAfterRedo).toHaveOnlyValidCharacters();
    expect(stateAfterRedo.lines).toStrictEqual(['test']);
    expect(stateAfterRedo.undoStack.length).toBe(1);
    expect(stateAfterRedo.redoStack.length).toBe(0);
  });
});

describe('create_undo_snapshot action', () => {
  it('should create a snapshot without changing state', () => {
    const stateWithText: TextBufferState = {
      ...initialState,
      lines: ['hello'],
      cursorRow: 0,
      cursorCol: 5,
    };
    const action: TextBufferAction = { type: 'create_undo_snapshot' };
    const state = textBufferReducer(stateWithText, action);
    expect(state).toHaveOnlyValidCharacters();

    expect(state.lines).toStrictEqual(['hello']);
    expect(state.cursorRow).toBe(0);
    expect(state.cursorCol).toBe(5);
    expect(state.undoStack.length).toBe(1);
    expect(state.undoStack[0].lines).toStrictEqual(['hello']);
    expect(state.undoStack[0].cursorRow).toBe(0);
    expect(state.undoStack[0].cursorCol).toBe(5);
  });
});

describe('delete_word_left action', () => {
  it.each([
    {
      input: 'hello world',
      cursorCol: 11,
      expectedLines: ['hello '],
      expectedCol: 6,
      desc: 'simple word',
    },
    {
      input: 'path/to/file',
      cursorCol: 12,
      expectedLines: ['path/to/'],
      expectedCol: 8,
      desc: 'path segment',
    },
    {
      input: 'variable_name',
      cursorCol: 13,
      expectedLines: ['variable_'],
      expectedCol: 9,
      desc: 'variable_name parts',
    },
  ])(
    'should delete $desc',
    ({ input, cursorCol, expectedLines, expectedCol }) => {
      const state = textBufferReducer(createSingleLineState(input, cursorCol), {
        type: 'delete_word_left',
      });
      expect(state.lines).toStrictEqual(expectedLines);
      expect(state.cursorCol).toBe(expectedCol);
    },
  );

  it('should act like backspace at the beginning of a line', () => {
    const stateWithText: TextBufferState = {
      ...initialState,
      lines: ['hello', 'world'],
      cursorRow: 1,
      cursorCol: 0,
    };
    const state = textBufferReducer(stateWithText, {
      type: 'delete_word_left',
    });
    expect(state.lines).toStrictEqual(['helloworld']);
    expect(state.cursorRow).toBe(0);
    expect(state.cursorCol).toBe(5);
  });
});

describe('delete_word_right action', () => {
  it.each([
    {
      input: 'hello world',
      cursorCol: 0,
      expectedLines: ['world'],
      expectedCol: 0,
      desc: 'simple word',
    },
    {
      input: 'variable_name',
      cursorCol: 0,
      expectedLines: ['_name'],
      expectedCol: 0,
      desc: 'variable_name parts',
    },
  ])(
    'should delete $desc',
    ({ input, cursorCol, expectedLines, expectedCol }) => {
      const state = textBufferReducer(createSingleLineState(input, cursorCol), {
        type: 'delete_word_right',
      });
      expect(state.lines).toStrictEqual(expectedLines);
      expect(state.cursorCol).toBe(expectedCol);
    },
  );

  it('should delete path segments progressively', () => {
    const stateWithText: TextBufferState = {
      ...initialState,
      lines: ['path/to/file'],
      cursorRow: 0,
      cursorCol: 0,
    };
    let state = textBufferReducer(stateWithText, {
      type: 'delete_word_right',
    });
    expect(state.lines).toStrictEqual(['/to/file']);
    state = textBufferReducer(state, { type: 'delete_word_right' });
    expect(state.lines).toStrictEqual(['to/file']);
  });

  it('should act like delete at the end of a line', () => {
    const stateWithText: TextBufferState = {
      ...initialState,
      lines: ['hello', 'world'],
      cursorRow: 0,
      cursorCol: 5,
    };
    const state = textBufferReducer(stateWithText, {
      type: 'delete_word_right',
    });
    expect(state.lines).toStrictEqual(['helloworld']);
    expect(state.cursorRow).toBe(0);
    expect(state.cursorCol).toBe(5);
  });
});

describe('Initialization', () => {
  it('should initialize with empty text and cursor at (0,0) by default', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    const state = getBufferState(result);
    expect(state.text).toBe('');
    expect(state.lines).toStrictEqual(['']);
    expect(state.cursor).toStrictEqual([0, 0]);
    expect(state.allVisualLines).toStrictEqual(['']);
    expect(state.viewportVisualLines).toStrictEqual(['']);
    expect(state.visualCursor).toStrictEqual([0, 0]);
    expect(state.visualScrollRow).toBe(0);
  });

  it('should initialize with provided initialText', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'hello',
        viewport,
        isValidPath: () => false,
      }),
    );
    const state = getBufferState(result);
    expect(state.text).toBe('hello');
    expect(state.lines).toStrictEqual(['hello']);
    expect(state.cursor).toStrictEqual([0, 0]); // Default cursor if offset not given
    expect(state.allVisualLines).toStrictEqual(['hello']);
    expect(state.viewportVisualLines).toStrictEqual(['hello']);
    expect(state.visualCursor).toStrictEqual([0, 0]);
  });

  it('should initialize with initialText and initialCursorOffset', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'hello\nworld',
        initialCursorOffset: 7, // Should be at 'o' in 'world'
        viewport,
        isValidPath: () => false,
      }),
    );
    const state = getBufferState(result);
    expect(state.text).toBe('hello\nworld');
    expect(state.lines).toStrictEqual(['hello', 'world']);
    expect(state.cursor).toStrictEqual([1, 1]); // Logical cursor at 'o' in "world"
    expect(state.allVisualLines).toStrictEqual(['hello', 'world']);
    expect(state.viewportVisualLines).toStrictEqual(['hello', 'world']);
    expect(state.visualCursor[0]).toBe(1); // On the second visual line
    expect(state.visualCursor[1]).toBe(1); // At 'o' in "world"
  });

  it('should wrap visual lines', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'The quick brown fox jumps over the lazy dog.',
        initialCursorOffset: 2, // After '好'
        viewport: { width: 15, height: 4 },
        isValidPath: () => false,
      }),
    );
    const state = getBufferState(result);
    expect(state.allVisualLines).toStrictEqual([
      'The quick',
      'brown fox',
      'jumps over the',
      'lazy dog.',
    ]);
  });

  it('should wrap visual lines with multiple spaces', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'The  quick  brown fox    jumps over the lazy dog.',
        viewport: { width: 15, height: 4 },
        isValidPath: () => false,
      }),
    );
    const state = getBufferState(result);
    // Including multiple spaces at the end of the lines like this is
    // consistent with Google docs behavior and makes it intuitive to edit
    // the spaces as needed.
    expect(state.allVisualLines).toStrictEqual([
      'The  quick ',
      'brown fox   ',
      'jumps over the',
      'lazy dog.',
    ]);
  });

  it('should wrap visual lines even without spaces', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: '123456789012345ABCDEFG', // 4 chars, 12 bytes
        viewport: { width: 15, height: 2 },
        isValidPath: () => false,
      }),
    );
    const state = getBufferState(result);
    // Including multiple spaces at the end of the lines like this is
    // consistent with Google docs behavior and makes it intuitive to edit
    // the spaces as needed.
    expect(state.allVisualLines).toStrictEqual(['123456789012345', 'ABCDEFG']);
  });

  it('should initialize with multi-byte unicode characters and correct cursor offset', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: '你好世界', // 4 chars, 12 bytes
        initialCursorOffset: 2, // After '好'
        viewport: { width: 5, height: 2 },
        isValidPath: () => false,
      }),
    );
    const state = getBufferState(result);
    expect(state.text).toBe('你好世界');
    expect(state.lines).toStrictEqual(['你好世界']);
    expect(state.cursor).toStrictEqual([0, 2]);
    // Visual: "你好" (width 4), "世"界" (width 4) with viewport width 5
    expect(state.allVisualLines).toStrictEqual(['你好', '世界']);
    expect(state.visualCursor).toStrictEqual([1, 0]);
  });
});

describe('Basic Editing', () => {
  it('insert: should insert a character and update cursor', () => {
    const { result } = renderHook(() =>
      useTextBuffer({ viewport, isValidPath: () => false }),
    );
    act(() => result.current.insert('a'));
    let state = getBufferState(result);
    expect(state.text).toBe('a');
    expect(state.cursor).toStrictEqual([0, 1]);
    expect(state.visualCursor).toStrictEqual([0, 1]);

    act(() => result.current.insert('b'));
    state = getBufferState(result);
    expect(state.text).toBe('ab');
    expect(state.cursor).toStrictEqual([0, 2]);
    expect(state.visualCursor).toStrictEqual([0, 2]);
  });

  it('insert: should insert text in the middle of a line', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'abc',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('right'));
    act(() => result.current.insert('-NEW-'));
    const state = getBufferState(result);
    expect(state.text).toBe('a-NEW-bc');
    expect(state.cursor).toStrictEqual([0, 6]);
  });

  it('newline: should create a new line and move cursor', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'ab',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => result.current.move('end')); // cursor at [0,2]
    act(() => result.current.newline());
    const state = getBufferState(result);
    expect(state.text).toBe('ab\n');
    expect(state.lines).toStrictEqual(['ab', '']);
    expect(state.cursor).toStrictEqual([1, 0]);
    expect(state.allVisualLines).toStrictEqual(['ab', '']);
    expect(state.viewportVisualLines).toStrictEqual(['ab', '']); // viewport height 3
    expect(state.visualCursor).toStrictEqual([1, 0]); // On the new visual line
  });

  it('backspace: should delete char to the left or merge lines', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'a\nb',
        viewport,
        isValidPath: () => false,
      }),
    );
    act(() => {
      result.current.move('down');
    });
    act(() => {
      result.current.move('end'); // cursor to [1,1] (end of 'b')
    });
    act(() => result.current.backspace()); // delete 'b'
    let state = getBufferState(result);
    expect(state.text).toBe('a\n');
    expect(state.cursor).toStrictEqual([1, 0]);

    act(() => result.current.backspace()); // merge lines
    state = getBufferState(result);
    expect(state.text).toBe('a');
    expect(state.cursor).toStrictEqual([0, 1]); // cursor after 'a'
    expect(state.allVisualLines).toStrictEqual(['a']);
    expect(state.viewportVisualLines).toStrictEqual(['a']);
    expect(state.visualCursor).toStrictEqual([0, 1]);
  });

  it('del: should delete char to the right or merge lines', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'a\nb',
        viewport,
        isValidPath: () => false,
      }),
    );
    // cursor at [0,0]
    act(() => result.current.del()); // delete 'a'
    let state = getBufferState(result);
    expect(state.text).toBe('\nb');
    expect(state.cursor).toStrictEqual([0, 0]);

    act(() => result.current.del()); // merge lines (deletes newline)
    state = getBufferState(result);
    expect(state.text).toBe('b');
    expect(state.cursor).toStrictEqual([0, 0]);
    expect(state.allVisualLines).toStrictEqual(['b']);
    expect(state.viewportVisualLines).toStrictEqual(['b']);
    expect(state.visualCursor).toStrictEqual([0, 0]);
  });
});
