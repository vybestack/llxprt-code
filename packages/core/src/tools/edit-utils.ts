/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import { EmojiFilter } from '../filters/EmojiFilter.js';
import { ReadFileTool } from './read-file.js';
import { ToolErrorType } from './tool-error.js';
import type { EditToolParams } from './edit.js';
import { fuzzyReplace } from './fuzzy-replacer.js';

/**
 * Gets emoji filter instance based on configuration
 */
export function getEmojiFilter(config: Config): EmojiFilter {
  // Get emojifilter from ephemeral settings or default to 'auto'
  const mode = config.getEphemeralSetting('emojifilter') as
    | 'allowed'
    | 'auto'
    | 'warn'
    | 'error';

  // Map auto to warn for file operations (we want warnings when filtering files)
  let filterMode: 'allowed' | 'warn' | 'error';
  if (mode === 'allowed') {
    filterMode = 'allowed';
  } else if (mode === 'auto' || mode === 'warn') {
    filterMode = 'warn';
  } else {
    filterMode = 'error';
  }

  return new EmojiFilter({ mode: filterMode });
}

/**
 * Applies a replacement to content.
 */
export function applyReplacement(
  currentContent: string | null,
  oldString: string,
  newString: string,
  isNewFile: boolean,
  expectedReplacements: number = 1,
): string {
  if (isNewFile) {
    return newString;
  }
  if (currentContent === null) {
    // Should not happen if not a new file, but defensively return empty or newString if oldString is also empty
    return oldString === '' ? newString : '';
  }

  if (oldString === '' && expectedReplacements > 1) {
    throw new Error(
      'Cannot perform multiple replacements with empty old_string',
    );
  }

  if (oldString === '') {
    return currentContent;
  }

  const preserveTrailingNewline = currentContent.endsWith('\n');
  const fuzzyResult = fuzzyReplace(
    currentContent,
    oldString,
    newString,
    expectedReplacements > 1,
  );

  if (fuzzyResult && fuzzyResult.occurrences === expectedReplacements) {
    return preserveTrailingNewlineForResult(
      fuzzyResult.result,
      preserveTrailingNewline,
    );
  }

  const result =
    expectedReplacements === 1
      ? replaceSingleOccurrence(currentContent, oldString, newString)
      : replaceExpectedOccurrences(
          currentContent,
          oldString,
          newString,
          expectedReplacements,
        );
  return preserveTrailingNewlineForResult(result, preserveTrailingNewline);
}

function preserveTrailingNewlineForResult(
  result: string,
  preserveTrailingNewline: boolean,
): string {
  if (preserveTrailingNewline && result.length > 0 && !result.endsWith('\n')) {
    return `${result}\n`;
  }
  return result;
}

function replaceSingleOccurrence(
  currentContent: string,
  oldString: string,
  newString: string,
): string {
  // Use a replacer function so `$` in `newString` is treated literally.
  return currentContent.replace(oldString, () => newString);
}

function replaceExpectedOccurrences(
  currentContent: string,
  oldString: string,
  newString: string,
  expectedReplacements: number,
): string {
  let result = currentContent;
  let replacementCount = 0;
  let searchIndex = 0;

  while (replacementCount < expectedReplacements) {
    const foundIndex = result.indexOf(oldString, searchIndex);
    if (foundIndex === -1) {
      break;
    }

    result = replaceAtIndex(result, foundIndex, oldString, newString);
    replacementCount++;
    searchIndex = foundIndex + newString.length;
  }

  return result;
}

function replaceAtIndex(
  content: string,
  foundIndex: number,
  oldString: string,
  newString: string,
): string {
  return (
    content.substring(0, foundIndex) +
    newString +
    content.substring(foundIndex + oldString.length)
  );
}

/**
 * Error information for edit operations.
 */
export interface EditErrorInfo {
  display: string;
  raw: string;
  type: ToolErrorType;
}

/**
 * Builds the error object when zero occurrences are found.
 */
export function buildNoOccurrenceError(
  filteredParams: EditToolParams,
  currentContent: string | null,
  filePath: string,
): EditErrorInfo {
  const replaceLine = filteredParams.replaceBeginLineNumber;

  if (replaceLine !== undefined && replaceLine > 0 && currentContent !== null) {
    const lines = currentContent.split('\n');

    if (replaceLine > lines.length) {
      return {
        display: `Failed to edit: replaceBeginLineNumber is out of range.`,
        raw: `Failed to edit: replaceBeginLineNumber=${replaceLine} is out of range for ${filePath} (total lines: ${lines.length}). No edits made.`,
        type: ToolErrorType.INVALID_TOOL_PARAMS,
      };
    }

    const lineIndex = replaceLine - 1;
    const startContext = Math.max(0, lineIndex - 2);
    const endContext = Math.min(lines.length - 1, lineIndex + 2);

    let preview = 'Context around requested line:';
    for (let i = startContext; i <= endContext; i++) {
      const lineNumber = i + 1;
      const prefix = lineNumber === replaceLine ? '->' : '  ';
      preview += `\n${prefix} ${lineNumber.toString().padStart(4, ' ')} | ${lines[i]}`;
    }

    return {
      display: `Failed to edit: no occurrences of old_string found on the specified line ${replaceLine}.`,
      raw: `Failed to edit, 0 occurrences found for old_string on line ${replaceLine} in ${filePath}. No edits made. The exact text in old_string was not found on that line.\n\n${preview}`,
      type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
    };
  }

  return {
    display: `Failed to edit, could not find the string to replace.`,
    raw: `Failed to edit, 0 occurrences found for old_string in ${filePath}. No edits made. The exact text in old_string was not found. Ensure you're not escaping content incorrectly and check whitespace, indentation, and context. Use ${ReadFileTool.Name} tool to verify.`,
    type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
  };
}

/**
 * Validates the edit parameters after reading file content and builds the
 * appropriate error object if any validation fails.
 */
export function validateEditState(
  filteredParams: EditToolParams,
  currentContent: string | null,
  fileExists: boolean,
  filePath: string,
  occurrences: number,
  expectedReplacements: number,
  finalOldString: string,
  finalNewString: string,
): EditErrorInfo | undefined {
  if (filteredParams.old_string === '' && expectedReplacements > 1) {
    return {
      display: `Failed to edit. Cannot perform multiple replacements with empty old_string.`,
      raw: `Invalid parameters: empty old_string with expected_replacements=${expectedReplacements} would cause infinite loop`,
      type: ToolErrorType.INVALID_TOOL_PARAMS,
    };
  }
  if (filteredParams.old_string === '') {
    return {
      display: `Failed to edit. Attempted to create a file that already exists.`,
      raw: `File already exists, cannot create: ${filePath}`,
      type: ToolErrorType.ATTEMPT_TO_CREATE_EXISTING_FILE,
    };
  }
  if (occurrences === 0) {
    return buildNoOccurrenceError(filteredParams, currentContent, filePath);
  }
  if (occurrences !== expectedReplacements) {
    const occurrenceTerm =
      expectedReplacements === 1 ? 'occurrence' : 'occurrences';
    return {
      display: `Failed to edit, expected ${expectedReplacements} ${occurrenceTerm} but found ${occurrences}.`,
      raw: `Failed to edit, Expected ${expectedReplacements} ${occurrenceTerm} but found ${occurrences} for old_string in file: ${filePath}`,
      type: ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
    };
  }
  if (finalOldString === finalNewString) {
    return {
      display: `No changes to apply. The old_string and new_string are identical.`,
      raw: `No changes to apply. The old_string and new_string are identical in file: ${filePath}`,
      type: ToolErrorType.EDIT_NO_CHANGE,
    };
  }
  return undefined;
}
