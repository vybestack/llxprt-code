/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import {
  type Config,
  type DebugLogger,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { CoreShellToolHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreShellToolHostAdapter.js';
import { CoreToolRegistryHostAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreToolRegistryHostAdapter.js';
import { ShellTool, ToolRegistry } from '@vybestack/llxprt-code-tools';
import { AcpTerminalShellHost } from './acp-terminal-shell-host.js';
import { TerminalManager } from './zed-terminal-manager.js';

export interface ZedTerminalSetup {
  readonly messageBus: MessageBus;
  readonly registry: ToolRegistry;
  readonly terminals: TerminalManager;
}

export function buildZedTerminalSetup(
  sessionId: string,
  config: Config,
  baseRegistry: ToolRegistry,
  connection: acp.AgentSideConnection,
  logger: DebugLogger,
): ZedTerminalSetup {
  const messageBus = new MessageBus(
    config.getPolicyEngine(),
    config.getDebugMode(),
  );
  const outputLimit = config.getEphemeralSetting('tool-output-max-tokens');
  const terminals = new TerminalManager(
    sessionId,
    connection,
    config.getTargetDir(),
    (update) => connection.sessionUpdate({ sessionId, update }),
    logger,
    typeof outputLimit === 'number' ? outputLimit : undefined,
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
  return { messageBus, registry, terminals };
}
