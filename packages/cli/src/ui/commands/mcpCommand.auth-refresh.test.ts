/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'bun:test';
import { mcpCommand } from './mcpCommand.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import type { MessageActionReturn } from './types.js';
import type { Agent } from '@vybestack/llxprt-code-agents';

// Mock external dependencies
void vi.mock('open', () => ({
  default: vi.fn(),
}));

const actual = { ...(await import('@vybestack/llxprt-code-mcp')) };
void vi.mock('@vybestack/llxprt-code-mcp', () => ({
  ...actual,
  MCPOAuthProvider: {
    authenticate: vi.fn(),
  },
  MCPOAuthTokenStorage: {
    getToken: vi.fn(),
    isTokenExpired: vi.fn(),
  },
}));

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

function requireCommandAction(name: string) {
  const action = mcpCommand.subCommands?.find(
    (command) => command.name === name,
  )?.action;
  if (action === undefined) {
    throw new Error(`Expected ${name} command action`);
  }
  return action;
}

describe('mcpCommand', () => {
  let mockConfig: {
    getMcpServers: ReturnType<typeof vi.fn>;
    getBlockedMcpServers: ReturnType<typeof vi.fn>;
  };

  const createMockAgent = (
    options: {
      refresh?: ReturnType<typeof vi.fn>;
      reload?: ReturnType<typeof vi.fn>;
      authenticate?: Agent['mcp']['authenticate'];
      servers?: ReadonlyArray<ReturnType<Agent['mcp']['listServers']>[number]>;
    } = {},
  ): Agent => {
    const refresh = options.refresh ?? vi.fn().mockResolvedValue(undefined);
    const reload = options.reload ?? vi.fn().mockResolvedValue(undefined);
    return {
      mcp: {
        details: vi.fn().mockResolvedValue({ servers: [], blockedServers: [] }),
        refresh,
        reload,
        status: vi.fn(),
        listServers: () => options.servers ?? [],
        listBlockedServers: () => [],
        toolsByServer: vi.fn().mockReturnValue({}),
        auth: vi.fn(),
        discoveryState: vi.fn().mockReturnValue('ready'),
        authenticate: options.authenticate ?? vi.fn(),
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
    } as unknown as Agent;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SANDBOX;
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
          agent: createMockAgent({
            servers: [
              {
                name: 'oauth-server',
                config: { oauth: { enabled: true } },
                status: 'disconnected',
              },
              { name: 'regular-server', config: {}, status: 'disconnected' },
              {
                name: 'another-oauth',
                config: { oauth: { enabled: true } },
                status: 'disconnected',
              },
            ],
          }),
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

    it('publishes success and reloads commands only after owner authentication completes', async () => {
      let release = (): void => {};
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const agent = createMockAgent({
        servers: [
          {
            name: 'test-server',
            config: { url: 'http://localhost:3000', oauth: { enabled: true } },
            status: 'disconnected',
          },
        ],
        authenticate: async (server, display) => {
          display?.('Open the owner authorization URL');
          await pending;
          return {
            server,
            authenticated: true,
            requiresAuth: true,
            oauthStatus: 'authenticated',
            sessionAuthenticated: true,
          };
        },
      });
      const context = createMockCommandContext({
        services: {
          agent,
          config: {
            getMcpServers: () => ({
              'test-server': {
                url: 'http://localhost:3000',
                oauth: { enabled: true },
              },
            }),
          },
        },
      });
      let reloads = 0;
      const messages: unknown[] = [];
      context.ui.reloadCommands = () => {
        reloads++;
      };
      context.ui.addItem = (item) => {
        messages.push(item);
        return 1;
      };
      const work = requireCommandAction('auth')(context, 'test-server');
      expect(reloads).toBe(0);
      expect(JSON.stringify(messages)).not.toContain(
        'Successfully authenticated',
      );
      release();
      const result = await work;
      assertMessageAction(result);
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Successfully authenticated');
      expect(reloads).toBe(1);
      expect(messages).toContainEqual({
        type: 'info',
        text: 'Open the owner authorization URL',
      });
    });

    it('reports owner authentication failures without publishing success', async () => {
      const context = createMockCommandContext({
        services: {
          agent: createMockAgent({
            servers: [
              {
                name: 'test-server',
                config: { oauth: { enabled: true } },
                status: 'disconnected',
              },
            ],
            authenticate: async () => {
              throw new Error('Auth failed');
            },
          }),
          config: {
            getMcpServers: () => ({
              'test-server': { oauth: { enabled: true } },
            }),
          },
        },
      });
      let reloads = 0;
      context.ui.reloadCommands = () => {
        reloads++;
      };
      const result = await requireCommandAction('auth')(context, 'test-server');
      assertMessageAction(result);
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Failed to authenticate');
      expect(result.content).toContain('Auth failed');
      expect(reloads).toBe(0);
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

  describe('reload subcommand', () => {
    it('reloads MCP configuration and displays the resulting status', async () => {
      const reload = vi.fn().mockResolvedValue(undefined);
      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({ server1: {} }),
            getBlockedMcpServers: vi.fn().mockReturnValue([]),
          },
          agent: createMockAgent({
            reload,
            servers: [{ name: 'server1', config: {}, status: 'disconnected' }],
          }),
        },
      });
      context.ui.reloadCommands = vi.fn();
      const reloadAction = requireCommandAction('reload');
      const result = await reloadAction(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        { type: 'info', text: 'Reloading MCP configuration from disk...' },
        expect.any(Number),
      );
      expect(reload).toHaveBeenCalledOnce();
      expect(context.ui.reloadCommands).toHaveBeenCalledOnce();
      assertMessageAction(result);
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Configured MCP servers:');
    });

    it('reports a reload failure without reloading commands', async () => {
      const reload = vi.fn().mockRejectedValue(new Error('settings invalid'));
      const context = createMockCommandContext({
        services: {
          config: {
            getMcpServers: vi.fn().mockReturnValue({ server1: {} }),
            getBlockedMcpServers: vi.fn().mockReturnValue([]),
          },
          agent: createMockAgent({ reload }),
        },
      });
      context.ui.reloadCommands = vi.fn();
      const reloadAction = requireCommandAction('reload');
      const result = await reloadAction(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        { type: 'info', text: 'Reloading MCP configuration from disk...' },
        expect.any(Number),
      );
      assertMessageAction(result);
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Failed to reload MCP configuration');
      expect(result.content).toContain('settings invalid');
      expect(context.ui.reloadCommands).not.toHaveBeenCalled();
    });

    it('stringifies a non-Error reload rejection', async () => {
      const reload = vi.fn().mockRejectedValue('transport closed');
      const context = createMockCommandContext({
        services: { config: mockConfig, agent: createMockAgent({ reload }) },
      });
      context.ui.reloadCommands = vi.fn();
      const reloadAction = requireCommandAction('reload');
      const result = await reloadAction(context, '');

      expect(context.ui.addItem).toHaveBeenCalledWith(
        { type: 'info', text: 'Reloading MCP configuration from disk...' },
        expect.any(Number),
      );
      assertMessageAction(result);
      expect(result.content).toContain('transport closed');
      expect(context.ui.reloadCommands).not.toHaveBeenCalled();
    });

    it('rejects reload when configuration is unavailable', async () => {
      const context = createMockCommandContext({
        services: { config: null, agent: createMockAgent() },
      });
      const reloadAction = requireCommandAction('reload');
      const result = await reloadAction(context, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Configuration not loaded.',
      });
    });

    it('rejects reload when the agent is unavailable', async () => {
      const context = createMockCommandContext({
        services: { config: mockConfig, agent: null },
      });
      const reloadAction = requireCommandAction('reload');
      const result = await reloadAction(context, '');

      expect(result).toStrictEqual({
        type: 'message',
        messageType: 'error',
        content: 'Could not retrieve tools from the agent.',
      });
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
          agent: createMockAgent({
            refresh,
            servers: [{ name: 'server1', config: {}, status: 'disconnected' }],
          }),
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
          agent: createMockAgent({ refresh }),
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
          agent: createMockAgent({ refresh }),
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
          agent: createMockAgent({ refresh }),
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
