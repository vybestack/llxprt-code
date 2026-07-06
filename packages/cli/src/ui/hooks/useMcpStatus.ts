/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import type { McpDiscoveryRuntime } from '../cliUiRuntime.js';

export function useMcpStatus(config: McpDiscoveryRuntime) {
  const [discoveryState, setDiscoveryState] = useState<MCPDiscoveryState>(
    () =>
      config.getMcpClientManager()?.getDiscoveryState() ??
      MCPDiscoveryState.NOT_STARTED,
  );

  const [mcpServerCount, setMcpServerCount] = useState<number>(
    () => config.getMcpClientManager()?.getMcpServerCount() ?? 0,
  );

  useEffect(() => {
    const onChange = () => {
      const manager = config.getMcpClientManager();
      if (manager !== undefined) {
        setDiscoveryState(manager.getDiscoveryState());
        setMcpServerCount(manager.getMcpServerCount());
      } else {
        setDiscoveryState(MCPDiscoveryState.NOT_STARTED);
        setMcpServerCount(0);
      }
    };

    onChange();
    coreEvents.on(CoreEvent.McpClientUpdate, onChange);
    return () => {
      coreEvents.off(CoreEvent.McpClientUpdate, onChange);
    };
  }, [config]);

  // We are ready if discovery has completed, OR if it hasn't started and no MCP servers are configured.
  const configuredMcpServerCount = Object.keys(
    config.getMcpServers() ?? {},
  ).length;
  const isMcpReady =
    discoveryState === MCPDiscoveryState.COMPLETED ||
    (discoveryState === MCPDiscoveryState.NOT_STARTED &&
      configuredMcpServerCount === 0);

  return {
    discoveryState,
    mcpServerCount,
    isMcpReady,
  };
}
