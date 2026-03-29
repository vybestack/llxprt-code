/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Word navigation utilities for the text buffer.
 * This module provides functions for navigating words within and across lines,
 * supporting Unicode characters, combining marks, and script detection.
 */

import { toCodePoints, cpLen } from '../../utils/textUtils.js';

/**
 * Character classification functions
 */

/**
 * Checks if a character is a word character using strict rules.
 * Matches any Unicode letter, any Unicode number, or an underscore.
 * @param char - The character to check
 * @returns true if the character is a word character
 */
export const isWordCharStrict = (char: string): boolean =>
  /[\w\p{L}\p{N}]/u.test(char);

/**
 * Checks if a character is whitespace.
 * @param char - The character to check
 * @returns true if the character is whitespace
 */
export const isWhitespace = (char: string): boolean => /\s/.test(char);

/**
 * Checks if a character is a combining mark (diacritics).
 * @param char - The character to check
 * @returns true if the character is a combining mark
 */
export const isCombiningMark = (char: string): boolean => /\p{M}/u.test(char);

/**
 * Checks if a character should be considered part of a word (including combining marks).
 * @param char - The character to check
 * @returns true if the character is part of a word
 */
export const isWordCharWithCombining = (char: string): boolean =>
  isWordCharStrict(char) || isCombiningMark(char);

/**
 * Script detection functions
 */

/**
 * Gets the script of a character (simplified for common scripts).
 * @param char - The character to check
 * @returns The script name as a string
 */
export const getCharScript = (char: string): string => {
  if (/[\p{Script=Latin}]/u.test(char)) return 'latin'; // All Latin script chars including diacritics
  if (/[\p{Script=Han}]/u.test(char)) return 'han'; // Chinese
  if (/[\p{Script=Arabic}]/u.test(char)) return 'arabic';
  if (/[\p{Script=Hiragana}]/u.test(char)) return 'hiragana';
  if (/[\p{Script=Katakana}]/u.test(char)) return 'katakana';
  if (/[\p{Script=Cyrillic}]/u.test(char)) return 'cyrillic';
  return 'other';
};

/**
 * Checks if two characters are from different scripts (indicating word boundary).
 * @param char1 - The first character
 * @param char2 - The second character
 * @returns true if the characters are from different scripts
 */
export const isDifferentScript = (char1: string, char2: string): boolean => {
  if (!isWordCharStrict(char1) || !isWordCharStrict(char2)) return false;
  return getCharScript(char1) !== getCharScript(char2);
};

/**
 * Single-line word navigation functions
 */

/**
 * Finds the next word start within a line, starting from a given column.
 * @param line - The line of text to search
 * @param col - The starting column position
 * @returns The column of the next word start, or null if not found
 */
export const findNextWordStartInLine = (
  line: string,
  col: number,
): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  if (i >= chars.length) return null;

  const currentChar = chars[i];

  // Skip current word/sequence based on character type
  if (isWordCharStrict(currentChar)) {
    while (i < chars.length && isWordCharWithCombining(chars[i])) {
      // Check for script boundary - if next character is from different script, stop here
      if (
        i + 1 < chars.length &&
        isWordCharStrict(chars[i + 1]) &&
        isDifferentScript(chars[i], chars[i + 1])
      ) {
        i++; // Include current character
        break; // Stop at script boundary
      }
      i++;
    }
  } else if (!isWhitespace(currentChar)) {
    while (
      i < chars.length &&
      !isWordCharStrict(chars[i]) &&
      !isWhitespace(chars[i])
    ) {
      i++;
    }
  }

  // Skip whitespace
  while (i < chars.length && isWhitespace(chars[i])) {
    i++;
  }

  return i < chars.length ? i : null;
};

/**
 * Finds the previous word start within a line.
 * @param line - The line of text to search
 * @param col - The starting column position
 * @returns The column of the previous word start, or null if not found
 */
export const findPrevWordStartInLine = (
  line: string,
  col: number,
): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  if (i <= 0) return null;

  i--;

  // Skip whitespace moving backwards
  while (i >= 0 && isWhitespace(chars[i])) {
    i--;
  }

  if (i < 0) return null;

  if (isWordCharStrict(chars[i])) {
    // We're in a word, move to its beginning
    while (i >= 0 && isWordCharStrict(chars[i])) {
      // Check for script boundary - if previous character is from different script, stop here
      if (
        i - 1 >= 0 &&
        isWordCharStrict(chars[i - 1]) &&
        isDifferentScript(chars[i], chars[i - 1])
      ) {
        return i; // Return current position at script boundary
      }
      i--;
    }
    return i + 1;
  }
  // We're in punctuation, move to its beginning
  while (i >= 0 && !isWordCharStrict(chars[i]) && !isWhitespace(chars[i])) {
    i--;
  }
  return i + 1;
};

/**
 * Finds the word end within a line.
 * @param line - The line of text to search
 * @param col - The starting column position
 * @returns The column of the word end, or null if not found
 */
function isAtWordEndBoundary(chars: string[], i: number): boolean {
  if (i >= chars.length || !isWordCharWithCombining(chars[i])) return false;
  if (i + 1 >= chars.length || !isWordCharWithCombining(chars[i + 1]))
    return true;
  return (
    isWordCharStrict(chars[i]) &&
    i + 1 < chars.length &&
    isWordCharStrict(chars[i + 1]) &&
    isDifferentScript(chars[i], chars[i + 1])
  );
}

function isAtPunctuationEnd(chars: string[], i: number): boolean {
  if (
    i >= chars.length ||
    isWordCharWithCombining(chars[i]) ||
    isWhitespace(chars[i])
  )
    return false;
  return (
    i + 1 >= chars.length ||
    isWhitespace(chars[i + 1]) ||
    isWordCharWithCombining(chars[i + 1])
  );
}

function skipWhitespace(chars: string[], start: number): number {
  let i = start;
  while (i < chars.length && isWhitespace(chars[i])) i++;
  return i;
}

function scanWordCharsToEnd(
  chars: string[],
  start: number,
): { lastBaseCharPos: number; endIdx: number } {
  let i = start;
  let lastBaseCharPos = -1;
  while (i < chars.length && isWordCharWithCombining(chars[i])) {
    if (isWordCharStrict(chars[i])) lastBaseCharPos = i;
    if (
      i + 1 < chars.length &&
      isWordCharStrict(chars[i + 1]) &&
      isDifferentScript(chars[i], chars[i + 1])
    ) {
      if (isWordCharStrict(chars[i])) lastBaseCharPos = i;
      return { lastBaseCharPos, endIdx: i + 1 };
    }
    i++;
  }
  return { lastBaseCharPos, endIdx: i };
}

function scanPunctuationToEnd(
  chars: string[],
  start: number,
): { lastBaseCharPos: number; endIdx: number } {
  let i = start;
  let lastBaseCharPos = -1;
  while (
    i < chars.length &&
    !isWordCharStrict(chars[i]) &&
    !isWhitespace(chars[i])
  ) {
    lastBaseCharPos = i;
    i++;
  }
  return { lastBaseCharPos, endIdx: i };
}

export const findWordEndInLine = (line: string, col: number): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  if (isAtWordEndBoundary(chars, i) || isAtPunctuationEnd(chars, i)) {
    i = skipWhitespace(chars, i + 1);
  }
  if (i < chars.length && !isWordCharWithCombining(chars[i])) {
    i = skipWhitespace(chars, i);
  }

  let result: { lastBaseCharPos: number; endIdx: number };
  if (i < chars.length && isWordCharWithCombining(chars[i])) {
    result = scanWordCharsToEnd(chars, i);
  } else if (i < chars.length && !isWhitespace(chars[i])) {
    result = scanPunctuationToEnd(chars, i);
  } else {
    return null;
  }

  return result.lastBaseCharPos >= col ? result.lastBaseCharPos : null;
};

/**
 * Cross-line word navigation functions
 */

/**
 * Finds the next word across multiple lines.
 * @param lines - Array of text lines
 * @param cursorRow - Current row position
 * @param cursorCol - Current column position
 * @param searchForWordStart - If true, search for word start; if false, search for word end
 * @returns Object with row and column of the next word, or null if not found
 */
function hasWordsInLaterLines(lines: string[], startRow: number): boolean {
  for (let laterRow = startRow; laterRow < lines.length; laterRow++) {
    const chars = toCodePoints(lines[laterRow] || '');
    const col = skipWhitespace(chars, 0);
    if (col < chars.length) return true;
  }
  return false;
}

function findFirstNonWhitespaceCol(line: string): number {
  const chars = toCodePoints(line);
  return skipWhitespace(chars, 0);
}

export const findNextWordAcrossLines = (
  lines: string[],
  cursorRow: number,
  cursorCol: number,
  searchForWordStart: boolean,
): { row: number; col: number } | null => {
  const currentLine = lines[cursorRow] || '';
  const colInCurrentLine = searchForWordStart
    ? findNextWordStartInLine(currentLine, cursorCol)
    : findWordEndInLine(currentLine, cursorCol);

  if (colInCurrentLine !== null) {
    return { row: cursorRow, col: colInCurrentLine };
  }

  for (let row = cursorRow + 1; row < lines.length; row++) {
    const line = lines[row] || '';
    if (line.length === 0) {
      if (!hasWordsInLaterLines(lines, row + 1)) return { row, col: 0 };
      continue;
    }

    const firstNonWs = findFirstNonWhitespaceCol(line);
    if (firstNonWs >= cpLen(line)) continue;

    if (searchForWordStart) return { row, col: firstNonWs };
    const endCol = findWordEndInLine(line, firstNonWs);
    if (endCol !== null) return { row, col: endCol };
  }

  return null;
};

/**
 * Finds the previous word across multiple lines.
 * @param lines - Array of lines to search
 * @param cursorRow - Current row position
 * @param cursorCol - Current column position
 * @returns Object with row and column of the previous word, or null if not found
 */
export const findPrevWordAcrossLines = (
  lines: string[],
  cursorRow: number,
  cursorCol: number,
): { row: number; col: number } | null => {
  // First try current line
  const currentLine = lines[cursorRow] || '';
  const colInCurrentLine = findPrevWordStartInLine(currentLine, cursorCol);

  if (colInCurrentLine !== null) {
    return { row: cursorRow, col: colInCurrentLine };
  }

  // Search previous lines
  for (let row = cursorRow - 1; row >= 0; row--) {
    const line = lines[row] || '';
    const chars = toCodePoints(line);

    if (chars.length === 0) continue;

    // Find last word start
    let lastWordStart = chars.length;
    while (lastWordStart > 0 && isWhitespace(chars[lastWordStart - 1])) {
      lastWordStart--;
    }

    if (lastWordStart > 0) {
      // Find start of this word
      const wordStart = findPrevWordStartInLine(line, lastWordStart);
      if (wordStart !== null) {
        return { row, col: wordStart };
      }
    }
  }

  return null;
};
