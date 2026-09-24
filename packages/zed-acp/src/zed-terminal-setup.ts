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
  type ShellJobPort,
  CoreMessageBusAdapter,
  CoreShellToolHostAdapter,
  CoreToolRegistryHostAdapter,
  CoreSkillServiceAdapter,
} from '@vybestack/llxprt-code-core';
import {
  ActivateMcpServerTool,
  ShellTool,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import { resolveAcquisitionBudgetFromSetting } from '@vybestack/llxprt-code-core';
import { AcpTerminalShellHost } from './acp-terminal-shell-host.js';
import { ActivateSkillTool } from '@vybestack/llxprt-code-tools/tools/activate-skill.js';
import { TerminalManager } from './zed-terminal-manager.js';

export interface ZedTerminalSetup {
  readonly registry: ToolRegistry;
  readonly terminals: TerminalManager;
}

export function buildZedSessionToolRegistry(
  config: Config,
  baseRegistry: ToolRegistry,
  messageBus: MessageBus,
): ToolRegistry {
  const registry = new ToolRegistry(
    new CoreToolRegistryHostAdapter(config),
    new CoreMessageBusAdapter(messageBus),
    config.getSettingsService(),
  );
  for (const tool of baseRegistry.getAllTools()) {
    registry.registerTool(tool);
  }
  // The base registry belongs to the shared Config. Activation tools built
  // with its initializer's bus must not be copied into another session.
  if (registry.getTool(ActivateSkillTool.Name) instanceof ActivateSkillTool) {
    config.getPostSkillDiscoveryToolRegistrar()?.(
      registry,
      new CoreSkillServiceAdapter(config),
      messageBus,
    );
  }
  if (
    registry.getTool(ActivateMcpServerTool.Name) instanceof
    ActivateMcpServerTool
  ) {
    registry.unregisterTool(ActivateMcpServerTool.Name);
    if (registry.listDeferredMcpServers().length > 0) {
      registry.registerTool(
        new ActivateMcpServerTool(registry, messageBus, () =>
          config.refreshMcpContext(messageBus),
        ),
      );
    }
  }
  return registry;
}

export function buildZedTerminalSetup(
  sessionId: string,
  config: Config,
  baseRegistry: ToolRegistry,
  connection: acp.AgentSideConnection,
  logger: DebugLogger,
  messageBus: MessageBus,
  shellJobs: ShellJobPort,
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
  const registry = buildZedSessionToolRegistry(
    config,
    baseRegistry,
    messageBus,
  );
  if (registry.getTool(ShellTool.Name) !== undefined) {
    registry.unregisterTool(ShellTool.Name);
    registry.registerTool(
      new ShellTool(
        new AcpTerminalShellHost(
          new CoreShellToolHostAdapter(config, () => shellJobs),
          terminals,
        ),
        messageBusAdapter,
      ),
    );
  }
  return { registry, terminals };
}
