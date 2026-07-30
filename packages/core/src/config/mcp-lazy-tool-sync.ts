/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ACTIVATE_MCP_SERVER_TOOL_NAME,
  ActivateMcpServerTool,
  type ToolRegistry,
  type IToolMessageBus,
} from '@vybestack/llxprt-code-tools';

export async function syncActivateMcpServerTool(
  registry: ToolRegistry,
  messageBus: IToolMessageBus | undefined,
  refreshMcpContext: () => Promise<void>,
): Promise<void> {
  if (messageBus === undefined) return;

  const deferred = registry.listDeferredMcpServers();
  const existing = registry
    .getAllTools()
    .find((tool) => tool.name === ACTIVATE_MCP_SERVER_TOOL_NAME);

  if (existing instanceof ActivateMcpServerTool) {
    registry.unregisterTool(ACTIVATE_MCP_SERVER_TOOL_NAME);
  } else if (existing !== undefined && deferred.length > 0) {
    throw new Error(
      `Cannot register activation tool: a foreign tool named "${ACTIVATE_MCP_SERVER_TOOL_NAME}" is already registered.`,
    );
  }

  if (deferred.length > 0) {
    registry.registerTool(
      new ActivateMcpServerTool(registry, messageBus, refreshMcpContext),
    );
  }
}
