/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import type * as acp from '@agentclientprotocol/sdk';
import {
  type WorkspaceTrustReader,
  type Config,
  type DebugLogger,
  type MessageBus,
  CoreMessageBusAdapter,
  CoreShellToolHostAdapter,
  CoreToolRegistryHostAdapter,
} from '@vybestack/llxprt-code-core';
import { ShellTool, ToolRegistry } from '@vybestack/llxprt-code-tools';
import { resolveAcquisitionBudgetFromSetting } from '@vybestack/llxprt-code-core';
import { AcpTerminalShellHost } from './acp-terminal-shell-host.js';
import { TerminalManager } from './zed-terminal-manager.js';

export interface ZedTerminalSetup {
  readonly registry: ToolRegistry;
  readonly terminals: TerminalManager;
}

export function buildZedTerminalSetup(
  sessionId: string,
  config: Config,
  baseRegistry: Pick<ToolSelection, 'getAllTools'>,
  connection: acp.AgentSideConnection,
  logger: DebugLogger,
  messageBus: MessageBus,
  paths: WorkspacePathOperations,
  settings: SessionSettingsOwner,
  trust: WorkspaceTrustReader,
): ZedTerminalSetup {
  // ACP receives the same finite acquisition budget as local shell execution,
  // rather than approximating bytes from the model-facing token limit.
  const outputBudget = resolveAcquisitionBudgetFromSetting(
    settings.readNamedParameter('shell-output-retention-max-bytes'),
  );
  const terminals = new TerminalManager(
    sessionId,
    connection,
    config.getTargetDir(),
    (update) => connection.sessionUpdate({ sessionId, update }),
    logger,
    outputBudget,
  );
  const messageBusAdapter = new CoreMessageBusAdapter(messageBus);
  const registry = new ToolRegistry(
    new CoreToolRegistryHostAdapter(config, trust),
    messageBusAdapter,
    () => settings.readRegistryPolicy(config.getExcludeTools() ?? []),
  );
  const baseTools = baseRegistry.getAllTools();
  let hasShellTool = false;
  for (const tool of baseTools) {
    if (tool.name === ShellTool.Name) {
      hasShellTool = true;
      continue;
    }
    registry.registerTool(tool);
  }
  if (hasShellTool) {
    registry.registerTool(
      new ShellTool(
        new AcpTerminalShellHost(
          new CoreShellToolHostAdapter(config, paths, () =>
            settings.readToolExecutionPolicy(),
          ),
          terminals,
        ),
        messageBusAdapter,
      ),
    );
  }
  return { registry, terminals };
}
