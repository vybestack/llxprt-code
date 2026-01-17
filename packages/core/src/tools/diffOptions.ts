/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Hunk, ParsedDiff, PatchOptions } from 'diff';
import * as Diff from 'diff';
import { type DiffStat } from './tools.js';

export const DEFAULT_STRUCTURED_PATCH_OPTIONS: PatchOptions = {
  context: 3,
  ignoreWhitespace: true,
};

export const DEFAULT_DIFF_OPTIONS: PatchOptions = {
  context: 3,
  ignoreWhitespace: true,
};

export function getDiffStat(
  fileName: string,
  oldStr: string,
  aiStr: string,
  userStr: string,
): DiffStat {
  const countLines = (patch: ParsedDiff) => {
    let added = 0;
    let removed = 0;
    patch.hunks.forEach((hunk: Hunk) => {
      hunk.lines.forEach((line: string) => {
        if (line.startsWith('+')) {
          added++;
        } else if (line.startsWith('-')) {
          removed++;
        }
      });
    });
    return { added, removed };
  };

  const patch = Diff.structuredPatch(
    fileName,
    fileName,
    oldStr,
    aiStr,
    'Current',
    'Proposed',
    DEFAULT_STRUCTURED_PATCH_OPTIONS,
  );
  const { added: aiAddedLines, removed: aiRemovedLines } = countLines(patch);

  const userPatch = Diff.structuredPatch(
    fileName,
    fileName,
    aiStr,
    userStr,
    'Proposed',
    'User',
    DEFAULT_STRUCTURED_PATCH_OPTIONS,
  );
  const { added: userAddedLines, removed: userRemovedLines } =
    countLines(userPatch);

  return {
    ai_added_lines: aiAddedLines,
    ai_removed_lines: aiRemovedLines,
    user_added_lines: userAddedLines,
    user_removed_lines: userRemovedLines,
  };
}
