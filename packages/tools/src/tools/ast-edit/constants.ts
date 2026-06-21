/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ===== Code Keywords =====
/**
 * Code keywords used for pattern matching and analysis.
 */
export const KEYWORDS = {
  FUNCTION: 'function',
  DEF: 'def',
  CLASS: 'class',
  IF: 'if',
  FOR: 'for',
  WHILE: 'while',
  RETURN: 'return',
  IMPORT: 'import ',
  FROM: 'from ',
} as const;

// ===== Comment Patterns =====
/**
 * Comment prefixes for various languages.
 */
export const COMMENT_PREFIXES = ['//', '#', '*', '/*', '*/'];

// ===== Regex Patterns =====
/**
 * Regex patterns for code analysis.
 * (IMPORT_MODULE parsing moved to string-scanning in language-analysis.ts
 *  to avoid regex backtracking risks.)
 */
export const REGEX = {} as const;

// Re-export shared language mapping from utils
export {
  LANGUAGE_MAP,
  JAVASCRIPT_FAMILY_EXTENSIONS,
} from '../../utils/ast-grep-utils.js';
