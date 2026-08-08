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
    // The zed terminal path routes shell execution through AcpTerminalShellHost
    // (interactive terminals), not the session-owned ShellJobManager, so the
    // background-job manager is intentionally undefined here. The owning
    // SessionRuntime (built inside fromConfig) retains the real manager for the
    // tasks API and background launches.
    registry.registerTool(
      new ShellTool(
        new AcpTerminalShellHost(
          new CoreShellToolHostAdapter(config, undefined),
          terminals,
        ),
        messageBusAdapter,
      ),
    );
  }
  return { registry, terminals };
}
