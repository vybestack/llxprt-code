/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpClientManager } from '@vybestack/llxprt-code-mcp';
import type { WorkspaceTrustControlPort } from '@vybestack/llxprt-code-core';

export function subscribeMcpTrust(
  manager: McpClientManager,
  trust: WorkspaceTrustControlPort,
  accepted: Set<Promise<void>>,
  retain: (unsubscribe: () => void) => void,
): void {
  retain(
    trust.subscribeTrustChange((transition) => {
      if (!transition.trusted) manager.quarantineForTrustRevocation();
    }),
  );
  retain(
    trust.subscribeTrustTransition((transition) => {
      const operation = transition.trusted
        ? manager.onFolderTrustGained()
        : manager.onFolderTrustRevoked();
      accepted.add(operation);
      void operation
        .finally(() => accepted.delete(operation))
        .catch(() => undefined);
      return operation;
    }),
  );
}

export async function reconcileMcpStartupTrust(
  manager: McpClientManager,
  trust: WorkspaceTrustControlPort,
  initialTrust: boolean,
): Promise<void> {
  const trusted = trust.isTrustedFolder();
  if (trusted === initialTrust) return;
  if (!trusted) manager.quarantineForTrustRevocation();
  await (trusted
    ? manager.onFolderTrustGained()
    : manager.onFolderTrustRevoked());
}
