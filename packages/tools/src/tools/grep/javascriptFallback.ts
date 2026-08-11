/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fsPromises from 'fs/promises';
import path from 'path';
import { globStream } from 'glob';

import { getErrorMessage, isNodeError } from '../../utils/errors.js';
import { debugLogger } from '../../utils/debugLogger.js';
import type { GrepMatch, SearchResults } from './types.js';

function extractMatchesFromFile(
  lines: string[],
  fileAbsolutePath: string,
  absolutePath: string,
  regex: RegExp,
  maxPerFile: number,
  maxResults: number,
  allMatches: GrepMatch[],
  filesWithMatches: Set<string>,
): number {
  let matchesInFile = 0;
  let totalFound = 0;

  lines.forEach((line, index) => {
    if (regex.test(line)) {
      totalFound++;
      if (matchesInFile < maxPerFile && allMatches.length < maxResults) {
        allMatches.push({
          filePath:
            path.relative(absolutePath, fileAbsolutePath) ||
            path.basename(fileAbsolutePath),
          lineNumber: index + 1,
          line,
        });
        matchesInFile++;
        filesWithMatches.add(fileAbsolutePath);
      }
    }
  });

  return totalFound;
}

function shouldProcessFile(
  allMatchesLength: number,
  maxResults: number,
  filesWithMatchesSize: number,
  maxFiles: number,
  isKnownFile: boolean,
): boolean {
  if (allMatchesLength >= maxResults) return false;
  if (filesWithMatchesSize >= maxFiles && !isKnownFile) return false;
  return true;
}

async function processFallbackFile(
  filePath: string,
  absolutePath: string,
  regex: RegExp,
  maxPerFile: number,
  maxResults: number,
  allMatches: GrepMatch[],
  filesWithMatches: Set<string>,
): Promise<number> {
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    return extractMatchesFromFile(
      lines,
      filePath,
      absolutePath,
      regex,
      maxPerFile,
      maxResults,
      allMatches,
      filesWithMatches,
    );
  } catch (readError: unknown) {
    if (!isNodeError(readError) || readError.code !== 'ENOENT') {
      debugLogger.debug(
        `GrepLogic: Could not read/process ${filePath}: ${getErrorMessage(readError)}`,
      );
    }
    return 0;
  }
}

export async function javascriptGrepFallback(
  pattern: string,
  absolutePath: string,
  include: string | undefined,
  abortSignal: AbortSignal,
  maxResults: number,
  maxFiles: number,
  maxPerFile: number,
  fileExclusions: readonly string[],
): Promise<SearchResults> {
  const globPattern = include ?? '**/*';
  const filesStream = globStream(globPattern, {
    cwd: absolutePath,
    dot: true,
    ignore: [...fileExclusions],
    absolute: true,
    nodir: true,
    signal: abortSignal,
  });

  const regex = new RegExp(pattern, 'i');
  const allMatches: GrepMatch[] = [];
  const filesWithMatches = new Set<string>();
  let totalFound = 0;
  let filesLimitHit = false;

  for await (const filePath of filesStream) {
    if (
      !shouldProcessFile(
        allMatches.length,
        maxResults,
        filesWithMatches.size,
        maxFiles,
        filesWithMatches.has(filePath),
      )
    ) {
      if (filesWithMatches.size >= maxFiles) filesLimitHit = true;
      break;
    }
    totalFound += await processFallbackFile(
      filePath,
      absolutePath,
      regex,
      maxPerFile,
      maxResults,
      allMatches,
      filesWithMatches,
    );
  }

  const incomplete = filesLimitHit;
  const totalFoundValue =
    incomplete || totalFound <= allMatches.length ? undefined : totalFound;
  return {
    results: allMatches,
    wasLimited: totalFound > allMatches.length || filesLimitHit,
    totalFound: totalFoundValue,
    incomplete,
    observedCount: totalFound,
  };
}
