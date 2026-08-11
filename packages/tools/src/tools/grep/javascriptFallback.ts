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
import {
  type SemanticBudget,
  type GrepLimits,
  type GrepRetainState,
  createGrepRetainState,
  retainGrepMatch,
} from './grepBudget.js';

async function processFallbackFile(
  state: GrepRetainState,
  filePath: string,
  absolutePath: string,
  regex: RegExp,
  limits: GrepLimits,
): Promise<void> {
  let content: string;
  try {
    content = await fsPromises.readFile(filePath, 'utf8');
  } catch (readError: unknown) {
    if (!isNodeError(readError) || readError.code !== 'ENOENT') {
      debugLogger.debug(
        `GrepLogic: Could not read/process ${filePath}: ${getErrorMessage(readError)}`,
      );
    }
    return;
  }
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length && !state.earlyStopped; i++) {
    if (regex.test(lines[i])) {
      const match: GrepMatch = {
        filePath:
          path.relative(absolutePath, filePath) || path.basename(filePath),
        lineNumber: i + 1,
        line: lines[i],
      };
      retainGrepMatch(state, match, limits);
    }
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
  semanticBudget: SemanticBudget,
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
  const limits: GrepLimits = { maxResults, maxFiles, maxPerFile };
  const state = createGrepRetainState(semanticBudget);

  for await (const filePath of filesStream) {
    if (state.earlyStopped) break;
    await processFallbackFile(state, filePath, absolutePath, regex, limits);
  }

  const incomplete = state.earlyStopped || state.budgetExhausted;
  const totalFoundValue =
    incomplete || state.observedCount <= state.usableCount
      ? undefined
      : state.observedCount;
  return {
    results: state.matches,
    wasLimited: state.observedCount > state.usableCount || incomplete,
    totalFound: totalFoundValue,
    incomplete,
    observedCount: state.observedCount,
  };
}
