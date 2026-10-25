/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentConfig } from './config-types.js';

type TransferInputs = Pick<
  AgentConfig,
  | 'definitionOwner'
  | 'definitionOwnership'
  | 'filesystemOwner'
  | 'filesystemOwnership'
  | 'lspOwner'
  | 'lspOwnership'
  | 'memoryOwner'
>;

/**
 * Workspace owners the caller transferred with ownership 'agent'. The MCP
 * runtime takes them over only after input validation and the earlier
 * acquisitions succeed, so createAgent must release them itself when it
 * rejects before that point. Every owner's dispose is memoized, so releasing
 * after the runtime already did is a no-op.
 */
export function prepareTransferredWorkspaceOwners(inputs: TransferInputs): {
  cleanupFailedConstruction(): Promise<void>;
} {
  // Dependents first: memory reads through the filesystem owner.
  const owners = [
    inputs.lspOwnership === 'agent' ? inputs.lspOwner : undefined,
    inputs.definitionOwnership === 'agent' ? inputs.definitionOwner : undefined,
    inputs.memoryOwner?.ownership === 'agent'
      ? inputs.memoryOwner.owner
      : undefined,
    inputs.filesystemOwnership === 'agent' ? inputs.filesystemOwner : undefined,
  ].flatMap((owner) => (owner === undefined ? [] : [owner]));
  let release: Promise<void> | undefined;
  return {
    cleanupFailedConstruction: () => {
      release ??= releaseInOrder(owners);
      return release;
    },
  };
}

async function releaseInOrder(
  owners: ReadonlyArray<{ dispose(): Promise<void> }>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const owner of owners) {
    try {
      await owner.dispose();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'Transferred workspace owner cleanup failed',
    );
}
