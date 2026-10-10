/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionToolCatalogOwner } from './session-tool-catalog-owner.js';
import { toToolDeclaration } from '../core/clientToolGovernance.js';

export function acceptSkillPublication(
  client: Pick<AgentClientContract, 'isInitialized' | 'setTools'>,
  tools: Pick<SessionToolCatalogOwner, 'acceptSkillPublication'>,
  enqueue: (operation: () => Promise<void>) => Promise<void>,
): (
  workspace: ReturnType<ToolSelection['getFunctionDeclarations']>,
) => Promise<void> {
  const project = client.isInitialized()
    ? tools.acceptSkillPublication()
    : undefined;
  return (workspace) => {
    const declarations = project?.(workspace).flatMap((entry) => {
      const declaration = toToolDeclaration(entry);
      return declaration === null ? [] : [declaration];
    });
    return enqueue(async () => {
      if (client.isInitialized()) await client.setTools(declarations);
    });
  };
}

export function publishWorkspaceInstructions(
  client: Pick<
    AgentClientContract,
    'isInitialized' | 'updateSystemInstruction'
  >,
  instructions: Parameters<AgentClientContract['updateSystemInstruction']>[0],
  stopped: () => boolean,
  enqueue: (operation: () => Promise<void>) => Promise<void>,
): Promise<void> {
  return enqueue(async () => {
    if (stopped()) return;
    if (client.isInitialized())
      await client.updateSystemInstruction(instructions);
  });
}
