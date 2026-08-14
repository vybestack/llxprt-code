/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bounded single-file streaming search for the grep tool.
 *
 * Reads a single file incrementally through a {@link BoundedLineFramer},
 * charging every source chunk against a finite observation budget and capping
 * retained matches at one-over the record budget. Extracted from
 * search-strategies.ts to keep that module under the source-size limit.
 *
 * @plan PLAN-20260211-ASTGREP.P05
 */

import { createReadStream } from 'fs';
import path from 'path';

import type { GrepMatch } from './types.js';
import { BoundedLineFramer } from '../../utils/lineFramer.js';
import {
  type SemanticBudget,
  type GrepLimits,
  type GrepRetainState,
  createAggregateSemanticBudget,
  createGrepRetainState,
  normalizeSourceBudgetBytes,
  retainGrepMatch,
} from './grepBudget.js';

/** Default limits for single-file search when no explicit limits are supplied. */
const SINGLE_FILE_DEFAULT_MAX_RESULTS = 1000;
const SINGLE_FILE_DEFAULT_MAX_PER_FILE = 50;

/** Per-invocation source-observation limits for a single-file search. */
export interface SingleFileLimits {
  maxResults: number;
  maxPerFile: number;
  /** Finite source-observation byte budget; charged per read chunk. */
  sourceBudgetBytes?: number;
}

/**
 * Result of a bounded single-file search. Includes truncation metadata so
 * callers can produce non-exhaustive wording and structured partial info.
 */
export interface SingleFileSearchResult {
  matches: GrepMatch[];
  truncated: boolean;
  observedCount: number;
  lineDropped: boolean;
  /**
   * Whether the source stream was only partially observed (abort, read error,
   * or premature close before clean end). When true the result is a lower
   * bound on the file's true matches.
   */
  sourcePartial: boolean;
}

/** Mutable context carried through a single-file streaming search. */
interface SingleFileSearchContext {
  readonly filePath: string;
  readonly regex: RegExp;
  readonly state: GrepRetainState;
  readonly framer: BoundedLineFramer;
  readonly basename: string;
  readonly effectiveLimits: GrepLimits;
  readonly sourceBudgetBytes: number;
  observedSourceBytes: number;
  lineNumber: number;
  settled: boolean;
  sourcePartial: boolean;
}

/**
 * Executes a single-file search using streaming line framing with finite
 * byte/record budgets.
 *
 * The file is read incrementally via {@link createReadStream} and framed
 * through a {@link BoundedLineFramer}, avoiding whole-file materialization.
 * Every read chunk is charged against a finite source-observation byte budget
 * — even when the pattern never matches — so a huge no-match file cannot be
 * read without bound; one-over stops the read and marks the result partial.
 * Overlong lines (exceeding the framer max) are dropped and reported via
 * {@link SingleFileSearchResult.lineDropped}. When a finite
 * {@link SemanticBudget} is supplied, retained matches are capped at
 * one-over the configured record budget via {@link retainGrepMatch}.
 *
 * Stream settlement is guarded by a single `settled` flag so end, error,
 * abort, and premature close never double-settle or mutate state after the
 * first settlement. A clean `end` is the only complete outcome; a `close`
 * without a prior settle is a premature close marked as partial. An abort is
 * resolved as a partial result rather than rejected.
 */
export async function performSingleFileSearch(
  pattern: string,
  filePath: string,
  signal: AbortSignal,
  limits?: SingleFileLimits,
  semanticBudget?: SemanticBudget,
): Promise<SingleFileSearchResult> {
  if (signal.aborted) {
    return {
      matches: [],
      truncated: true,
      observedCount: 0,
      lineDropped: false,
      sourcePartial: true,
    };
  }
  const ctx = createSingleFileSearchContext(
    pattern,
    filePath,
    limits,
    semanticBudget,
  );
  return driveSingleFileStream(ctx, signal);
}

function createSingleFileSearchContext(
  pattern: string,
  filePath: string,
  limits: SingleFileLimits | undefined,
  semanticBudget: SemanticBudget | undefined,
): SingleFileSearchContext {
  const budget = semanticBudget ?? createAggregateSemanticBudget();
  return {
    filePath,
    regex: new RegExp(pattern, 'i'),
    state: createGrepRetainState(budget),
    framer: new BoundedLineFramer(),
    basename: path.basename(filePath),
    effectiveLimits: {
      maxResults: limits?.maxResults ?? SINGLE_FILE_DEFAULT_MAX_RESULTS,
      maxPerFile: limits?.maxPerFile ?? SINGLE_FILE_DEFAULT_MAX_PER_FILE,
      maxFiles: 1,
    },
    sourceBudgetBytes: normalizeSourceBudgetBytes(
      limits?.sourceBudgetBytes ?? budget.sourceBytes,
    ),
    observedSourceBytes: 0,
    lineNumber: 0,
    settled: false,
    sourcePartial: false,
  };
}

function isSingleFileTruncated(ctx: SingleFileSearchContext): boolean {
  const limitHit =
    ctx.state.earlyStopped ||
    ctx.state.budgetExhausted ||
    ctx.state.observedCount > ctx.state.usableCount;
  return limitHit || ctx.framer.wasLineDropped || ctx.sourcePartial;
}

function finalizeSingleFileResult(
  ctx: SingleFileSearchContext,
): SingleFileSearchResult {
  return {
    matches: ctx.state.matches,
    truncated: isSingleFileTruncated(ctx),
    observedCount: ctx.state.observedCount,
    lineDropped: ctx.framer.wasLineDropped,
    sourcePartial: ctx.sourcePartial,
  };
}

function driveSingleFileStream(
  ctx: SingleFileSearchContext,
  signal: AbortSignal,
): Promise<SingleFileSearchResult> {
  return new Promise<SingleFileSearchResult>((resolve, reject) => {
    const stream = createReadStream(ctx.filePath);

    const onAbort = (): void => {
      ctx.sourcePartial = true;
      stream.destroy();
      // destroy drives the stream toward 'close', which settles
      // authoritatively as a partial result.
    };

    const detachAll = (): void => {
      stream.removeAllListeners();
      signal.removeEventListener('abort', onAbort);
    };

    const settleResolve = (value: SingleFileSearchResult): void => {
      if (ctx.settled) return;
      ctx.settled = true;
      detachAll();
      resolve(value);
    };

    const settleReject = (error: Error): void => {
      if (ctx.settled) return;
      ctx.settled = true;
      detachAll();
      reject(error);
    };

    const processLine = (line: string): void => {
      ctx.lineNumber++;
      if (ctx.state.earlyStopped) return;
      if (ctx.regex.test(line)) {
        retainGrepMatch(
          ctx.state,
          { filePath: ctx.basename, lineNumber: ctx.lineNumber, line },
          ctx.effectiveLimits,
        );
      }
    };

    const onData = (chunk: Buffer | string): void => {
      // createReadStream without an encoding always emits Buffer chunks;
      // narrow to Buffer directly. The string path satisfies the Node.js
      // stream type contract but is never taken at runtime.
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      ctx.observedSourceBytes += buf.length;
      if (ctx.observedSourceBytes > ctx.sourceBudgetBytes) {
        ctx.sourcePartial = true;
        stream.destroy();
        return;
      }
      ctx.framer.feedChunk(buf, processLine);
      if (ctx.state.earlyStopped) {
        ctx.sourcePartial = true;
        stream.destroy();
      }
    };

    const onEnd = (): void => {
      if (!ctx.state.earlyStopped) {
        ctx.framer.flushRemaining(processLine);
      }
      settleResolve(finalizeSingleFileResult(ctx));
    };

    const onError = (err: NodeJS.ErrnoException): void => {
      // An abort-driven destroy may surface as an AbortError here; treat it as
      // a partial result, not a thrown error. A genuine read/open error is
      // surfaced to the caller (fail fast).
      if (signal.aborted || err.name === 'AbortError') {
        ctx.sourcePartial = true;
        return;
      }
      settleReject(err);
    };

    const onClose = (): void => {
      // 'close' without a prior clean 'end' settle is a premature close
      // (abort, source-budget overrun, or unexpected termination). The
      // settled flag guarantees we only ever take one settlement path.
      settleResolve(finalizeSingleFileResult(ctx));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    stream.on('close', onClose);
  });
}
