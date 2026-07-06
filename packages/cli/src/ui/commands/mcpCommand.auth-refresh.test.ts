/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { mcpCommand } from './mcpCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { MessageActionReturn } from './types.js';
import {
  MCPServerStatus,
  MCPDiscoveryState,
  getMCPServerStatus,
  getMCPDiscoveryState,
} from '@vybestack/llxprt-code-mcp';
import type { Agent } from '@vybestack/llxprt-code-agents';

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

describe('mcpCommand', () => {
  let mockConfig: {
    getMcpServers: ReturnType<typeof vi.fn>;
    getBlockedMcpServers: ReturnType<typeof vi.fn>;
  };

  const createMockAgent = (
    refresh: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
  ): Agent =>
    ({
      mcp: {
        details: vi.fn().mockResolvedValue({ servers: [], blockedServers: [] }),
        refresh,
        status: vi.fn(),
        listServers: vi.fn().mockReturnValue([]),
        toolsByServer: vi.fn().mockReturnValue({}),
        auth: vi.fn(),
        discoveryState: vi.fn().mockReturnValue('ready'),
        authenticate: vi.fn(),
      },
      // Partial tools mock: the /mcp command path never accesses tools.keys,
      // so it is intentionally omitted rather than stubbed with an `as never`
      // escape hatch (the outer `as unknown as Agent` permits the partial).
      tools: {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn(),
        setEnabled: vi.fn(),
        onConfirmationRequest: vi.fn(),
        respondToConfirmation: vi.fn(),
        onToolUpdate: vi.fn(),
        setEditorCallbacks: vi.fn(),
      },
    }) as unknown as Agent;

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

  describe('auth subcommand', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should list OAuth-enabled servers when no server name is provided', async () => {
      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({
              'oauth-server': { oauth: { enabled: true } },
              'regular-server': {},
              'another-oauth': { oauth: { enabled: true } },
            }),
          },
        },
      });

      const authCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'auth',
      );
      expect(authCommand).toBeDefined();

      const result = await authCommand!.action!(context, '');
      assertMessageAction(result);

      expect(result.messageType).toBe('info');
      expect(result.content).toContain('oauth-server');
      expect(result.content).toContain('another-oauth');
      expect(result.content).not.toContain('regular-server');
      expect(result.content).toContain('/mcp auth <server-name>');
    });

    it('should show message when no OAuth servers are configured', async () => {
      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({
              'regular-server': {},
            }),
          },
        },
      });

      const authCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'auth',
      );
      const result = await authCommand!.action!(context, '');

      assertMessageAction(result);

      expect(result.messageType).toBe('info');
      expect(result.content).toBe(
        'No MCP servers configured with OAuth authentication.',
      );
    });

    it('should authenticate with a specific server', async () => {
      const mockMcpClientManager = {
        restartServer: vi.fn(),
      };
      const mockAgentClient = {
        setTools: vi.fn(),
      };

      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({
              'test-server': {
                url: 'http://localhost:3000',
                oauth: { enabled: true },
              },
            }),
            getMcpClientManager: vi.fn().mockReturnValue(mockMcpClientManager),
            getAgentClient: vi.fn().mockReturnValue(mockAgentClient),
            getPromptRegistry: vi.fn().mockReturnValue({
              removePromptsByServer: vi.fn(),
            }),
          },
        },
      });
      // Mock the reloadCommands function
      context.ui.reloadCommands = vi.fn();

      const { MCPOAuthProvider } = await import('@vybestack/llxprt-code-mcp');

      const authCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'auth',
      );
      const result = await authCommand!.action!(context, 'test-server');

      expect(MCPOAuthProvider.authenticate).toHaveBeenCalledWith(
        'test-server',
        { enabled: true },
        'http://localhost:3000',
        expect.any(Object),
      );
      expect(mockMcpClientManager.restartServer).toHaveBeenCalledWith(
        'test-server',
      );
      expect(mockAgentClient.setTools).toHaveBeenCalled();
      expect(context.ui.reloadCommands).toHaveBeenCalledTimes(1);

      assertMessageAction(result);

      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Successfully authenticated');
    });

    it('should handle authentication errors', async () => {
      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({
              'test-server': { oauth: { enabled: true } },
            }),
          },
        },
      });

      const { MCPOAuthProvider } = await import('@vybestack/llxprt-code-mcp');
      (
        MCPOAuthProvider.authenticate as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('Auth failed'));

      const authCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'auth',
      );
      const result = await authCommand!.action!(context, 'test-server');

      assertMessageAction(result);

      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Failed to authenticate');
      expect(result.content).toContain('Auth failed');
    });

    it('should handle non-existent server', async () => {
      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({
              'existing-server': {},
            }),
          },
        },
      });

      const authCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'auth',
      );
      const result = await authCommand!.action!(context, 'non-existent');

      assertMessageAction(result);

      expect(result.messageType).toBe('error');
      expect(result.content).toContain("MCP server 'non-existent' not found");
    });
  });

  describe('refresh subcommand', () => {
    it('should refresh the list of tools and display the status', async () => {
      const refresh = vi.fn().mockResolvedValue(undefined);

      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({ server1: {} }),
            getBlockedMcpServers: vi.fn().mockReturnValue([]),
          },
          agent: createMockAgent(refresh),
        },
      });
      context.ui.reloadCommands = vi.fn();

      const refreshCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'refresh',
      );
      expect(refreshCommand).toBeDefined();

      const result = await refreshCommand!.action!(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        {
          type: 'info',
          text: 'Restarting MCP servers...',
        },
        expect.any(Number),
      );
      expect(refresh).toHaveBeenCalled();
      expect(context.ui.reloadCommands).toHaveBeenCalledTimes(1);

      assertMessageAction(result);

      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Configured MCP servers:');
    });
    it('should return a user-friendly error when refresh rejects', async () => {
      const refresh = vi.fn().mockRejectedValue(new Error('server boom'));

      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({ server1: {} }),
            getBlockedMcpServers: vi.fn().mockReturnValue([]),
          },
          agent: createMockAgent(refresh),
        },
      });
      context.ui.reloadCommands = vi.fn();

      const refreshCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'refresh',
      );

      const result = await refreshCommand!.action!(context, '');

      // The rejection must be caught and surfaced as an error message rather
      // than escaping as an unhandled rejection, and reloadCommands must NOT
      // run when the refresh failed.
      expect(refresh).toHaveBeenCalled();
      expect(context.ui.reloadCommands).not.toHaveBeenCalled();

      assertMessageAction(result);
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Failed to restart MCP servers');
      expect(result.content).toContain('server boom');
    });

    it('should return an error when MCP tool discovery fails', async () => {
      // agent.mcp.refresh() re-runs discovery/restart; a failing server rejects.
      const refresh = vi
        .fn()
        .mockRejectedValue(new Error('connection refused'));
      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({ server1: {} }),
            getBlockedMcpServers: vi.fn().mockReturnValue([]),
          },
          agent: createMockAgent(refresh),
        },
      });
      context.ui.reloadCommands = vi.fn();

      const refreshCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'refresh',
      );
      const result = await refreshCommand!.action!(context, '');

      assertMessageAction(result);
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Failed to restart MCP servers');
      expect(result.content).toContain('connection refused');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(context.ui.reloadCommands).not.toHaveBeenCalled();
    });

    it('surfaces a non-Error rejection from agent.mcp.refresh() as a string', async () => {
      // The catch block stringifies non-Error rejections; verify that path.
      const refresh = vi.fn().mockRejectedValue('transport closed');
      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({ server1: {} }),
            getBlockedMcpServers: vi.fn().mockReturnValue([]),
          },
          agent: createMockAgent(refresh),
        },
      });
      context.ui.reloadCommands = vi.fn();

      const refreshCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'refresh',
      );
      const result = await refreshCommand!.action!(context, '');

      assertMessageAction(result);
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Failed to restart MCP servers');
      expect(result.content).toContain('transport closed');
      expect(context.ui.reloadCommands).not.toHaveBeenCalled();
    });

    it('should show an error if config is not available', async () => {
      const contextWithoutConfig = createMockCommandContext({
        services: {
          config: null,
        },
      });

      const refreshCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'refresh',
      );
      const result = await refreshCommand!.action!(contextWithoutConfig, '');

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
        ui: {
          reloadCommands: vi.fn(),
        },
      });

      const refreshCommand = mcpCommand.subCommands?.find(
        (cmd) => cmd.name === 'refresh',
      );
      const result = await refreshCommand!.action!(contextWithNoAgent, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Could not retrieve tools from the agent.',
      });
    });
  });
});
