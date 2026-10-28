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
 * Workspace owners the caller transferred with ownership 'agent'. createAgent
 * is their only rollback authority until MCP assembly accepts them. After
 * `handOffToMcp()` the MCP runtime is the sole authority: it releases them if
 * its construction fails and when it is disposed, so `cleanupFailedConstruction`
 * releases nothing and cannot report their failures a second time.
 */
export interface TransferredWorkspaceOwners {
  cleanupFailedConstruction(): Promise<void>;
  handOffToMcp(): void;
}

export function prepareTransferredWorkspaceOwners(
  inputs: TransferInputs,
): TransferredWorkspaceOwners {
  // Dependents first: memory reads through the filesystem owner.
  const owners = [
    inputs.lspOwnership === 'agent' ? inputs.lspOwner : undefined,
    inputs.definitionOwnership === 'agent' ? inputs.definitionOwner : undefined,
    inputs.memoryOwner?.ownership === 'agent'
      ? inputs.memoryOwner.owner
      : undefined,
    inputs.filesystemOwnership === 'agent' ? inputs.filesystemOwner : undefined,
  ].flatMap((owner) => (owner === undefined ? [] : [owner]));
  let handedOff = false;
  let release: Promise<void> | undefined;
  return {
    cleanupFailedConstruction: () => {
      if (handedOff) return Promise.resolve();
      release ??= releaseInOrder(owners);
      return release;
    },
    handOffToMcp: () => {
      handedOff = true;
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
