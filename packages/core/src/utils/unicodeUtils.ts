/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sanitizes Unicode strings by handling replacement characters and ensuring
 * proper UTF-8 encoding for API transmission.
 */

/**
 * Removes or replaces Unicode replacement characters (U+FFFD) from a string.
 * These characters often appear when there are encoding/decoding errors.
 *
 * @param text The text to sanitize
 * @param replacement What to replace U+FFFD with (default: '?')
 * @returns The sanitized text
 */
export function sanitizeUnicodeReplacements(
  text: string,
  replacement: string = '?',
): string {
  // U+FFFD is the Unicode replacement character
  return text.replace(/\uFFFD/g, replacement);
}

/**
 * Checks if a string contains Unicode replacement characters (U+FFFD).
 *
 * @param text The text to check
 * @returns True if the text contains replacement characters
 */
export function hasUnicodeReplacements(text: string): boolean {
  return /\uFFFD/.test(text);
}

/**
 * Ensures a string is safe for JSON serialization and API transmission.
 * This handles various edge cases including:
 * - Unicode replacement characters
 * - Control characters
 * - Invalid surrogate pairs
 *
 * @param text The text to make safe
 * @returns The sanitized text
 */
export function ensureJsonSafe(text: string): string {
  // First, handle replacement characters
  let safe = sanitizeUnicodeReplacements(text);

  // Remove control characters except common ones (tab, newline, carriage return)
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Ensure valid UTF-16 surrogate pairs
  // This regex matches unpaired surrogates
  safe = safe.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '?',
  );

  return safe;
}

/**
 * Attempts to detect and fix common cp932 (Shift-JIS) decoding issues.
 * This is specifically for Windows Japanese locale users.
 *
 * @param text The text that may have cp932 encoding issues
 * @returns The cleaned text
 */
export function cleanCp932Artifacts(text: string): string {
  // Common cp932 decoding artifacts when incorrectly decoded as UTF-8
  const commonArtifacts: { [key: string]: string } = {
    '髮｢': '陰',
    邨ｱ: '結',
    繧ｳ: 'コ',
    繝ｼ: 'ー',
    '繝｡': 'メ',
    繝ｳ: 'ン',
    繝医: 'ト',
    // Add more common patterns as discovered
  };

  let cleaned = text;
  for (const [artifact, replacement] of Object.entries(commonArtifacts)) {
    cleaned = cleaned.replace(new RegExp(artifact, 'g'), replacement);
  }

  return cleaned;
}
