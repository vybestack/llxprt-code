/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import {
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
  baseRegistry: ToolRegistry,
  connection: acp.AgentSideConnection,
  logger: DebugLogger,
  messageBus: MessageBus,
): ZedTerminalSetup {
  // ACP receives the same finite acquisition budget as local shell execution,
  // rather than approximating bytes from the model-facing token limit.
  const outputBudget = resolveAcquisitionBudgetFromSetting(
    config.getEphemeralSetting('shell-output-retention-max-bytes'),
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
    new CoreToolRegistryHostAdapter(config),
    messageBusAdapter,
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
          new CoreShellToolHostAdapter(config),
          terminals,
        ),
        messageBusAdapter,
      ),
    );
  }
  return { registry, terminals };
}
