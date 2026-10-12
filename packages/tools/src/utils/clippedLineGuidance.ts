/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MAX_LINE_LENGTH_TEXT_FILE, type ClippedLine } from './fileUtils.js';

const MAX_LISTED_CLIPPED_LINES = 10;

/**
 * Tells the model how to read the rest of each clipped line with read_file.
 * Shared by read_file and read_line_range so both emit the same executable
 * continuation.
 */
export function formatClippedLineGuidance(
  absolutePath: string,
  columnOffset: number,
  clippedLines: readonly ClippedLine[],
): string {
  const listed = clippedLines.slice(0, MAX_LISTED_CLIPPED_LINES);
  const entries = listed.map((clipped) => {
    const call = JSON.stringify({
      absolute_path: absolutePath,
      offset: clipped.lineNumber - 1,
      limit: 1,
      column_offset: clipped.nextColumnOffset,
    });
    return `- Line ${clipped.lineNumber} has ${clipped.lineLength} characters; characters ${columnOffset} up to ${clipped.nextColumnOffset} are shown. To read the next part: read_file ${call}`;
  });
  const omitted = clippedLines.slice(MAX_LISTED_CLIPPED_LINES);
  const omittedNote = formatOmittedClippedLines(
    absolutePath,
    columnOffset,
    omitted,
  );
  return `Long lines are clipped: at most ${MAX_LINE_LENGTH_TEXT_FILE} characters of a line are shown per read. Character positions count UTF-16 code units from the start of the line (0-based).\n${entries.join('\n')}${omittedNote}`;
}

/** Points at a read that lists the clipped lines the guidance left out. */
function formatOmittedClippedLines(
  absolutePath: string,
  columnOffset: number,
  omitted: readonly ClippedLine[],
): string {
  if (omitted.length === 0) {
    return '';
  }
  const first = omitted[0].lineNumber;
  const last = omitted[omitted.length - 1].lineNumber;
  const call = JSON.stringify({
    absolute_path: absolutePath,
    offset: first - 1,
    limit: last - first + 1,
    ...(columnOffset > 0 ? { column_offset: columnOffset } : {}),
  });
  return `\n- ${omitted.length} more clipped line(s) not listed (lines ${first} to ${last}). To list them: read_file ${call}`;
}
