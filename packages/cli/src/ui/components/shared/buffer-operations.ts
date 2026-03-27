/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core buffer operations for the text buffer.
 * This module provides functions for manipulating text buffer content
 * and managing undo history.
 */

import type { TextBufferState } from './buffer-types.js';
import { historyLimit } from './buffer-types.js';
import { cpLen } from '../../utils/textUtils.js';

/**
 * Converts an absolute text offset to logical row/col position.
 * @param text - The full text content
 * @param offset - The absolute character offset
 * @returns A tuple [row, col] representing the logical position
 */
export function offsetToLogicalPos(
  text: string,
  offset: number,
): [number, number] {
  let row = 0;
  let col = 0;
  let currentOffset = 0;

  if (offset === 0) return [0, 0];

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLength = cpLen(line);
    const lineLengthWithNewline = lineLength + (i < lines.length - 1 ? 1 : 0);

    if (offset <= currentOffset + lineLength) {
      // Check against lineLength first
      row = i;
      col = offset - currentOffset;
      return [row, col];
    } else if (offset <= currentOffset + lineLengthWithNewline) {
      // Check if offset is the newline itself
      row = i;
      col = lineLength; // Position cursor at the end of the current line content
      // If the offset IS the newline, and it's not the last line, advance to next line, col 0
      if (
        offset === currentOffset + lineLengthWithNewline &&
        i < lines.length - 1
      ) {
        return [i + 1, 0];
      }
      return [row, col]; // Otherwise, it's at the end of the current line content
    }
    currentOffset += lineLengthWithNewline;
  }

  // If offset is beyond the text length, place cursor at the end of the last line
  // or [0,0] if text is empty
  if (lines.length > 0) {
    row = lines.length - 1;
    col = cpLen(lines[row]);
  } else {
    row = 0;
    col = 0;
  }
  return [row, col];
}

/**
 * Converts logical row/col position to absolute text offset.
 * Inverse operation of offsetToLogicalPos.
 * @param lines - Array of text lines
 * @param row - The logical row index
 * @param col - The logical column index
 * @returns The absolute character offset
 */
export function logicalPosToOffset(
  lines: string[],
  row: number,
  col: number,
): number {
  let offset = 0;

  // Clamp row to valid range
  const actualRow = Math.min(row, lines.length - 1);

  // Add lengths of all lines before the target row
  for (let i = 0; i < actualRow; i++) {
    offset += cpLen(lines[i]) + 1; // +1 for newline
  }

  // Add column offset within the target row
  if (actualRow >= 0 && actualRow < lines.length) {
    offset += Math.min(col, cpLen(lines[actualRow]));
  }

  return offset;
}

/**
 * Gets the start and end positions (row/col) from start and end offsets.
 * @param startOffset - The starting character offset
 * @param endOffset - The ending character offset
 * @param lines - Array of text lines
 * @returns An object with startRow, startCol, endRow, endCol
 */
export const getPositionFromOffsets = (
  startOffset: number,
  endOffset: number,
  lines: string[],
) => {
  let offset = 0;
  let startRow = 0;
  let startCol = 0;
  let endRow = 0;
  let endCol = 0;

  // Find start position
  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + 1; // +1 for newline
    if (offset + lineLength > startOffset) {
      startRow = i;
      startCol = startOffset - offset;
      break;
    }
    offset += lineLength;
  }

  // Find end position
  offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length + (i < lines.length - 1 ? 1 : 0); // +1 for newline except last line
    if (offset + lineLength >= endOffset) {
      endRow = i;
      endCol = endOffset - offset;
      break;
    }
    offset += lineLength;
  }

  return { startRow, startCol, endRow, endCol };
};

/**
 * Gets the start and end offsets for a range of lines.
 * @param startRow - The starting row index
 * @param lineCount - The number of lines in the range
 * @param lines - Array of text lines
 * @returns An object with startOffset and endOffset
 */
export const getLineRangeOffsets = (
  startRow: number,
  lineCount: number,
  lines: string[],
) => {
  let startOffset = 0;

  // Calculate start offset
  for (let i = 0; i < startRow; i++) {
    startOffset += lines[i].length + 1; // +1 for newline
  }

  // Calculate end offset
  let endOffset = startOffset;
  for (let i = 0; i < lineCount; i++) {
    const lineIndex = startRow + i;
    if (lineIndex < lines.length) {
      endOffset += lines[lineIndex].length;
      if (lineIndex < lines.length - 1) {
        endOffset += 1; // +1 for newline
      }
    }
  }

  return { startOffset, endOffset };
};
/**
 * Pushes the current state onto the undo stack.
 * Creates a snapshot of the current lines and cursor position.
 * @param currentState - The current buffer state
 * @returns A new state with the undo stack updated
 */
export const pushUndo = (currentState: TextBufferState): TextBufferState => {
  const snapshot = {
    lines: [...currentState.lines],
    cursorRow: currentState.cursorRow,
    cursorCol: currentState.cursorCol,
  };
  const newStack = [...currentState.undoStack, snapshot];
  if (newStack.length > historyLimit) {
    newStack.shift();
  }
  return { ...currentState, undoStack: newStack, redoStack: [] };
};

/**
 * Replaces text within a specified range in the buffer.
 * Handles both single-line and multi-line replacements.
 * @param state - The current buffer state
 * @param startRow - Starting row index (inclusive)
 * @param startCol - Starting column index (inclusive)
 * @param endRow - Ending row index (inclusive)
 * @param endCol - Ending column index (exclusive)
 * @param text - The replacement text
 * @returns A new state with the replacement applied
 */
export const replaceRangeInternal = (
  state: TextBufferState,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  text: string,
): TextBufferState => {
  const currentLine = (row: number) => state.lines[row] || '';
  const currentLineLen = (row: number) => cpLen(currentLine(row));
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  if (
    startRow > endRow ||
    (startRow === endRow && startCol > endCol) ||
    startRow < 0 ||
    startCol < 0 ||
    endRow >= state.lines.length ||
    (endRow < state.lines.length && endCol > currentLineLen(endRow))
  ) {
    return state; // Invalid range
  }

  const newLines = [...state.lines];

  const sCol = clamp(startCol, 0, currentLineLen(startRow));
  const eCol = clamp(endCol, 0, currentLineLen(endRow));

  const prefix = cpSlice(currentLine(startRow), 0, sCol);
  const suffix = cpSlice(currentLine(endRow), eCol);

  const normalisedReplacement = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const replacementParts = normalisedReplacement.split('\n');

  // The combined first line of the new text
  const firstLine = prefix + replacementParts[0];

  if (replacementParts.length === 1) {
    // No newlines in replacement: combine prefix, replacement, and suffix on one line.
    newLines.splice(startRow, endRow - startRow + 1, firstLine + suffix);
  } else {
    // Newlines in replacement: create new lines.
    const lastLine = replacementParts[replacementParts.length - 1] + suffix;
    const middleLines = replacementParts.slice(1, -1);
    newLines.splice(
      startRow,
      endRow - startRow + 1,
      firstLine,
      ...middleLines,
      lastLine,
    );
  }

  const finalCursorRow = startRow + replacementParts.length - 1;
  const finalCursorCol =
    (replacementParts.length > 1 ? 0 : sCol) +
    cpLen(replacementParts[replacementParts.length - 1]);

  return {
    ...state,
    lines: newLines,
    cursorRow: Math.min(Math.max(finalCursorRow, 0), newLines.length - 1),
    cursorCol: Math.max(
      0,
      Math.min(finalCursorCol, cpLen(newLines[finalCursorRow] || '')),
    ),
    preferredCol: null,
  };
};

/**
 * Helper function for cpSlice - slices a string by code point indices.
 * @param str - The string to slice
 * @param start - Starting code point index
 * @param end - Ending code point index (optional)
 * @returns The sliced string
 */
function cpSlice(str: string, start: number, end?: number): string {
  const codePoints = Array.from(str);
  return codePoints.slice(start, end).join('');
}
