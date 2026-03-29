/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
    const quoteMatch = RegExp(/^'(.*)'$/).exec(potentialPath);
    if (quoteMatch != null) {
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
  const mapping = layout.visualToLogicalMap[clampedVisRow];

  if (!mapping) return null;

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

  let command: string | undefined = undefined;
  const args = [filePath];

  const preferredEditorType = getPrefEditor?.();
  if (!command && preferredEditorType) {
    command = getEditorCommand(preferredEditorType);
    if (isGuiEditor(preferredEditorType)) {
      args.unshift('--wait');
    }
  }

  if (!command) {
    command =
      process.env['VISUAL'] ??
      process.env['EDITOR'] ??
      (process.platform === 'win32' ? 'notepad' : 'vi');
  }

  dispatch({ type: 'create_undo_snapshot' });

  const wasRaw = stdin?.isRaw ?? false;
  try {
    setRawMode?.(false);
    const { status, error } = spawnSync(command, args, { stdio: 'inherit' });
    if (error != null) throw error;
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
  const initialState = useMemo((): TextBufferState => {
    const lines = initialText.split('\n');
    const [initialCursorRow, initialCursorCol] = calculateInitialCursorPosition(
      lines.length === 0 ? [''] : lines,
      initialCursorOffset,
    );
    const transformationsByLine = calculateTransformations(
      lines.length === 0 ? [''] : lines,
    );
    const visualLayout = calculateLayout(
      lines.length === 0 ? [''] : lines,
      viewport.width,
      [initialCursorRow, initialCursorCol],
    );
    return {
      lines: lines.length === 0 ? [''] : lines,
      cursorRow: initialCursorRow,
      cursorCol: initialCursorCol,
      transformationsByLine,
      preferredCol: null,
      undoStack: [],
      redoStack: [],
      clipboard: null,
      selectionAnchor: null,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      visualLayout,
    };
  }, [initialText, initialCursorOffset, viewport.width, viewport.height]);

  const [state, dispatch] = useReducer(
    (s: TextBufferState, a: TextBufferAction) =>
      textBufferReducer(s, a, { inputFilter, singleLine }),
    initialState,
  );
  const {
    lines,
    cursorRow,
    cursorCol,
    preferredCol,
    selectionAnchor,
    visualLayout,
  } = state;

  const text = useMemo(() => lines.join('\n'), [lines]);

  const visualCursor = useMemo(
    () => calculateVisualCursorFromLayout(visualLayout, [cursorRow, cursorCol]),
    [visualLayout, cursorRow, cursorCol],
  );

  const { visualLines } = visualLayout;

  const [visualScrollRow, setVisualScrollRow] = useState<number>(0);

  useEffect(() => {
    if (onChange != null) {
      onChange(text);
    }
  }, [text, onChange]);

  useEffect(() => {
    dispatch({
      type: 'set_viewport',
      payload: { width: viewport.width, height: viewport.height },
    });
  }, [viewport.width, viewport.height]);

  // Update visual scroll (vertical)
  useEffect(() => {
    const { height } = viewport;
    const totalVisualLines = visualLines.length;
    const maxScrollStart = Math.max(0, totalVisualLines - height);
    let newVisualScrollRow = visualScrollRow;

    if (visualCursor[0] < visualScrollRow) {
      newVisualScrollRow = visualCursor[0];
    } else if (visualCursor[0] >= visualScrollRow + height) {
      newVisualScrollRow = visualCursor[0] - height + 1;
    }

    // When the number of visual lines shrinks (e.g., after widening the viewport),
    // ensure scroll never starts beyond the last valid start so we can render a full window.
    newVisualScrollRow = clamp(newVisualScrollRow, 0, maxScrollStart);

    if (newVisualScrollRow !== visualScrollRow) {
      setVisualScrollRow(newVisualScrollRow);
    }
  }, [visualCursor, visualScrollRow, viewport, visualLines.length]);

  const insert = useCallback(
    (rawText: string, { paste = false }: { paste?: boolean } = {}): void => {
      processInsertText(rawText, dispatch, {
        singleLine,
        shellModeActive,
        isValidPath,
        paste,
      });
    },
    [dispatch, isValidPath, shellModeActive, singleLine],
  );

  const newline = useCallback((): void => {
    if (singleLine) {
      return;
    }
    dispatch({ type: 'insert', payload: '\n' });
  }, [singleLine]);

  const backspace = useCallback((): void => {
    dispatch({ type: 'backspace' });
  }, []);

  const del = useCallback((): void => {
    dispatch({ type: 'delete' });
  }, []);

  const move = useCallback(
    (dir: Direction): void => {
      dispatch({ type: 'move', payload: { dir } });
    },
    [dispatch],
  );

  const undo = useCallback((): void => {
    dispatch({ type: 'undo' });
  }, []);

  const redo = useCallback((): void => {
    dispatch({ type: 'redo' });
  }, []);

  const setText = useCallback((newText: string): void => {
    dispatch({ type: 'set_text', payload: newText });
  }, []);

  const deleteWordLeft = useCallback((): void => {
    dispatch({ type: 'delete_word_left' });
  }, []);

  const deleteWordRight = useCallback((): void => {
    dispatch({ type: 'delete_word_right' });
  }, []);

  const killLineRight = useCallback((): void => {
    dispatch({ type: 'kill_line_right' });
  }, []);

  const killLineLeft = useCallback((): void => {
    dispatch({ type: 'kill_line_left' });
  }, []);

  // Vim callbacks — dispatch is stable from useReducer, so useMemo computes once.
  const vimCallbacks = useMemo(() => createVimCallbacks(dispatch), [dispatch]);

  const openInExternalEditor = useCallback(
    async () =>
      runExternalEditor({
        text,
        stdin,
        setRawMode,
        getPreferredEditor,
        dispatch,
      }),
    [text, stdin, setRawMode, getPreferredEditor],
  );

  const handleInput = useCallback(
    (key: Key): void => {
      const { sequence: input } = key;

      if (key.paste) {
        // Do not do any other processing on pastes so ensure we handle them
        // before all other cases.
        insert(input, { paste: key.paste });
        return;
      }

      if (
        !singleLine &&
        (key.name === 'return' ||
          input === '\r' ||
          input === '\n' ||
          input === '\\r') // VSCode terminal represents shift + enter this way
      )
        newline();
      else if (keyMatchers[Command.MOVE_LEFT](key)) move('left');
      else if (keyMatchers[Command.MOVE_RIGHT](key)) move('right');
      else if (key.name === 'up') move('up');
      else if (key.name === 'down') move('down');
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
      else if (key.insertable) {
        insert(input, { paste: key.paste });
      }
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

  const renderedVisualLines = useMemo(
    () => visualLines.slice(visualScrollRow, visualScrollRow + viewport.height),
    [visualLines, visualScrollRow, viewport.height],
  );

  const replaceRange = useCallback(
    (
      startRow: number,
      startCol: number,
      endRow: number,
      endCol: number,
      text: string,
    ): void => {
      dispatch({
        type: 'replace_range',
        payload: { startRow, startCol, endRow, endCol, text },
      });
    },
    [],
  );

  const replaceRangeByOffset = useCallback(
    (startOffset: number, endOffset: number, replacementText: string): void => {
      const [startRow, startCol] = offsetToLogicalPos(text, startOffset);
      const [endRow, endCol] = offsetToLogicalPos(text, endOffset);
      replaceRange(startRow, startCol, endRow, endCol, replacementText);
    },
    [text, replaceRange],
  );

  const moveToOffset = useCallback((offset: number): void => {
    dispatch({ type: 'move_to_offset', payload: { offset } });
  }, []);

  const moveToVisualPosition = useCallback(
    (visRow: number, visCol: number): void => {
      const pos = resolveVisualToLogical(visualLayout, visRow, visCol);
      if (pos != null) {
        dispatch({ type: 'set_cursor', payload: pos });
      }
    },
    [visualLayout],
  );

  const getOffset = useCallback(
    (): number => logicalPosToOffset(lines, cursorRow, cursorCol),
    [lines, cursorRow, cursorCol],
  );

  const returnValue: TextBuffer = useMemo(
    () => ({
      lines,
      text,
      cursor: [cursorRow, cursorCol],
      preferredCol,
      selectionAnchor,

      allVisualLines: visualLines,
      viewportVisualLines: renderedVisualLines,
      visualCursor,
      visualScrollRow,
      visualToLogicalMap: visualLayout.visualToLogicalMap,
      transformationsByLine: state.transformationsByLine,
      visualToTransformedMap: visualLayout.visualToTransformedMap,

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
      lines,
      text,
      cursorRow,
      cursorCol,
      preferredCol,
      selectionAnchor,
      visualLines,
      renderedVisualLines,
      visualCursor,
      visualScrollRow,
      visualLayout,
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
      state.transformationsByLine,
    ],
  );
  return returnValue;
}
