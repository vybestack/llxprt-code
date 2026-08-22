/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
      return {};
    },
    async callTool() {
      return [];
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMockConfig MCP lifecycle', () => {
  it('keeps complete lazy-MCP registry behavior while scheduled refreshes complete', async () => {
    let releaseRefresh: (() => void) | undefined;
    let markRefreshStarted: (() => void) | undefined;
    let config: Config | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      markRefreshStarted = resolve;
    });
    vi.spyOn(Config.prototype, 'refreshMemory').mockImplementation(async () => {
      markRefreshStarted?.();
      await refreshGate;
      return { memoryContent: '', fileCount: 0, filePaths: [] };
    });

    try {
      const created = await createMockConfig({ getTool: () => undefined });
      config = created.config;
      await refreshStarted;

      config.setEphemeralSetting('mcp.lazy', true);
      created.toolRegistry.registerTool(
        new DiscoveredMCPTool(
          createCallableTool(),
          'scheduled-server',
          'fixture-tool',
          'Scheduled refresh fixture',
          { type: 'object' },
        ),
      );
      expect(created.toolRegistry.listDeferredMcpServers()).toEqual([
        'scheduled-server',
      ]);
      expect(config.getToolRegistry()).toBe(created.toolRegistry);

      releaseRefresh?.();
      await config.refreshMcpContext();
      expect(
        created.toolRegistry
          .getAllTools()
          .some((tool) => tool.name === ACTIVATE_MCP_SERVER_TOOL_NAME),
      ).toBe(true);
    } finally {
      releaseRefresh?.();
      if (config !== undefined) {
        await disposeMockConfig(config);
      }
    }
  });
});
