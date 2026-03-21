/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Edit helper functions for ast-edit tool.
 */

/**
 * Applies a replacement to file content.
 * This is the core replacement logic used by ASTEditTool.
 *
 * NOTE: This differs from edit.ts applyReplacement - they are intentionally separate.
 * edit.ts supports multiple occurrences and fuzzy matching; ast-edit.ts uses simple single-replace.
 * These are different domain behaviors and must NOT be unified.
 *
 * @param currentContent - The current file content (null if file doesn't exist)
 * @param oldString - The string to replace
 * @param newString - The replacement string
 * @param isNewFile - Whether this is a new file creation
 * @returns The modified content
 */
export function applyReplacement(
  currentContent: string | null,
  oldString: string,
  newString: string,
  isNewFile: boolean,
): string {
  if (isNewFile) {
    return newString;
  }
  if (currentContent === null) {
    return oldString === '' ? newString : '';
  }
  if (oldString === '' && !isNewFile) {
    return currentContent;
  }

  // For single replacement, use replace() instead of replaceAll()
  return currentContent.replace(oldString, newString);
}
