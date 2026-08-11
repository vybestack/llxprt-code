/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import type { CombinedAcquisitionResult } from '../../acquisition/index.js';
import type { GrepMatch } from './types.js';

export function parseRipgrepLine(
  line: string,
  basePath: string,
): GrepMatch | null {
  if (!line.trim()) return null;

  const nullSep = line.indexOf('\0');
  const pathSep = nullSep === -1 ? line.indexOf(':') : nullSep;
  if (pathSep === -1) return null;

  const lineNumStart = pathSep + 1;
  const contentSep = line.indexOf(':', lineNumStart);
  if (contentSep === -1) return null;

  const filePathRaw = line.substring(0, pathSep);
  const lineNumberStr = line.substring(lineNumStart, contentSep);
  const lineContent = line.substring(contentSep + 1);

  const lineNumber = parseInt(lineNumberStr, 10);
  if (isNaN(lineNumber)) return null;

  const absoluteFilePath = path.resolve(basePath, filePathRaw);
  const relativeFilePath = path.relative(basePath, absoluteFilePath);

  return {
    filePath: relativeFilePath || path.basename(absoluteFilePath),
    lineNumber,
    line: lineContent,
  };
}

export function formatRipgrepDiagnostic(
  acquisition: CombinedAcquisitionResult,
): string {
  const stderr = acquisition.stderrText.trim();
  if (acquisition.omissionNotice === null) {
    return stderr;
  }
  return stderr.length === 0
    ? acquisition.omissionNotice
    : `${stderr}\n${acquisition.omissionNotice}`;
}
