/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  TextBufferState,
  TextBufferAction,
  TextBufferOptions,
} from './buffer-types.js';
import {
  toCodePoints,
  cpLen,
  cpSlice,
  stripUnsafeCharacters,
} from '../../utils/textUtils.js';
import {
  pushUndo,
  replaceRangeInternal,
  offsetToLogicalPos,
} from './buffer-operations.js';
import {
  calculateTransformations,
  getTransformUnderCursor,
} from './transformations.js';
import { handleVimAction, type VimAction } from './vim-buffer-actions.js';
import {
  findPrevWordStartInLine,
  findNextWordStartInLine,
} from './word-navigation.js';
import {
  calculateLayout,
  calculateVisualCursorFromLayout,
} from './visual-layout.js';
export { calculateLayout, calculateVisualCursorFromLayout };

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function findPrevWordBoundary(line: string, cursorCol: number): number {
  const codePoints = toCodePoints(line);
  const prefix = codePoints.slice(0, cursorCol).join('');
  const cursorIdx = prefix.length;

  let targetIdx = 0;

  for (const seg of segmenter.segment(line)) {
    if (seg.index >= cursorIdx) break;

    if (seg.isWordLike) {
      targetIdx = seg.index;
    }
  }

  return toCodePoints(line.slice(0, targetIdx)).length;
}

function findNextWordBoundary(line: string, cursorCol: number): number {
  const codePoints = toCodePoints(line);
  const prefix = codePoints.slice(0, cursorCol).join('');
  const cursorIdx = prefix.length;

  let targetIdx = line.length;

  for (const seg of segmenter.segment(line)) {
    const segEnd = seg.index + seg.segment.length;

    if (segEnd > cursorIdx) {
      if (seg.isWordLike) {
        targetIdx = segEnd;
        break;
      }
    }
  }

  return toCodePoints(line.slice(0, targetIdx)).length;
}

export function calculateInitialCursorPosition(
  initialLines: string[],
  offset: number,
): [number, number] {
  let remainingChars = offset;
  let row = 0;
  while (row < initialLines.length) {
    const lineLength = cpLen(initialLines[row]);
    const totalCharsInLineAndNewline =
      lineLength + (row < initialLines.length - 1 ? 1 : 0);

    if (remainingChars <= lineLength) {
      return [row, remainingChars];
    }
    remainingChars -= totalCharsInLineAndNewline;
    row++;
  }
  if (initialLines.length > 0) {
    const lastRow = initialLines.length - 1;
    return [lastRow, cpLen(initialLines[lastRow])];
  }
  return [0, 0];
}

// ─── Individual action handlers ──────────────────────────────────────────

function handleSetText(
  state: TextBufferState,
  payload: string,
  pushToUndoFlag: boolean | undefined,
): TextBufferState {
  let nextState = state;
  if (pushToUndoFlag !== false) {
    nextState = pushUndo(state);
  }
  const newContentLines = payload.replace(/\r\n?/g, '\n').split('\n');
  const lines = newContentLines.length === 0 ? [''] : newContentLines;
  const lastIdx = lines.length - 1;
  return {
    ...nextState,
    lines,
    cursorRow: lastIdx,
    cursorCol: cpLen(lines[lastIdx] ?? ''),
    preferredCol: null,
  };
}

function handleInsertAction(
  state: TextBufferState,
  rawPayload: string,
  options: TextBufferOptions,
): TextBufferState {
  let payload = rawPayload;
  if (options.singleLine) {
    payload = payload.replace(/[\r\n]/g, '');
  }
  if (options.inputFilter) {
    payload = options.inputFilter(payload);
  }
  if (payload.length === 0) return state;

  const nextState = pushUndo(state);
  const newLines = [...nextState.lines];
  let newCursorRow = nextState.cursorRow;
  let newCursorCol = nextState.cursorCol;

  const str = stripUnsafeCharacters(
    payload.replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
  );
  const parts = str.split('\n');
  const lineContent = newLines[newCursorRow] ?? '';
  const before = cpSlice(lineContent, 0, newCursorCol);
  const after = cpSlice(lineContent, newCursorCol);

  if (parts.length > 1) {
    newLines[newCursorRow] = before + parts[0];
    const remainingParts = parts.slice(1);
    const lastPartOriginal = remainingParts.pop() ?? '';
    newLines.splice(newCursorRow + 1, 0, ...remainingParts);
    newLines.splice(
      newCursorRow + parts.length - 1,
      0,
      lastPartOriginal + after,
    );
    newCursorRow = newCursorRow + parts.length - 1;
    newCursorCol = cpLen(lastPartOriginal);
  } else {
    newLines[newCursorRow] = before + parts[0] + after;
    newCursorCol = cpLen(before) + cpLen(parts[0]);
  }

  return {
    ...nextState,
    lines: newLines,
    cursorRow: newCursorRow,
    cursorCol: newCursorCol,
    preferredCol: null,
  };
}

function handleBackspaceAction(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol } = state;
  if (cursorCol === 0 && cursorRow === 0) return state;

  const nextState = pushUndo(state);
  const newLines = [...nextState.lines];
  let newRow = cursorRow;
  let newCol = cursorCol;

  if (newCol > 0) {
    const lineContent = newLines[newRow] ?? '';
    newLines[newRow] =
      cpSlice(lineContent, 0, newCol - 1) + cpSlice(lineContent, newCol);
    newCol--;
  } else if (newRow > 0) {
    const prevLineContent = newLines[newRow - 1] ?? '';
    const currentLineContentVal = newLines[newRow] ?? '';
    const newColVal = cpLen(prevLineContent);
    newLines[newRow - 1] = prevLineContent + currentLineContentVal;
    newLines.splice(newRow, 1);
    newRow--;
    newCol = newColVal;
  }

  return {
    ...nextState,
    lines: newLines,
    cursorRow: newRow,
    cursorCol: newCol,
    preferredCol: null,
  };
}

interface VisualPos {
  row: number;
  col: number;
  preferred: number | null;
}

function visualMoveLeft(
  row: number,
  col: number,
  visualLines: string[],
): VisualPos {
  if (col > 0) return { row, col: col - 1, preferred: null };
  if (row > 0)
    return {
      row: row - 1,
      col: cpLen(visualLines[row - 1] ?? ''),
      preferred: null,
    };
  return { row, col, preferred: null };
}

function visualMoveRight(
  row: number,
  col: number,
  visualLines: string[],
): VisualPos {
  if (col < cpLen(visualLines[row] ?? ''))
    return { row, col: col + 1, preferred: null };
  if (row < visualLines.length - 1)
    return { row: row + 1, col: 0, preferred: null };
  return { row, col, preferred: null };
}

function visualMoveVertical(
  row: number,
  col: number,
  preferred: number | null,
  delta: number,
  visualLines: string[],
): VisualPos {
  const targetRow = row + delta;
  if (targetRow < 0 || targetRow >= visualLines.length)
    return { row, col, preferred };
  const pref = preferred ?? col;
  return {
    row: targetRow,
    col: clamp(pref, 0, cpLen(visualLines[targetRow] ?? '')),
    preferred: pref,
  };
}

function applyVisualDirection(
  dir: string,
  row: number,
  col: number,
  preferred: number | null,
  visualLines: string[],
): VisualPos {
  if (dir === 'left') return visualMoveLeft(row, col, visualLines);
  if (dir === 'right') return visualMoveRight(row, col, visualLines);
  if (dir === 'up')
    return visualMoveVertical(row, col, preferred, -1, visualLines);
  if (dir === 'down')
    return visualMoveVertical(row, col, preferred, 1, visualLines);
  if (dir === 'home') return { row, col: 0, preferred: null };
  if (dir === 'end')
    return { row, col: cpLen(visualLines[row] ?? ''), preferred: null };
  return { row, col, preferred };
}

function handleVisualMove(
  state: TextBufferState,
  dir: string,
): TextBufferState {
  const { cursorRow, cursorCol, visualLayout, preferredCol, lines } = state;
  const visualCursor = calculateVisualCursorFromLayout(visualLayout, [
    cursorRow,
    cursorCol,
  ]);
  const { visualLines, visualToLogicalMap } = visualLayout;

  const pos = applyVisualDirection(
    dir,
    visualCursor[0],
    visualCursor[1],
    preferredCol,
    visualLines,
  );

  if (visualToLogicalMap[pos.row]) {
    const [logRow, logStartCol] = visualToLogicalMap[pos.row];
    return {
      ...state,
      cursorRow: logRow,
      cursorCol: clamp(logStartCol + pos.col, 0, cpLen(lines[logRow] ?? '')),
      preferredCol: pos.preferred,
    };
  }
  return state;
}

function handleLogicalMove(
  state: TextBufferState,
  dir: string,
): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;

  if (dir === 'wordLeft') {
    if (cursorCol === 0 && cursorRow === 0) return state;
    let newCursorRow = cursorRow;
    let newCursorCol = cursorCol;
    if (cursorCol === 0) {
      newCursorRow--;
      newCursorCol = cpLen(lines[newCursorRow] ?? '');
    } else {
      const lineContent = lines[cursorRow];
      newCursorCol = findPrevWordBoundary(lineContent, cursorCol);
    }
    return {
      ...state,
      cursorRow: newCursorRow,
      cursorCol: newCursorCol,
      preferredCol: null,
    };
  }

  if (dir === 'wordRight') {
    const lineContent = lines[cursorRow] ?? '';
    if (cursorRow === lines.length - 1 && cursorCol === cpLen(lineContent)) {
      return state;
    }
    let newCursorRow = cursorRow;
    let newCursorCol = cursorCol;
    const lineLen = cpLen(lineContent);
    if (cursorCol >= lineLen) {
      newCursorRow++;
      newCursorCol = 0;
    } else {
      newCursorCol = findNextWordBoundary(lineContent, cursorCol);
    }
    return {
      ...state,
      cursorRow: newCursorRow,
      cursorCol: newCursorCol,
      preferredCol: null,
    };
  }

  return state;
}

const VISUAL_DIRS = new Set(['left', 'right', 'up', 'down', 'home', 'end']);

function handleMoveAction(
  state: TextBufferState,
  dir: string,
): TextBufferState {
  return VISUAL_DIRS.has(dir)
    ? handleVisualMove(state, dir)
    : handleLogicalMove(state, dir);
}

function handleDeleteAction(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  const lineContent = lines[cursorRow] ?? '';
  const lineLen = cpLen(lineContent);

  if (cursorCol < lineLen) {
    const nextState = pushUndo(state);
    const newLines = [...nextState.lines];
    newLines[cursorRow] =
      cpSlice(lineContent, 0, cursorCol) + cpSlice(lineContent, cursorCol + 1);
    return { ...nextState, lines: newLines, preferredCol: null };
  } else if (cursorRow < lines.length - 1) {
    const nextState = pushUndo(state);
    const nextLineContent = lines[cursorRow + 1] ?? '';
    const newLines = [...nextState.lines];
    newLines[cursorRow] = lineContent + nextLineContent;
    newLines.splice(cursorRow + 1, 1);
    return { ...nextState, lines: newLines, preferredCol: null };
  }
  return state;
}

function handleDeleteWordLeftAction(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  if (cursorCol === 0 && cursorRow === 0) return state;

  const nextState = pushUndo(state);
  const newLines = [...nextState.lines];
  let newCursorRow = cursorRow;
  let newCursorCol = cursorCol;

  if (newCursorCol > 0) {
    const lineContent = lines[cursorRow] ?? '';
    const prevWordStart = findPrevWordStartInLine(lineContent, newCursorCol);
    const start = prevWordStart === null ? 0 : prevWordStart;
    newLines[newCursorRow] =
      cpSlice(lineContent, 0, start) + cpSlice(lineContent, newCursorCol);
    newCursorCol = start;
  } else {
    const prevLineContent = lines[cursorRow - 1] ?? '';
    const currentLineContentVal = lines[cursorRow] ?? '';
    const newCol = cpLen(prevLineContent);
    newLines[cursorRow - 1] = prevLineContent + currentLineContentVal;
    newLines.splice(cursorRow, 1);
    newCursorRow--;
    newCursorCol = newCol;
  }

  return {
    ...nextState,
    lines: newLines,
    cursorRow: newCursorRow,
    cursorCol: newCursorCol,
    preferredCol: null,
  };
}

function handleDeleteWordRightAction(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  const lineContent = lines[cursorRow] ?? '';
  const lineLen = cpLen(lineContent);

  if (cursorCol >= lineLen && cursorRow === lines.length - 1) return state;

  const nextState = pushUndo(state);
  const newLines = [...nextState.lines];

  if (cursorCol >= lineLen) {
    const nextLineContent = lines[cursorRow + 1] ?? '';
    newLines[cursorRow] = lineContent + nextLineContent;
    newLines.splice(cursorRow + 1, 1);
  } else {
    const nextWordStart = findNextWordStartInLine(lineContent, cursorCol);
    const end = nextWordStart === null ? lineLen : nextWordStart;
    newLines[cursorRow] =
      cpSlice(lineContent, 0, cursorCol) + cpSlice(lineContent, end);
  }

  return { ...nextState, lines: newLines, preferredCol: null };
}

function handleKillLineRightAction(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  const lineContent = lines[cursorRow] ?? '';

  if (cursorCol < cpLen(lineContent)) {
    const nextState = pushUndo(state);
    const newLines = [...nextState.lines];
    newLines[cursorRow] = cpSlice(lineContent, 0, cursorCol);
    return { ...nextState, lines: newLines };
  } else if (cursorRow < lines.length - 1) {
    const nextState = pushUndo(state);
    const nextLineContent = lines[cursorRow + 1] ?? '';
    const newLines = [...nextState.lines];
    newLines[cursorRow] = lineContent + nextLineContent;
    newLines.splice(cursorRow + 1, 1);
    return { ...nextState, lines: newLines, preferredCol: null };
  }
  return state;
}

function handleKillLineLeftAction(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  if (cursorCol > 0) {
    const nextState = pushUndo(state);
    const lineContent = lines[cursorRow] ?? '';
    const newLines = [...nextState.lines];
    newLines[cursorRow] = cpSlice(lineContent, cursorCol);
    return {
      ...nextState,
      lines: newLines,
      cursorCol: 0,
      preferredCol: null,
    };
  }
  return state;
}

function handleUndoAction(state: TextBufferState): TextBufferState {
  const stateToRestore = state.undoStack[state.undoStack.length - 1];
  if (!stateToRestore) return state;

  const currentSnapshot = {
    lines: [...state.lines],
    cursorRow: state.cursorRow,
    cursorCol: state.cursorCol,
  };
  return {
    ...state,
    ...stateToRestore,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, currentSnapshot],
  };
}

function handleRedoAction(state: TextBufferState): TextBufferState {
  const stateToRestore = state.redoStack[state.redoStack.length - 1];
  if (!stateToRestore) return state;

  const currentSnapshot = {
    lines: [...state.lines],
    cursorRow: state.cursorRow,
    cursorCol: state.cursorCol,
  };
  return {
    ...state,
    ...stateToRestore,
    redoStack: state.redoStack.slice(0, -1),
    undoStack: [...state.undoStack, currentSnapshot],
  };
}

function handleReplaceRangeAction(
  state: TextBufferState,
  payload: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
    text: string;
  },
): TextBufferState {
  const { startRow, startCol, endRow, endCol, text } = payload;
  return replaceRangeInternal(
    pushUndo(state),
    startRow,
    startCol,
    endRow,
    endCol,
    text,
  );
}

function handleMoveToOffset(
  state: TextBufferState,
  offset: number,
): TextBufferState {
  const [newRow, newCol] = offsetToLogicalPos(state.lines.join('\n'), offset);
  return {
    ...state,
    cursorRow: newRow,
    cursorCol: newCol,
    preferredCol: null,
  };
}

// ─── Vim action type guard ───────────────────────────────────────────────

function isVimAction(action: TextBufferAction): action is VimAction {
  return action.type.startsWith('vim_');
}

// ─── Main reducer dispatch ───────────────────────────────────────────────

function handleSetViewport(
  state: TextBufferState,
  action: Extract<TextBufferAction, { type: 'set_viewport' }>,
): TextBufferState {
  const { width, height } = action.payload;
  if (width === state.viewportWidth && height === state.viewportHeight) {
    return state;
  }
  return { ...state, viewportWidth: width, viewportHeight: height };
}

function dispatchEditAction(
  state: TextBufferState,
  action: Exclude<TextBufferAction, VimAction>,
  options: TextBufferOptions,
): TextBufferState | null {
  switch (action.type) {
    case 'set_text':
      return handleSetText(state, action.payload, action.pushToUndo);
    case 'insert':
      return handleInsertAction(state, action.payload, options);
    case 'backspace':
      return handleBackspaceAction(state);
    case 'delete':
      return handleDeleteAction(state);
    case 'delete_word_left':
      return handleDeleteWordLeftAction(state);
    case 'delete_word_right':
      return handleDeleteWordRightAction(state);
    case 'kill_line_right':
      return handleKillLineRightAction(state);
    case 'kill_line_left':
      return handleKillLineLeftAction(state);
    case 'replace_range':
      return handleReplaceRangeAction(state, action.payload);
    case 'create_undo_snapshot':
      return pushUndo(state);
    default:
      return null;
  }
}

function dispatchNonEditAction(
  state: TextBufferState,
  action: Exclude<TextBufferAction, VimAction>,
): TextBufferState | null {
  switch (action.type) {
    case 'set_viewport':
      return handleSetViewport(state, action);
    case 'move':
      return handleMoveAction(state, action.payload.dir);
    case 'set_cursor':
      return { ...state, ...action.payload };
    case 'undo':
      return handleUndoAction(state);
    case 'redo':
      return handleRedoAction(state);
    case 'move_to_offset':
      return handleMoveToOffset(state, action.payload.offset);
    default:
      return null;
  }
}

function dispatchNonVimAction(
  state: TextBufferState,
  action: Exclude<TextBufferAction, VimAction>,
  options: TextBufferOptions,
): TextBufferState {
  return (
    dispatchEditAction(state, action, options) ??
    dispatchNonEditAction(state, action) ??
    state
  );
}

function textBufferReducerLogic(
  state: TextBufferState,
  action: TextBufferAction,
  options: TextBufferOptions = {},
): TextBufferState {
  if (isVimAction(action)) {
    return handleVimAction(state, action);
  }
  return dispatchNonVimAction(state, action, options);
}

// ─── Public reducer with layout recomputation ────────────────────────────

export function textBufferReducer(
  state: TextBufferState,
  action: TextBufferAction,
  options: TextBufferOptions = {},
): TextBufferState {
  const newState = textBufferReducerLogic(state, action, options);

  const newTransformedLines =
    newState.lines !== state.lines
      ? calculateTransformations(newState.lines)
      : state.transformationsByLine;

  const oldTransform = getTransformUnderCursor(
    state.cursorRow,
    state.cursorCol,
    state.transformationsByLine,
  );
  const newTransform = getTransformUnderCursor(
    newState.cursorRow,
    newState.cursorCol,
    newTransformedLines,
  );
  const oldInside = oldTransform !== null;
  const newInside = newTransform !== null;
  const movedBetweenTransforms =
    oldTransform !== newTransform &&
    (oldTransform !== null || newTransform !== null);

  if (
    newState.lines !== state.lines ||
    newState.viewportWidth !== state.viewportWidth ||
    oldInside !== newInside ||
    movedBetweenTransforms
  ) {
    const shouldResetPreferred =
      oldInside !== newInside || movedBetweenTransforms;
    return {
      ...newState,
      preferredCol: shouldResetPreferred ? null : newState.preferredCol,
      visualLayout: calculateLayout(newState.lines, newState.viewportWidth, [
        newState.cursorRow,
        newState.cursorCol,
      ]),
      transformationsByLine: newTransformedLines,
    };
  }

  return newState;
}
