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
import type {
  Agent,
  McpDetailStatus,
  McpResourceInfo,
  McpServerDetail,
  ToolInfo,
} from '@vybestack/llxprt-code-agents';

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

const createMockMCPResource = (uri: string, name: string): McpResourceInfo => ({
  name,
  uri,
  description: `Description for ${name}`,
});

// Helper function to create a mock DiscoveredMCPTool (used to derive ToolInfo)
const createMockMCPTool = (
  serverToolName: string,
  serverName: string,
  description?: string,
): DiscoveredMCPTool =>
  new DiscoveredMCPTool(
    {
      callTool: vi.fn(),
      tool: vi.fn(),
    } as unknown as ConstructorParameters<typeof DiscoveredMCPTool>[0],
    serverName,
    serverToolName,
    description === undefined || description === ''
      ? `Description for ${serverToolName}`
      : description,
    { type: 'OBJECT', properties: {} },
    true,
  );

/**
 * Projects a DiscoveredMCPTool into the public ToolInfo shape, mirroring what
 * agent.mcp.details() returns. Used by createMockAgent to build realistic
 * detail payloads from legacy tool instances the tests already construct.
 */
function projectToolToInfo(tool: DiscoveredMCPTool): ToolInfo {
  const schema = tool.schema.parametersJsonSchema;
  return {
    name: tool.name,
    displayName: tool.displayName,
    ...(tool.description.length > 0 ? { description: tool.description } : {}),
    source: 'mcp',
    server: tool.serverName,
    enabled: true,
    serverToolName: tool.serverToolName,
    ...(typeof schema === 'object' && schema !== null
      ? { parametersSchema: schema as Readonly<Record<string, unknown>> }
      : {}),
  };
}

interface MockAgentOptions {
  tools?: DiscoveredMCPTool[];
  resources?: Array<{ serverName: string; resource: McpResourceInfo }>;
  blockedServers?: Array<{ name: string; extensionName: string }>;
}

/**
 * Creates a minimal Agent mock whose mcp.details() returns per-server tool /
 * resource projections. This replaces the old config.getToolRegistry() mock.
 */
function createMockAgent(opts: MockAgentOptions = {}): Agent {
  const tools = opts.tools ?? [];
  const toolsByServer = new Map<string, ToolInfo[]>();
  for (const tool of tools) {
    const bucket = toolsByServer.get(tool.serverName) ?? [];
    bucket.push(projectToolToInfo(tool));
    toolsByServer.set(tool.serverName, bucket);
  }
  const resourcesByServer = new Map<string, McpResourceInfo[]>();
  for (const entry of opts.resources ?? []) {
    const bucket = resourcesByServer.get(entry.serverName) ?? [];
    bucket.push(entry.resource);
    resourcesByServer.set(entry.serverName, bucket);
  }
  const servers: McpServerDetail[] = [
    ...new Set([...toolsByServer.keys(), ...resourcesByServer.keys()]),
  ].map((name) => ({
    name,
    authenticated: false,
    requiresAuth: false,
    oauthStatus: 'not-required' as const,
    sessionAuthenticated: false,
    tools: toolsByServer.get(name) ?? [],
    resources: resourcesByServer.get(name) ?? [],
  }));
  const detailStatus: McpDetailStatus = {
    servers,
    blockedServers: opts.blockedServers ?? [],
  };
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
  let mockContext: ReturnType<typeof createMockCommandContext>;
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
    mockContext = createMockCommandContext({
      services: {
        config: mockConfig,
        agent: createMockAgent(),
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
        ui: { reloadCommands: vi.fn() },
      });
      const result = await mcpCommand.action!(contextWithoutConfig, '');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Configuration not loaded.',
      });
    });

    it('should show an error if agent is not available', async () => {
      const contextWithNoAgent = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: null,
        },
        ui: { reloadCommands: vi.fn() },
      });
      const result = await mcpCommand.action!(contextWithNoAgent, '');
      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Could not retrieve tools from the agent.',
      });
    });
  });

  describe('no MCP servers configured', () => {
    beforeEach(() => {
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
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: { command: 'cmd1' },
        server2: { command: 'cmd2' },
        server3: { command: 'cmd3' },
      });
    });

    it('should display configured MCP servers with status indicators and their tools', async () => {
      vi.mocked(getMCPServerStatus).mockImplementation((serverName) => {
        if (serverName === 'server1') return MCPServerStatus.CONNECTED;
        if (serverName === 'server2') return MCPServerStatus.CONNECTED;
        return MCPServerStatus.DISCONNECTED;
      });

      const allTools = [
        createMockMCPTool('server1_tool1', 'server1'),
        createMockMCPTool('server1_tool2', 'server1'),
        createMockMCPTool('server2_tool1', 'server2'),
        createMockMCPTool('server3_tool1', 'server3'),
      ];

      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: createMockAgent({ tools: allTools }),
        },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
      const message = result.content;

      expect(message).toContain(
        '[READY] \u001b[1mserver1\u001b[0m - Ready (2 tools)',
      );
      expect(message).toContain('server1_tool1');
      expect(message).toContain('server1_tool2');
      expect(message).toContain(
        '[READY] \u001b[1mserver2\u001b[0m - Ready (1 tool)',
      );
      expect(message).toContain('server2_tool1');
      expect(message).toContain(
        '[READY] \u001b[1mserver3\u001b[0m - Ready (1 tool)',
      );
      expect(message).toContain('server3_tool1');
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

      const tools = [createMockMCPTool('server1_tool1', 'server1')];
      const resources = [
        {
          serverName: 'server1',
          resource: createMockMCPResource('file:///docs/readme.md', 'README'),
        },
        {
          serverName: 'server2',
          resource: createMockMCPResource(
            'file:///docs/changelog.md',
            'CHANGELOG',
          ),
        },
      ];

      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: createMockAgent({ tools, resources }),
        },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
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
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: {
          command: 'cmd1',
          description: 'This is a server description',
        },
      });

      const tools = [
        createMockMCPTool('tool1', 'server1', 'This is tool 1 description'),
        createMockMCPTool('tool2', 'server1', 'This is tool 2 description'),
      ];

      const testContext = createMockCommandContext({
        services: { config: mockConfig, agent: createMockAgent({ tools }) },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, 'desc');
      assertMessageAction(result);
      const message = result.content;

      expect(message).toContain('\u001b[1mserver1\u001b[0m - Ready (2 tools)');
      expect(message).toContain(
        '\u001b[32mThis is a server description\u001b[0m',
      );
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
      expect(message).toContain(
        '\u001b[32mThis is tool 1 description\u001b[0m',
      );
      expect(message).toContain('\u001b[36mtool2\u001b[0m');
      expect(message).toContain(
        '\u001b[32mThis is tool 2 description\u001b[0m',
      );
      expect(message).not.toContain('TIP: Tips:');
    });

    it('should not display descriptions when nodesc argument is used', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: {
          command: 'cmd1',
          description: 'This is a server description',
        },
      });

      const tools = [
        createMockMCPTool('tool1', 'server1', 'This is tool 1 description'),
      ];

      const testContext = createMockCommandContext({
        services: { config: mockConfig, agent: createMockAgent({ tools }) },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, 'nodesc');
      assertMessageAction(result);
      const message = result.content;

      expect(message).not.toContain('This is a server description');
      expect(message).not.toContain('This is tool 1 description');
      expect(message).toContain('\u001b[36mtool1\u001b[0m');
      expect(message).not.toContain('TIP: Tips:');
    });

    it('should indicate when a server has no tools', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: { command: 'cmd1' },
        server2: { command: 'cmd2' },
      });

      vi.mocked(getMCPServerStatus).mockImplementation((serverName) => {
        if (serverName === 'server1') return MCPServerStatus.CONNECTED;
        return MCPServerStatus.DISCONNECTED;
      });

      const tools = [createMockMCPTool('server1_tool1', 'server1')];

      const testContext = createMockCommandContext({
        services: { config: mockConfig, agent: createMockAgent({ tools }) },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
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
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: { command: 'cmd1' },
        server2: { command: 'cmd2' },
      });

      vi.mocked(getMCPServerStatus).mockImplementation((serverName) => {
        if (serverName === 'server1') return MCPServerStatus.CONNECTED;
        if (serverName === 'server2') return MCPServerStatus.CONNECTING;
        return MCPServerStatus.DISCONNECTED;
      });

      vi.mocked(getMCPDiscoveryState).mockReturnValue(
        MCPDiscoveryState.IN_PROGRESS,
      );

      const tools = [
        createMockMCPTool('server1_tool1', 'server1'),
        createMockMCPTool('server2_tool1', 'server2'),
      ];

      const testContext = createMockCommandContext({
        services: { config: mockConfig, agent: createMockAgent({ tools }) },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
      const message = result.content;

      expect(message).toContain(
        'MCP servers are starting up (1 initializing)...',
      );
      expect(message).toContain(
        'Note: First startup may take longer. Tool availability will update automatically.',
      );
      expect(message).toContain(
        '[READY] \u001b[1mserver1\u001b[0m - Ready (1 tool)',
      );
      expect(message).toContain(
        '[STARTING] \u001b[1mserver2\u001b[0m - Starting... (first startup may take longer) (tools and prompts will appear when ready)',
      );
    });

    it('should display the extension name for servers from extensions', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: { command: 'cmd1', extensionName: 'my-extension' },
      });

      const testContext = createMockCommandContext({
        services: { config: mockConfig, agent: createMockAgent() },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
      expect(result.content).toContain('server1 (from my-extension)');
    });

    it('should display blocked MCP servers', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({});
      const blockedServers = [
        { name: 'blocked-server', extensionName: 'my-extension' },
      ];
      mockConfig.getBlockedMcpServers = vi.fn().mockReturnValue(blockedServers);

      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: createMockAgent({ blockedServers }),
        },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
      expect(result.content).toContain(
        '[BLOCKED] \u001b[1mblocked-server (from my-extension)\u001b[0m - Blocked',
      );
    });

    it('should display both active and blocked servers correctly', async () => {
      mockConfig.getMcpServers = vi.fn().mockReturnValue({
        server1: { command: 'cmd1', extensionName: 'my-extension' },
      });
      const blockedServers = [
        { name: 'blocked-server', extensionName: 'another-extension' },
      ];
      mockConfig.getBlockedMcpServers = vi.fn().mockReturnValue(blockedServers);

      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: createMockAgent({ blockedServers }),
        },
        ui: { reloadCommands: vi.fn() },
      });

      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
      expect(result.content).toContain('server1 (from my-extension)');
      expect(result.content).toContain(
        '[BLOCKED] \u001b[1mblocked-server (from another-extension)\u001b[0m - Blocked',
      );
    });

    it('degrades gracefully when agent.mcp.details() rejects, showing servers and a warning', async () => {
      vi.mocked(getMCPServerStatus).mockImplementation((serverName) => {
        if (serverName === 'server1') return MCPServerStatus.CONNECTED;
        return MCPServerStatus.DISCONNECTED;
      });

      // Create an agent whose mcp.details() rejects.
      const failingAgent = {
        mcp: {
          details: vi.fn().mockRejectedValue(new Error('details unavailable')),
          refresh: vi.fn().mockResolvedValue(undefined),
          status: vi.fn(),
          listServers: vi.fn().mockReturnValue([]),
        },
        tools: { list: vi.fn().mockReturnValue([]) },
      } as unknown as Agent;

      const testContext = createMockCommandContext({
        services: {
          config: mockConfig,
          agent: failingAgent,
        },
        ui: { reloadCommands: vi.fn() },
      });

      // Must NOT throw — it should degrade and return a message.
      const result = await mcpCommand.action!(testContext, '');
      assertMessageAction(result);
      const message = result.content;

      // Server headers must still render correctly (status rendering does not
      // depend on details()). Match the full header pattern — a bare substring
      // like 'server1' would pass even if header rendering were broken.
      expect(message).toContain(
        '[READY] \u001b[1mserver1\u001b[0m - Ready (0 tools)',
      );
      expect(message).toContain(
        '[DISCONNECTED] \u001b[1mserver2\u001b[0m - Disconnected',
      );

      // Warning line must be present.
      expect(message).toContain('Failed to load MCP tool details');
      expect(message).toContain('details unavailable');
    });
  });
});
