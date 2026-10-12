/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { type ProviderFileCleanupResult } from '../providerFilePolicy.js';

function cleanupFailureMessage(
  runtimeId: string,
  result: ProviderFileCleanupResult,
  lifecycle: ProviderFileLifecycle,
): string | undefined {
  if (result.failed === 0) return undefined;
  const snapshot = lifecycle.snapshot();
  const fileIds = [
    ...snapshot.pendingDeletionFileIds,
    ...snapshot.deletionFailures.map((failure) => failure.fileId),
  ];
  return `Provider file cleanup incomplete for runtime ${runtimeId}; files=${[...new Set(fileIds)].join(',') || 'unknown'}; failed=${result.failed}; deferred=${result.deferred}`;
}

export async function cleanupOwnedProviderFiles(
  lifecycle: ProviderFileLifecycle,
  runtimeId: string,
): Promise<void> {
  const cleanup = await lifecycle.cleanupScope('session', runtimeId);
  const failure = cleanupFailureMessage(runtimeId, cleanup, lifecycle);
  if (failure !== undefined) throw new Error(failure);
  if (cleanup.deferred > 0) {
    await lifecycle.waitForScopeCleanup('session', runtimeId);
  }
}
