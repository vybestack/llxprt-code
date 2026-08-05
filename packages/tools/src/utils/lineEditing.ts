/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Newline-aware line splitting/joining for the line-range editor tools
 * (issue #3036).
 *
 * `content.split('\n')` treats a trailing newline as a phantom empty final
 * element; that element IS the newline, not a line. These helpers model a
 * file as the lines between newlines plus a separate trailing-newline flag so
 * edit tools preserve the file's final-newline state.
 */

export interface SplitFileLines {
  readonly lines: readonly string[];
  readonly hadTrailingNewline: boolean;
}

/**
 * Splits file content into real lines and records whether it ended in a
 * newline. An empty file has zero lines.
 */
export function splitFileLines(content: string): SplitFileLines {
  if (content === '') {
    return { lines: [], hadTrailingNewline: false };
  }
  const hadTrailingNewline = content.endsWith('\n');
  const body = hadTrailingNewline ? content.slice(0, -1) : content;
  return { lines: body.split('\n'), hadTrailingNewline };
}

/**
 * Joins lines back into file content, restoring the trailing newline only when
 * the source file had one. An empty line set is always the empty file (no
 * stray newline), even if the source was newline-terminated.
 */
export function joinFileLines(
  lines: readonly string[],
  hadTrailingNewline: boolean,
): string {
  if (lines.length === 0) {
    return '';
  }
  const joined = lines.join('\n');
  return hadTrailingNewline ? `${joined}\n` : joined;
}
