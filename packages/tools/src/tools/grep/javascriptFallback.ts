/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream } from 'fs';
import path from 'path';
import { globStream } from 'glob';

import { getErrorMessage, isNodeError } from '../../utils/errors.js';
import { debugLogger } from '../../utils/debugLogger.js';
import { BoundedLineFramer } from '../../utils/lineFramer.js';
import type { GrepMatch, SearchResults } from './types.js';
import {
  type SemanticBudget,
  type GrepLimits,
  type GrepRetainState,
  createGrepRetainState,
  retainGrepMatch,
} from './grepBudget.js';

/** Outcome of reading/processing one file in the JavaScript fallback. */
interface FallbackFileOutcome {
  /** Whether this file was only partially observed (line drop, read error,
   * premature close, or mid-file abort); marks the aggregate result incomplete. */
  partial: boolean;
}

/** Factory for the per-line retain callback used during a fallback file scan. */
function createRetainLine(
  relativeFilePath: string,
  regex: RegExp,
  state: GrepRetainState,
  limits: GrepLimits,
): (line: string) => boolean {
  let lineNumber = 0;
  return (line: string): boolean => {
    lineNumber++;
    if (state.earlyStopped) return true;
    if (regex.test(line)) {
      const match: GrepMatch = {
        filePath: relativeFilePath,
        lineNumber,
        line,
      };
      return retainGrepMatch(state, match, limits);
    }
    return false;
  };
}

async function processFallbackFile(
  state: GrepRetainState,
  filePath: string,
  absolutePath: string,
  regex: RegExp,
  limits: GrepLimits,
  abortSignal: AbortSignal,
): Promise<FallbackFileOutcome> {
  const relativeFilePath =
    path.relative(absolutePath, filePath) || path.basename(filePath);
  const framer = new BoundedLineFramer();
  let filePartial = false;
  let settled = false;

  const retainLine = createRetainLine(relativeFilePath, regex, state, limits);

  return new Promise<FallbackFileOutcome>((resolve) => {
    const stream = createReadStream(filePath);

    // Wire the abort signal to the active read stream: when the caller
    // aborts mid-file, destroy the stream promptly so processing stops
    // immediately rather than reading to EOF. The listener is removed on
    // settle to avoid leaks across many files.
    const onAbort = (): void => {
      filePartial = true;
      stream.destroy();
    };

    const settle = (outcome: FallbackFileOutcome): void => {
      if (settled) return;
      settled = true;
      abortSignal.removeEventListener('abort', onAbort);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
      resolve(outcome);
    };

    const onData = (chunk: Buffer | string): void => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      // Charge every source chunk against the invocation-wide aggregate
      // source-observation budget shared across all files, roots, and
      // strategies — even for no-match content — so a huge no-match input
      // cannot be read without bound and no file receives a fresh budget.
      // One-over semantics: reading exactly the remaining budget is complete
      // if EOF occurs; the first chunk beyond it proves partiality.
      if (buf.length > state.semanticBudget.sourceBytes) {
        filePartial = true;
        state.budgetExhausted = true;
        stream.destroy();
        return;
      }
      state.semanticBudget.sourceBytes -= buf.length;
      framer.feedChunk(buf, (line) => {
        if (retainLine(line)) stream.destroy();
      });
      if (state.earlyStopped || framer.wasLineDropped) {
        filePartial = filePartial || framer.wasLineDropped;
        stream.destroy();
      }
    };

    const onEnd = (): void => {
      // Clean EOF: flush remaining framed lines, then settle complete.
      if (!state.earlyStopped && !filePartial) {
        framer.flushRemaining((line) => {
          retainLine(line);
        });
      }
      settle({ partial: filePartial });
    };

    const onError = (readError: NodeJS.ErrnoException): void => {
      if (!isNodeError(readError) || readError.code !== 'ENOENT') {
        debugLogger.debug(
          `GrepLogic: Could not read/process ${filePath}: ${getErrorMessage(readError)}`,
        );
      }
      // A read error means this file was not exhaustively processed; mark the
      // aggregate result partial. Do not throw — the fallback continues with
      // remaining files. The single settle below prevents double resolution.
      filePartial = true;
    };

    const onClose = (): void => {
      // 'close' is the authoritative settlement for non-clean paths (destroy
      // from early-stop/budget/abort, read error, or premature close before end).
      settle({ partial: filePartial });
    };

    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    stream.on('close', onClose);
    if (abortSignal.aborted) {
      onAbort();
    } else {
      abortSignal.addEventListener('abort', onAbort, { once: true });
    }
  });
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
  let anyFilePartial = false;

  for await (const filePath of filesStream) {
    if (state.earlyStopped || state.budgetExhausted || abortSignal.aborted)
      break;
    const outcome = await processFallbackFile(
      state,
      filePath,
      absolutePath,
      regex,
      limits,
      abortSignal,
    );
    anyFilePartial = anyFilePartial || outcome.partial;
  }

  const incomplete =
    state.earlyStopped || state.budgetExhausted || anyFilePartial;
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
