/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { isAbortLikeError } from './is-abort-like-error.js';
import {
  withHistoryState,
  rollbackHistoryState,
  type HistoryStateDeps,
} from './historyStateRollback.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

export interface GuardedCompressionDeps extends HistoryStateDeps {
  readonly logger: DebugLogger;
  readonly historyOrigin?: object;
  readonly performCompression: (
    promptId: string,
    options: {
      bypassCooldown: boolean;
      trigger: 'auto';
      onCommitted: () => void;
    },
  ) => Promise<PerformCompressionResult>;
}

export class CompressionRollbackError extends AggregateError {}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Whether the guarded compression committed. The session journal writes its
 * `compressed` record from the history's `compressionEnded` event (and only
 * owners that accept the event's origin do), so that event is the commit: from
 * then on the compressed history is what a resume replays.
 */
interface CompressionCommit {
  committed(): boolean;
  mark(): void;
  stop(): void;
}

function watchCompressionCommit(
  deps: GuardedCompressionDeps,
): CompressionCommit {
  let committed = false;
  const onEnded = (
    _summary: IContent,
    _itemsCompressed: number,
    origin?: object,
  ): void => {
    if (
      origin === undefined ||
      deps.historyOrigin === undefined ||
      origin === deps.historyOrigin
    ) {
      committed = true;
    }
  };
  deps.historyService.prependListener('compressionEnded', onEnded);
  return {
    committed: () => committed,
    mark: () => {
      committed = true;
    },
    stop: () => {
      deps.historyService.off('compressionEnded', onEnded);
    },
  };
}

interface CompressionAttempt {
  /** Undefined only for a confirmed COMPRESSED. */
  readonly failure?: Error;
  /** What the compression threw, when it threw. */
  readonly thrown?: unknown;
}

async function attemptCompression(
  deps: GuardedCompressionDeps,
  promptId: string,
  onCommitted: () => void,
): Promise<CompressionAttempt> {
  try {
    const result = await deps.performCompression(promptId, {
      bypassCooldown: true,
      trigger: 'auto',
      onCommitted,
    });
    await deps.historyService.waitForTokenUpdates();
    if (result === PerformCompressionResult.COMPRESSED) {
      return {};
    }
    deps.logger.debug(
      () =>
        `[CompressionHandler] Provider-content compression finished without COMPRESSED result: ${result}`,
    );
    return {
      failure: new Error(
        `Auto compression did not complete during hard-limit enforcement (result: ${result})`,
      ),
    };
  } catch (error) {
    const compressionError = normalizeError(error);
    if (!isAbortLikeError(error)) {
      deps.logger.warn(
        () =>
          '[CompressionHandler] Auto compression failed during hard-limit enforcement',
        compressionError,
      );
    }
    return { failure: compressionError, thrown: error };
  }
}

/**
 * Runs one compression and classifies its outcome: the failure for an
 * exception, FAILED, NOOP or SKIPPED, undefined for a confirmed COMPRESSED.
 * Anything else may have left history half rewritten, so the history, cache
 * anchor and prompt-token baseline captured beforehand are restored before the
 * caller recomposes or continues, except entries other writers committed while
 * the compression ran; when that rollback fails the request is rejected rather
 * than continued.
 *
 * Only an UNCOMMITTED rewrite is rolled back. A compression that committed (it
 * ended and was journaled) is a valid state a resume reproduces, so a failure
 * in a later step (token settlement, telemetry) is logged and the compression
 * counts as done: rolling back would leave the live history behind the
 * journal. Cancellation is rethrown on every path, after the rollback when
 * there is one: it is never a failed compression that lets truncation or the
 * overflow error take over.
 */
export async function runGuardedCompression(
  deps: GuardedCompressionDeps,
  promptId: string,
): Promise<Error | undefined> {
  return withHistoryState(deps, async (snapshot) => {
    const commit = watchCompressionCommit(deps);
    try {
      const attempt = await attemptCompression(deps, promptId, () =>
        commit.mark(),
      );
      if (attempt.failure === undefined) {
        return undefined;
      }
      if (commit.committed()) {
        deps.logger.warn(
          () =>
            '[CompressionHandler] Compression committed but a later step failed; keeping the journaled history',
          attempt.failure,
        );
        if (isAbortLikeError(attempt.thrown)) {
          throw attempt.thrown;
        }
        return undefined;
      }
      try {
        await rollbackHistoryState(deps, snapshot);
      } catch (rollbackError) {
        throw new CompressionRollbackError(
          [attempt.failure, normalizeError(rollbackError)],
          'Auto compression failed and its history rollback also failed',
        );
      }
      if (isAbortLikeError(attempt.thrown)) {
        throw attempt.thrown;
      }
      return attempt.failure;
    } finally {
      commit.stop();
    }
  });
}
