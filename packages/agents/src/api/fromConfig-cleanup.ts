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

/**
 * Repeated identities can represent separate release failures, and a nested
 * owner failure has its own causal structure. Retain both without interpreting
 * equality with the bootstrap failure as evidence that cleanup succeeded.
 */
export function rethrowPrimaryAfterCleanup(
  primaryError: unknown,
  cleanupFailures: readonly unknown[],
  message: string,
): never {
  if (cleanupFailures.length === 0) throw primaryError;
  throw new AggregateError(
    [primaryError, ...cleanupFailures],
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
    Promise.resolve().then(closeGitHub),
    Promise.resolve().then(closeImages),
    Promise.resolve().then(closeDefinitions),
    Promise.resolve().then(closeMemory),
  ]);
  const preflightCleanup = await Promise.allSettled([
    Promise.resolve().then(closePreflight),
  ]);
  const failures = rejections([...ownerCleanup, ...preflightCleanup]);
  return rethrowPrimaryAfterCleanup(
    primaryError,
    failures,
    'fromConfig ownership cleanup failed',
  );
}

export async function cleanupFailedAdoption(
  primaryError: unknown,
  closeRuntime: () => void | Promise<void>,
  disposeWorkspace: (() => Promise<void>) | undefined,
  closeMedia: (() => Promise<void>) | undefined,
  closeClient: (() => Promise<void>) | undefined,
): Promise<never> {
  const mcpCleanup = await Promise.allSettled([
    Promise.resolve().then(disposeWorkspace),
  ]);
  const clientCleanup = await Promise.allSettled([
    Promise.resolve().then(closeClient),
  ]);
  const runtimeCleanup = await Promise.allSettled([
    Promise.resolve().then(closeRuntime),
  ]);
  const mediaCleanup = await Promise.allSettled([
    Promise.resolve().then(closeMedia),
  ]);
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
  const clients = await Promise.allSettled([
    Promise.resolve().then(closePreflight),
  ]);
  const resources = await Promise.allSettled([
    Promise.resolve().then(closeMedia),
    Promise.resolve().then(closeMcp),
  ]);
  const failures = rejections([...clients, ...resources]);
  if (failures.length > 0)
    throw new AggregateError(
      [error, ...failures],
      'Adopted media assembly cleanup failed',
    );
  throw error;
}

export async function cleanupFailedForegroundWorkspace(
  primary: unknown,
  closeMemory: () => Promise<void>,
  closeFilesystem: () => Promise<void>,
  closeTrust: () => Promise<void>,
): Promise<never> {
  const results: Array<PromiseSettledResult<void>> = [];
  for (const close of [closeMemory, closeFilesystem, closeTrust])
    results.push(
      ...(await Promise.allSettled([Promise.resolve().then(close)])),
    );
  const failures = rejections(results);
  return rethrowPrimaryAfterCleanup(
    primary,
    failures,
    'Memory bootstrap cleanup failed',
  );
}
export async function finishPreflightCleanup(
  actions: ReadonlyArray<() => void | Promise<void>>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const close of actions) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Preflight cleanup failed');
}
