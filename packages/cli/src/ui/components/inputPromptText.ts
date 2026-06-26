/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Key } from '../hooks/useKeypress.js';
import {
  cpLen,
  cpSlice,
  getCachedStringWidth,
  toCodePoints,
} from '../utils/textUtils.js';
import { logicalPosToOffset } from './shared/buffer-operations.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type React from 'react';

const LARGE_PASTE_LINE_THRESHOLD = 4;

const LARGE_PASTE_CHAR_THRESHOLD = 1000;

const formatLargePastePlaceholder = (
  lines: number,
  chars: number,
  id: number,
): string => {
  const idSuffix = ` #${id}`;
  if (lines > 1) {
    const label = lines === 1 ? 'line' : 'lines';
    return `[${lines} ${label} pasted${idSuffix}]`;
  }
  const charLabel = chars === 1 ? 'character' : 'characters';
  return `[${chars} ${charLabel} pasted${idSuffix}]`;
};

// The input content, input container, and input suggestions list may have different widths
export const calculatePromptWidths = (terminalWidth: number) => {
  const widthFraction = 0.9;
  const FRAME_PADDING_AND_BORDER = 4; // Border (2) + padding (2)
  const PROMPT_PREFIX_WIDTH = 2; // '> ' or '! '
  const MIN_CONTENT_WIDTH = 2;

  const innerContentWidth =
    Math.floor(terminalWidth * widthFraction) -
    FRAME_PADDING_AND_BORDER -
    PROMPT_PREFIX_WIDTH;

  const inputWidth = Math.max(MIN_CONTENT_WIDTH, innerContentWidth);
  const FRAME_OVERHEAD = FRAME_PADDING_AND_BORDER + PROMPT_PREFIX_WIDTH;
  const containerWidth = inputWidth + FRAME_OVERHEAD;
  const suggestionsWidth = Math.max(20, Math.floor(terminalWidth * 1.0));

  return {
    inputWidth,
    containerWidth,
    suggestionsWidth,
    frameOverhead: FRAME_OVERHEAD,
  } as const;
};

// ---------------------------------------------------------------------------
// Pure helpers (no hooks, no React)
// ---------------------------------------------------------------------------

/** Wrap a single long word across multiple lines at the given width. */
const wrapOverlongWord = (
  word: string,
  width: number,
  into: string[],
): void => {
  let remaining = word;
  while (getCachedStringWidth(remaining) > width) {
    let part = '';
    const wordCP = toCodePoints(remaining);
    let partWidth = 0;
    let splitIndex = 0;
    for (let i = 0; i < wordCP.length; i++) {
      const char = wordCP[i];
      const charWidth = getCachedStringWidth(char);
      if (partWidth + charWidth > width) {
        break;
      }
      part += char;
      partWidth += charWidth;
      splitIndex = i + 1;
    }
    into.push(part);
    remaining = cpSlice(remaining, splitIndex);
  }
  if (remaining) {
    into.push(remaining);
  }
};

/** Word-wrap `text` to `width`, returning the array of wrapped lines. */
const wrapTextToWidth = (text: string, width: number): string[] => {
  const result: string[] = [];
  const words = text.split(' ');
  let currentLine = '';

  for (const word of words) {
    const prospectiveLine = currentLine ? `${currentLine} ${word}` : word;
    if (getCachedStringWidth(prospectiveLine) > width) {
      if (currentLine) {
        result.push(currentLine);
      }
      if (getCachedStringWidth(word) > width) {
        wrapOverlongWord(word, width, result);
        currentLine = '';
      } else {
        currentLine = word;
      }
    } else {
      currentLine = prospectiveLine;
    }
  }
  if (currentLine) {
    result.push(currentLine);
  }
  return result;
};

/** Compute inline ghost text and additional wrapped lines. */
export const computeGhostText = (
  ghostSuffix: string,
  cursorCol: number,
  currentLogicalLine: string,
  inputWidth: number,
): { inlineGhost: string; additionalLines: string[] } => {
  const textBeforeCursor = cpSlice(currentLogicalLine, 0, cursorCol);
  const usedWidth = getCachedStringWidth(textBeforeCursor);
  const remainingWidth = Math.max(0, inputWidth - usedWidth);

  const ghostTextLinesRaw = ghostSuffix.split('\n');
  const firstLineRaw = ghostTextLinesRaw.shift() ?? '';

  let inlineGhost = '';
  let remainingFirstLine = '';

  if (getCachedStringWidth(firstLineRaw) <= remainingWidth) {
    inlineGhost = firstLineRaw;
  } else {
    const words = firstLineRaw.split(' ');
    let currentLine = '';
    let wordIdx = 0;
    for (const word of words) {
      const prospectiveLine = currentLine ? `${currentLine} ${word}` : word;
      if (getCachedStringWidth(prospectiveLine) > remainingWidth) {
        break;
      }
      currentLine = prospectiveLine;
      wordIdx++;
    }
    inlineGhost = currentLine;
    if (words.length > wordIdx) {
      remainingFirstLine = words.slice(wordIdx).join(' ');
    }
  }

  const linesToWrap: string[] = [];
  if (remainingFirstLine) {
    linesToWrap.push(remainingFirstLine);
  }
  linesToWrap.push(...ghostTextLinesRaw);
  const remainingGhostText = linesToWrap.join('\n');

  const additionalLines: string[] = [];
  if (remainingGhostText) {
    for (const textLine of remainingGhostText.split('\n')) {
      additionalLines.push(...wrapTextToWidth(textLine, inputWidth));
    }
  }

  return { inlineGhost, additionalLines };
};

/** Insert @path reference at the current cursor position in the buffer. */
export const insertPathReference = (
  buffer: TextBuffer,
  relativePath: string,
): void => {
  const insertText = `@${relativePath}`;
  const currentText = buffer.text;
  const [row, col] = buffer.cursor;
  const offset = logicalPosToOffset(buffer.lines, row, col);

  let textToInsert = insertText;
  const charBefore = offset > 0 ? currentText[offset - 1] : '';
  const charAfter = offset < currentText.length ? currentText[offset] : '';

  if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
    textToInsert = ' ' + textToInsert;
  }
  if (!charAfter || (charAfter !== ' ' && charAfter !== '\n')) {
    textToInsert = textToInsert + ' ';
  }

  buffer.replaceRangeByOffset(offset, offset, textToInsert);
};

/** Handle a large paste by inserting a placeholder into the buffer. */
export const handleLargePaste = (
  key: Key,
  buffer: TextBuffer,
  nextPlaceholderIdRef: React.MutableRefObject<number>,
  pendingLargePastesRef: React.MutableRefObject<Map<string, string>>,
): void => {
  const sanitized = key.sequence.replace(/\r\n?/g, '\n');
  const charCount = cpLen(sanitized);
  const lineCount = sanitized.length === 0 ? 0 : sanitized.split('\n').length;

  if (
    lineCount < LARGE_PASTE_LINE_THRESHOLD &&
    charCount < LARGE_PASTE_CHAR_THRESHOLD
  ) {
    buffer.handleInput({ ...key, sequence: sanitized });
    return;
  }

  const existingText = buffer.text;
  const cursorOffset = logicalPosToOffset(
    buffer.lines,
    buffer.cursor[0],
    buffer.cursor[1],
  );
  const before = existingText.slice(0, cursorOffset);
  const after = existingText.slice(cursorOffset);
  const placeholderId = nextPlaceholderIdRef.current++;
  const placeholderLabel = formatLargePastePlaceholder(
    lineCount,
    charCount,
    placeholderId,
  );
  const placeholderText = `${before}${placeholderLabel}${after}`;

  buffer.setText(placeholderText);
  buffer.moveToOffset(cursorOffset + placeholderLabel.length);
  const nextPendingPastes = new Map(pendingLargePastesRef.current);
  nextPendingPastes.set(placeholderLabel, sanitized);
  pendingLargePastesRef.current = nextPendingPastes;
};
