/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import {
  type DebugLogger,
  type MessageBus,
  CoreMessageBusAdapter,
  type CoreToolRegistryHostAdapter,
} from '@vybestack/llxprt-code-core';
import type {
  EphemeralSettings,
  WorkspacePaths,
} from '@vybestack/llxprt-code-core/config/roles.js';
import {
  ShellTool,
  ToolRegistry,
  type IShellToolHost,
} from '@vybestack/llxprt-code-tools';
import { AcpTerminalShellHost } from './acp-terminal-shell-host.js';
import { TerminalManager } from './zed-terminal-manager.js';

type ZedTerminalSetupConfig = EphemeralSettings & WorkspacePaths;

export interface ZedTerminalSetup {
  readonly registry: ToolRegistry;
  readonly terminals: TerminalManager;
}

export function buildZedTerminalSetup(
  sessionId: string,
  config: ZedTerminalSetupConfig,
  baseRegistry: ToolRegistry,
  connection: acp.AgentSideConnection,
  logger: DebugLogger,
  messageBus: MessageBus,
  toolRegistryHost: CoreToolRegistryHostAdapter,
  shellToolHost: IShellToolHost,
): ZedTerminalSetup {
  const outputLimit = config.getEphemeralSetting('tool-output-max-tokens');
  const terminals = new TerminalManager(
    sessionId,
    connection,
    config.getTargetDir(),
    (update) => connection.sessionUpdate({ sessionId, update }),
    logger,
    typeof outputLimit === 'number' &&
    Number.isFinite(outputLimit) &&
    outputLimit > 0
      ? outputLimit
      : undefined,
  );
  const messageBusAdapter = new CoreMessageBusAdapter(messageBus);
  const registry = new ToolRegistry(toolRegistryHost, messageBusAdapter);
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
        new AcpTerminalShellHost(shellToolHost, terminals),
        messageBusAdapter,
      ),
    );
  }
  return { registry, terminals };
}
