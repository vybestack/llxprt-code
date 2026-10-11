import { installTestCatalogOwners } from '@vybestack/llxprt-code-test-utils/core/config.js';
const createTestCatalogOwner = installTestCatalogOwners();
import { createTestOAuthBinding } from './test-support/index.js';
import { unsupportedApprovalPolicy } from './test-support/approval-policy.js';
/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Config as BaseConfig } from './test-support/mcpClientTestSupport.js';

import {
  buildToolGovernance,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import { McpClientManager } from './mcp-client-manager.js';
import type { McpClient } from './mcp-client.js';
import { MCPDiscoveryState } from './mcp-client.js';

const { mockMcpClient } = {
  mockMcpClient: vi.fn(),
};
void vi.mock('./mcp-client.js', () => ({
  McpClient: mockMcpClient,
  MCPDiscoveryState: {
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
  },
  populateMcpServerCommand: vi.fn((servers: unknown) => servers),
}));

describe('McpClientManager partial discovery failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retains a successful server while cleaning every artifact for a failed server', async () => {
    const goodClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
      getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      getInstructions: vi.fn().mockReturnValue('good-server instructions'),
    };
    const badClient = {
      connect: vi.fn().mockRejectedValue(new Error('server crashed')),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
      getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    mockMcpClient
      .mockReturnValueOnce(goodClient as unknown as McpClient)
      .mockReturnValueOnce(badClient as unknown as McpClient);
    const catalog = createTestCatalogOwner();
    const promptRegistry = catalog.promptPublication;
    const resourceRegistry = catalog.resourcePublication;
    const configPrompts = promptRegistry;
    const configResources = resourceRegistry;
    const config = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'good-server': {}, 'bad-server': {} }),
      getMcpServerCommand: () => '',

      getDebugMode: () => false,

      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      refreshMcpContext: vi.fn(),
    } as unknown as Config;
    const toolRegistry = new ToolRegistry(
      config,
      { requestConfirmation: async () => false },
      () => ({
        hideTaskAsync: false,
        lazyMcp: false,
        eagerServers: [],
        governance: buildToolGovernance({
          getEphemeralSettings: () => ({}),
          getExcludeTools: () => [],
        }),
      }),
    );
    const removeTools = vi.spyOn(toolRegistry, 'removeMcpToolsByServer');
    const removePrompts = vi.spyOn(promptRegistry, 'removePromptsByServer');
    const removeResources = vi.spyOn(
      resourceRegistry,
      'removeResourcesByServer',
    );
    const manager = new McpClientManager(
      createTestOAuthBinding(),
      unsupportedApprovalPolicy(),
      '0.0.1',
      toolRegistry,
      configPrompts,
      configResources,
      config,
      config.refreshMcpContext,
    );

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();

    expect(manager.getDiscoveryFailures().get('bad-server')).toContain(
      'server crashed',
    );
    expect(manager.getDiscoveryFailures().has('good-server')).toBe(false);
    expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.COMPLETED);
    expect(manager.getMcpServerCount()).toBe(1);
    expect(badClient.disconnect).toHaveBeenCalledOnce();
    for (const remove of [removeTools, removePrompts, removeResources]) {
      expect(remove).toHaveBeenCalledWith('bad-server');
      expect(remove).not.toHaveBeenCalledWith('good-server');
    }
    expect(manager.readInstructions()).toContain('good-server instructions');
  });
});

type Config = BaseConfig & { refreshMcpContext(): Promise<void> };
