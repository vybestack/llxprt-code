/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Edit calculation logic for ast-edit tool.
 * Contains calculateEdit, validation, and helper functions.
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { parse } from '@ast-grep/napi';
import type { Config } from '../../config/config.js';
import type { ASTEditToolParams } from './types.js';
import { ToolErrorType } from '../tool-error.js';
import { isNodeError } from '../../utils/errors.js';
import { LANGUAGE_MAP } from '../../utils/ast-grep-utils.js';
import { applyReplacement } from './edit-helpers.js';

/**
 * Result of edit calculation, including validation and freshness checks.
 */
export interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  occurrences: number;
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
  astValidation?: { valid: boolean; errors: string[] };
  fileFreshness?: number | null;
}

/**
 * Calculates the edit to be applied, including validation and freshness checks.
 *
 * @param params - Edit parameters
 * @param config - Configuration object
 * @param _abortSignal - Abort signal (currently unused)
 * @returns Calculated edit result with validation info
 */
export async function calculateEdit(
  params: ASTEditToolParams,
  config: Config,
  _abortSignal: AbortSignal,
): Promise<CalculatedEdit> {
  // Normalize all string parameters to LF for consistent matching
  const normalizedOldString = params.old_string.replace(/\r\n/g, '\n');
  const normalizedNewString = params.new_string.replace(/\r\n/g, '\n');

  const { currentContent, fileExists } = await readFileState(params, config);

  // Freshness Check (moved before old_string validation to ensure it runs first)
  const currentMtime = await getFileLastModified(params.file_path);

  const freshnessError = checkFreshness(
    params,
    currentMtime,
    fileExists,
    currentContent,
  );
  if (freshnessError) {
    return freshnessError;
  }

  const { occurrences, error, isNewFile } = validateEditParams(
    params,
    currentContent,
    fileExists,
    normalizedOldString,
    normalizedNewString,
  );

  const newContent = !error
    ? applyReplacement(
        currentContent,
        normalizedOldString,
        normalizedNewString,
        isNewFile,
      )
    : (currentContent ?? '');

  const noChangeError = checkNoChange(
    error,
    fileExists,
    currentContent,
    newContent,
    params.file_path,
  );

  let astValidation: { valid: boolean; errors: string[] } | undefined;
  if (!noChangeError) {
    astValidation = validateASTSyntax(params.file_path, newContent);
  }

  return {
    currentContent,
    newContent,
    occurrences,
    error: noChangeError,
    isNewFile,
    astValidation,
    fileFreshness: currentMtime,
  };
}

async function readFileState(
  params: ASTEditToolParams,
  config: Config,
): Promise<{ currentContent: string | null; fileExists: boolean }> {
  let currentContent: string | null = null;
  let fileExists = false;

  try {
    currentContent = await config
      .getFileSystemService()
      .readTextFile(params.file_path);
    currentContent = currentContent.replace(/\r\n/g, '\n');
    fileExists = true;
  } catch (err: unknown) {
    if (!isNodeError(err) || err.code !== 'ENOENT') {
      throw err;
    }
    fileExists = false;
  }

  return { currentContent, fileExists };
}

function checkFreshness(
  params: ASTEditToolParams,
  currentMtime: number | null,
  fileExists: boolean,
  currentContent: string | null,
): CalculatedEdit | undefined {
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    params.last_modified != null &&
    ((fileExists && currentMtime == null) ||
      (currentMtime != null && currentMtime > params.last_modified))
  ) {
    return {
      currentContent,
      newContent: currentContent ?? '',
      occurrences: 0,
      error: {
        display: `File has been modified since it was last read. Please read the file again to get the latest content.`,
        raw: JSON.stringify({
          message: `File ${params.file_path} mismatch. Expected mtime <= ${params.last_modified}, but found ${currentMtime}.`,
          current_mtime: currentMtime,
          your_mtime: params.last_modified,
        }),
        type: ToolErrorType.FILE_MODIFIED_CONFLICT,
      },
      isNewFile: false,
      astValidation: undefined,
      fileFreshness: currentMtime,
    };
  }
  return undefined;
}

function validateEditParams(
  params: ASTEditToolParams,
  currentContent: string | null,
  fileExists: boolean,
  normalizedOldString: string,
  normalizedNewString: string,
): {
  occurrences: number;
  error: { display: string; raw: string; type: ToolErrorType } | undefined;
  isNewFile: boolean;
} {
  let occurrences = 0;
  let error: { display: string; raw: string; type: ToolErrorType } | undefined =
    undefined;
  let isNewFile = false;

  if (params.old_string === '' && !fileExists) {
    isNewFile = true;
  } else if (!fileExists) {
    error = {
      display: `File not found. Cannot apply edit. Use an empty old_string to create a new file.`,
      raw: `File not found: ${params.file_path}`,
      type: ToolErrorType.FILE_NOT_FOUND,
    };
  } else if (currentContent !== null) {
    occurrences = countOccurrences(currentContent, normalizedOldString);

    if (occurrences === 0) {
      error = {
        display: `Failed to edit, could not find string to replace.`,
        raw: `Failed to edit, 0 occurrences found for old_string in ${params.file_path}. No edits made.`,
        type: ToolErrorType.EDIT_NO_OCCURRENCE_FOUND,
      };
    } else if (normalizedOldString === normalizedNewString) {
      error = {
        display: `No changes to apply. The old_string and new_string are identical.`,
        raw: `No changes to apply. The old_string and new_string are identical in file: ${params.file_path}`,
        type: ToolErrorType.EDIT_NO_CHANGE,
      };
    }
  }

  return { occurrences, error, isNewFile };
}

function checkNoChange(
  error: { display: string; raw: string; type: ToolErrorType } | undefined,
  fileExists: boolean,
  currentContent: string | null,
  newContent: string,
  filePath: string,
): { display: string; raw: string; type: ToolErrorType } | undefined {
  if (!error && fileExists && currentContent === newContent) {
    return {
      display:
        'No changes to apply. The new content is identical to the current content.',
      raw: `No changes to apply. The new content is identical to the current content in file: ${filePath}`,
      type: ToolErrorType.EDIT_NO_CHANGE,
    };
  }
  return error;
}

/**
 * Counts occurrences that will be replaced (0 or 1).
 * Returns 0/1 not true count, aligned with String.replace() single-replacement semantics.
 *
 * @param content - File content
 * @param searchString - String to search for
 * @returns 0 if not found, 1 if found
 */
export function countOccurrences(
  content: string,
  searchString: string,
): number {
  if (!searchString) return 0;

  // Since applyReplacement uses String.replace (single replacement),
  // count occurrences that will actually be replaced (0 or 1)
  return content.includes(searchString) ? 1 : 0;
}

/**
 * Validates AST syntax for the given file path and content.
 * Inspects the tree-sitter parse tree for ERROR nodes and zero-width
 * phantom nodes (MISSING tokens inserted by error recovery) rather than
 * relying on thrown exceptions (tree-sitter is error-recovering and
 * never throws on syntax errors).
 *
 * @param filePath - File path (used to detect language)
 * @param content - File content to validate
 * @returns Validation result
 */
export function validateASTSyntax(
  filePath: string,
  content: string,
): { valid: boolean; errors: string[] } {
  const extension = path.extname(filePath).substring(1).toLowerCase();
  const lang = LANGUAGE_MAP[extension];
  if (!lang) {
    return { valid: true, errors: [] };
  }

  try {
    const tree = parse(lang, content);
    const root = tree.root();

    // Check for explicit ERROR nodes (garbled/unparseable tokens)
    const errorNode = root.find({ rule: { kind: 'ERROR' } });
    if (errorNode) {
      const pos = errorNode.range().start;
      return {
        valid: false,
        errors: [
          `Syntax error at line ${pos.line + 1}, column ${pos.column + 1}`,
        ],
      };
    }

    // Check for zero-width phantom nodes (MISSING tokens from error recovery).
    // Tree-sitter inserts these when expected delimiters are absent (e.g., missing }).
    // ast-grep doesn't expose isMissing() or kind:'MISSING', but zero-width leaf
    // nodes in non-empty content reliably indicate recovered syntax errors.
    if (content.length > 0) {
      const missingNode = findZeroWidthNode(root);
      if (missingNode) {
        return {
          valid: false,
          errors: [
            `Syntax error at line ${missingNode.line + 1}, column ${missingNode.column + 1}`,
          ],
        };
      }
    }

    return { valid: true, errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Walks the parse tree to find zero-width leaf nodes, which indicate
 * MISSING tokens inserted by tree-sitter's error recovery (e.g., a phantom
 * closing brace). Skips the root node to avoid false positives on empty content.
 */
function findZeroWidthNode(
  node: ReturnType<ReturnType<typeof parse>['root']>,
): { line: number; column: number } | null {
  for (const child of node.children()) {
    const range = child.range();
    if (range.start.index === range.end.index && child.isLeaf()) {
      return { line: range.start.line, column: range.start.column };
    }
    const found = findZeroWidthNode(child);
    if (found) return found;
  }
  return null;
}

/**
 * Gets the last modified timestamp of a file.
 * Returns null if file doesn't exist.
 *
 * @param filePath - Path to the file
 * @returns Timestamp in milliseconds or null
 */
export async function getFileLastModified(
  filePath: string,
): Promise<number | null> {
  try {
    const stats = await fsPromises.stat(filePath);
    return stats.mtime.getTime();
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
