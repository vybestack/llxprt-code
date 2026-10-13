/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getErrorMessage } from '@vybestack/llxprt-code-core';

function rejections(results: ReadonlyArray<PromiseSettledResult<unknown>>) {
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
}

function flattenFailures(failure: unknown): unknown[] {
  return failure instanceof AggregateError
    ? failure.errors.flatMap(flattenFailures)
    : [failure];
}

/**
 * Rethrows the primary bootstrap failure after cleanup. Cleanup operations
 * that join an already-failed construction step re-report the primary error
 * (possibly nested in an AggregateError); those are not cleanup failures and
 * are dropped by identity. Genuine cleanup failures are reported together
 * with the primary error, whose message leads the AggregateError message so
 * a top-level printer that shows only the message still names the cause.
 */
export function rethrowPrimaryAfterCleanup(
  primaryError: unknown,
  cleanupFailures: readonly unknown[],
  message: string,
): never {
  const independent = [
    ...new Set(cleanupFailures.flatMap(flattenFailures)),
  ].filter((failure) => failure !== primaryError);
  if (independent.length === 0) throw primaryError;
  throw new AggregateError(
    [primaryError, ...independent],
    `${message}: ${getErrorMessage(primaryError)}`,
  );
}

/**
 * Releases every construction owner after a failed adoption. The activation
 * preflight is released last, and any cleanup failure is attached to the
 * primary error instead of replacing it.
 */
export async function cleanupFailedFromConfig(
  primaryError: unknown,
  closeGitHub: (() => Promise<void>) | undefined,
  closeImages: () => Promise<void>,
  closeDefinitions: (() => Promise<void>) | undefined,
  closeMemory: (() => Promise<void>) | undefined,
  closePreflight: (() => Promise<void>) | undefined,
): Promise<never> {
  const ownerCleanup = await Promise.allSettled([
    closeGitHub?.(),
    closeImages(),
    closeDefinitions?.(),
    closeMemory?.(),
  ]);
  const preflightCleanup = await Promise.allSettled([closePreflight?.()]);
  const failures = rejections([...ownerCleanup, ...preflightCleanup]);
  return rethrowPrimaryAfterCleanup(
    primaryError,
    failures,
    'fromConfig ownership cleanup failed',
  );
}

/**
 * Releases the consumed preflight after a successful adoption. When that
 * release fails the adopted agent is disposed so it does not leak.
 */
export async function closePreflightAfterAdoption(
  closePreflight: (() => Promise<void>) | undefined,
  closeAgent: () => Promise<void>,
): Promise<void> {
  try {
    await closePreflight?.();
  } catch (closeError) {
    const agentCleanup = await Promise.allSettled([closeAgent()]);
    const failures = rejections(agentCleanup);
    if (failures.length > 0)
      throw new AggregateError(
        [closeError, ...failures],
        'fromConfig preflight cleanup failed',
      );
    throw closeError;
  }
}

export async function cleanupFailedAdoption(
  primaryError: unknown,
  closeRuntime: () => void | Promise<void>,
  disposeWorkspace: (() => Promise<void>) | undefined,
  closeMedia: (() => Promise<void>) | undefined,
  closeClient: (() => Promise<void>) | undefined,
): Promise<never> {
  const mcpCleanup = await Promise.allSettled([disposeWorkspace?.()]);
  const clientCleanup = await Promise.allSettled([closeClient?.()]);
  const runtimeCleanup = await Promise.allSettled([closeRuntime()]);
  const mediaCleanup = await Promise.allSettled([closeMedia?.()]);
  const failures = rejections([
    ...mcpCleanup,
    ...clientCleanup,
    ...runtimeCleanup,
    ...mediaCleanup,
  ]);
  return rethrowPrimaryAfterCleanup(
    primaryError,
    failures,
    'fromConfig bootstrap cleanup failed',
  );
}

export async function cleanupFailedMediaAssembly(
  error: unknown,
  closePreflight: (() => void | Promise<void>) | undefined,
  closeMedia: (() => Promise<void>) | undefined,
  closeMcp: (() => Promise<void>) | undefined,
): Promise<never> {
  const clients = await Promise.allSettled([closePreflight?.()]);
  const resources = await Promise.allSettled([closeMedia?.(), closeMcp?.()]);
  const failures = rejections([...clients, ...resources]);
  if (failures.length > 0)
    throw new AggregateError(
      [error, ...failures],
      'Adopted media assembly cleanup failed',
    );
  throw error;
}
