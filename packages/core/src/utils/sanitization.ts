/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Character sets for sanitization
 */
const UNICODE_REPLACEMENT = '\uFFFD';
const CONTROL_CHAR_START = 0x0000;
const CONTROL_CHAR_END = 0x001f;
const DELETE_CHAR = 0x007f;
const NON_ASCII_START = 0x0080;
const NON_ASCII_END = 0xffff;

/**
 * Checks if a character code point is a control character
 */
function isControlChar(codePoint: number): boolean {
  return (
    (codePoint >= CONTROL_CHAR_START && codePoint <= CONTROL_CHAR_END) ||
    codePoint === DELETE_CHAR
  );
}

/**
 * Checks if a character code point is non-ASCII
 */
function isNonAscii(codePoint: number): boolean {
  return codePoint >= NON_ASCII_START && codePoint <= NON_ASCII_END;
}

/**
 * Sanitizes a string by removing problematic characters that can cause
 * encoding issues, particularly with ByteString conversions.
 *
 * @param input The string to sanitize
 * @returns The sanitized string
 */
export function sanitizeForByteString(input: string): string {
  let result = '';

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const codePoint = input.charCodeAt(i);

    // Skip Unicode replacement character
    if (char === UNICODE_REPLACEMENT) {
      continue;
    }

    // Skip control characters
    if (isControlChar(codePoint)) {
      continue;
    }

    // Skip non-ASCII characters
    if (isNonAscii(codePoint)) {
      continue;
    }

    result += char;
  }

  return result.trim();
}

/**
 * Checks if sanitization would modify the input string
 *
 * @param input The string to check
 * @returns True if the string would be modified by sanitization
 */
export function needsSanitization(input: string): boolean {
  const trimmed = input.trim();
  return sanitizeForByteString(trimmed) !== trimmed;
}
