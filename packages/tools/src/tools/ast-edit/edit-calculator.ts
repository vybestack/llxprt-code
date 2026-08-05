/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Edit calculation logic for ast-edit tool.
 * Contains calculateEdit, validation, and helper functions.
 */

import { promises as fsPromises } from 'fs';
import * as path from 'path';
import type { IToolHost } from '../../interfaces/index.js';
import type { ASTEditToolParams } from './types.js';
import { ToolErrorType } from '../../types/tool-error.js';
import { isNodeError } from '../../utils/errors.js';
import { parse, LANGUAGE_MAP } from '../../utils/ast-grep-utils.js';
import { applyReplacement } from './edit-helpers.js';
import {
  findEditStartLine,
  type AstValidationResult,
  type AstDiagnostic,
} from './validation-categorizer.js';

/**
 * Optional edit region used to refine whole-file tree-sitter recovery
 * locations so they point at the edited area instead of line 1.
 */
export interface EditRegion {
  startLine: number;
}

/**
 * Result of edit calculation, including validation and freshness checks.
 */
export interface CalculatedEdit {
  currentContent: string | null;
  newContent: string;
  occurrences: number;
  error?: { display: string; raw: string; type: ToolErrorType };
  isNewFile: boolean;
  astValidation?: AstValidationResult;
  preEditValidation?: AstValidationResult;
  fileFreshness?: number | null;
}

/**
 * Calculates the edit to be applied, including validation and freshness checks.
 *
 * @param params - Edit parameters
 * @param host - Tool host interface
 * @param _abortSignal - Abort signal (currently unused)
 * @returns Calculated edit result with validation info
 */
export async function calculateEdit(
  params: ASTEditToolParams,
  host: IToolHost,
  _abortSignal: AbortSignal,
): Promise<CalculatedEdit> {
  // Normalize all string parameters to LF for consistent matching
  const normalizedOldString = params.old_string.replace(/\r\n/g, '\n');
  const normalizedNewString = params.new_string.replace(/\r\n/g, '\n');

  const { currentContent, fileExists } = await readFileState(params, host);

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

  // Validate the original (pre-edit) content so post-edit errors can be
  // categorized as pre-existing vs newly-introduced (issue #2124).
  // Skipped for new files where there is no prior content to baseline.
  const preEditValidation =
    !noChangeError && currentContent !== null
      ? validateASTSyntax(params.file_path, currentContent)
      : undefined;

  let astValidation: AstValidationResult | undefined;
  if (!noChangeError) {
    // Refine whole-file recovery locations using the edited region.
    const editRegion = buildEditRegion(currentContent, normalizedOldString);
    astValidation = validateASTSyntax(params.file_path, newContent, editRegion);
  }

  return {
    currentContent,
    newContent,
    occurrences,
    error: noChangeError,
    isNewFile,
    astValidation,
    preEditValidation,
    fileFreshness: currentMtime,
  };
}

async function readFileState(
  params: ASTEditToolParams,
  host: IToolHost,
): Promise<{ currentContent: string | null; fileExists: boolean }> {
  let currentContent: string | null = null;
  let fileExists = false;

  try {
    const fileSystemService = host.getFileSystemService?.() as
      | { readTextFile?: (filePath: string) => Promise<string> }
      | undefined;
    currentContent = fileSystemService?.readTextFile
      ? await fileSystemService.readTextFile(params.file_path)
      : await fsPromises.readFile(params.file_path, 'utf-8');
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

function isFileStale(
  params: ASTEditToolParams,
  fileExists: boolean,
  currentMtime: number | null,
): boolean {
  if (params.last_modified == null) {
    return false;
  }
  if (fileExists && currentMtime == null) {
    return true;
  }
  return currentMtime != null && currentMtime > params.last_modified;
}

function checkFreshness(
  params: ASTEditToolParams,
  currentMtime: number | null,
  fileExists: boolean,
  currentContent: string | null,
): CalculatedEdit | undefined {
  if (isFileStale(params, fileExists, currentMtime)) {
    return {
      currentContent,
      newContent: currentContent ?? '',
      occurrences: 0,
      error: {
        display: `File has been modified since it was last read (expected last_modified ${params.last_modified}, current mtime ${currentMtime}). Re-read the file then retry.`,
        raw: `FILE_MODIFIED_CONFLICT: ${params.file_path} was modified since it was last read. Expected last_modified ${params.last_modified}, but the current mtime is ${currentMtime}. Re-read the file then retry.`,
        type: ToolErrorType.FILE_MODIFIED_CONFLICT,
      },
      isNewFile: false,
      astValidation: undefined,
      preEditValidation: undefined,
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
    } else if (occurrences > 1) {
      error = {
        display: `old_string appears ${occurrences} times. Include more surrounding context to target a specific occurrence.`,
        raw: `old_string appears ${occurrences} times in ${params.file_path}. Provide more surrounding context to disambiguate.`,
        type: ToolErrorType.EDIT_EXPECTED_OCCURRENCE_MISMATCH,
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
 * Derives the edited region's start line so whole-file tree-sitter recovery
 * can report a useful location. Returns undefined for new files or when the
 * edit position cannot be determined.
 */
function buildEditRegion(
  currentContent: string | null,
  oldString: string,
): EditRegion | undefined {
  if (!currentContent || !oldString) return undefined;
  const startLine = findEditStartLine(currentContent, oldString);
  return startLine === null ? undefined : { startLine };
}

/**
 * Returns the true number of occurrences of searchString in content.
 *
 * @param content - File content
 * @param searchString - String to search for
 * @returns Number of occurrences (0 if not found)
 */
export function countOccurrences(
  content: string,
  searchString: string,
): number {
  if (!searchString) return 0;

  let count = 0;
  let idx = content.indexOf(searchString);
  while (idx !== -1) {
    count++;
    idx = content.indexOf(searchString, idx + searchString.length);
  }
  return count;
}

/**
 * Validates AST syntax for the given file path and content.
 * Inspects the tree-sitter parse tree for ERROR nodes and zero-width
 * phantom nodes (MISSING tokens inserted by error recovery) rather than
 * relying on thrown exceptions (tree-sitter is error-recovering and
 * never throws on syntax errors).
 *
 * Collects EVERY relevant diagnostic in stable source order (not only the
 * first ERROR node) so a pre-existing early error cannot mask a newly
 * introduced later error. Descends through ERROR nodes to retain both enclosing
 * recovery identity and more precise nested diagnostics, then deduplicates true
 * equivalents.
 *
 * @param filePath - File path (used to detect language)
 * @param content - File content to validate
 * @param editRegion - When provided, whole-file recovery ERROR nodes are
 *   re-attributed to the edited region instead of the misleading line 1.
 * @returns Validation result; `supported` is false for unsupported extensions.
 */
export function validateASTSyntax(
  filePath: string,
  content: string,
  editRegion?: EditRegion,
): AstValidationResult {
  const extension = path.extname(filePath).substring(1).toLowerCase();
  const lang = LANGUAGE_MAP[extension];
  if (!lang) {
    return { valid: true, errors: [], supported: false };
  }

  try {
    const root = parse(lang, content).root();
    const diagnostics = collectDiagnostics(root, content, editRegion);
    if (diagnostics.length === 0) {
      return { valid: true, errors: [], supported: true, diagnostics };
    }
    return {
      valid: false,
      errors: diagnostics.map((d) => d.message),
      supported: true,
      diagnostics,
    };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      supported: true,
    };
  }
}

/**
 * Builds a single diagnostic from a raw parser range, preserving the raw
 * coordinates and whole-file-recovery identity while refining only the display
 * location to the edited region.
 */
function toDiagnostic(
  range: { start: { line: number; column: number }; end: { line: number } },
  editRegion: EditRegion | undefined,
): AstDiagnostic {
  const line = range.start.line;
  const column = range.start.column;
  const endLine = range.end.line;
  const wholeFileRecovery = line === 0 && column === 0 && endLine > line;
  let message: string;
  if (wholeFileRecovery && editRegion && editRegion.startLine > 1) {
    message = `Syntax error near line ${editRegion.startLine} (whole-file recovery; location approximate)`;
  } else if (wholeFileRecovery) {
    message = `Syntax error at line ${line + 1}, column ${column + 1} (whole-file recovery)`;
  } else {
    message = `Syntax error at line ${line + 1}, column ${column + 1}`;
  }
  return { line, column, endLine, wholeFileRecovery, message };
}

/**
 * Collects every ERROR/MISSING diagnostic by walking the parse tree in source
 * order, descending through ERROR nodes to find more specific nested
 * diagnostics. Every relevant diagnostic is retained so the classification
 * can compare the whole-file recovery identity AND any nested precise
 * locations — suppressing an enclosing recovery when a child exists would
 * lose damage that the child does not capture. True equivalents (identical
 * span) are deduplicated, preserving stable source order.
 */
function collectDiagnostics(
  root: ReturnType<ReturnType<typeof parse>['root']>,
  content: string,
  editRegion: EditRegion | undefined,
): AstDiagnostic[] {
  const collected: AstDiagnostic[] = [];
  const visit = (node: typeof root): void => {
    const kind = node.kind();
    const range = node.range();
    const isZeroWidthMissing =
      content.length > 0 &&
      range.start.index === range.end.index &&
      node.isLeaf();
    if (kind === 'ERROR' || isZeroWidthMissing) {
      collected.push(toDiagnostic(range, editRegion));
      // Continue descending into ERROR nodes to find more specific nested
      // diagnostics — the enclosing recovery must not mask distinct damage.
    }
    for (const child of node.children()) {
      visit(child);
    }
  };
  visit(root);

  // Deduplicate true equivalents (identical span) preserving source order.
  const seen = new Set<string>();
  const result: AstDiagnostic[] = [];
  for (const d of collected) {
    const key = `${d.line}:${d.column}:${d.endLine}:${d.wholeFileRecovery}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(d);
    }
  }
  return result;
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
