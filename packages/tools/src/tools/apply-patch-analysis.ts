/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure analysis and message helpers for apply_patch (issue #3033).
 *
 * No I/O, no class state — every export is a pure function over its inputs.
 * Message wording and patch-header math live here so `apply-patch.ts` stays
 * small and focused on orchestration.
 *
 * @issue 3033
 */

import * as Diff from 'diff';
import * as path from 'node:path';
import type { FileDiff, ToolResult } from './tools.js';
import { ToolErrorType } from '../types/tool-error.js';
import { DEFAULT_CREATE_PATCH_OPTIONS } from '../utils/diffOptions.js';

/**
 * Removes the `a/` or `b/` prefix used in unified-diff headers.
 * Single source of truth for prefix stripping.
 */
export function stripHeaderPrefix(headerPath: string): string {
  if (headerPath.startsWith('a/') || headerPath.startsWith('b/')) {
    return headerPath.slice(2);
  }
  return headerPath;
}

/**
 * Reads the stripped old-file header from a parsed patch. jsdiff types the
 * field as a required string, but `parsePatch` yields `undefined` for a
 * headerless patch at runtime, so coerce via `||` rather than `??`.
 */
function oldHeaderOf(patch: Diff.StructuredPatch): string {
  return stripHeaderPrefix(patch.oldFileName || '');
}

function newHeaderOf(patch: Diff.StructuredPatch): string {
  return stripHeaderPrefix(patch.newFileName || '');
}

/**
 * AC4: a headerless patch (only `@@` and body, no `---`/`+++`) parses with
 * both file names absent. jsdiff types the names as required strings, so a
 * truthiness check is the runtime-accurate detector.
 */
export function hasNoFileHeader(patch: Diff.StructuredPatch): boolean {
  return !patch.oldFileName && !patch.newFileName;
}

/**
 * AC1: a delete patch sends the file to `/dev/null` from a real old header.
 */
export function isDeletePatch(patch: Diff.StructuredPatch): boolean {
  const oldHeader = oldHeaderOf(patch);
  const newHeader = newHeaderOf(patch);
  return (
    newHeader === '/dev/null' && oldHeader !== '' && oldHeader !== '/dev/null'
  );
}

/**
 * AC6: a creation patch originates from `/dev/null`.
 */
export function isCreationPatch(patch: Diff.StructuredPatch): boolean {
  const oldHeader = oldHeaderOf(patch);
  const newHeader = newHeaderOf(patch);
  return (
    oldHeader === '/dev/null' && newHeader !== '' && newHeader !== '/dev/null'
  );
}

/**
 * Detects a Codex `*** Begin Patch` / `*** Update File:` envelope.
 */
export function isCodexEnvelope(patchContent: string): boolean {
  return /^\*\*\* (Begin Patch|Update File|Add File|Delete File)/m.test(
    patchContent,
  );
}

/**
 * Splits content into lines, dropping the single trailing empty element that a
 * final newline produces. Empty content yields an empty array.
 */
function splitLines(content: string): string[] {
  if (content === '') return [];
  const parts = content.split('\n');
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

function formatLanding(newStart: number, newLines: number): string {
  if (newLines <= 1) {
    return `line ${newStart}`;
  }
  return `lines ${newStart}-${newStart + newLines - 1}`;
}

/**
 * AC5: when `Diff.parsePatch` throws, explains a hunk whose declared old/new
 * counts disagree with its body. Returns null when every hunk agrees so the
 * caller falls back to the original jsdiff message.
 */
export function describeHunkCountMismatch(patchContent: string): string | null {
  const lines = splitPatchLines(patchContent);
  const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  for (let i = 0; i < lines.length; i++) {
    const match = hunkHeaderRe.exec(lines[i]);
    if (match === null) continue;
    const mismatch = checkHunkCounts(match, lines, i);
    if (mismatch !== null) return mismatch;
  }
  return null;
}

/** Strips exactly one trailing empty element (the terminating newline). */
function splitPatchLines(patchContent: string): string[] {
  const lines = patchContent.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * True when the line at `index` ends the current hunk's body. A `--- ` line is
 * a real file-section boundary only as the first half of the `--- X` / `+++ Y`
 * header pair; on its own it may be a removed line whose content begins with
 * `-- ` (rendered as `--- X`). A lone `+++ ` line is never a terminator: as a
 * header it is consumed by the pair on the preceding line, as content it is an
 * added line.
 */
function isHunkTerminator(lines: string[], index: number): boolean {
  const line = lines[index];
  if (line.startsWith('@@') || line.startsWith('diff --git')) {
    return true;
  }
  if (line.startsWith('--- ')) {
    return index + 1 < lines.length && lines[index + 1].startsWith('+++ ');
  }
  return false;
}

/** Stops the body walk at a terminator or any non-body line. */
function stopsHunkBody(lines: string[], index: number): boolean {
  if (isHunkTerminator(lines, index)) return true;
  const line = lines[index];
  if (line.length === 0) return false;
  const c = line[0];
  return c !== ' ' && c !== '-' && c !== '+' && c !== '\\';
}

/** Walks a hunk body counting actual old/new lines until a terminator. */
function countHunkBody(
  lines: string[],
  start: number,
): {
  actualOld: number;
  actualNew: number;
} {
  let actualOld = 0;
  let actualNew = 0;
  for (let j = start; j < lines.length; j++) {
    if (stopsHunkBody(lines, j)) break;
    const body = lines[j];
    const first = body.length === 0 ? '' : body[0];
    if (first === '-') actualOld++;
    else if (first === '+') actualNew++;
    else if (first === ' ' || first === '') {
      actualOld++;
      actualNew++;
    }
  }
  return { actualOld, actualNew };
}

/** Compares declared vs actual counts for one hunk; returns a message or null. */
function checkHunkCounts(
  match: RegExpExecArray,
  lines: string[],
  headerIndex: number,
): string | null {
  const counts = countHunkBody(lines, headerIndex + 1);
  const declaredOld = match[2] ? Number(match[2]) : 1;
  const declaredNew = match[4] ? Number(match[4]) : 1;
  if (counts.actualOld === declaredOld && counts.actualNew === declaredNew) {
    return null;
  }
  return `Hunk header "${lines[headerIndex]}" (line ${headerIndex + 1}) declared ${declaredOld} old line(s) and ${declaredNew} new line(s), but the body actually has ${counts.actualOld} old line(s) and ${counts.actualNew} new line(s). @@ line numbers are tolerant but the old/new counts are strict; fix the @@ counts to match the body.`;
}

/**
 * Finds every 1-based start index in `lines` where `block` matches exactly.
 */
function findBlockMatches(block: readonly string[], lines: string[]): number[] {
  const matches: number[] = [];
  if (block.length === 0) return matches;
  for (let i = 0; i + block.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j] !== block[j]) {
        ok = false;
        break;
      }
    }
    if (ok) matches.push(i + 1);
  }
  return matches;
}

interface PatchEvidence {
  summary: string;
  notes: string[];
}

/**
 * AC2: advisory notes computed per declared hunk against the original content.
 * Announces ambiguity (multiple matches) and declared-vs-actual line drift.
 */
function buildAdvisoryNotes(
  patch: Diff.StructuredPatch,
  originalLines: string[],
): string[] {
  const notes: string[] = [];
  patch.hunks.forEach((hunk, idx) => {
    const hunkNumber = idx + 1;
    const oldBlock: string[] = [];
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) continue;
      if (line.startsWith(' ') || line.startsWith('-')) {
        oldBlock.push(line.slice(1));
      }
    }
    if (oldBlock.length === 0) return;
    const matches = findBlockMatches(oldBlock, originalLines);
    if (matches.length === 0) return;
    if (matches.length > 1) {
      notes.push(
        `Hunk ${hunkNumber} context (declared at line ${hunk.oldStart}) occurs ${matches.length} times in the file (lines ${matches.join(', ')}); check the reported landing lines.`,
      );
    } else if (matches[0] !== hunk.oldStart) {
      notes.push(
        `Hunk ${hunkNumber} declared line ${hunk.oldStart} but its context matches line ${matches[0]}.`,
      );
    }
  });
  return notes;
}

/**
 * AC2: evidence for a successful modify — declared hunk count, true landing
 * positions derived from the before/after content, plus advisory notes.
 */
export function buildModifyEvidence(
  currentContent: string,
  newContent: string,
  patch: Diff.StructuredPatch,
  fileName: string,
): PatchEvidence {
  const declaredHunks = patch.hunks.length;
  const landing = Diff.structuredPatch(
    fileName,
    fileName,
    currentContent,
    newContent,
    '',
    '',
    { context: 0 },
  );
  const ranges = landing.hunks.map((h) =>
    formatLanding(h.newStart, h.newLines),
  );
  const where = ranges.length > 0 ? ranges.join('; ') : 'no change';
  const summary = `Patch declared ${declaredHunks} hunk(s). The applied change landed at ${where}.`;
  const notes = buildAdvisoryNotes(patch, splitLines(currentContent));
  return { summary, notes };
}

/** AC2: proportionate evidence for a creation (lines written). */
export function buildCreateEvidence(newContent: string): string {
  return `Created file with ${splitLines(newContent).length} line(s).`;
}

/** AC2: proportionate evidence for a deletion (lines removed). */
export function buildDeleteEvidence(currentContent: string): string {
  return `Removed ${splitLines(currentContent).length} line(s).`;
}

/** AC2: assembles the success message parts for a modify or create. */
export function buildSuccessParts(opts: {
  fileExists: boolean;
  filePath: string;
  currentContent: string;
  newContent: string;
  patch: Diff.StructuredPatch;
  fileName: string;
  modifiedByUser: boolean;
}): string[] {
  const parts: string[] = [
    opts.fileExists
      ? `Successfully applied patch to file: ${opts.filePath}.`
      : `Successfully created file from patch: ${opts.filePath}.`,
  ];
  if (opts.modifiedByUser) {
    parts.push('User modified the patch content.');
  }
  if (opts.fileExists) {
    const evidence = buildModifyEvidence(
      opts.currentContent,
      opts.newContent,
      opts.patch,
      opts.fileName,
    );
    parts.push(evidence.summary);
    parts.push(...evidence.notes);
  } else {
    parts.push(buildCreateEvidence(opts.newContent));
  }
  return parts;
}

// ---------------------------------------------------------------------------
// AC3: patch-header target validation (matching rules preserved verbatim).
// ---------------------------------------------------------------------------

/**
 * AC3: validates the parsed patch header targets the same file as the
 * absolute_path. Matching rules are unchanged from the original implementation;
 * only the rejection message now names both accepted forms.
 */
export function validatePatchHeader(
  patch: Diff.StructuredPatch,
  filePath: string,
  targetDir: string,
): ToolResult | null {
  const targetName = path.basename(filePath);

  const newHeader = newHeaderOf(patch);
  const oldHeader = oldHeaderOf(patch);

  const isNewFileFromNull =
    oldHeader === '/dev/null' && newHeader !== '' && newHeader !== '/dev/null';
  const isDeleteToNull =
    newHeader === '/dev/null' && oldHeader !== '' && oldHeader !== '/dev/null';

  if (isNewFileFromNull || isDeleteToNull) {
    if (isNewFileFromNull && path.basename(newHeader) === targetName) {
      return null;
    }
    if (isDeleteToNull && path.basename(oldHeader) === targetName) {
      return null;
    }
  }

  const toPosix = (p: string): string => p.split(path.sep).join('/');
  const relativePath = toPosix(path.relative(targetDir, filePath));
  const headerMatches = (header: string): boolean => {
    if (header === '') return false;
    if (header.includes('/') || header.includes(path.sep)) {
      return toPosix(header) === relativePath;
    }
    return path.basename(header) === targetName;
  };

  if (headerMatches(newHeader) || headerMatches(oldHeader)) {
    return null;
  }

  const describedTarget = newHeader || oldHeader || '(unknown)';
  const msg = `Patch header targets "${describedTarget}" but absolute_path is "${filePath}". The header path must be either the workspace-relative path "${relativePath}" or the bare file name "${targetName}"; a partial path is not accepted. Ensure the patch header matches the target file.`;
  return {
    llmContent: msg,
    returnDisplay: `Rejected patch: header target "${describedTarget}" does not match absolute_path "${targetName}".`,
    error: {
      message: msg,
      type: ToolErrorType.INVALID_TOOL_PARAMS,
    },
  };
}

// ---------------------------------------------------------------------------
// ToolResult builders for each rejection / success path.
// ---------------------------------------------------------------------------

export function buildWorkspacePathResult(pathError: string): ToolResult {
  return {
    llmContent: pathError,
    returnDisplay: 'File path is not within workspace',
    error: { message: pathError, type: ToolErrorType.INVALID_TOOL_PARAMS },
  };
}

export function buildNoSectionsResult(): ToolResult {
  return {
    llmContent:
      'Patch content did not contain any parseable file sections. Provide a valid unified diff with at least one file section.',
    returnDisplay: 'No parseable patch sections found.',
    error: {
      message: 'Patch content did not contain any parseable file sections.',
      type: ToolErrorType.INVALID_TOOL_PARAMS,
    },
  };
}

export function buildMultiSectionResult(
  patches: Diff.StructuredPatch[],
): ToolResult {
  const fileNames = patches
    .map((p) => p.newFileName || p.oldFileName)
    .join(', ');
  return {
    llmContent: `apply_patch accepts a single target file patch, but the provided patch_content contained ${patches.length} file sections (${fileNames}). Make a separate apply_patch call for each file.`,
    returnDisplay: `Rejected multi-file patch: ${patches.length} file sections.`,
    error: {
      message: `apply_patch accepts a single target file patch, but the patch_content contained ${patches.length} file sections. Use a separate apply_patch call per file.`,
      type: ToolErrorType.INVALID_TOOL_PARAMS,
    },
  };
}

export function buildParseErrorResult(message: string): ToolResult {
  return {
    llmContent: `Failed to parse patch: ${message}`,
    returnDisplay: `Error parsing patch: ${message}`,
    error: {
      message: `Failed to parse patch: ${message}`,
      type: ToolErrorType.INVALID_TOOL_PARAMS,
    },
  };
}

export function buildCodexResult(): ToolResult {
  const msg =
    'The "*** Begin Patch" / "*** Update File:" / "*** Add File:" / "*** Delete File:" envelope (Codex patch format) is not supported. Provide a unified diff with "---"/"+++" file headers and "@@" hunks.';
  return {
    llmContent: msg,
    returnDisplay: msg,
    error: { message: msg, type: ToolErrorType.INVALID_TOOL_PARAMS },
  };
}

export function buildNoHunksResult(): ToolResult {
  const msg =
    'The patch declares no "@@" hunks, so it would change nothing. Provide at least one "@@" hunk with "---"/"+++" headers.';
  return {
    llmContent: msg,
    returnDisplay: msg,
    error: { message: msg, type: ToolErrorType.INVALID_TOOL_PARAMS },
  };
}

export function buildHeaderlessResult(
  relativePath: string,
  basename: string,
): ToolResult {
  const msg = `The patch has "@@" hunks but is missing the "---"/"+++" file header. A header is required; for this target use either "--- a/${relativePath}" / "+++ b/${relativePath}" or "--- ${basename}" / "+++ ${basename}".`;
  return {
    llmContent: msg,
    returnDisplay: msg,
    error: { message: msg, type: ToolErrorType.INVALID_TOOL_PARAMS },
  };
}

export function buildMissingFileResult(absolutePath: string): ToolResult {
  const msg = `The file does not exist at "${absolutePath}". To create a new file, use a creation patch with "--- /dev/null" as the old header.`;
  return {
    llmContent: msg,
    returnDisplay: msg,
    error: { message: msg, type: ToolErrorType.FILE_NOT_FOUND },
  };
}

/** AC7: context mismatch — single prefix, states cause and remedy. */
export function buildContextMismatchResult(): ToolResult {
  const msg =
    "Failed to apply patch: the hunk context lines do not match the file's current content. Re-read the file and rebuild the patch against current content.";
  return {
    llmContent: msg,
    returnDisplay: msg,
    error: { message: msg, type: ToolErrorType.PATCH_APPLY_FAILURE },
  };
}

/** AC7: genuine throw from applyPatch — single prefix. */
export function buildApplyThrowResult(errorMsg: string): ToolResult {
  return {
    llmContent: `Failed to apply patch: ${errorMsg}`,
    returnDisplay: `Error applying patch: ${errorMsg}`,
    error: {
      message: `Failed to apply patch: ${errorMsg}`,
      type: ToolErrorType.PATCH_APPLY_FAILURE,
    },
  };
}

/** AC1: a delete patch that does not remove the whole file. */
export function buildDeletePartialResult(appliedResult: string): ToolResult {
  const remaining = splitLines(appliedResult).length;
  const msg = `Delete patch would leave ${remaining} line(s) in the file; a delete patch must remove the entire file. Re-read the file and rebuild the delete patch to cover every line.`;
  return {
    llmContent: msg,
    returnDisplay: msg,
    error: { message: msg, type: ToolErrorType.PATCH_APPLY_FAILURE },
  };
}

/** AC1: a successful whole-file deletion — FileDiff showing the removal. */
export function buildDeleteDisplay(
  fileName: string,
  filePath: string,
  currentContent: string,
): ToolResult {
  const fileDiff = Diff.createPatch(
    fileName,
    currentContent,
    '',
    'Current',
    'Deleted',
    DEFAULT_CREATE_PATCH_OPTIONS,
  );
  const display: FileDiff = {
    fileDiff,
    fileName,
    originalContent: currentContent,
    newContent: '',
  };
  return {
    llmContent: `Successfully deleted file from patch: ${filePath}.\n\n${buildDeleteEvidence(currentContent)}`,
    returnDisplay: display,
  };
}
