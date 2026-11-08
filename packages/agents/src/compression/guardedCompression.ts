/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { isAbortLikeError } from './is-abort-like-error.js';
import {
  captureHistoryState,
  rollbackHistoryState,
  watchIndependentWrites,
} from './historyStateRollback.js';
import type { ProviderContentEnforcementDeps } from './providerContentEnforcement.js';

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

interface CompressionAttempt {
  /** Undefined only for a confirmed COMPRESSED. */
  readonly failure?: Error;
  /** What the compression threw, when it threw. */
  readonly thrown?: unknown;
}

async function attemptCompression(
  deps: ProviderContentEnforcementDeps,
  promptId: string,
): Promise<CompressionAttempt> {
  try {
    const result = await deps.performCompression(promptId, {
      bypassCooldown: true,
      trigger: 'auto',
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
 * exception, FAILED, NOOP or SKIPPED, undefined only for a confirmed
 * COMPRESSED. Anything else may have left history half rewritten, so the
 * history, cache anchor and prompt-token baseline captured beforehand are
 * restored before the caller recomposes or continues, except entries other
 * writers committed while the compression ran; when that rollback
 * fails the request is rejected rather than continued. Cancellation is
 * rethrown after the rollback on every path: it is never a failed compression
 * that lets truncation or the overflow error take over.
 */
export async function runGuardedCompression(
  deps: ProviderContentEnforcementDeps,
  promptId: string,
): Promise<Error | undefined> {
  const snapshot = captureHistoryState(deps);
  const writes = watchIndependentWrites(deps.historyService);
  let attempt: CompressionAttempt;
  try {
    attempt = await attemptCompression(deps, promptId);
  } finally {
    writes.stop();
  }
  if (attempt.failure === undefined) {
    return undefined;
  }
  try {
    await rollbackHistoryState(deps, snapshot, writes);
  } catch (rollbackError) {
    throw new AggregateError(
      [attempt.failure, normalizeError(rollbackError)],
      'Auto compression failed and its history rollback also failed',
    );
  }
  if (isAbortLikeError(attempt.thrown)) {
    throw attempt.thrown;
  }
  return attempt.failure;
}
