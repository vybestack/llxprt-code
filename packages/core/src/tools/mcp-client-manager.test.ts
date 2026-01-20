/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect } from 'vitest';
import { McpClientManager } from './mcp-client-manager.js';
import { McpClient } from './mcp-client.js';
import type { Config } from '../config/config.js';
import type { ToolRegistry } from './tool-registry.js';
import type { PromptRegistry } from '../prompts/prompt-registry.js';
import type { ResourceRegistry } from '../resources/resource-registry.js';
import type { WorkspaceContext } from '../utils/workspaceContext.js';

vi.mock('./mcp-client.js', () => ({
  McpClient: vi.fn(),
  MCPDiscoveryState: {
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
  },
  populateMcpServerCommand: vi.fn((servers, _command) => servers),
}));

describe('McpClientManager', () => {
  it('should discover tools from all configured servers', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn(),
      getStatus: vi.fn(),
      getServerConfig: vi.fn().mockReturnValue({}),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );
    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({
        'test-server': {},
      }),
      getMcpServerCommand: () => '',
      getPromptRegistry: () => ({}) as PromptRegistry,
      getResourceRegistry: () => ({}) as ResourceRegistry,
      getDebugMode: () => false,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getEnableExtensionReloading: () => false,
      getExtensionEvents: () => undefined,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getGeminiClient: () => ({
        isInitialized: () => false,
      }),
      refreshMcpContext: vi.fn(),
    } as unknown as Config;
    const manager = new McpClientManager({} as ToolRegistry, mockConfig);
    await manager.startConfiguredMcpServers();
    expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
    expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
    expect(mockConfig.refreshMcpContext).toHaveBeenCalledOnce();
  });

  it('should batch context refresh when starting multiple servers', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn(),
      getStatus: vi.fn(),
      getServerConfig: vi.fn().mockReturnValue({}),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );
    const refreshMcpContext = vi.fn();
    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({
        'server-1': {},
        'server-2': {},
        'server-3': {},
      }),
      getMcpServerCommand: () => '',
      getPromptRegistry: () => ({}) as PromptRegistry,
      getResourceRegistry: () => ({}) as ResourceRegistry,
      getDebugMode: () => false,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getEnableExtensionReloading: () => false,
      getExtensionEvents: () => undefined,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getGeminiClient: () => ({
        isInitialized: () => false,
      }),
      refreshMcpContext,
    } as unknown as Config;
    const manager = new McpClientManager({} as ToolRegistry, mockConfig);
    await manager.startConfiguredMcpServers();

    // Each client should be connected/discovered
    expect(mockedMcpClient.connect).toHaveBeenCalledTimes(3);
    expect(mockedMcpClient.discover).toHaveBeenCalledTimes(3);

    // Context refresh should happen once after all servers start
    expect(refreshMcpContext).toHaveBeenCalledOnce();
  });

  it('should not discover tools if folder is not trusted', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn(),
      getStatus: vi.fn(),
      getServerConfig: vi.fn().mockReturnValue({}),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );
    const mockConfig = {
      isTrustedFolder: () => false,
      getMcpServers: () => ({
        'test-server': {},
      }),
      getMcpServerCommand: () => '',
      getPromptRegistry: () => ({}) as PromptRegistry,
      getResourceRegistry: () => ({}) as ResourceRegistry,
      getDebugMode: () => false,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getEnableExtensionReloading: () => false,
      getExtensionEvents: () => undefined,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getGeminiClient: () => ({
        isInitialized: () => false,
      }),
    } as unknown as Config;
    const manager = new McpClientManager({} as ToolRegistry, mockConfig);
    await manager.startConfiguredMcpServers();
    expect(mockedMcpClient.connect).not.toHaveBeenCalled();
    expect(mockedMcpClient.discover).not.toHaveBeenCalled();
  });

  it('should not hang when geminiClient is not yet initialized during discovery', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn(),
      getStatus: vi.fn(),
      getServerConfig: vi.fn().mockReturnValue({}),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );
    // Simulate the real initialization order: geminiClient is created AFTER
    // Promise.all([startConfiguredMcpServers(), extensionLoader.start()]),
    // so getGeminiClient() returns undefined during MCP discovery.
    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({
        'test-server': {},
      }),
      getMcpServerCommand: () => '',
      getPromptRegistry: () => ({}) as PromptRegistry,
      getResourceRegistry: () => ({}) as ResourceRegistry,
      getDebugMode: () => false,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getEnableExtensionReloading: () => false,
      getExtensionEvents: () => undefined,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getGeminiClient: () => undefined,
      refreshMcpContext: vi.fn(),
    } as unknown as Config;
    const manager = new McpClientManager({} as ToolRegistry, mockConfig);

    // This must resolve, not hang forever
    await manager.startConfiguredMcpServers();

    expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
    expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
  });

  describe('getMcpInstructions', () => {
    it('should aggregate instructions from all connected servers', async () => {
      const mockedMcpClient1 = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn().mockReturnValue('connected'),
        getServerConfig: vi.fn().mockReturnValue({}),
        getInstructions: vi.fn().mockReturnValue('Server 1 instructions'),
      };
      const mockedMcpClient2 = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn().mockReturnValue('connected'),
        getServerConfig: vi.fn().mockReturnValue({}),
        getInstructions: vi.fn().mockReturnValue('Server 2 instructions'),
      };

      let callCount = 0;
      vi.mocked(McpClient).mockImplementation(() => {
        const client = callCount === 0 ? mockedMcpClient1 : mockedMcpClient2;
        callCount++;
        return client as unknown as McpClient;
      });

      const mockConfig = {
        isTrustedFolder: () => true,
        getMcpServers: () => ({
          'server-1': {},
          'server-2': {},
        }),
        getMcpServerCommand: () => '',
        getPromptRegistry: () => ({}) as PromptRegistry,
        getResourceRegistry: () => ({}) as ResourceRegistry,
        getDebugMode: () => false,
        getWorkspaceContext: () => ({}) as WorkspaceContext,
        getEnableExtensionReloading: () => false,
        getExtensionEvents: () => undefined,
        getAllowedMcpServers: () => undefined,
        getBlockedMcpServers: () => undefined,
        getGeminiClient: () => ({
          isInitialized: () => false,
        }),
        refreshMcpContext: vi.fn(),
      } as unknown as Config;

      const manager = new McpClientManager({} as ToolRegistry, mockConfig);
      await manager.startConfiguredMcpServers();

      const instructions = manager.getMcpInstructions();
      expect(instructions).toContain(
        "The following are instructions provided by the tool server 'server-1':",
      );
      expect(instructions).toContain('---[start of server instructions]---');
      expect(instructions).toContain('Server 1 instructions');
      expect(instructions).toContain('---[end of server instructions]---');
      expect(instructions).toContain(
        "The following are instructions provided by the tool server 'server-2':",
      );
      expect(instructions).toContain('Server 2 instructions');
    });

    it('should return empty string when no servers have instructions', async () => {
      const mockedMcpClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn().mockReturnValue('connected'),
        getServerConfig: vi.fn().mockReturnValue({}),
        getInstructions: vi.fn().mockReturnValue(''),
      };

      vi.mocked(McpClient).mockReturnValue(
        mockedMcpClient as unknown as McpClient,
      );

      const mockConfig = {
        isTrustedFolder: () => true,
        getMcpServers: () => ({
          'test-server': {},
        }),
        getMcpServerCommand: () => '',
        getPromptRegistry: () => ({}) as PromptRegistry,
        getResourceRegistry: () => ({}) as ResourceRegistry,
        getDebugMode: () => false,
        getWorkspaceContext: () => ({}) as WorkspaceContext,
        getEnableExtensionReloading: () => false,
        getExtensionEvents: () => undefined,
        getAllowedMcpServers: () => undefined,
        getBlockedMcpServers: () => undefined,
        getGeminiClient: () => ({
          isInitialized: () => false,
        }),
        refreshMcpContext: vi.fn(),
      } as unknown as Config;

      const manager = new McpClientManager({} as ToolRegistry, mockConfig);
      await manager.startConfiguredMcpServers();

      const instructions = manager.getMcpInstructions();
      expect(instructions).toBe('');
    });

    it('should include instructions from servers with content', async () => {
      const mockedMcpClient1 = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn().mockReturnValue('connected'),
        getServerConfig: vi.fn().mockReturnValue({}),
        getInstructions: vi
          .fn()
          .mockReturnValue('Connected server instructions'),
      };
      const mockedMcpClient2 = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn().mockReturnValue('connected'),
        getServerConfig: vi.fn().mockReturnValue({}),
        getInstructions: vi.fn().mockReturnValue(''),
      };

      let callCount = 0;
      vi.mocked(McpClient).mockImplementation(() => {
        const client = callCount === 0 ? mockedMcpClient1 : mockedMcpClient2;
        callCount++;
        return client as unknown as McpClient;
      });

      const mockConfig = {
        isTrustedFolder: () => true,
        getMcpServers: () => ({
          'server-with-instructions': {},
          'server-without-instructions': {},
        }),
        getMcpServerCommand: () => '',
        getPromptRegistry: () => ({}) as PromptRegistry,
        getResourceRegistry: () => ({}) as ResourceRegistry,
        getDebugMode: () => false,
        getWorkspaceContext: () => ({}) as WorkspaceContext,
        getEnableExtensionReloading: () => false,
        getExtensionEvents: () => undefined,
        getAllowedMcpServers: () => undefined,
        getBlockedMcpServers: () => undefined,
        getGeminiClient: () => ({
          isInitialized: () => false,
        }),
        refreshMcpContext: vi.fn(),
      } as unknown as Config;

      const manager = new McpClientManager({} as ToolRegistry, mockConfig);
      await manager.startConfiguredMcpServers();

      const instructions = manager.getMcpInstructions();
      expect(instructions).toContain(
        "The following are instructions provided by the tool server 'server-with-instructions':",
      );
      expect(instructions).toContain('---[start of server instructions]---');
      expect(instructions).toContain('Connected server instructions');
      expect(instructions).toContain('---[end of server instructions]---');
      expect(instructions).not.toContain(
        "The following are instructions provided by the tool server 'server-without-instructions':",
      );
    });
  });
});
