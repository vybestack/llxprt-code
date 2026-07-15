/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import {
  McpClientManager,
  DEFAULT_MCP_DISCOVERY_SETTLE_TIMEOUT_MS,
} from './mcp-client-manager.js';
import { McpClient } from './mcp-client.js';
import { MCPDiscoveryState } from './mcp-client.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { EventEmitter } from 'node:events';
import { CoreEvent } from '@vybestack/llxprt-code-core/utils/events.js';

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
  afterEach(() => {
    vi.mocked(McpClient).mockReset();
  });
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
      getAgentClient: () => ({
        isInitialized: () => false,
      }),
      refreshMcpContext: vi.fn(),
    } as unknown as Config;
    const manager = new McpClientManager(
      '0.0.1',
      {} as ToolRegistry,
      mockConfig,
    );
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
      getAgentClient: () => ({
        isInitialized: () => false,
      }),
      refreshMcpContext,
    } as unknown as Config;
    const manager = new McpClientManager(
      '0.0.1',
      {} as ToolRegistry,
      mockConfig,
    );
    await manager.startConfiguredMcpServers();

    // Each client should be connected/discovered
    expect(mockedMcpClient.connect).toHaveBeenCalledTimes(3);
    expect(mockedMcpClient.discover).toHaveBeenCalledTimes(3);

    // Context refresh should happen once after all servers start
    expect(refreshMcpContext).toHaveBeenCalledOnce();
  });

  it('cancels a debounced context refresh during stop and ignores later scheduling', async () => {
    vi.useFakeTimers();
    try {
      const mockedMcpClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        invalidateCapabilities: vi.fn(),
        abortDiscovery: vi.fn(),
        getStatus: vi.fn(),
        getServerConfig: vi.fn().mockReturnValue({}),
      };
      let onToolsUpdated: ConstructorParameters<typeof McpClient>[9];
      vi.mocked(McpClient).mockImplementation(
        (
          _serverName,
          _serverConfig,
          _toolRegistry,
          _promptRegistry,
          _resourceRegistry,
          _workspaceContext,
          _cliConfig,
          _debugMode,
          _clientVersion,
          handleToolsUpdated,
        ) => {
          onToolsUpdated = handleToolsUpdated;
          return mockedMcpClient as unknown as McpClient;
        },
      );
      const refreshMcpContext = vi.fn();
      const mockConfig = {
        isTrustedFolder: () => true,
        getMcpServers: () => ({ 'test-server': {} }),
        getMcpServerCommand: () => '',
        getPromptRegistry: () => ({ removePromptsByServer: vi.fn() }),
        getResourceRegistry: () => ({ removeResourcesByServer: vi.fn() }),
        getDebugMode: () => false,
        getWorkspaceContext: () => ({}) as WorkspaceContext,
        getAllowedMcpServers: () => undefined,
        getBlockedMcpServers: () => undefined,
        refreshMcpContext,
      } as unknown as Config;
      const toolRegistry = {
        removeMcpToolsByServer: vi.fn(),
      } as unknown as ToolRegistry;
      const manager = new McpClientManager('0.0.1', toolRegistry, mockConfig);
      await manager.startConfiguredMcpServers();
      refreshMcpContext.mockClear();

      void onToolsUpdated?.();
      await manager.stop();

      expect(refreshMcpContext).not.toHaveBeenCalled();

      const afterStopRefresh = onToolsUpdated?.();
      await afterStopRefresh;
      expect(refreshMcpContext).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a context refresh requested while a failed refresh is pending', async () => {
    vi.useFakeTimers();
    try {
      let onToolsUpdated: ConstructorParameters<typeof McpClient>[9];
      const mockedMcpClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        invalidateCapabilities: vi.fn(),
        abortDiscovery: vi.fn(),
        getStatus: vi.fn(),
        getServerConfig: vi.fn().mockReturnValue({}),
      };
      vi.mocked(McpClient).mockImplementation(
        (
          _serverName,
          _serverConfig,
          _toolRegistry,
          _promptRegistry,
          _resourceRegistry,
          _workspaceContext,
          _cliConfig,
          _debugMode,
          _clientVersion,
          handleToolsUpdated,
        ) => {
          onToolsUpdated = handleToolsUpdated;
          return mockedMcpClient as unknown as McpClient;
        },
      );
      const refreshMcpContext = vi.fn().mockResolvedValue(undefined);
      const mockConfig = {
        isTrustedFolder: () => true,
        getMcpServers: () => ({ 'test-server': {} }),
        getMcpServerCommand: () => '',
        getPromptRegistry: () => ({ removePromptsByServer: vi.fn() }),
        getResourceRegistry: () => ({ removeResourcesByServer: vi.fn() }),
        getDebugMode: () => false,
        getWorkspaceContext: () => ({}) as WorkspaceContext,
        getAllowedMcpServers: () => undefined,
        getBlockedMcpServers: () => undefined,
        refreshMcpContext,
      } as unknown as Config;
      const manager = new McpClientManager(
        '0.0.1',
        { removeMcpToolsByServer: vi.fn() } as unknown as ToolRegistry,
        mockConfig,
      );
      await manager.startConfiguredMcpServers();
      refreshMcpContext.mockClear();
      let rejectFirstRefresh: (error: Error) => void = () => {};
      const firstRefresh = new Promise<void>((_resolve, reject) => {
        rejectFirstRefresh = reject;
      });
      refreshMcpContext
        .mockReturnValueOnce(firstRefresh)
        .mockResolvedValue(undefined);

      const firstRequest = onToolsUpdated?.();
      await vi.advanceTimersByTimeAsync(300);
      const secondRequest = onToolsUpdated?.();
      rejectFirstRefresh(new Error('refresh failed'));
      await vi.advanceTimersByTimeAsync(300);
      await Promise.all([firstRequest, secondRequest]);

      expect(refreshMcpContext).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
      getAgentClient: () => ({
        isInitialized: () => false,
      }),
    } as unknown as Config;
    const manager = new McpClientManager(
      '0.0.1',
      {} as ToolRegistry,
      mockConfig,
    );
    await manager.startConfiguredMcpServers();
    expect(mockedMcpClient.connect).not.toHaveBeenCalled();
    expect(mockedMcpClient.discover).not.toHaveBeenCalled();
  });

  it('should not hang when agentClient is not yet initialized during discovery', async () => {
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
    // Simulate the real initialization order: agentClient is created AFTER
    // Promise.all([startConfiguredMcpServers(), extensionLoader.start()]),
    // so getAgentClient() returns undefined during MCP discovery.
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
      getAgentClient: () => undefined,
      refreshMcpContext: vi.fn(),
    } as unknown as Config;
    const manager = new McpClientManager(
      '0.0.1',
      {} as ToolRegistry,
      mockConfig,
    );

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
        getAgentClient: () => ({
          isInitialized: () => false,
        }),
        refreshMcpContext: vi.fn(),
      } as unknown as Config;

      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
      );
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
        getAgentClient: () => ({
          isInitialized: () => false,
        }),
        refreshMcpContext: vi.fn(),
      } as unknown as Config;

      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
      );
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
        getAgentClient: () => ({
          isInitialized: () => false,
        }),
        refreshMcpContext: vi.fn(),
      } as unknown as Config;

      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
      );
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

  describe('discovery state transitions', () => {
    const createManager = (servers: Record<string, unknown> = {}) => {
      const eventEmitter = new EventEmitter();
      const mockedMcpClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        getServerConfig: vi.fn().mockReturnValue({}),
        getInstructions: vi.fn().mockReturnValue(''),
      };
      vi.mocked(McpClient).mockReturnValue(
        mockedMcpClient as unknown as McpClient,
      );
      const mockConfig = {
        isTrustedFolder: () => true,
        getMcpServers: () => servers,
        getMcpServerCommand: () => '',
        getPromptRegistry: () => ({}) as PromptRegistry,
        getResourceRegistry: () => ({}) as ResourceRegistry,
        getDebugMode: () => false,
        getWorkspaceContext: () => ({}) as WorkspaceContext,
        getEnableExtensionReloading: () => false,
        getExtensionEvents: () => undefined,
        getAllowedMcpServers: () => undefined,
        getBlockedMcpServers: () => undefined,
        getAgentClient: () => ({
          isInitialized: () => false,
        }),
        refreshMcpContext: vi.fn(),
      } as unknown as Config;
      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
        eventEmitter,
      );
      return { manager, eventEmitter, mockedMcpClient, mockConfig };
    };

    it('should start with NOT_STARTED state', () => {
      const { manager } = createManager();
      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.NOT_STARTED);
    });

    it('should transition to COMPLETED immediately when no servers are configured', async () => {
      const { manager, eventEmitter } = createManager({});
      const events: string[] = [];
      eventEmitter.on(CoreEvent.McpClientUpdate, () =>
        events.push('McpClientUpdate'),
      );

      await manager.startConfiguredMcpServers();

      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.COMPLETED);
      // Zero-server fast-path should still emit McpClientUpdate
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('should transition NOT_STARTED → IN_PROGRESS → COMPLETED for configured servers', async () => {
      const { manager, eventEmitter } = createManager({
        'test-server': {},
      });
      const states: string[] = [];
      eventEmitter.on(CoreEvent.McpClientUpdate, () => {
        states.push(manager.getDiscoveryState());
      });

      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.NOT_STARTED);

      await manager.startConfiguredMcpServers();

      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.COMPLETED);
      // Should have seen IN_PROGRESS at some point during discovery
      expect(states).toContain(MCPDiscoveryState.IN_PROGRESS);
      // Should have seen COMPLETED at the end
      expect(states).toContain(MCPDiscoveryState.COMPLETED);
    });

    it('should emit McpClientUpdate on COMPLETED transition', async () => {
      const { manager, eventEmitter } = createManager({
        'test-server': {},
      });
      const payloads: unknown[] = [];
      eventEmitter.on(CoreEvent.McpClientUpdate, (payload) => {
        payloads.push(payload);
      });

      await manager.startConfiguredMcpServers();

      // At least one payload should have been emitted (the COMPLETED one)
      expect(payloads.length).toBeGreaterThanOrEqual(1);
    });

    it('should not change state when folder is not trusted', async () => {
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
        getMcpServers: () => ({ 'test-server': {} }),
        getMcpServerCommand: () => '',
        getPromptRegistry: () => ({}) as PromptRegistry,
        getResourceRegistry: () => ({}) as ResourceRegistry,
        getDebugMode: () => false,
        getWorkspaceContext: () => ({}) as WorkspaceContext,
        getEnableExtensionReloading: () => false,
        getExtensionEvents: () => undefined,
        getAllowedMcpServers: () => undefined,
        getBlockedMcpServers: () => undefined,
        getAgentClient: () => ({
          isInitialized: () => false,
        }),
        refreshMcpContext: vi.fn(),
      } as unknown as Config;
      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
      );

      await manager.startConfiguredMcpServers();

      // Untrusted folder means startConfiguredMcpServers returns early
      // without touching discovery state — stays NOT_STARTED
      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.NOT_STARTED);
    });
  });

  // Shared helpers for extension-based discovery tests (issue #2325 + #2516).
  const createExtensionManager = (
    mockedMcpClient?: Record<string, ReturnType<typeof vi.fn>>,
    servers: Record<string, unknown> = {},
  ) => {
    if (mockedMcpClient !== undefined) {
      vi.mocked(McpClient).mockReturnValue(
        mockedMcpClient as unknown as McpClient,
      );
    }
    const promptRegistry = {
      removePromptsByServer: vi.fn(),
    } as unknown as PromptRegistry;
    const resourceRegistry = {
      removeResourcesByServer: vi.fn(),
    } as unknown as ResourceRegistry;
    const toolRegistry = {
      removeMcpToolsByServer: vi.fn(),
    } as unknown as ToolRegistry;
    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => servers,
      getMcpServerCommand: () => '',
      getPromptRegistry: () => promptRegistry,
      getResourceRegistry: () => resourceRegistry,
      getDebugMode: () => false,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getEnableExtensionReloading: () => false,
      getExtensionEvents: () => undefined,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getAgentClient: () => ({
        isInitialized: () => false,
      }),
      refreshMcpContext: vi.fn(),
    } as unknown as Config;
    const manager = new McpClientManager('0.0.1', toolRegistry, mockConfig);
    return {
      manager,
      mockConfig,
      promptRegistry,
      resourceRegistry,
      toolRegistry,
    };
  };

  const makeTestExtension = (): LlxprtExtension =>
    ({
      name: 'test-ext',
      version: '1.0.0',
      isActive: true,
      path: '/path/to/ext',
      contextFiles: [],
      mcpServers: { 'ext-server': {} },
    }) as unknown as LlxprtExtension;

  describe('startExtension background discovery (issue #2325)', () => {
    it('should not block startExtension on MCP server discovery (issue #2325)', async () => {
      let resolveConnect: () => void;
      const connectPromise = new Promise<void>((resolve) => {
        resolveConnect = resolve;
      });
      const mockedMcpClient = {
        connect: vi.fn().mockReturnValue(connectPromise),
        discover: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getStatus: vi.fn(),
        getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      };
      const { manager } = createExtensionManager(mockedMcpClient);

      // startExtension should resolve immediately without waiting for connect
      await manager.startExtension(makeTestExtension());

      // connect was called but the deferred promise hasn't resolved yet
      expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
      // discover should NOT have been called yet — it runs after connect
      expect(mockedMcpClient.discover).not.toHaveBeenCalled();

      // Now resolve the connect promise — discovery completes in background.
      resolveConnect();
      await manager.whenDiscoverySettled();
      // After settling, discover should have been called
      expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
    });

    it('whenDiscoverySettled should resolve after background discovery from startExtension', async () => {
      const mockedMcpClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        discover: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getStatus: vi.fn(),
        getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      };
      const { manager } = createExtensionManager(mockedMcpClient);

      await manager.startExtension(makeTestExtension());
      await manager.whenDiscoverySettled();
      expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
      expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
    });

    it('should not throw and whenDiscoverySettled should resolve when connect rejects', async () => {
      const mockedMcpClient = {
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        discover: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getStatus: vi.fn(),
        getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      };
      const { manager } = createExtensionManager(mockedMcpClient);

      await expect(
        manager.startExtension(makeTestExtension()),
      ).resolves.toBeUndefined();
      await expect(manager.whenDiscoverySettled()).resolves.toBeUndefined();
      // connect was attempted but discover was never reached
      expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
      expect(mockedMcpClient.discover).not.toHaveBeenCalled();
      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.COMPLETED);
    });
  });

  describe('discovery failure tracking (issue #2516)', () => {
    it('records a per-server discovery failure when connect rejects with a non-auth error', async () => {
      const mockedMcpClient = {
        connect: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        discover: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getStatus: vi.fn(),
        getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      };
      const { manager, promptRegistry, resourceRegistry, toolRegistry } =
        createExtensionManager(mockedMcpClient);

      await manager.startExtension(makeTestExtension());
      await manager.whenDiscoverySettled();

      const failures = manager.getDiscoveryFailures();
      expect(failures.has('ext-server')).toBe(true);
      expect(failures.get('ext-server')).toContain('ECONNREFUSED');
      expect(toolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
        'ext-server',
      );
      expect(promptRegistry.removePromptsByServer).toHaveBeenCalledWith(
        'ext-server',
      );
      expect(resourceRegistry.removeResourcesByServer).toHaveBeenCalledWith(
        'ext-server',
      );
    });

    it('resolves whenDiscoverySettled via bounded timeout for a never-settling server', async () => {
      vi.useFakeTimers();
      try {
        // A connect promise that NEVER resolves — simulates a hung server.
        const neverResolvingConnect = new Promise<void>(() => {});
        const mockedMcpClient = {
          connect: vi.fn().mockReturnValue(neverResolvingConnect),
          discover: vi.fn().mockResolvedValue(undefined),
          disconnect: vi.fn().mockResolvedValue(undefined),
          getStatus: vi.fn(),
          getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
        };
        const { manager } = createExtensionManager(mockedMcpClient);

        await manager.startExtension(makeTestExtension());

        // Start the bounded wait before advancing fake timers so its timeout is
        // registered. The never-settling connect means discoveryPromise never
        // resolves, so only the timeout can settle the gate.
        const settled = manager.whenDiscoverySettled();
        await vi.advanceTimersByTimeAsync(
          DEFAULT_MCP_DISCOVERY_SETTLE_TIMEOUT_MS + 1,
        );

        // whenDiscoverySettled must resolve despite the never-settling connect.
        await expect(settled).resolves.toBeUndefined();

        // The pending server must appear in discovery failures.
        const failures = manager.getDiscoveryFailures();
        expect(failures.has('ext-server')).toBe(true);
        expect(failures.get('ext-server')).toMatch(/Timed out/i);
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears a timeout failure when the same discovery eventually succeeds', async () => {
      vi.useFakeTimers();
      try {
        let resolveConnect: (value?: void) => void = () => {};
        const connectPromise = new Promise<void>((resolve) => {
          resolveConnect = resolve;
        });
        const mockedMcpClient = {
          connect: vi.fn().mockReturnValue(connectPromise),
          discover: vi.fn().mockResolvedValue(undefined),
          disconnect: vi.fn().mockResolvedValue(undefined),
          getStatus: vi.fn(),
          getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
        };
        const { manager } = createExtensionManager(mockedMcpClient);

        await manager.startExtension(makeTestExtension());
        const boundedWait = manager.whenDiscoverySettled();
        await vi.advanceTimersByTimeAsync(
          DEFAULT_MCP_DISCOVERY_SETTLE_TIMEOUT_MS + 1,
        );
        await boundedWait;
        expect(manager.getDiscoveryFailures().get('ext-server')).toMatch(
          /Timed out/i,
        );

        resolveConnect();
        await manager.whenDiscoverySettled();

        expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
        expect(manager.getDiscoveryFailures().has('ext-server')).toBe(false);
        expect(manager.getMcpServerCount()).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
