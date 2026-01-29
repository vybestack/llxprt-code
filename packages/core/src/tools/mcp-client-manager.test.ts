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
});
