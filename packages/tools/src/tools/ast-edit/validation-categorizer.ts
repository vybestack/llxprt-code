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

export type AstValidationResult = {
  valid: boolean;
  errors: string[];
  /**
   * False when the file extension has no supported AST language, so the
   * content was never parsed. Undefined preserves backward compatibility for
   * callers that only know {valid, errors}.
   */
  supported?: boolean;
  /**
   * Structured parser diagnostics in stable source order. Carries the raw
   * parser identity/range and whole-file-recovery flag so classification can
   * compare every diagnostic (not only the first) and prove equivalence.
   * Undefined for callers that only supply display strings.
   */
  diagnostics?: AstDiagnostic[];
};

/**
 * One parser diagnostic with its raw parser coordinates preserved for
 * classification, separate from the (possibly edit-region-refined) display
 * message.
 */
export interface AstDiagnostic {
  /** 0-based start line from the parser (raw, unrefined). */
  readonly line: number;
  /** 0-based start column from the parser (raw, unrefined). */
  readonly column: number;
  /** 0-based end line; used to detect whole-file recovery spans. */
  readonly endLine: number;
  /**
   * 0-based end column from the parser. Optional for backward compatibility
   * with structured fixtures that predate it; the parser always supplies it,
   * and whole-file-recovery span identity requires it.
   */
  readonly endColumn?: number;
  /** True when this is a whole-file tree-sitter recovery node (1:1, spans lines). */
  readonly wholeFileRecovery: boolean;
  /** Human-readable message (display location refined to the edit region when applicable). */
  readonly message: string;
}

/**
 * Mapping from original to candidate content with explicit unchanged prefix
 * and suffix line boundaries and a single conservative changed middle region.
 *
 * A pre/post precise diagnostic may match only if it maps through the unchanged
 * prefix (same line) or the unchanged suffix (line shifted by `lineDelta`).
 * Diagnostics in the changed middle cannot be proven equivalent and must fail
 * closed. This is used for model content and IDE-diverged content alike.
 */
export interface CandidateMapping {
  /** Number of unchanged leading lines (1-based lines 1..prefixLines). */
  readonly prefixLines: number;
  /** Number of unchanged trailing lines. */
  readonly suffixLines: number;
  /** Total lines in the original content. */
  readonly origLineCount: number;
  /** Net line delta (candidate line count minus original line count). */
  readonly lineDelta: number;
}

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

/** Sentinel mapping representing a no-change edit (entire file is prefix). */
const NO_CHANGE_MAPPING: CandidateMapping = {
  prefixLines: Number.MAX_SAFE_INTEGER,
  suffixLines: 0,
  origLineCount: Number.MAX_SAFE_INTEGER,
  lineDelta: 0,
};

/**
 * Extracts the leading line number from a validation error message such as
 * "Syntax error at line 173, column 5". Returns null when no line is found.
 */
export function extractErrorLineNumber(error: string): number | null {
  const match = /line (\d+)/i.exec(error);
  return match ? parseInt(match[1], 10) : null;
}

interface ErrorLocation {
  line: number;
  column: number;
}

function extractErrorLocation(error: string): ErrorLocation | null {
  const match = /line (\d+), column (\d+)/i.exec(error);
  if (!match) return null;
  return {
    line: parseInt(match[1], 10),
    column: parseInt(match[2], 10),
  };
}

/**
 * Finds the 1-based line number where an edit begins in the original content.
 * Returns null when the position cannot be determined (e.g. new file) or when
 * oldString appears more than once (ambiguous — indexOf would return the first
 * match, but the actual edit could target a different occurrence, making the
 * computed line unreliable for shift matching).
 */
export function findEditStartLine(
  content: string | null,
  oldString: string,
): number | null {
  if (!content || !oldString) return null;
  const firstIdx = content.indexOf(oldString);
  if (firstIdx === -1) return null;
  // Ambiguous: oldString appears more than once, so we cannot reliably
  // determine which occurrence the edit targets. Return null to fall back
  // to the less precise (but safe) lineDelta-based matching.
  if (content.indexOf(oldString, firstIdx + 1) !== -1) return null;
  return content.substring(0, firstIdx).split('\n').length;
}

/** Counts newline delimiters, which determine shifts below an edit. */
function countLineBreaks(s: string | undefined): number {
  if (!s) return 0;
  return s.split('\n').length - 1;
}

/**
 * Computes the net line delta an edit introduces. A positive value means the
 * edit added lines (shifting errors below it downward); negative means removed.
 */
export function computeLineDelta(
  oldString: string | undefined,
  newString: string | undefined,
): number {
  return countLineBreaks(newString) - countLineBreaks(oldString);
}

/**
 * Derives the candidate mapping from the ACTUAL original-to-candidate content
 * diff, with explicit unchanged prefix and suffix boundaries. Used to classify
 * both model content and IDE-accepted content that diverges from the model
 * replacement. A diagnostic may match only through the unchanged prefix or
 * unchanged suffix; diagnostics in the changed middle fail closed.
 *
 * Multi-hunk edits conservatively treat the span between the first and last
 * changed line as the changed middle (even if some lines inside are
 * unchanged). Returns a no-change mapping when candidate equals original or
 * when original is null (new file).
 */
export function deriveCandidateMapping(
  original: string | null,
  candidate: string,
): CandidateMapping {
  if (original === null) {
    return { ...NO_CHANGE_MAPPING };
  }
  if (original === candidate) {
    const origLineCount = original.split('\n').length;
    return {
      prefixLines: origLineCount,
      suffixLines: 0,
      origLineCount,
      lineDelta: 0,
    };
  }
  const origLines = original.split('\n');
  const candLines = candidate.split('\n');
  const origLineCount = origLines.length;
  const lineDelta = candLines.length - origLineCount;
  // Longest common line prefix → first changed line (1-based).
  const minLen = Math.min(origLines.length, candLines.length);
  let prefix = 0;
  while (prefix < minLen && origLines[prefix] === candLines[prefix]) {
    prefix++;
  }
  // Longest common line suffix that does not overlap the prefix.
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    origLines[origLines.length - 1 - suffix] ===
      candLines[candLines.length - 1 - suffix]
  ) {
    suffix++;
  }
  return { prefixLines: prefix, suffixLines: suffix, origLineCount, lineDelta };
}

/**
 * Determines whether a pre-edit error line and a post-edit error line refer to
 * the same location, using the candidate mapping's unchanged prefix/suffix
 * boundaries.
 *
 * A diagnostic in the unchanged prefix (1-based lines 1..prefixLines) maps to
 * the same line. A diagnostic in the unchanged suffix maps with a lineDelta
 * shift. A diagnostic in the changed middle CANNOT be proven equivalent and
 * must fail closed — this prevents accepting a different new error at the
 * same/shifted coordinate inside replaced content. The validator emits
 * deterministic line and column coordinates, so both must match exactly after
 * applying the known line shift.
 */
function locationsMatch(
  pre: ErrorLocation,
  post: ErrorLocation,
  mapping: CandidateMapping,
): boolean {
  if (pre.column !== post.column) return false;

  const { prefixLines, suffixLines, origLineCount, lineDelta } = mapping;

  // Unchanged prefix: diagnostic did not shift.
  if (pre.line <= prefixLines) {
    return pre.line === post.line;
  }

  // Unchanged suffix: diagnostic shifted by lineDelta.
  const suffixStartOrig = origLineCount - suffixLines; // 0-based line where suffix begins
  if (suffixLines > 0 && pre.line > suffixStartOrig) {
    return pre.line + lineDelta === post.line;
  }

  // Changed middle: cannot prove equivalence → fail closed.
  return false;
}

/**
 * A diagnostic normalized for classification: whole-file recoveries carry no
 * reliable start coordinates (line/column null) but DO carry their raw end span
 * (end line AND end column) for identity, precise diagnostics carry their
 * 1-based parser coordinates. Derived from structured diagnostics when present,
 * otherwise from display strings (backward compatibility — endLine is 0 and
 * endColumn is undefined when unknown).
 */
interface NormalizedDiagnostic {
  wholeFileRecovery: boolean;
  line: number | null;
  column: number | null;
  /** Raw 0-based end line from the parser; 0 when unavailable (string-only). */
  endLine: number;
  /** Raw 0-based end column; undefined when unavailable (string-only caller). */
  endColumn: number | undefined;
  message: string;
}

/**
 * Normalizes an AstValidationResult into classification-ready diagnostics.
 * Prefers structured diagnostics (which preserve raw parser identity) and
 * falls back to display-string parsing for callers that supply only strings.
 */
function toNormalized(result: AstValidationResult): NormalizedDiagnostic[] {
  if (result.diagnostics && result.diagnostics.length > 0) {
    return result.diagnostics.map((d) => ({
      wholeFileRecovery: d.wholeFileRecovery,
      line: d.wholeFileRecovery ? null : d.line + 1,
      column: d.wholeFileRecovery ? null : d.column,
      endLine: d.endLine,
      endColumn: d.endColumn,
      message: d.message,
    }));
  }
  return result.errors.map((err) => {
    const wholeFileRecovery = err.includes('whole-file recovery');
    if (wholeFileRecovery) {
      return {
        wholeFileRecovery,
        line: null,
        column: null,
        endLine: 0,
        endColumn: undefined,
        message: err,
      };
    }
    const loc = extractErrorLocation(err);
    return {
      wholeFileRecovery,
      line: loc?.line ?? null,
      column: loc?.column ?? null,
      endLine: 0,
      endColumn: undefined,
      message: err,
    };
  });
}

/**
 * Determines whether a post-edit diagnostic is equivalent to (i.e. explained
 * by) a pre-edit diagnostic, using the candidate mapping for coordinate
 * provenance.
 *
 * A whole-file recovery has no reliable start coordinates, so it is equivalent
 * ONLY to a baseline whole-file recovery, and ONLY when the raw END-span
 * identity (end line AND end column) matches after adjustment through the
 * unchanged suffix (or prefix for a no-change edit). An unknown end column
 * (string-only caller) cannot prove identity → fail closed (returns false), so
 * a different/new recovery is never silently trusted as pre-existing. A
 * whole-file recovery cannot be proven equivalent to a precise baseline error
 * → fail closed. This avoids blindly accepting a whole-file recovery whenever
 * the baseline was merely "invalid" while still staying writable when an
 * unchanged baseline whole-file recovery remains.
 */
function diagnosticsEquivalent(
  pre: NormalizedDiagnostic,
  post: NormalizedDiagnostic,
  mapping: CandidateMapping,
): boolean {
  if (post.wholeFileRecovery) {
    if (!pre.wholeFileRecovery) return false;
    // Prove equivalence by raw END-span identity (line AND column) through the
    // candidate mapping. A missing end column means no structured span identity
    // (string-only caller) → fail closed.
    if (pre.endColumn === undefined || post.endColumn === undefined) {
      return false;
    }
    const { suffixLines, prefixLines, origLineCount, lineDelta } = mapping;
    const suffixStartOrig = origLineCount - suffixLines;
    if (suffixLines > 0 && pre.endLine >= suffixStartOrig) {
      // End maps through the unchanged suffix (lineDelta shift); the end column
      // lies within an unchanged line, so it must match exactly.
      return (
        pre.endLine + lineDelta === post.endLine &&
        pre.endColumn === post.endColumn
      );
    }
    if (prefixLines >= origLineCount) {
      // No-change edit: entire file is unchanged prefix.
      return pre.endLine === post.endLine && pre.endColumn === post.endColumn;
    }
    // End is in the changed middle → cannot prove equivalence → fail closed.
    return false;
  }
  if (pre.wholeFileRecovery) {
    return false;
  }
  if (post.line === null || pre.line === null) {
    return false;
  }
  return locationsMatch(
    { line: pre.line, column: pre.column ?? 0 },
    { line: post.line, column: post.column ?? 0 },
    mapping,
  );
}

/**
 * Categorizes post-edit AST validation results relative to the pre-edit
 * baseline so the LLM understands whether failures are its fault.
 *
 * @param preEdit - Validation result of the original file content.
 * @param postEdit - Validation result of the edited file content.
 * @param mapping - Candidate mapping with unchanged prefix/suffix boundaries.
 *   Omitted when there is no content diff (everything is unchanged prefix).
 */
export function summarizeAstValidation(
  preEdit: AstValidationResult | undefined,
  postEdit: AstValidationResult | undefined,
  mapping: CandidateMapping = NO_CHANGE_MAPPING,
): AstValidationSummary {
  if (!postEdit) {
    return {
      status: 'SKIPPED',
      preExisting: false,
      newlyIntroduced: false,
      label: 'SKIPPED (validation not performed)',
    };
  }

  // Unsupported file types are never syntax-validated; report SKIPPED so the
  // caller knows the edit is still allowed and not falsely "passing".
  if (postEdit.supported === false) {
    return {
      status: 'SKIPPED',
      preExisting: false,
      newlyIntroduced: false,
      label: 'SKIPPED (unsupported file type)',
    };
  }

  // Post-edit is valid.
  if (postEdit.valid) {
    if (preEdit && !preEdit.valid) {
      return {
        status: 'PASSED',
        preExisting: false,
        newlyIntroduced: false,
        label: `PASSED (edit resolved pre-existing error${formatLineLabel(preEdit.errors)})`,
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

  // Pre-edit was clean (or no baseline / new file) → the edit introduced the error.
  if (preEdit === undefined || preEdit.valid) {
    return {
      status: 'FAILED',
      preExisting: false,
      newlyIntroduced: true,
      label: `FAILED (new error introduced by this edit${formatLineLabel(postErrors)})`,
    };
  }

  // Both pre- and post-edit are invalid. Compare EVERY diagnostic (not only the
  // first) so an earlier pre-existing error cannot mask a later new one.
  return categorizeBothInvalid(preEdit, postEdit, mapping);
}

/**
 * Categorizes the case where both pre- and post-edit content are invalid.
 * Compares EVERY post-edit diagnostic against the pre-edit diagnostics
 * (accounting for candidate mapping and whole-file-recovery identity) so an
 * earlier pre-existing error cannot mask a newly introduced later error.
 */
function categorizeBothInvalid(
  preEdit: AstValidationResult,
  postEdit: AstValidationResult,
  mapping: CandidateMapping,
): AstValidationSummary {
  const preNorm = toNormalized(preEdit);
  const postNorm = toNormalized(postEdit);
  const pool = [...preNorm];
  let matchedCount = 0;
  const unmatchedPostMessages: string[] = [];
  for (const post of postNorm) {
    const matchingIndex = pool.findIndex((pre) =>
      diagnosticsEquivalent(pre, post, mapping),
    );
    if (matchingIndex === -1) {
      unmatchedPostMessages.push(post.message);
    } else {
      matchedCount++;
      pool.splice(matchingIndex, 1);
    }
  }

  if (postNorm.length > 0 && unmatchedPostMessages.length === 0) {
    return {
      status: 'FAILED',
      preExisting: true,
      newlyIntroduced: false,
      label: `FAILED (pre-existing error${formatLineLabel(postEdit.errors)} — present before this edit)`,
    };
  }

  // File was already broken, but some post-edit errors do not line up with the
  // pre-existing ones. List only the unmatched (genuinely new) post errors as
  // "may be newly introduced" so the message stays coherent (Finding 5).
  return formatMixedValidationSummary(
    preEdit.errors,
    unmatchedPostMessages,
    matchedCount > 0,
  );
}

function formatMixedValidationSummary(
  preErrors: string[],
  postErrors: string[],
  hasMatchedError: boolean,
): AstValidationSummary {
  const preErrorNoun = preErrors.length === 1 ? 'error' : 'errors';
  let postErrorDescription =
    'post-edit validation failed without error details';
  if (postErrors.length > 0) {
    const postErrorNoun = postErrors.length === 1 ? 'error' : 'errors';
    postErrorDescription = `post-edit ${postErrorNoun}${formatLineLabel(postErrors)} may be newly introduced`;
  }
  return {
    status: 'FAILED',
    preExisting: hasMatchedError,
    newlyIntroduced: true,
    label: `FAILED (file had pre-existing ${preErrorNoun}${formatLineLabel(preErrors)}; ${postErrorDescription})`,
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
