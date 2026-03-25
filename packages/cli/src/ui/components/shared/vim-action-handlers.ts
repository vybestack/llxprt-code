/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Individual action handler functions for vim buffer operations.
 * Each function corresponds to one (or two paired) vim action types.
 */

import type { TextBufferState } from './buffer-types.js';
import {
  getLineRangeOffsets,
  getPositionFromOffsets,
  replaceRangeInternal,
  pushUndo,
} from './buffer-operations.js';
import {
  isWordCharStrict,
  isWordCharWithCombining,
  isCombiningMark,
  findNextWordAcrossLines,
  findPrevWordAcrossLines,
  findWordEndInLine,
} from './word-navigation.js';
import { cpLen, toCodePoints } from '../../utils/textUtils.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isAtEndOfBaseWord(lineCodePoints: string[], col: number): boolean {
  if (!isWordCharStrict(lineCodePoints[col])) return false;
  let i = col + 1;
  while (i < lineCodePoints.length && isCombiningMark(lineCodePoints[i])) {
    i++;
  }
  return i >= lineCodePoints.length || !isWordCharStrict(lineCodePoints[i]);
}

function clampLineCol(lines: string[], row: number, col: number): number {
  if (row >= lines.length) return col;
  return Math.min(col, cpLen(lines[row] || ''));
}

function findFirstNonWhitespace(line: string): number {
  const pts = toCodePoints(line);
  let col = 0;
  while (col < pts.length && /\s/.test(pts[col])) {
    col++;
  }
  return col;
}

// ---------------------------------------------------------------------------
// Delete / change word forward
// ---------------------------------------------------------------------------

export function handleDeleteWordForward(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines, cursorRow, cursorCol } = state;
  let endRow = cursorRow;
  let endCol = cursorCol;

  for (let i = 0; i < count; i++) {
    const nextWord = findNextWordAcrossLines(lines, endRow, endCol, true);
    if (nextWord) {
      endRow = nextWord.row;
      endCol = nextWord.col;
    } else {
      const currentLine = lines[endRow] || '';
      const wordEnd = findWordEndInLine(currentLine, endCol);
      endCol = wordEnd !== null ? wordEnd + 1 : cpLen(currentLine);
      break;
    }
  }

  if (endRow !== cursorRow || endCol !== cursorCol) {
    return replaceRangeInternal(
      pushUndo(state),
      cursorRow,
      cursorCol,
      endRow,
      endCol,
      '',
    );
  }
  return state;
}

// ---------------------------------------------------------------------------
// Delete / change word backward
// ---------------------------------------------------------------------------

export function handleDeleteWordBackward(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines, cursorRow, cursorCol } = state;
  let startRow = cursorRow;
  let startCol = cursorCol;

  for (let i = 0; i < count; i++) {
    const prevWord = findPrevWordAcrossLines(lines, startRow, startCol);
    if (!prevWord) break;
    startRow = prevWord.row;
    startCol = prevWord.col;
  }

  if (startRow !== cursorRow || startCol !== cursorCol) {
    return replaceRangeInternal(
      pushUndo(state),
      startRow,
      startCol,
      cursorRow,
      cursorCol,
      '',
    );
  }
  return state;
}

// ---------------------------------------------------------------------------
// Delete / change word end
// ---------------------------------------------------------------------------

type Pos = { row: number; col: number };

function nextWordEndPos(lines: string[], r: number, c: number): Pos | null {
  return findNextWordAcrossLines(lines, r, c, false) ?? null;
}

function nextWordStartPos(lines: string[], r: number, c: number): Pos | null {
  return findNextWordAcrossLines(lines, r, c, true) ?? null;
}

function advanceWordEnd(
  lines: string[],
  row: number,
  col: number,
  count: number,
): Pos {
  let r = row;
  let c = col;
  let remaining = count;
  while (remaining > 0) {
    const wordEnd = nextWordEndPos(lines, r, c);
    if (!wordEnd) {
      remaining = 0;
    } else {
      r = wordEnd.row;
      c = wordEnd.col + 1;
      remaining--;
      const nextWord =
        remaining > 0
          ? nextWordStartPos(lines, wordEnd.row, wordEnd.col + 1)
          : null;
      if (nextWord !== null) {
        r = nextWord.row;
        c = nextWord.col;
      } else if (remaining > 0) {
        remaining = 0;
      }
    }
  }
  return { row: r, col: c };
}

export function handleDeleteWordEnd(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines, cursorRow, cursorCol } = state;
  const end = advanceWordEnd(lines, cursorRow, cursorCol, count);
  const endRow = end.row;
  const endCol = clampLineCol(lines, endRow, end.col);

  if (endRow !== cursorRow || endCol !== cursorCol) {
    return replaceRangeInternal(
      pushUndo(state),
      cursorRow,
      cursorCol,
      endRow,
      endCol,
      '',
    );
  }
  return state;
}

// ---------------------------------------------------------------------------
// Delete line
// ---------------------------------------------------------------------------

export function handleDeleteLine(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines, cursorRow } = state;
  if (lines.length === 0) return state;

  const linesToDelete = Math.min(count, lines.length - cursorRow);
  const totalLines = lines.length;

  if (totalLines === 1 || linesToDelete >= totalLines) {
    return {
      ...pushUndo(state),
      lines: [''],
      cursorRow: 0,
      cursorCol: 0,
      preferredCol: null,
    };
  }

  const nextState = pushUndo(state);
  const newLines = [...nextState.lines];
  newLines.splice(cursorRow, linesToDelete);

  return {
    ...nextState,
    lines: newLines,
    cursorRow: Math.min(cursorRow, newLines.length - 1),
    cursorCol: 0,
    preferredCol: null,
  };
}

// ---------------------------------------------------------------------------
// Change line
// ---------------------------------------------------------------------------

export function handleChangeLine(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines, cursorRow } = state;
  if (lines.length === 0) return state;

  const linesToChange = Math.min(count, lines.length - cursorRow);
  const nextState = pushUndo(state);
  const { startOffset, endOffset } = getLineRangeOffsets(
    cursorRow,
    linesToChange,
    nextState.lines,
  );
  const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
    startOffset,
    endOffset,
    nextState.lines,
  );
  return replaceRangeInternal(
    nextState,
    startRow,
    startCol,
    endRow,
    endCol,
    '',
  );
}

// ---------------------------------------------------------------------------
// Delete / change to end of line
// ---------------------------------------------------------------------------

export function handleDeleteToEndOfLine(
  state: TextBufferState,
): TextBufferState {
  const { lines, cursorRow, cursorCol } = state;
  const currentLine = lines[cursorRow] || '';
  if (cursorCol < cpLen(currentLine)) {
    return replaceRangeInternal(
      pushUndo(state),
      cursorRow,
      cursorCol,
      cursorRow,
      cpLen(currentLine),
      '',
    );
  }
  return state;
}

// ---------------------------------------------------------------------------
// Change movement — sub-handlers
// ---------------------------------------------------------------------------

function changeMovementH(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { cursorRow, cursorCol } = state;
  const startCol = Math.max(0, cursorCol - count);
  return replaceRangeInternal(
    pushUndo(state),
    cursorRow,
    startCol,
    cursorRow,
    cursorCol,
    '',
  );
}

function changeMovementL(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines, cursorRow, cursorCol } = state;
  return replaceRangeInternal(
    pushUndo(state),
    cursorRow,
    cursorCol,
    cursorRow,
    Math.min(cpLen(lines[cursorRow] || ''), cursorCol + count),
    '',
  );
}

function changeMovementJ(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines, cursorRow } = state;
  const linesToChange = Math.min(count, lines.length - cursorRow);
  if (linesToChange <= 0) return state;

  if (lines.length === 1) {
    const currentLine = state.lines[0] || '';
    return replaceRangeInternal(
      pushUndo(state),
      0,
      0,
      0,
      cpLen(currentLine),
      '',
    );
  }

  const nextState = pushUndo(state);
  const { startOffset, endOffset } = getLineRangeOffsets(
    cursorRow,
    linesToChange,
    nextState.lines,
  );
  const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
    startOffset,
    endOffset,
    nextState.lines,
  );
  return replaceRangeInternal(
    nextState,
    startRow,
    startCol,
    endRow,
    endCol,
    '',
  );
}

function changeMovementK(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines, cursorRow } = state;
  const upLines = Math.min(count, cursorRow + 1);
  if (upLines <= 0) return state;

  if (lines.length === 1) {
    const currentLine = lines[0] || '';
    return replaceRangeInternal(
      pushUndo(state),
      0,
      0,
      0,
      cpLen(currentLine),
      '',
    );
  }

  const startRow = Math.max(0, cursorRow - count + 1);
  const linesToChange = cursorRow - startRow + 1;
  const nextState = pushUndo(state);
  const { startOffset, endOffset } = getLineRangeOffsets(
    startRow,
    linesToChange,
    nextState.lines,
  );
  const {
    startRow: newStartRow,
    startCol,
    endRow,
    endCol,
  } = getPositionFromOffsets(startOffset, endOffset, nextState.lines);
  const resultState = replaceRangeInternal(
    nextState,
    newStartRow,
    startCol,
    endRow,
    endCol,
    '',
  );
  return { ...resultState, cursorRow: startRow, cursorCol: 0 };
}

export function handleChangeMovement(
  state: TextBufferState,
  movement: string,
  count: number,
): TextBufferState {
  switch (movement) {
    case 'h':
      return changeMovementH(state, count);
    case 'j':
      return changeMovementJ(state, count);
    case 'k':
      return changeMovementK(state, count);
    case 'l':
      return changeMovementL(state, count);
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Move left
// ---------------------------------------------------------------------------

function stepLeft(
  lines: string[],
  row: number,
  col: number,
): { row: number; col: number } {
  if (col > 0) {
    return { row, col: col - 1 };
  }
  if (row > 0) {
    const prevLine = lines[row - 1] || '';
    const prevLen = cpLen(prevLine);
    return { row: row - 1, col: prevLen === 0 ? 0 : prevLen - 1 };
  }
  return { row, col };
}

export function handleMoveLeft(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines } = state;
  let row = state.cursorRow;
  let col = state.cursorCol;

  for (let i = 0; i < count; i++) {
    const next = stepLeft(lines, row, col);
    row = next.row;
    col = next.col;
  }

  return { ...state, cursorRow: row, cursorCol: col, preferredCol: null };
}

// ---------------------------------------------------------------------------
// Move right
// ---------------------------------------------------------------------------

function advanceCursorRight(
  lines: string[],
  row: number,
  col: number,
): { row: number; col: number } {
  const currentLine = lines[row] || '';
  const lineLength = cpLen(currentLine);

  if (lineLength === 0) {
    return row < lines.length - 1 ? { row: row + 1, col: 0 } : { row, col };
  }

  if (col < lineLength - 1) {
    let newCol = col + 1;
    const pts = toCodePoints(currentLine);
    while (
      newCol < pts.length &&
      isCombiningMark(pts[newCol]) &&
      newCol < lineLength - 1
    ) {
      newCol++;
    }
    return { row, col: newCol };
  }

  return row < lines.length - 1 ? { row: row + 1, col: 0 } : { row, col };
}

export function handleMoveRight(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines } = state;
  let row = state.cursorRow;
  let col = state.cursorCol;

  for (let i = 0; i < count; i++) {
    const next = advanceCursorRight(lines, row, col);
    row = next.row;
    col = next.col;
  }

  return { ...state, cursorRow: row, cursorCol: col, preferredCol: null };
}

// ---------------------------------------------------------------------------
// Move up / down
// ---------------------------------------------------------------------------

export function handleMoveUp(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  const newRow = Math.max(0, cursorRow - count);
  const targetLine = lines[newRow] || '';
  const targetLen = cpLen(targetLine);
  const newCol = Math.min(cursorCol, targetLen > 0 ? targetLen - 1 : 0);
  return { ...state, cursorRow: newRow, cursorCol: newCol, preferredCol: null };
}

export function handleMoveDown(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  const newRow = Math.min(lines.length - 1, cursorRow + count);
  const targetLine = lines[newRow] || '';
  const targetLen = cpLen(targetLine);
  const newCol = Math.min(cursorCol, targetLen > 0 ? targetLen - 1 : 0);
  return { ...state, cursorRow: newRow, cursorCol: newCol, preferredCol: null };
}

// ---------------------------------------------------------------------------
// Move word forward / backward
// ---------------------------------------------------------------------------

export function handleMoveWordForward(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines } = state;
  let row = state.cursorRow;
  let col = state.cursorCol;

  for (let i = 0; i < count; i++) {
    const nextWord = findNextWordAcrossLines(lines, row, col, true);
    if (!nextWord) break;
    row = nextWord.row;
    col = nextWord.col;
  }

  return { ...state, cursorRow: row, cursorCol: col, preferredCol: null };
}

export function handleMoveWordBackward(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines } = state;
  let row = state.cursorRow;
  let col = state.cursorCol;

  for (let i = 0; i < count; i++) {
    const prevWord = findPrevWordAcrossLines(lines, row, col);
    if (!prevWord) break;
    row = prevWord.row;
    col = prevWord.col;
  }

  return { ...state, cursorRow: row, cursorCol: col, preferredCol: null };
}

// ---------------------------------------------------------------------------
// Move word end
// ---------------------------------------------------------------------------

function isAtWordEnd(lineCodePoints: string[], col: number): boolean {
  const inBounds = col < lineCodePoints.length;
  const onWordChar = inBounds && isWordCharStrict(lineCodePoints[col]);
  const nextIsNonWord =
    col + 1 >= lineCodePoints.length ||
    !isWordCharWithCombining(lineCodePoints[col + 1]);
  const atBaseEnd = isAtEndOfBaseWord(lineCodePoints, col);
  return onWordChar && (nextIsNonWord || atBaseEnd);
}

function stepWordEnd(
  lines: string[],
  row: number,
  col: number,
  isFirst: boolean,
): { row: number; col: number } | null {
  if (isFirst) {
    const lineCodePoints = toCodePoints(lines[row] || '');
    if (isAtWordEnd(lineCodePoints, col)) {
      return findNextWordAcrossLines(lines, row, col + 1, false) ?? null;
    }
  }
  return findNextWordAcrossLines(lines, row, col, false) ?? null;
}

export function handleMoveWordEnd(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { lines } = state;
  let row = state.cursorRow;
  let col = state.cursorCol;

  for (let i = 0; i < count; i++) {
    const wordEnd = stepWordEnd(lines, row, col, i === 0);
    if (!wordEnd) break;
    row = wordEnd.row;
    col = wordEnd.col;
  }

  return { ...state, cursorRow: row, cursorCol: col, preferredCol: null };
}

// ---------------------------------------------------------------------------
// Delete char
// ---------------------------------------------------------------------------

export function handleDeleteChar(
  state: TextBufferState,
  count: number,
): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  const currentLine = lines[cursorRow] || '';
  const lineLength = cpLen(currentLine);

  if (cursorCol < lineLength) {
    const deleteCount = Math.min(count, lineLength - cursorCol);
    return replaceRangeInternal(
      pushUndo(state),
      cursorRow,
      cursorCol,
      cursorRow,
      cursorCol + deleteCount,
      '',
    );
  }
  return state;
}

// ---------------------------------------------------------------------------
// Cursor positioning helpers
// ---------------------------------------------------------------------------

export function handleInsertAtCursor(state: TextBufferState): TextBufferState {
  return state;
}

export function handleAppendAtCursor(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  const currentLine = lines[cursorRow] || '';
  const newCol = cursorCol < cpLen(currentLine) ? cursorCol + 1 : cursorCol;
  return { ...state, cursorCol: newCol, preferredCol: null };
}

export function handleOpenLineBelow(state: TextBufferState): TextBufferState {
  const { cursorRow, lines } = state;
  const nextState = pushUndo(state);
  const endOfLine = cpLen(lines[cursorRow] || '');
  return replaceRangeInternal(
    nextState,
    cursorRow,
    endOfLine,
    cursorRow,
    endOfLine,
    '\n',
  );
}

export function handleOpenLineAbove(state: TextBufferState): TextBufferState {
  const { cursorRow } = state;
  const nextState = pushUndo(state);
  const resultState = replaceRangeInternal(
    nextState,
    cursorRow,
    0,
    cursorRow,
    0,
    '\n',
  );
  return { ...resultState, cursorRow, cursorCol: 0 };
}

export function handleAppendAtLineEnd(state: TextBufferState): TextBufferState {
  const { cursorRow, lines } = state;
  return {
    ...state,
    cursorCol: cpLen(lines[cursorRow] || ''),
    preferredCol: null,
  };
}

function moveToFirstNonWhitespace(state: TextBufferState): TextBufferState {
  const { cursorRow, lines } = state;
  const col = findFirstNonWhitespace(lines[cursorRow] || '');
  return { ...state, cursorCol: col, preferredCol: null };
}

export function handleInsertAtLineStart(
  state: TextBufferState,
): TextBufferState {
  return moveToFirstNonWhitespace(state);
}

export function handleMoveToFirstNonWhitespace(
  state: TextBufferState,
): TextBufferState {
  return moveToFirstNonWhitespace(state);
}

export function handleMoveToLineStart(state: TextBufferState): TextBufferState {
  return { ...state, cursorCol: 0, preferredCol: null };
}

export function handleMoveToLineEnd(state: TextBufferState): TextBufferState {
  const { cursorRow, lines } = state;
  const lineLength = cpLen(lines[cursorRow] || '');
  return {
    ...state,
    cursorCol: lineLength > 0 ? lineLength - 1 : 0,
    preferredCol: null,
  };
}

export function handleMoveToFirstLine(state: TextBufferState): TextBufferState {
  return { ...state, cursorRow: 0, cursorCol: 0, preferredCol: null };
}

export function handleMoveToLastLine(state: TextBufferState): TextBufferState {
  const lastRow = state.lines.length - 1;
  return { ...state, cursorRow: lastRow, cursorCol: 0, preferredCol: null };
}

export function handleMoveToLine(
  state: TextBufferState,
  lineNumber: number,
): TextBufferState {
  const targetRow = Math.min(
    Math.max(0, lineNumber - 1),
    state.lines.length - 1,
  );
  return { ...state, cursorRow: targetRow, cursorCol: 0, preferredCol: null };
}

export function handleEscapeInsertMode(
  state: TextBufferState,
): TextBufferState {
  const newCol = state.cursorCol > 0 ? state.cursorCol - 1 : 0;
  return { ...state, cursorCol: newCol, preferredCol: null };
}
