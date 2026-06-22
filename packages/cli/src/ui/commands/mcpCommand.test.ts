/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { mcpCommand } from './mcpCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  MCPServerStatus,
  MCPDiscoveryState,
  getMCPServerStatus,
  getMCPDiscoveryState,
  DiscoveredMCPTool,
} from '@vybestack/llxprt-code-mcp';
import type { MessageActionReturn } from './types.js';
import type { CallableTool } from '@google/genai';
import { Type } from '@google/genai';

// Mock external dependencies
vi.mock('open', () => ({
  default: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-mcp', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-mcp')>();
  return {
    ...actual,
    getMCPServerStatus: vi.fn(),
    getMCPDiscoveryState: vi.fn(),
    mcpServerRequiresOAuth: new Map<string, boolean>(),
    MCPOAuthProvider: {
      authenticate: vi.fn(),
    },
    MCPOAuthTokenStorage: {
      getToken: vi.fn(),
      isTokenExpired: vi.fn(),
    },
  };
});

function assertMessageAction(
  result: unknown,
): asserts result is MessageActionReturn {
  expect(result).toMatchObject({ type: 'message' });
  if (
    result === null ||
    typeof result !== 'object' ||
    !('type' in result) ||
    result.type !== 'message'
  ) {
    throw new Error('Expected message action');
  }
}

const createMockMCPResource = (
  serverName: string,
  uri: string,
  name: string,
) => ({
  serverName,
  uri,
  name,
  mimeType: 'text/plain',
  description: `Description for ${name}`,
  discoveredAt: Date.now(),
});

// Helper function to create a mock DiscoveredMCPTool
const createMockMCPTool = (
  serverToolName: string,
  serverName: string,
  description?: string,
) =>
  new DiscoveredMCPTool(
    {
      callTool: vi.fn(),
      tool: vi.fn(),
    } as unknown as CallableTool,
    serverName,
    serverToolName,
    description === undefined || description === ''
      ? `Description for ${serverToolName}`
      : description,
    { type: Type.OBJECT, properties: {} },
    true,
  );

describe('mcpCommand', () => {
  let mockContext: ReturnType<typeof createMockCommandContext>;
  let mockConfig: {
    getToolRegistry: ReturnType<typeof vi.fn>;
    getMcpServers: ReturnType<typeof vi.fn>;
    getBlockedMcpServers: ReturnType<typeof vi.fn>;
    getPromptRegistry: ReturnType<typeof vi.fn>;
    getResourceRegistry: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock environment
    delete process.env.SANDBOX;

    // Default mock implementations
    vi.mocked(getMCPServerStatus).mockReturnValue(MCPServerStatus.CONNECTED);
    vi.mocked(getMCPDiscoveryState).mockReturnValue(
      MCPDiscoveryState.COMPLETED,
    );

    // Create mock config with all necessary methods
    mockConfig = {
      getToolRegistry: vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue([]),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      }),
      getMcpServers: vi.fn().mockReturnValue({}),
      getBlockedMcpServers: vi.fn().mockReturnValue([]),
      getPromptRegistry: vi.fn().mockReturnValue({
        getAllPrompts: vi.fn().mockReturnValue([]),
        getPromptsByServer: vi.fn().mockReturnValue([]),
      }),
      getResourceRegistry: vi.fn().mockReturnValue({
        getAllResources: vi.fn().mockReturnValue([]),
      }),
      getAgentClient: vi.fn().mockReturnValue(null),
    };

    mockContext = createMockCommandContext({
      services: {
        config: mockConfig,
      },
      ui: {
        reloadCommands: vi.fn(),
      },
    });
  });

  describe('basic functionality', () => {
    it('should show an error if config is not available', async () => {
      const contextWithoutConfig = createMockCommandContext({
        services: {
          config: null,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(contextWithoutConfig, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Config not loaded.',
      });
    });

    it('should show an error if tool registry is not available', async () => {
      const contextWithNoRegistry = createMockCommandContext({
        services: {
          config: {
            ...mockConfig,
            getToolRegistry: vi.fn().mockReturnValue(undefined),
          },
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(contextWithNoRegistry, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Could not retrieve tool registry.',
      });
    });
  });

  describe('no MCP servers configured', () => {
    beforeEach(() => {
      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue([]),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });
      mockConfig.getMcpServers = vi.fn().mockReturnValue({});
    });

    it('should display a message with a URL when no MCP servers are configured', async () => {
      const result = await mcpCommand.action!(mockContext, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content:
          'No MCP servers configured. Please view MCP documentation in your browser: https://github.com/vybestack/llxprt-code/blob/main/docs/tools/mcp-server.md or use the cli /docs command',
      });
    });
  });

  describe('with configured MCP servers', () => {
    beforeEach(() => {
      const mockMcpServers = {
        server1: { command: 'cmd1' },
        server2: { command: 'cmd2' },
        server3: { command: 'cmd3' },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      // Ensure the tool registry is properly set up with tools
      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue([]),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Update the mockContext with the new config
      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });
    });

    it('should display configured MCP servers with status indicators and their tools', async () => {
      // Setup getMCPServerStatus mock implementation
      vi.mocked(getMCPServerStatus).mockImplementation((serverName) => {
        if (serverName === 'server1') return MCPServerStatus.CONNECTED;
        if (serverName === 'server2') return MCPServerStatus.CONNECTED;
        return MCPServerStatus.DISCONNECTED; // server3
      });

      // Mock tools from each server using actual DiscoveredMCPTool instances
      const mockServer1Tools = [
        createMockMCPTool('server1_tool1', 'server1'),
        createMockMCPTool('server1_tool2', 'server1'),
      ];
      const mockServer2Tools = [createMockMCPTool('server2_tool1', 'server2')];
      const mockServer3Tools = [createMockMCPTool('server3_tool1', 'server3')];

      const allTools = [
        ...mockServer1Tools,
        ...mockServer2Tools,
        ...mockServer3Tools,
      ];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(allTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Update mockContext with the new config for this test
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Configured MCP servers:'),
      });

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      // Server 1 - Connected
      expect(message).toContain(
        '[READY] \u001b[1mserver1\u001b[0m - Ready (2 tools)',
      );
      expect(message).toContain('server1_tool1');
      expect(message).toContain('server1_tool2');

      // Server 2 - Connected
      expect(message).toContain(
        '[READY] \u001b[1mserver2\u001b[0m - Ready (1 tool)',
      );
      expect(message).toContain('server2_tool1');

      // Server 3 - Disconnected but with cached tools, so shows as Ready
      expect(message).toContain(
        '[READY] \u001b[1mserver3\u001b[0m - Ready (1 tool)',
      );
      expect(message).toContain('server3_tool1');

      // Check that helpful tips are displayed when no arguments are provided
      expect(message).toContain('TIP: Tips:');
      expect(message).toContain('/mcp desc');
      expect(message).toContain('/mcp schema');
      expect(message).toContain('/mcp nodesc');
      expect(message).toContain('Ctrl+T');
    });

    it('should include resource counts and resource names in MCP status output', async () => {
      vi.mocked(getMCPServerStatus).mockImplementation((serverName) => {
        if (serverName === 'server1') return MCPServerStatus.CONNECTED;
        if (serverName === 'server2') return MCPServerStatus.CONNECTED;
        return MCPServerStatus.DISCONNECTED;
      });

      const mockServer1Tools = [createMockMCPTool('server1_tool1', 'server1')];
      const mockServer2Tools: DiscoveredMCPTool[] = [];
      const allTools = [...mockServer1Tools, ...mockServer2Tools];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(allTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      mockConfig.getResourceRegistry = vi.fn().mockReturnValue({
        getAllResources: vi
          .fn()
          .mockReturnValue([
            createMockMCPResource(
              'server1',
              'file:///docs/readme.md',
              'README',
            ),
            createMockMCPResource(
              'server2',
              'file:///docs/changelog.md',
              'CHANGELOG',
            ),
          ]),
      });

      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, '');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('Ready (1 tool, 1 resource)');
      expect(message).toContain('Ready (1 resource)');
      expect(message).toContain('Resources:');
      expect(message).toContain('README');
      expect(message).toContain('file:///docs/readme.md');
      expect(message).toContain('CHANGELOG');
      expect(message).toContain('file:///docs/changelog.md');
    });

    it('should display tool descriptions when desc argument is used', async () => {
      const mockMcpServers = {
        server1: {
          command: 'cmd1',
          description: 'This is a server description',
        },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      // Mock tools with descriptions using actual DiscoveredMCPTool instances
      const mockServerTools = [
        createMockMCPTool('tool1', 'server1', 'This is tool 1 description'),
        createMockMCPTool('tool2', 'server1', 'This is tool 2 description'),
      ];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(mockServerTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Update context with new config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, 'desc');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Configured MCP servers:'),
      });

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      // Check that server description is included
      expect(message).toContain('\u001b[1mserver1\u001b[0m - Ready (2 tools)');
      expect(message).toContain(
        '\u001b[32mThis is a server description\u001b[0m',
      );

      // Check that tool descriptions are included
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
      expect(message).toContain(
        '\u001b[32mThis is tool 1 description\u001b[0m',
      );
      expect(message).toContain('\u001b[36mtool2\u001b[0m');
      expect(message).toContain(
        '\u001b[32mThis is tool 2 description\u001b[0m',
      );

      // Check that tips are NOT displayed when arguments are provided
      expect(message).not.toContain('TIP: Tips:');
    });

    it('should not display descriptions when nodesc argument is used', async () => {
      const mockMcpServers = {
        server1: {
          command: 'cmd1',
          description: 'This is a server description',
        },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      const mockServerTools = [
        createMockMCPTool('tool1', 'server1', 'This is tool 1 description'),
      ];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(mockServerTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Update context with new config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, 'nodesc');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Configured MCP servers:'),
      });

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      // Check that descriptions are not included
      expect(message).not.toContain('This is a server description');
      expect(message).not.toContain('This is tool 1 description');
      expect(message).toContain('\u001b[36mtool1\u001b[0m');

      // Check that tips are NOT displayed when arguments are provided
      expect(message).not.toContain('TIP: Tips:');
    });

    it('should indicate when a server has no tools', async () => {
      const mockMcpServers = {
        server1: { command: 'cmd1' },
        server2: { command: 'cmd2' },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      // Setup server statuses
      vi.mocked(getMCPServerStatus).mockImplementation((serverName) => {
        if (serverName === 'server1') return MCPServerStatus.CONNECTED;
        if (serverName === 'server2') return MCPServerStatus.DISCONNECTED;
        return MCPServerStatus.DISCONNECTED;
      });

      // Mock tools - only server1 has tools
      const mockServerTools = [createMockMCPTool('server1_tool1', 'server1')];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(mockServerTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Update context with new config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, '');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain(
        '[READY] \u001b[1mserver1\u001b[0m - Ready (1 tool)',
      );
      expect(message).toContain('\u001b[36mserver1_tool1\u001b[0m');
      expect(message).toContain(
        '[DISCONNECTED] \u001b[1mserver2\u001b[0m - Disconnected (0 tools cached)',
      );
      expect(message).toContain('No tools, prompts, or resources available');
    });

    it('should show startup indicator when servers are connecting', async () => {
      const mockMcpServers = {
        server1: { command: 'cmd1' },
        server2: { command: 'cmd2' },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      // Setup server statuses with one connecting
      vi.mocked(getMCPServerStatus).mockImplementation((serverName) => {
        if (serverName === 'server1') return MCPServerStatus.CONNECTED;
        if (serverName === 'server2') return MCPServerStatus.CONNECTING;
        return MCPServerStatus.DISCONNECTED;
      });

      // Setup discovery state as in progress
      vi.mocked(getMCPDiscoveryState).mockReturnValue(
        MCPDiscoveryState.IN_PROGRESS,
      );

      // Mock tools
      const mockServerTools = [
        createMockMCPTool('server1_tool1', 'server1'),
        createMockMCPTool('server2_tool1', 'server2'),
      ];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(mockServerTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Update context with new config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, '');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      // Check that startup indicator is shown
      expect(message).toContain(
        'MCP servers are starting up (1 initializing)...',
      );
      expect(message).toContain(
        'Note: First startup may take longer. Tool availability will update automatically.',
      );

      // Check server statuses
      expect(message).toContain(
        '[READY] \u001b[1mserver1\u001b[0m - Ready (1 tool)',
      );
      expect(message).toContain(
        '[STARTING] \u001b[1mserver2\u001b[0m - Starting... (first startup may take longer) (tools and prompts will appear when ready)',
      );
    });

    it('should display the extension name for servers from extensions', async () => {
      const mockMcpServers = {
        server1: { command: 'cmd1', extensionName: 'my-extension' },
      };
      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      // Create new context with updated config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, '');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('server1 (from my-extension)');
    });

    it('should display blocked MCP servers', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({});
      const blockedServers = [
        { name: 'blocked-server', extensionName: 'my-extension' },
      ];
      mockConfig.getBlockedMcpServers = vi.fn().mockReturnValue(blockedServers);

      // Create new context with updated config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, '');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain(
        '[BLOCKED] \u001b[1mblocked-server (from my-extension)\u001b[0m - Blocked',
      );
    });

    it('should display both active and blocked servers correctly', async () => {
      const mockMcpServers = {
        server1: { command: 'cmd1', extensionName: 'my-extension' },
      };
      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);
      const blockedServers = [
        { name: 'blocked-server', extensionName: 'another-extension' },
      ];
      mockConfig.getBlockedMcpServers = vi.fn().mockReturnValue(blockedServers);

      // Create new context with updated config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, '');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('server1 (from my-extension)');
      expect(message).toContain(
        '[BLOCKED] \u001b[1mblocked-server (from another-extension)\u001b[0m - Blocked',
      );
    });
  });
});
