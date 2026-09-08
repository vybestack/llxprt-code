/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { SemanticMediaPurgeAttempt } from './semanticMediaPurgeSession.js';
import type { PreparedUserTurn } from './mediaAdmissionSeam.js';

export async function failedTurnCleanup(
  prepared: PreparedUserTurn,
  semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  try {
    await prepared.releaseIfUncommitted();
  } catch (error: unknown) {
    failures.push(error);
  }
  try {
    await semanticMediaPurge?.failAfterProcessingError();
  } catch (error: unknown) {
    failures.push(error);
  }
  return failures;
}

export async function throwAfterFailedTurnCleanup(
  primaryError: unknown,
  prepared: PreparedUserTurn,
  semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
): Promise<never> {
  const cleanupFailures = await failedTurnCleanup(prepared, semanticMediaPurge);
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupFailures],
      'Turn failed and media cleanup was incomplete',
    );
  }
  throw primaryError;
}

async function completeStreamTermination(
  operation: () => Promise<IteratorResult<StreamEvent>>,
  prepared: PreparedUserTurn,
  semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
  onDone: () => void,
): Promise<IteratorResult<StreamEvent>> {
  let result: IteratorResult<StreamEvent> | undefined;
  let primaryFailure: { readonly error: unknown } | undefined;
  const cleanupFailures: unknown[] = [];
  try {
    result = await operation();
  } catch (error: unknown) {
    primaryFailure = { error };
  }
  if (!prepared.isTransferredToHistory()) {
    cleanupFailures.push(
      ...(await failedTurnCleanup(prepared, semanticMediaPurge)),
    );
  }
  try {
    onDone();
  } catch (error: unknown) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      primaryFailure === undefined
        ? cleanupFailures
        : [primaryFailure.error, ...cleanupFailures],
      'Cancelled stream turn media cleanup was incomplete',
    );
  }
  if (primaryFailure !== undefined) throw primaryFailure.error;
  return result ?? { done: true, value: undefined };
}

export function wrapStreamGeneratorLifecycle(
  stream: AsyncGenerator<StreamEvent>,
  prepared: PreparedUserTurn,
  semanticMediaPurge: SemanticMediaPurgeAttempt | undefined,
  onDone: () => void,
): AsyncGenerator<StreamEvent> {
  const wrapped: AsyncGenerator<StreamEvent> & {
    [Symbol.asyncDispose](): Promise<void>;
  } = {
    next: (value?: unknown) => stream.next(value),
    return: (value?: unknown) =>
      completeStreamTermination(
        () => stream.return(value),
        prepared,
        semanticMediaPurge,
        onDone,
      ),
    throw: (error?: unknown) =>
      completeStreamTermination(
        async () => {
          const result = await stream.throw(error);
          return result.done === true ? result : stream.return(undefined);
        },
        prepared,
        semanticMediaPurge,
        onDone,
      ),
    [Symbol.asyncIterator](): AsyncGenerator<StreamEvent> {
      return wrapped;
    },
    [Symbol.asyncDispose]: async (): Promise<void> => {
      await wrapped.return(undefined);
    },
  };
  return wrapped;
}
