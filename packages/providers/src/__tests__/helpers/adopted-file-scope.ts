/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderFileLifecycle } from '../../providerFilePolicy.js';

/**
 * Releases an adopted provider-file scope and fails loudly when the lifecycle
 * could not finish deleting the files it owns.
 */
export async function releaseAdoptedFileScope(
  lifecycle: ProviderFileLifecycle,
  scope: string,
): Promise<void> {
  const result = await lifecycle.cleanupScope('session', scope);
  if (result.failed > 0) {
    const snapshot = lifecycle.snapshot();
    const ids = [
      ...new Set([
        ...snapshot.pendingDeletionFileIds,
        ...snapshot.deletionFailures.map((failure) => failure.fileId),
      ]),
    ];
    throw new Error(
      `Provider file cleanup incomplete for runtime ${scope}; files=${ids.join(',') || 'unknown'}; failed=${result.failed}; deferred=${result.deferred}`,
    );
  }
  if (result.deferred > 0)
    await lifecycle.waitForScopeCleanup('session', scope);
}
