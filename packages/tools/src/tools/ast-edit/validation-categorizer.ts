/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Categorizes AST validation results into pre-existing vs newly-introduced
 * errors by comparing the pre-edit and post-edit parse trees.
 *
 * Background (issue #2124): tree-sitter is error-recovering and will report
 * ERROR/MISSING nodes for any pre-existing syntax weirdness in a file. Without
 * a baseline, every post-edit validation failure looks like the edit's fault,
 * causing the LLM to either blindly force the edit or abandon it for a less
 * capable tool. Comparing against the pre-edit baseline lets us tell the LLM
 * whether the failure was already there.
 */

export type AstValidationResult = { valid: boolean; errors: string[] };

export interface AstValidationSummary {
  /** Post-edit validation status. */
  status: 'PASSED' | 'FAILED' | 'SKIPPED';
  /** True when the post-edit error(s) also existed in the pre-edit content. */
  preExisting: boolean;
  /** True when the edit likely introduced an error that did not exist before. */
  newlyIntroduced: boolean;
  /** One-line label suitable for LLM-facing output. */
  label: string;
}

/** Tolerance (in lines) for matching pre/post error locations after a shift. */
const LINE_MATCH_TOLERANCE = 3;

/**
 * Extracts the leading line number from a validation error message such as
 * "Syntax error at line 173, column 5". Returns null when no line is found.
 */
export function extractErrorLineNumber(error: string): number | null {
  const match = /line (\d+)/i.exec(error);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Finds the 1-based line number where an edit begins in the original content.
 * Returns null when the position cannot be determined (e.g. new file).
 */
export function findEditStartLine(
  content: string | null,
  oldString: string,
): number | null {
  if (!content || !oldString) return null;
  const idx = content.indexOf(oldString);
  if (idx === -1) return null;
  return content.substring(0, idx).split('\n').length;
}

/**
 * Counts the number of lines in a string, treating a single trailing newline
 * as a line terminator (not an extra empty line) so that "abc\n" counts as 1
 * line, matching "abc".
 */
function countLines(s: string | undefined): number {
  if (!s) return 0;
  return s.replace(/\n$/, '').split('\n').length;
}

/**
 * Computes the net line delta an edit introduces. A positive value means the
 * edit added lines (shifting errors below it downward); negative means removed.
 */
export function computeLineDelta(
  oldString: string | undefined,
  newString: string | undefined,
): number {
  return countLines(newString) - countLines(oldString);
}

/**
 * Determines whether a pre-edit error line and a post-edit error line refer to
 * the same location, accounting for line shifts caused by the edit.
 *
 * When the edit's start line is known, errors at or below the edit must have
 * shifted by `lineDelta`, while errors above it did not shift — this avoids the
 * false positive of matching a newly-introduced error to a pre-existing one
 * simply because they happen to be within tolerance without the shift.
 *
 * When the edit position is unknown, the two cases are made mutually exclusive
 * based on whether `lineDelta` is zero, which is the safest fallback.
 */
function linesMatch(
  preLine: number,
  postLine: number,
  lineDelta: number,
  editStartLine: number | null,
): boolean {
  if (editStartLine !== null) {
    // Whether the PRE-EDIT error was at/below the edit determines whether it
    // shifted. Checking postLine instead causes false positives: a new error
    // below the edit can numerically align with a shifted pre-edit error that
    // was actually above the edit and never moved.
    if (preLine >= editStartLine) {
      // Error was at/below edit start → shifted by lineDelta.
      return Math.abs(preLine + lineDelta - postLine) <= LINE_MATCH_TOLERANCE;
    }
    // Error was above edit start → did not shift.
    return Math.abs(preLine - postLine) <= LINE_MATCH_TOLERANCE;
  }

  // Fallback: pick the correct case based on whether the edit changed line count.
  if (lineDelta === 0) {
    return Math.abs(preLine - postLine) <= LINE_MATCH_TOLERANCE;
  }
  return Math.abs(preLine - (postLine - lineDelta)) <= LINE_MATCH_TOLERANCE;
}

/**
 * Categorizes post-edit AST validation results relative to the pre-edit
 * baseline so the LLM understands whether failures are its fault.
 *
 * @param preEdit - Validation result of the original file content.
 * @param postEdit - Validation result of the edited file content.
 * @param lineDelta - Net lines added/removed by the edit (for shift matching).
 * @param editStartLine - 1-based line where the edit begins (for precise matching).
 */
export function summarizeAstValidation(
  preEdit: AstValidationResult | undefined,
  postEdit: AstValidationResult | undefined,
  lineDelta = 0,
  editStartLine: number | null = null,
): AstValidationSummary {
  if (!postEdit) {
    return {
      status: 'SKIPPED',
      preExisting: false,
      newlyIntroduced: false,
      label: 'SKIPPED (validation not performed)',
    };
  }

  // Post-edit is valid.
  if (postEdit.valid) {
    if (preEdit && !preEdit.valid) {
      return {
        status: 'PASSED',
        preExisting: false,
        newlyIntroduced: false,
        label: `PASSED (edit may have resolved pre-existing error${formatLineLabel(preEdit.errors)})`,
      };
    }
    return {
      status: 'PASSED',
      preExisting: false,
      newlyIntroduced: false,
      label: 'PASSED',
    };
  }

  // Post-edit is invalid.
  const postErrors = postEdit.errors;
  const preHadErrors = preEdit !== undefined && !preEdit.valid;

  // Pre-edit was clean (or no baseline / new file) → the edit introduced the error.
  if (!preHadErrors) {
    return {
      status: 'FAILED',
      preExisting: false,
      newlyIntroduced: true,
      label: `FAILED (new error introduced by this edit${formatLineLabel(postErrors)})`,
    };
  }

  // Both pre- and post-edit are invalid. Determine whether every post-edit
  // error corresponds to the same location as a pre-edit one. Iterate over the
  // raw error strings (not just those with parseable line numbers) so that
  // unparseable post-edit errors are conservatively treated as unmatched
  // rather than silently dropped.
  const preLines = extractErrorLineNumbers(preEdit.errors);
  let allMatched = postErrors.length > 0;
  for (const postErr of postErrors) {
    const postLine = extractErrorLineNumber(postErr);
    if (
      postLine === null ||
      !preLines.some((prel) =>
        linesMatch(prel, postLine, lineDelta, editStartLine),
      )
    ) {
      allMatched = false;
      break;
    }
  }

  if (allMatched) {
    return {
      status: 'FAILED',
      preExisting: true,
      newlyIntroduced: false,
      label: `FAILED (pre-existing error${formatLineLabel(postErrors)} — present before this edit)`,
    };
  }

  // File was already broken, but the post-edit errors don't line up with the
  // pre-existing ones. They may be cascading from the same root cause or newly
  // introduced; surface both for the LLM to judge.
  return {
    status: 'FAILED',
    preExisting: true,
    newlyIntroduced: true,
    label: `FAILED (file had pre-existing errors${formatLineLabel(preEdit.errors)}; verify post-edit error${formatLineLabel(postErrors)} is not newly introduced)`,
  };
}

function extractErrorLineNumbers(errors: string[]): number[] {
  const lines: number[] = [];
  for (const err of errors) {
    const line = extractErrorLineNumber(err);
    if (line !== null) lines.push(line);
  }
  return lines;
}

export function formatValidationLineLabel(errors: string[]): string {
  const lines = extractErrorLineNumbers(errors);
  if (lines.length === 0) return '';
  return ` at line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}`;
}

function formatLineLabel(errors: string[]): string {
  return formatValidationLineLabel(errors);
}
