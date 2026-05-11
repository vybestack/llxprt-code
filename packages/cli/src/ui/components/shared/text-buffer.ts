/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

// Type re-exports — public API surface only
export type {
  Direction,
  Viewport,
  Transformation,
  VisualLayout,
  TextBufferState,
  TextBufferAction,
  TextBufferOptions,
  TextBuffer,
  UndoHistoryEntry,
  UseTextBufferProps,
} from './buffer-types.js';
export { historyLimit } from './buffer-types.js';

// Function re-exports consumed by production code outside this directory
export { logicalPosToOffset, offsetToLogicalPos } from './buffer-operations.js';

// Import dependencies for the useTextBuffer hook and reducer
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import pathMod from 'node:path';
import { useState, useCallback, useEffect, useMemo, useReducer } from 'react';
import {
  coreEvents,
  CoreEvent,
  debugLogger,
  getEditorCommand,
  isGuiEditor,
} from '@vybestack/llxprt-code-core';
import { toCodePoints, getCachedStringWidth } from '../../utils/textUtils.js';
import { parsePastedPaths } from '../../utils/clipboardUtils.js';
import type { Key } from '../../contexts/KeypressContext.js';
import { keyMatchers, Command } from '../../keyMatchers.js';
import { terminalCapabilityManager } from '../../utils/terminalCapabilityManager.js';

// Import types and functions from new modules
import type {
  TextBufferState,
  TextBufferAction,
  UseTextBufferProps,
  TextBuffer,
  Direction,
} from './buffer-types.js';
import { offsetToLogicalPos, logicalPosToOffset } from './buffer-operations.js';
import { calculateTransformations } from './transformations.js';
import {
  textBufferReducer,
  calculateInitialCursorPosition,
  calculateLayout,
  calculateVisualCursorFromLayout,
} from './buffer-reducer.js';

// Re-export for backward compatibility
export {
  textBufferReducer,
  calculateInitialCursorPosition,
  calculateLayout,
  calculateVisualCursorFromLayout,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ── Extracted helper functions (reduce useTextBuffer hook complexity) ──

/** Factory creating all vim dispatch callbacks. Stable when dispatch is stable. */
function createVimCallbacks(dispatch: (action: TextBufferAction) => void) {
  return {
    vimDeleteWordForward: (count: number) =>
      dispatch({ type: 'vim_delete_word_forward', payload: { count } }),
    vimDeleteWordBackward: (count: number) =>
      dispatch({ type: 'vim_delete_word_backward', payload: { count } }),
    vimDeleteWordEnd: (count: number) =>
      dispatch({ type: 'vim_delete_word_end', payload: { count } }),
    vimChangeWordForward: (count: number) =>
      dispatch({ type: 'vim_change_word_forward', payload: { count } }),
    vimChangeWordBackward: (count: number) =>
      dispatch({ type: 'vim_change_word_backward', payload: { count } }),
    vimChangeWordEnd: (count: number) =>
      dispatch({ type: 'vim_change_word_end', payload: { count } }),
    vimDeleteLine: (count: number) =>
      dispatch({ type: 'vim_delete_line', payload: { count } }),
    vimChangeLine: (count: number) =>
      dispatch({ type: 'vim_change_line', payload: { count } }),
    vimDeleteToEndOfLine: () => dispatch({ type: 'vim_delete_to_end_of_line' }),
    vimChangeToEndOfLine: () => dispatch({ type: 'vim_change_to_end_of_line' }),
    vimChangeMovement: (movement: 'h' | 'j' | 'k' | 'l', count: number) =>
      dispatch({ type: 'vim_change_movement', payload: { movement, count } }),
    vimMoveLeft: (count: number) =>
      dispatch({ type: 'vim_move_left', payload: { count } }),
    vimMoveRight: (count: number) =>
      dispatch({ type: 'vim_move_right', payload: { count } }),
    vimMoveUp: (count: number) =>
      dispatch({ type: 'vim_move_up', payload: { count } }),
    vimMoveDown: (count: number) =>
      dispatch({ type: 'vim_move_down', payload: { count } }),
    vimMoveWordForward: (count: number) =>
      dispatch({ type: 'vim_move_word_forward', payload: { count } }),
    vimMoveWordBackward: (count: number) =>
      dispatch({ type: 'vim_move_word_backward', payload: { count } }),
    vimMoveWordEnd: (count: number) =>
      dispatch({ type: 'vim_move_word_end', payload: { count } }),
    vimDeleteChar: (count: number) =>
      dispatch({ type: 'vim_delete_char', payload: { count } }),
    vimInsertAtCursor: () => dispatch({ type: 'vim_insert_at_cursor' }),
    vimAppendAtCursor: () => dispatch({ type: 'vim_append_at_cursor' }),
    vimOpenLineBelow: () => dispatch({ type: 'vim_open_line_below' }),
    vimOpenLineAbove: () => dispatch({ type: 'vim_open_line_above' }),
    vimAppendAtLineEnd: () => dispatch({ type: 'vim_append_at_line_end' }),
    vimInsertAtLineStart: () => dispatch({ type: 'vim_insert_at_line_start' }),
    vimMoveToLineStart: () => dispatch({ type: 'vim_move_to_line_start' }),
    vimMoveToLineEnd: () => dispatch({ type: 'vim_move_to_line_end' }),
    vimMoveToFirstNonWhitespace: () =>
      dispatch({ type: 'vim_move_to_first_nonwhitespace' }),
    vimMoveToFirstLine: () => dispatch({ type: 'vim_move_to_first_line' }),
    vimMoveToLastLine: () => dispatch({ type: 'vim_move_to_last_line' }),
    vimMoveToLine: (lineNumber: number) =>
      dispatch({ type: 'vim_move_to_line', payload: { lineNumber } }),
    vimEscapeInsertMode: () => dispatch({ type: 'vim_escape_insert_mode' }),
  };
}

/** Process pasted text: detect drag-and-drop paths, handle DEL characters. */
function processInsertText(
  rawText: string,
  dispatch: (action: TextBufferAction) => void,
  opts: {
    singleLine: boolean;
    shellModeActive: boolean;
    isValidPath: (path: string) => boolean;
    paste: boolean;
  },
): void {
  let textToInsert = rawText;

  if (!opts.singleLine && /[\n\r]/.test(textToInsert)) {
    dispatch({ type: 'insert', payload: textToInsert });
    return;
  }

  const minLengthToInferAsDragDrop = 3;
  if (
    textToInsert.length >= minLengthToInferAsDragDrop &&
    !opts.shellModeActive &&
    opts.paste
  ) {
    let potentialPath = textToInsert.trim();
    const quoteMatch = potentialPath.match(/^'(.*)'$/);
    if (quoteMatch) {
      potentialPath = quoteMatch[1];
    }
    potentialPath = potentialPath.trim();
    const processed = parsePastedPaths(potentialPath, opts.isValidPath);
    if (processed) {
      textToInsert = processed;
    }
  }

  let bufferedText = '';
  for (const char of toCodePoints(textToInsert)) {
    if (char.codePointAt(0) === 127) {
      if (bufferedText.length > 0) {
        dispatch({ type: 'insert', payload: bufferedText });
        bufferedText = '';
      }
      dispatch({ type: 'backspace' });
    } else {
      bufferedText += char;
    }
  }
  if (bufferedText.length > 0) {
    dispatch({ type: 'insert', payload: bufferedText });
  }
}

/** Resolve visual (row, col) to logical cursor position for click/mouse handling. */
function resolveVisualToLogical(
  layout: {
    visualLines: string[];
    visualToLogicalMap: Array<[number, number]>;
  },
  visRow: number,
  visCol: number,
): { cursorRow: number; cursorCol: number; preferredCol: number } | null {
  const clampedVisRow = Math.max(
    0,
    Math.min(visRow, layout.visualLines.length - 1),
  );
  const visualLine = layout.visualLines[clampedVisRow] || '';
  const mapping = (
    layout.visualToLogicalMap as Array<[number, number] | undefined>
  )[clampedVisRow];

  if (mapping === undefined) return null;

  const [logRow, logStartCol] = mapping;
  const codePoints = toCodePoints(visualLine);
  let currentVisX = 0;
  let charOffset = 0;

  for (const char of codePoints) {
    const charWidth = getCachedStringWidth(char);
    if (visCol < currentVisX + charWidth) {
      if (charWidth > 1 && visCol >= currentVisX + charWidth / 2) {
        charOffset++;
      }
      break;
    }
    currentVisX += charWidth;
    charOffset++;
  }

  charOffset = Math.min(charOffset, codePoints.length);
  return {
    cursorRow: logRow,
    cursorCol: logStartCol + charOffset,
    preferredCol: charOffset,
  };
}

/** Launch an external editor for the buffer content. */
async function runExternalEditor(params: {
  text: string;
  stdin: NodeJS.ReadStream | null | undefined;
  setRawMode: ((mode: boolean) => void) | undefined;
  getPreferredEditor: UseTextBufferProps['getPreferredEditor'];
  dispatch: (action: TextBufferAction) => void;
}): Promise<void> {
  const {
    text,
    stdin,
    setRawMode,
    getPreferredEditor: getPrefEditor,
    dispatch,
  } = params;
  const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'llxprt-edit-'));
  const filePath = pathMod.join(tmpDir, 'buffer.txt');
  fs.writeFileSync(filePath, text, 'utf8');

  const args = [filePath];

  const preferredEditorType = getPrefEditor?.();
  let command = preferredEditorType
    ? getEditorCommand(preferredEditorType)
    : undefined;
  if (preferredEditorType && isGuiEditor(preferredEditorType)) {
    args.unshift('--wait');
  }

  command ??=
    process.env['VISUAL'] ??
    process.env['EDITOR'] ??
    (process.platform === 'win32' ? 'notepad' : 'vi');

  dispatch({ type: 'create_undo_snapshot' });

  const wasRaw = stdin?.isRaw ?? false;
  try {
    setRawMode?.(false);
    const { status, error } = spawnSync(command, args, { stdio: 'inherit' });
    if (error) throw error;
    if (typeof status === 'number' && status !== 0)
      throw new Error(`External editor exited with status ${status}`);

    let newText = fs.readFileSync(filePath, 'utf8');
    newText = newText.replace(/\r\n?/g, '\n');

    dispatch({ type: 'set_text', payload: newText, pushToUndo: false });
  } catch (err) {
    debugLogger.error('[useTextBuffer] external editor error', err);
  } finally {
    terminalCapabilityManager.enableKittyProtocol();
    coreEvents.emit(CoreEvent.ExternalEditorClosed);
    if (wasRaw) setRawMode?.(true);
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
    try {
      fs.rmdirSync(tmpDir);
    } catch {
      /* ignore */
    }
  }
}

/** Create simple dispatch-only action callbacks. */
function useSimpleDispatchActions(
  dispatch: (action: TextBufferAction) => void,
) {
  return useMemo(
    () => ({
      backspace: () => dispatch({ type: 'backspace' }),
      del: () => dispatch({ type: 'delete' }),
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      deleteWordLeft: () => dispatch({ type: 'delete_word_left' }),
      deleteWordRight: () => dispatch({ type: 'delete_word_right' }),
      killLineRight: () => dispatch({ type: 'kill_line_right' }),
      killLineLeft: () => dispatch({ type: 'kill_line_left' }),
      moveToOffset: (offset: number) =>
        dispatch({ type: 'move_to_offset', payload: { offset } }),
    }),
    [dispatch],
  );
}

/** Create composite action callbacks that depend on other hooks. */
function useCompositeActions(
  dispatch: (action: TextBufferAction) => void,
  singleLine: boolean,
  text: string,
  replaceRange: (
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    replacementText: string,
  ) => void,
) {
  const newline = useCallback((): void => {
    if (singleLine) return;
    dispatch({ type: 'insert', payload: '\n' });
  }, [singleLine, dispatch]);

  const setText = useCallback(
    (newText: string): void => {
      dispatch({ type: 'set_text', payload: newText });
    },
    [dispatch],
  );

  const replaceRangeByOffset = useCallback(
    (startOffset: number, endOffset: number, replacementText: string): void => {
      const [startRow, startCol] = offsetToLogicalPos(text, startOffset);
      const [endRow, endCol] = offsetToLogicalPos(text, endOffset);
      replaceRange(startRow, startCol, endRow, endCol, replacementText);
    },
    [text, replaceRange],
  );

  return { newline, setText, replaceRangeByOffset };
}

/** Key-input handler: maps key events to buffer actions. */
function useInputHandler(
  singleLine: boolean,
  insert: (ch: string, opts?: { paste?: boolean }) => void,
  newline: () => void,
  move: (dir: Direction) => void,
  simpleActions: ReturnType<typeof useSimpleDispatchActions>,
): (key: Key) => void {
  const { deleteWordLeft, deleteWordRight, backspace, del, undo, redo } =
    simpleActions;
  return useCallback(
    (key: Key): void => {
      const { sequence: input } = key;
      if (key.name === 'paste') {
        insert(input, { paste: true });
        return;
      }
      const isReturnKey =
        key.name === 'return' || input === '\r' || input === '\n';
      const isVsCodeShiftEnter = input === '\\r';
      if (!singleLine && (isReturnKey || isVsCodeShiftEnter)) newline();
      else if (keyMatchers[Command.MOVE_LEFT](key)) move('left');
      else if (keyMatchers[Command.MOVE_RIGHT](key)) move('right');
      else if (keyMatchers[Command.MOVE_UP](key)) move('up');
      else if (keyMatchers[Command.MOVE_DOWN](key)) move('down');
      else if (keyMatchers[Command.MOVE_WORD_LEFT](key)) move('wordLeft');
      else if (keyMatchers[Command.MOVE_WORD_RIGHT](key)) move('wordRight');
      else if (keyMatchers[Command.HOME](key)) move('home');
      else if (keyMatchers[Command.END](key)) move('end');
      else if (keyMatchers[Command.DELETE_WORD_BACKWARD](key)) deleteWordLeft();
      else if (keyMatchers[Command.DELETE_WORD_FORWARD](key)) deleteWordRight();
      else if (keyMatchers[Command.DELETE_CHAR_LEFT](key)) backspace();
      else if (keyMatchers[Command.DELETE_CHAR_RIGHT](key)) del();
      else if (keyMatchers[Command.UNDO](key)) undo();
      else if (keyMatchers[Command.REDO](key)) redo();
      else if (key.insertable ?? false) insert(input, { paste: false });
    },
    [
      newline,
      move,
      deleteWordLeft,
      deleteWordRight,
      backspace,
      del,
      insert,
      undo,
      redo,
      singleLine,
    ],
  );
}

/** Build the state-dependent portion of the TextBuffer return value. */
function useTextBufferStateSlice(
  state: TextBufferState,
  renderedVisualLines: string[],
  visualCursor: [number, number],
  visualScrollRow: number,
) {
  return useMemo(
    () => ({
      lines: state.lines,
      text: state.lines.join('\n'),
      cursor: [state.cursorRow, state.cursorCol] as [number, number],
      preferredCol: state.preferredCol,
      selectionAnchor: state.selectionAnchor,
      allVisualLines: state.visualLayout.visualLines,
      viewportVisualLines: renderedVisualLines,
      visualCursor,
      visualScrollRow,
      visualToLogicalMap: state.visualLayout.visualToLogicalMap,
      transformationsByLine: state.transformationsByLine,
      visualToTransformedMap: state.visualLayout.visualToTransformedMap,
    }),
    [state, renderedVisualLines, visualCursor, visualScrollRow],
  );
}

/** Build the action-dependent portion of the TextBuffer return value. */
function useTextBufferActionSlice(
  simpleActions: ReturnType<typeof useSimpleDispatchActions>,
  compositeActions: ReturnType<typeof useCompositeActions>,
  insert: (ch: string, opts?: { paste?: boolean }) => void,
  move: (dir: Direction) => void,
  replaceRange: (
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    rText: string,
  ) => void,
  moveToVisualPosition: (visRow: number, visCol: number) => void,
  getOffset: () => number,
  handleInput: (key: Key) => void,
  openInExternalEditor: () => Promise<void>,
  vimCallbacks: ReturnType<typeof createVimCallbacks>,
) {
  const {
    backspace,
    del,
    undo,
    redo,
    deleteWordLeft,
    deleteWordRight,
    killLineRight,
    killLineLeft,
    moveToOffset,
  } = simpleActions;
  const { newline, setText, replaceRangeByOffset } = compositeActions;
  return useMemo(
    () => ({
      setText,
      insert,
      newline,
      backspace,
      del,
      move,
      undo,
      redo,
      replaceRange,
      replaceRangeByOffset,
      moveToOffset,
      getOffset,
      moveToVisualPosition,
      deleteWordLeft,
      deleteWordRight,
      killLineRight,
      killLineLeft,
      handleInput,
      openInExternalEditor,
      ...vimCallbacks,
    }),
    [
      setText,
      insert,
      newline,
      backspace,
      del,
      move,
      undo,
      redo,
      replaceRange,
      replaceRangeByOffset,
      moveToOffset,
      getOffset,
      moveToVisualPosition,
      deleteWordLeft,
      deleteWordRight,
      killLineRight,
      killLineLeft,
      handleInput,
      openInExternalEditor,
      vimCallbacks,
    ],
  );
}

function useBufferState(
  initialText: string,
  initialCursorOffset: number,
  viewport: { width: number; height: number },
  inputFilter: UseTextBufferProps['inputFilter'],
  singleLine: boolean,
) {
  const initialState = useMemo((): TextBufferState => {
    const lines = initialText.split('\n');
    const safeLines = lines.length === 0 ? [''] : lines;
    const [r, c] = calculateInitialCursorPosition(
      safeLines,
      initialCursorOffset,
    );
    return {
      lines: safeLines,
      cursorRow: r,
      cursorCol: c,
      transformationsByLine: calculateTransformations(safeLines),
      preferredCol: null,
      undoStack: [],
      redoStack: [],
      clipboard: null,
      selectionAnchor: null,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      visualLayout: calculateLayout(safeLines, viewport.width, [r, c]),
    };
  }, [initialText, initialCursorOffset, viewport.width, viewport.height]);

  return useReducer(
    (s: TextBufferState, a: TextBufferAction) =>
      textBufferReducer(s, a, { inputFilter, singleLine }),
    initialState,
  );
}

function useVisualScrollSync(
  visualCursor: [number, number],
  viewport: { width: number; height: number },
  visualLinesCount: number,
): [number, React.Dispatch<React.SetStateAction<number>>] {
  const [visualScrollRow, setVisualScrollRow] = useState<number>(0);
  useEffect(() => {
    const { height } = viewport;
    const maxScrollStart = Math.max(0, visualLinesCount - height);
    let newRow = visualScrollRow;
    if (visualCursor[0] < visualScrollRow) newRow = visualCursor[0];
    else if (visualCursor[0] >= visualScrollRow + height)
      newRow = visualCursor[0] - height + 1;
    newRow = clamp(newRow, 0, maxScrollStart);
    if (newRow !== visualScrollRow) setVisualScrollRow(newRow);
  }, [visualCursor, visualScrollRow, viewport, visualLinesCount]);
  return [visualScrollRow, setVisualScrollRow];
}

function useBufferEffects(
  text: string,
  onChange: UseTextBufferProps['onChange'],
  dispatch: (action: TextBufferAction) => void,
  viewport: { width: number; height: number },
) {
  useEffect(() => {
    if (onChange) onChange(text);
  }, [text, onChange, dispatch]);
  useEffect(() => {
    dispatch({
      type: 'set_viewport',
      payload: { width: viewport.width, height: viewport.height },
    });
  }, [viewport.width, viewport.height, dispatch]);
}

function useBufferInsertAndMove(
  dispatch: (action: TextBufferAction) => void,
  singleLine: boolean,
  shellModeActive: boolean,
  isValidPath: (path: string) => boolean,
) {
  const insert = useCallback(
    (rawText: string, opts?: { paste?: boolean }): void => {
      processInsertText(rawText, dispatch, {
        singleLine,
        shellModeActive,
        isValidPath,
        paste: opts?.paste ?? false,
      });
    },
    [dispatch, isValidPath, shellModeActive, singleLine],
  );
  const move = useCallback(
    (dir: Direction): void => {
      dispatch({ type: 'move', payload: { dir } });
    },
    [dispatch],
  );
  return { insert, move };
}

function useBufferPositionActions(
  dispatch: (action: TextBufferAction) => void,
  visualLayout: {
    visualLines: string[];
    visualToLogicalMap: Array<[number, number]>;
  },
  lines: string[],
  cursorRow: number,
  cursorCol: number,
  visualScrollRow: number,
  viewportHeight: number,
) {
  const renderedVisualLines = useMemo(
    () =>
      visualLayout.visualLines.slice(
        visualScrollRow,
        visualScrollRow + viewportHeight,
      ),
    [visualLayout.visualLines, visualScrollRow, viewportHeight],
  );
  const moveToVisualPosition = useCallback(
    (visRow: number, visCol: number): void => {
      const pos = resolveVisualToLogical(visualLayout, visRow, visCol);
      if (pos) dispatch({ type: 'set_cursor', payload: pos });
    },
    [visualLayout, dispatch],
  );
  const getOffset = useCallback(
    (): number => logicalPosToOffset(lines, cursorRow, cursorCol),
    [lines, cursorRow, cursorCol],
  );
  return { renderedVisualLines, moveToVisualPosition, getOffset };
}

function useBufferExternalEditor(
  text: string,
  stdin: NodeJS.ReadStream | null | undefined,
  setRawMode: ((mode: boolean) => void) | undefined,
  getPreferredEditor: UseTextBufferProps['getPreferredEditor'],
  dispatch: (action: TextBufferAction) => void,
) {
  return useCallback(
    async () =>
      runExternalEditor({
        text,
        stdin,
        setRawMode,
        getPreferredEditor,
        dispatch,
      }),
    [text, stdin, setRawMode, getPreferredEditor, dispatch],
  );
}

function useBufferCompositeAndInput(
  dispatch: (action: TextBufferAction) => void,
  singleLine: boolean,
  text: string,
  insert: (ch: string, opts?: { paste?: boolean }) => void,
  move: (dir: Direction) => void,
  simpleActions: ReturnType<typeof useSimpleDispatchActions>,
) {
  const replaceRange = useCallback(
    (sr: number, sc: number, er: number, ec: number, rText: string) => {
      dispatch({
        type: 'replace_range',
        payload: {
          startRow: sr,
          startCol: sc,
          endRow: er,
          endCol: ec,
          text: rText,
        },
      });
    },
    [dispatch],
  );
  const compositeActions = useCompositeActions(
    dispatch,
    singleLine,
    text,
    replaceRange,
  );
  const handleInput = useInputHandler(
    singleLine,
    insert,
    compositeActions.newline,
    move,
    simpleActions,
  );
  return { replaceRange, compositeActions, handleInput };
}

function useTextBufferComputedValues(state: TextBufferState) {
  const { lines, cursorRow, cursorCol, visualLayout } = state;
  const text = useMemo(() => lines.join('\n'), [lines]);
  const visualCursor = useMemo(
    () => calculateVisualCursorFromLayout(visualLayout, [cursorRow, cursorCol]),
    [visualLayout, cursorRow, cursorCol],
  );
  return { lines, cursorRow, cursorCol, visualLayout, text, visualCursor };
}

function useTextBufferAssembly(
  state: TextBufferState,
  dispatch: (action: TextBufferAction) => void,
  viewport: { width: number; height: number },
  stdin: NodeJS.ReadStream | null | undefined,
  setRawMode: ((mode: boolean) => void) | undefined,
  onChange: UseTextBufferProps['onChange'],
  isValidPath: (path: string) => boolean,
  shellModeActive: boolean,
  singleLine: boolean,
  getPreferredEditor: UseTextBufferProps['getPreferredEditor'],
): TextBuffer {
  const { lines, cursorRow, cursorCol, visualLayout, text, visualCursor } =
    useTextBufferComputedValues(state);
  const [visualScrollRow] = useVisualScrollSync(
    visualCursor,
    viewport,
    visualLayout.visualLines.length,
  );
  useBufferEffects(text, onChange, dispatch, viewport);
  const { insert, move } = useBufferInsertAndMove(
    dispatch,
    singleLine,
    shellModeActive,
    isValidPath,
  );
  const vimCallbacks = useMemo(() => createVimCallbacks(dispatch), [dispatch]);
  const simpleActions = useSimpleDispatchActions(dispatch);
  const openInExternalEditor = useBufferExternalEditor(
    text,
    stdin,
    setRawMode,
    getPreferredEditor,
    dispatch,
  );
  const { replaceRange, compositeActions, handleInput } =
    useBufferCompositeAndInput(
      dispatch,
      singleLine,
      text,
      insert,
      move,
      simpleActions,
    );
  const { renderedVisualLines, moveToVisualPosition, getOffset } =
    useBufferPositionActions(
      dispatch,
      visualLayout,
      lines,
      cursorRow,
      cursorCol,
      visualScrollRow,
      viewport.height,
    );
  const stateSlice = useTextBufferStateSlice(
    state,
    renderedVisualLines,
    visualCursor,
    visualScrollRow,
  );
  const actionSlice = useTextBufferActionSlice(
    simpleActions,
    compositeActions,
    insert,
    move,
    replaceRange,
    moveToVisualPosition,
    getOffset,
    handleInput,
    openInExternalEditor,
    vimCallbacks,
  );
  return useMemo(
    () => ({ ...stateSlice, ...actionSlice }),
    [stateSlice, actionSlice],
  );
}

export function useTextBuffer({
  initialText = '',
  initialCursorOffset = 0,
  viewport,
  stdin,
  setRawMode,
  onChange,
  isValidPath,
  shellModeActive = false,
  inputFilter,
  singleLine = false,
  getPreferredEditor,
}: UseTextBufferProps): TextBuffer {
  const [state, dispatch] = useBufferState(
    initialText,
    initialCursorOffset,
    viewport,
    inputFilter,
    singleLine,
  );
  return useTextBufferAssembly(
    state,
    dispatch,
    viewport,
    stdin,
    setRawMode,
    onChange,
    isValidPath,
    shellModeActive,
    singleLine,
    getPreferredEditor,
  );
}
