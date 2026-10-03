/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Config } from './test-support/mcpClientTestSupport.js';
import { PromptRegistry } from './test-support/mcpClientTestSupport.js';
import { ResourceRegistry } from './test-support/mcpClientTestSupport.js';
import { WorkspaceContext } from './test-support/mcpClientTestSupport.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
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
    const promptRegistry = new PromptRegistry();
    const resourceRegistry = new ResourceRegistry();
    const config = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'good-server': {}, 'bad-server': {} }),
      getMcpServerCommand: () => '',
      getPromptRegistry: () => promptRegistry,
      getResourceRegistry: () => resourceRegistry,
      getDebugMode: () => false,
      getWorkspaceContext: () => new WorkspaceContext(''),
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      refreshMcpContext: vi.fn(),
    } as unknown as Config;
    const toolRegistry = new ToolRegistry(
      config,
      { requestConfirmation: async () => false },
      new SettingsService(),
    );
    const removeTools = vi.spyOn(toolRegistry, 'removeMcpToolsByServer');
    const removePrompts = vi.spyOn(promptRegistry, 'removePromptsByServer');
    const removeResources = vi.spyOn(
      resourceRegistry,
      'removeResourcesByServer',
    );
    const manager = new McpClientManager('0.0.1', toolRegistry, config);

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
    expect(manager.getMcpInstructions()).toContain('good-server instructions');
  });
});

describe('independent MCP discovery notices', () => {
  it('routes interleaved failures to the owning manager without aborting discovery', async () => {
    const noticesA: string[] = [];
    const noticesB: string[] = [];
    const pending = new Map<string, (error: Error) => void>();
    mockMcpClient.mockImplementation((name: string) => ({
      connect: () =>
        new Promise<void>((_resolve, reject) => {
          pending.set(name, reject);
        }),
      disconnect: async () => {},
      getServerConfig: () => ({}),
    }));
    const createManager = (
      name: string,
      notices: string[],
    ): McpClientManager => {
      const config = {
        isTrustedFolder: () => true,
        getMcpServers: () => ({ [name]: { command: 'unused' } }),
        getMcpServerCommand: () => undefined,
        getPromptRegistry: () => new PromptRegistry(),
        getResourceRegistry: () => new ResourceRegistry(),
        getDebugMode: () => false,
        getWorkspaceContext: () => new WorkspaceContext(''),
        getAllowedMcpServers: () => undefined,
        getBlockedMcpServers: () => undefined,
        getExtensions: () => [],
        refreshMcpContext: async () => {},
      } as unknown as Config;
      const tools = new ToolRegistry(
        config,
        { requestConfirmation: async () => false },
        new SettingsService(),
      );
      return new McpClientManager('0.0.1', tools, config, undefined, 10_000, {
        emitFeedback: (_severity, message) => notices.push(message),
        openBrowser: async () => {},
      });
    };
    const first = createManager('server-a', noticesA);
    const second = createManager('server-b', noticesB);
    const discoveryA = first.startConfiguredMcpServers();
    const discoveryB = second.startConfiguredMcpServers();

    pending.get('server-b')?.(new Error('B unavailable'));
    await discoveryB;
    pending.get('server-a')?.(new Error('A unavailable'));
    await discoveryA;

    expect(noticesA).toHaveLength(1);
    expect(noticesA[0]).toContain('server-a');
    expect(noticesA[0]).not.toContain('server-b');
    expect(noticesB).toHaveLength(1);
    expect(noticesB[0]).toContain('server-b');
    expect(noticesB[0]).not.toContain('server-a');
    expect(first.getDiscoveryFailures().get('server-a')).toContain(
      'A unavailable',
    );
    expect(second.getDiscoveryFailures().get('server-b')).toContain(
      'B unavailable',
    );
  });
});

describe('advisory MCP discovery notices', () => {
  it('keeps failed discovery recorded when the owning notice sink throws', async () => {
    mockMcpClient.mockImplementation(() => ({
      connect: async () => {
        throw new Error('offline');
      },
      disconnect: async () => {},
      getServerConfig: () => ({}),
    }));
    const config = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ broken: { command: 'unused' } }),
      getMcpServerCommand: () => undefined,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getPromptRegistry: () => new PromptRegistry(),
      getResourceRegistry: () => new ResourceRegistry(),
      getWorkspaceContext: () => new WorkspaceContext(''),
      getDebugMode: () => false,
      getExtensions: () => [],
      refreshMcpContext: async () => {},
    } as unknown as Config;
    const manager = new McpClientManager(
      '0.0.1',
      new ToolRegistry(
        config,
        { requestConfirmation: async () => false },
        new SettingsService(),
      ),
      config,
      undefined,
      10_000,
      {
        emitFeedback: () => {
          throw new Error('notice sink unavailable');
        },
        openBrowser: async () => {},
      },
    );

    await manager.startConfiguredMcpServers();

    expect(manager.getDiscoveryFailures().get('broken')).toContain('offline');
  });
});
