/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { unsupportedApprovalPolicy } from '@vybestack/llxprt-code-mcp/test-support/approval-policy.js';

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DiscoveredMCPTool } from '@vybestack/llxprt-code-mcp';
import {
  ACTIVATE_MCP_SERVER_TOOL_NAME,
  type CallableTool,
} from '@vybestack/llxprt-code-tools';
import {
  createMockConfig,
  disposeMockConfig,
} from './subagent-test-helpers.js';

function createCallableTool(): CallableTool {
  return {
    async tool() {
      return [];
    },
    async callTool() {
      return [];
    },
  };
}

describe('createMockConfig MCP lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps complete lazy-MCP registry behavior while scheduled refreshes complete', async () => {
    const { created } =
      await observeKeepsCompleteLazyMCPRegistryBehaviorWhileScheduledRefreshesComplete();
    expect(
      created.toolRegistry
        .getAllTools()
        .filter((tool) => 'serverName' in tool)
        .map((tool) => Reflect.get(tool, 'serverName')),
    ).toContain('scheduled-server');
    expect(created.mcpRuntime.toolSelection).toBe(created.toolRegistry);
    expect(
      created.toolRegistry
        .getAllTools()
        .some((tool) => tool.name === ACTIVATE_MCP_SERVER_TOOL_NAME),
    ).toBe(true);
  });

  const observeKeepsCompleteLazyMCPRegistryBehaviorWhileScheduledRefreshesComplete =
    async () => {
      let releaseRefresh: (() => void) | undefined;
      let markRefreshStarted: (() => void) | undefined;
      let config: Config | undefined;
      const refreshGate = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      const refreshStarted = new Promise<void>((resolve) => {
        markRefreshStarted = resolve;
      });

      try {
        const created = await createMockConfig(
          { getTool: () => undefined },
          { 'mcp.lazy': true },
        );
        config = created.config;
        const scan = created.mcpRuntime.workspaceFilesystem.scans.run;
        vi.spyOn(
          created.mcpRuntime.workspaceFilesystem.scans,
          'run',
        ).mockImplementation((directories, operation) =>
          scan(directories, async () => {
            markRefreshStarted?.();
            await refreshGate;
            return operation();
          }),
        );
        const refreshing =
          created.mcpRuntime.workspaceMemory.operations.refresh();
        await refreshStarted;

        created.mcpRuntime.toolPublication.registerTool(
          new DiscoveredMCPTool(
            unsupportedApprovalPolicy(),
            createCallableTool(),
            'scheduled-server',
            'fixture-tool',
            'Scheduled refresh fixture',
            { type: 'object' },
          ),
        );

        releaseRefresh?.();
        await refreshing;
        await created.mcpRuntime.refreshContext();

        return { created, config };
      } finally {
        releaseRefresh?.();
        if (config !== undefined) {
          await disposeMockConfig(config);
        }
      }
    };
});
