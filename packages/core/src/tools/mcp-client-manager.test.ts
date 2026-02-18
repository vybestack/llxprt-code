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
    expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
    expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
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
      getDebugMode: () => false,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getEnableExtensionReloading: () => false,
      getExtensionEvents: () => undefined,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getGeminiClient: () => undefined,
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

      const instructions = manager.getMcpInstructions();
      expect(instructions).toContain('server-1');
      expect(instructions).toContain('Server 1 instructions');
      expect(instructions).toContain('server-2');
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

      const instructions = manager.getMcpInstructions();
      expect(instructions).toBe('');
    });

    it('should skip servers that are not connected', async () => {
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
        getStatus: vi.fn().mockReturnValue('disconnected'),
        getServerConfig: vi.fn().mockReturnValue({}),
        getInstructions: vi
          .fn()
          .mockReturnValue('Disconnected server instructions'),
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
          'connected-server': {},
          'disconnected-server': {},
        }),
        getMcpServerCommand: () => '',
        getPromptRegistry: () => ({}) as PromptRegistry,
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

      const instructions = manager.getMcpInstructions();
      expect(instructions).toContain('Connected server instructions');
      expect(instructions).not.toContain('Disconnected server instructions');
    });
  });
});
