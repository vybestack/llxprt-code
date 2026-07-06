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
import type {
  Agent,
  McpDetailStatus,
  McpServerDetail,
  ToolInfo,
} from '@vybestack/llxprt-code-agents';

vi.mock('open', () => ({ default: vi.fn() }));

vi.mock('@vybestack/llxprt-code-mcp', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-mcp')>();
  return {
    ...actual,
    getMCPServerStatus: vi.fn(),
    getMCPDiscoveryState: vi.fn(),
    mcpServerRequiresOAuth: new Map<string, boolean>(),
    MCPOAuthProvider: { authenticate: vi.fn() },
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

const createMockMCPTool = (
  serverToolName: string,
  serverName: string,
  description?: string,
) =>
  new DiscoveredMCPTool(
    { callTool: vi.fn(), tool: vi.fn() } as unknown as CallableTool,
    serverName,
    serverToolName,
    description === undefined || description === ''
      ? `Description for ${serverToolName}`
      : description,
    { type: Type.OBJECT, properties: {} },
    true,
  );

function projectToolToInfo(tool: DiscoveredMCPTool): ToolInfo {
  const schema = tool.schema.parametersJsonSchema as
    | Readonly<Record<string, unknown>>
    | undefined;
  return {
    name: tool.name,
    displayName: tool.displayName,
    ...(tool.description.length > 0 ? { description: tool.description } : {}),
    source: 'mcp',
    server: tool.serverName,
    enabled: true,
    serverToolName: tool.serverToolName,
    ...(schema !== undefined ? { parametersSchema: schema } : {}),
  };
}

function createMockAgent(tools: DiscoveredMCPTool[] = []): Agent {
  const toolsByServer = new Map<string, ToolInfo[]>();
  for (const tool of tools) {
    const bucket = toolsByServer.get(tool.serverName) ?? [];
    bucket.push(projectToolToInfo(tool));
    toolsByServer.set(tool.serverName, bucket);
  }
  const servers: McpServerDetail[] = [...toolsByServer.keys()].map((name) => ({
    name,
    authenticated: false,
    requiresAuth: false,
    oauthStatus: 'not-required' as const,
    sessionAuthenticated: false,
    tools: toolsByServer.get(name) ?? [],
  }));
  const detailStatus: McpDetailStatus = { servers, blockedServers: [] };
  return {
    mcp: {
      details: vi.fn().mockResolvedValue(detailStatus),
      refresh: vi.fn().mockResolvedValue(undefined),
      status: vi.fn(),
      listServers: vi.fn().mockReturnValue([]),
      toolsByServer: vi.fn().mockReturnValue({}),
      auth: vi.fn(),
      discoveryState: vi.fn().mockReturnValue('ready'),
      authenticate: vi.fn(),
    },
    tools: {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
      setEnabled: vi.fn(),
      onConfirmationRequest: vi.fn(),
      respondToConfirmation: vi.fn(),
      onToolUpdate: vi.fn(),
      setEditorCallbacks: vi.fn(),
      keys: {} as never,
    },
  } as unknown as Agent;
}

describe('mcpCommand', () => {
  let mockConfig: {
    getMcpServers: ReturnType<typeof vi.fn>;
    getBlockedMcpServers: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SANDBOX;
    vi.mocked(getMCPServerStatus).mockReturnValue(MCPServerStatus.CONNECTED);
    vi.mocked(getMCPDiscoveryState).mockReturnValue(
      MCPDiscoveryState.COMPLETED,
    );
    mockConfig = {
      getMcpServers: vi.fn().mockReturnValue({}),
      getBlockedMcpServers: vi.fn().mockReturnValue([]),
    };
  });

  describe('schema functionality', () => {
    it('should display tool schemas when schema argument is used', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: {
          command: 'cmd1',
          description: 'This is a server description',
        },
      });

      const tool1 = new DiscoveredMCPTool(
        { callTool: vi.fn(), tool: vi.fn() } as unknown as CallableTool,
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
        { callTool: vi.fn(), tool: vi.fn() } as unknown as CallableTool,
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

      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: createMockAgent([tool1, tool2]),
        },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, 'schema');
      assertMessageAction(result);
      const message = result.content;

      expect(message).toContain('Ready (2 tools)');
      expect(message).toContain('This is a server description');
      expect(message).toContain('This is tool 1 description');
      expect(message).toContain('Parameters:');
      expect(message).toContain('param1');
      expect(message).toContain('STRING');
      expect(message).toContain('This is tool 2 description');
      expect(message).toContain('param2');
      expect(message).toContain('NUMBER');
    });

    it('should handle tools without parameter schemas gracefully', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: { command: 'cmd1' },
      });

      // Build the tool inline with an explicit undefined parameterSchema so
      // schema.parametersJsonSchema resolves to undefined, genuinely
      // exercising the no-parameter-schema path (createMockMCPTool always
      // supplies an object schema, which would not).
      const toolWithoutSchema = new DiscoveredMCPTool(
        { callTool: vi.fn(), tool: vi.fn() } as unknown as CallableTool,
        'server1',
        'tool1',
        'Tool without schema',
        undefined,
        true,
      );

      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: createMockAgent([toolWithoutSchema]),
        },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, 'schema');
      assertMessageAction(result);
      const message = result.content;

      expect(message).toContain('tool1');
      expect(message).toContain('Tool without schema');
      // With no parameter schema, the schema view must NOT emit a Parameters:
      // section for this tool.
      expect(message).not.toContain('Parameters:');
    });
  });

  describe('argument parsing', () => {
    let mockContext: ReturnType<typeof createMockCommandContext>;

    beforeEach(() => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: {
          command: 'cmd1',
          description: 'Server description',
        },
      });

      mockContext = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: createMockAgent([
            createMockMCPTool('tool1', 'server1', 'Test tool'),
          ]),
        },
        ui: { reloadCommands: vi.fn() },
      });
    });

    it('should handle "descriptions" as alias for "desc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'descriptions');
      assertMessageAction(result);
      expect(result.content).toContain('Test tool');
      expect(result.content).toContain('Server description');
    });

    it('should handle "nodescriptions" as alias for "nodesc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'nodescriptions');
      assertMessageAction(result);
      expect(result.content).not.toContain('Test tool');
      expect(result.content).not.toContain('Server description');
      expect(result.content).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle mixed case arguments', async () => {
      const result = await mcpCommand.action!(mockContext, 'DESC');
      assertMessageAction(result);
      expect(result.content).toContain('Test tool');
      expect(result.content).toContain('Server description');
    });

    it('should handle multiple arguments - "schema desc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'schema desc');
      assertMessageAction(result);
      expect(result.content).toContain('Test tool');
      expect(result.content).toContain('Server description');
      expect(result.content).toContain('Parameters:');
    });

    it('should handle multiple arguments - "desc schema"', async () => {
      const result = await mcpCommand.action!(mockContext, 'desc schema');
      assertMessageAction(result);
      expect(result.content).toContain('Test tool');
      expect(result.content).toContain('Server description');
      expect(result.content).toContain('Parameters:');
    });

    it('should handle "schema" alone showing descriptions', async () => {
      const result = await mcpCommand.action!(mockContext, 'schema');
      assertMessageAction(result);
      expect(result.content).toContain('Test tool');
      expect(result.content).toContain('Server description');
      expect(result.content).toContain('Parameters:');
    });

    it('should handle "nodesc" overriding "schema" - "schema nodesc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'schema nodesc');
      assertMessageAction(result);
      expect(result.content).not.toContain('Test tool');
      expect(result.content).not.toContain('Server description');
      expect(result.content).toContain('Parameters:');
      expect(result.content).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle "nodesc" overriding "desc" - "desc nodesc"', async () => {
      const result = await mcpCommand.action!(mockContext, 'desc nodesc');
      assertMessageAction(result);
      expect(result.content).not.toContain('Test tool');
      expect(result.content).not.toContain('Server description');
      expect(result.content).not.toContain('Parameters:');
      expect(result.content).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle "nodesc" overriding both "desc" and "schema" - "desc schema nodesc"', async () => {
      const result = await mcpCommand.action!(
        mockContext,
        'desc schema nodesc',
      );
      assertMessageAction(result);
      expect(result.content).not.toContain('Test tool');
      expect(result.content).not.toContain('Server description');
      expect(result.content).toContain('Parameters:');
      expect(result.content).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle extra whitespace in arguments', async () => {
      const result = await mcpCommand.action!(mockContext, '  desc   schema  ');
      assertMessageAction(result);
      expect(result.content).toContain('Test tool');
      expect(result.content).toContain('Server description');
      expect(result.content).toContain('Parameters:');
    });

    it('should handle empty arguments gracefully', async () => {
      const result = await mcpCommand.action!(mockContext, '');
      assertMessageAction(result);
      expect(result.content).not.toContain('Test tool');
      expect(result.content).not.toContain('Server description');
      expect(result.content).not.toContain('Parameters:');
      expect(result.content).toContain('\u001b[36mtool1\u001b[0m');
    });

    it('should handle unknown arguments gracefully', async () => {
      const result = await mcpCommand.action!(mockContext, 'unknown arg');
      assertMessageAction(result);
      expect(result.content).not.toContain('Test tool');
      expect(result.content).not.toContain('Server description');
      expect(result.content).not.toContain('Parameters:');
      expect(result.content).toContain('\u001b[36mtool1\u001b[0m');
    });
  });

  describe('edge cases', () => {
    it('should handle empty server names gracefully', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        '': { command: 'cmd1' },
      });

      const testContext = createMockCommandContext({
        services: { config: mockConfig, agent: createMockAgent([]) },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'info',
        content: expect.stringContaining('Configured MCP servers:'),
      });
    });

    it('should handle servers with special characters in names', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        'server-with-dashes': { command: 'cmd1' },
        server_with_underscores: { command: 'cmd2' },
        'server.with.dots': { command: 'cmd3' },
      });

      const testContext = createMockCommandContext({
        services: { config: mockConfig, agent: createMockAgent([]) },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
      expect(result.content).toContain('server-with-dashes');
      expect(result.content).toContain('server_with_underscores');
      expect(result.content).toContain('server.with.dots');
    });
  });
});
