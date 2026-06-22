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
    getAgentClient?: ReturnType<typeof vi.fn>;
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

  describe('schema functionality', () => {
    it('should display tool schemas when schema argument is used', async () => {
      const mockMcpServers = {
        server1: {
          command: 'cmd1',
          description: 'This is a server description',
        },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      // Create tools with parameter schemas
      const mockCallableTool1: CallableTool = {
        callTool: vi.fn(),
        tool: vi.fn(),
      } as unknown as CallableTool;
      const mockCallableTool2: CallableTool = {
        callTool: vi.fn(),
        tool: vi.fn(),
      } as unknown as CallableTool;

      const tool1 = new DiscoveredMCPTool(
        mockCallableTool1,
        'server1',
        'tool1',
        'This is tool 1 description',
        {
          type: Type.OBJECT,
          properties: {
            param1: { type: Type.STRING, description: 'First parameter' },
          },
          required: ['param1'],
        },
        false,
      );

      const tool2 = new DiscoveredMCPTool(
        mockCallableTool2,
        'server1',
        'tool2',
        'This is tool 2 description',
        {
          type: Type.OBJECT,
          properties: {
            param2: { type: Type.NUMBER, description: 'Second parameter' },
          },
          required: ['param2'],
        },
        false,
      );

      const mockServerTools = [tool1, tool2];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(mockServerTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Create new context with updated config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, 'schema');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Configured MCP servers:'),
      });

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      // Check that server description is included
      expect(message).toContain('Ready (2 tools)');
      expect(message).toContain('This is a server description');

      // Check that tool descriptions and schemas are included
      expect(message).toContain('This is tool 1 description');
      expect(message).toContain('Parameters:');
      expect(message).toContain('param1');
      expect(message).toContain('STRING');
      expect(message).toContain('This is tool 2 description');
      expect(message).toContain('param2');
      expect(message).toContain('NUMBER');
    });

    it('should handle tools without parameter schemas gracefully', async () => {
      const mockMcpServers = {
        server1: { command: 'cmd1' },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      // Mock tools without parameter schemas
      const mockServerTools = [
        createMockMCPTool('tool1', 'server1', 'Tool without schema'),
      ];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(mockServerTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Create new context with updated config
      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const result = await mcpCommand.action!(testContext, 'schema');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Configured MCP servers:'),
      });

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('tool1');
      expect(message).toContain('Tool without schema');
      // Should not crash when parameterSchema is undefined
    });
  });

  describe('argument parsing', () => {
    beforeEach(() => {
      const mockMcpServers = {
        server1: {
          command: 'cmd1',
          description: 'Server description',
        },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);

      const mockServerTools = [
        createMockMCPTool('tool1', 'server1', 'Test tool'),
      ];

      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue(mockServerTools),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

      // Recreate context with updated config
      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
        },
        ui: {
          reloadCommands: vi.fn(),
        },
      });
    });

    it('should handle "descriptions" as alias for "desc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'descriptions');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('Test tool');
      expect(message).toContain('Server description');
    });

    it('should handle "nodescriptions" as alias for "nodesc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'nodescriptions');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).not.toContain('Test tool');
      expect(message).not.toContain('Server description');
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle mixed case arguments', async () => {
      const result = await mcpCommand.action!(mockContext, 'DESC');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('Test tool');
      expect(message).toContain('Server description');
    });

    it('should handle multiple arguments - "schema desc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'schema desc');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('Test tool');
      expect(message).toContain('Server description');
      expect(message).toContain('Parameters:');
    });

    it('should handle multiple arguments - "desc schema"', async () => {
      const result = await mcpCommand.action!(mockContext, 'desc schema');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('Test tool');
      expect(message).toContain('Server description');
      expect(message).toContain('Parameters:');
    });

    it('should handle "schema" alone showing descriptions', async () => {
      const result = await mcpCommand.action!(mockContext, 'schema');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('Test tool');
      expect(message).toContain('Server description');
      expect(message).toContain('Parameters:');
    });

    it('should handle "nodesc" overriding "schema" - "schema nodesc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'schema nodesc');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).not.toContain('Test tool');
      expect(message).not.toContain('Server description');
      expect(message).toContain('Parameters:'); // Schema should still show
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle "nodesc" overriding "desc" - "desc nodesc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'desc nodesc');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).not.toContain('Test tool');
      expect(message).not.toContain('Server description');
      expect(message).not.toContain('Parameters:');
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle "nodesc" overriding both "desc" and "schema" - "desc schema nodesc"', async () => {
      const result = await mcpCommand.action!(
        mockContext,
        'desc schema nodesc',
      );

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).not.toContain('Test tool');
      expect(message).not.toContain('Server description');
      expect(message).toContain('Parameters:'); // Schema should still show
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle extra whitespace in arguments', async () => {
      const result = await mcpCommand.action!(mockContext, '  desc   schema  ');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).toContain('Test tool');
      expect(message).toContain('Server description');
      expect(message).toContain('Parameters:');
    });

    it('should handle empty arguments gracefully', async () => {
      const result = await mcpCommand.action!(mockContext, '');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).not.toContain('Test tool');
      expect(message).not.toContain('Server description');
      expect(message).not.toContain('Parameters:');
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle unknown arguments gracefully', async () => {
      const result = await mcpCommand.action!(mockContext, 'unknown arg');

      assertMessageAction(result);
      expect(result.content).toBeTruthy();

      const message = result.content;

      expect(message).not.toContain('Test tool');
      expect(message).not.toContain('Server description');
      expect(message).not.toContain('Parameters:');
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
    });
  });

  describe('edge cases', () => {
    it('should handle empty server names gracefully', async () => {
      const mockMcpServers = {
        '': { command: 'cmd1' }, // Empty server name
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);
      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue([]),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

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

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Configured MCP servers:'),
      });
    });

    it('should handle servers with special characters in names', async () => {
      const mockMcpServers = {
        'server-with-dashes': { command: 'cmd1' },
        server_with_underscores: { command: 'cmd2' },
        'server.with.dots': { command: 'cmd3' },
      };

      mockConfig.getMcpServers = vi.fn().mockReturnValue(mockMcpServers);
      mockConfig.getToolRegistry = vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockReturnValue([]),
        discoverAllTools: vi.fn().mockResolvedValue(undefined),
      });

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

      expect(message).toContain('server-with-dashes');
      expect(message).toContain('server_with_underscores');
      expect(message).toContain('server.with.dots');
    });
  });
});
