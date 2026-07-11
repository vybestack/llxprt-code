/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect } from 'bun:test';
import {
  McpClientManager,
  type McpClientFactory,
} from './mcp-client-manager.js';
import type { McpClient } from './mcp-client.js';
import { MCPDiscoveryState } from './mcp-client.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { EventEmitter } from 'node:events';
import { CoreEvent } from '@vybestack/llxprt-code-core/utils/events.js';

/**
 * Minimal fake shape for {@link McpClient}. Only the members the manager
 * touches during discovery are populated; each is a mock so tests can assert
 * call counts and drive connect/discover outcomes.
 */
type FakeMcpClient = {
  connect: ReturnType<typeof vi.fn>;
  discover: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  getServerConfig: ReturnType<typeof vi.fn>;
  getInstructions?: ReturnType<typeof vi.fn>;
};

const makeFakeClient = (
  overrides: Partial<FakeMcpClient> = {},
): FakeMcpClient => ({
  connect: vi.fn(),
  discover: vi.fn(),
  disconnect: vi.fn(),
  getStatus: vi.fn(),
  getServerConfig: vi.fn().mockReturnValue({}),
  ...overrides,
});

/**
 * Builds an injectable {@link McpClientFactory} that hands out the supplied
 * fake clients in construction order (reusing the last one once exhausted).
 * This replaces the previous module-level mock of `./mcp-client.js` with a
 * typed dependency seam, mirroring the auth-provider factories.
 */
const factoryReturning = (...clients: FakeMcpClient[]): McpClientFactory => {
  let callCount = 0;
  return () => {
    const client = clients[Math.min(callCount, clients.length - 1)];
    callCount++;
    return client as unknown as McpClient;
  };
};

/**
 * Builds a {@link Config} test double. Only the accessors the manager reads
 * during discovery are implemented; server map, trust, and the refresh spy are
 * parameterised so each test can assert the behaviour it cares about.
 */
const makeConfig = (options: {
  servers?: Record<string, unknown>;
  isTrustedFolder?: boolean;
  refreshMcpContext?: ReturnType<typeof vi.fn>;
  getAgentClient?: () => unknown;
}): Config => {
  const {
    servers = {},
    isTrustedFolder = true,
    refreshMcpContext = vi.fn(),
    getAgentClient = () => ({ isInitialized: () => false }),
  } = options;
  return {
    isTrustedFolder: () => isTrustedFolder,
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
    getAgentClient,
    refreshMcpContext,
  } as unknown as Config;
};

describe('McpClientManager', () => {
  it('should discover tools from all configured servers', async () => {
    const mockedMcpClient = makeFakeClient();
    const refreshMcpContext = vi.fn();
    const mockConfig = makeConfig({
      servers: { 'test-server': {} },
      refreshMcpContext,
    });
    const manager = new McpClientManager(
      '0.0.1',
      {} as ToolRegistry,
      mockConfig,
      undefined,
      { createClient: factoryReturning(mockedMcpClient) },
    );
    await manager.startConfiguredMcpServers();
    expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
    expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
    expect(refreshMcpContext).toHaveBeenCalledOnce();
  });

  it('should batch context refresh when starting multiple servers', async () => {
    const mockedMcpClient = makeFakeClient();
    const refreshMcpContext = vi.fn();
    const mockConfig = makeConfig({
      servers: {
        'server-1': {},
        'server-2': {},
        'server-3': {},
      },
      refreshMcpContext,
    });
    const manager = new McpClientManager(
      '0.0.1',
      {} as ToolRegistry,
      mockConfig,
      undefined,
      { createClient: factoryReturning(mockedMcpClient) },
    );
    await manager.startConfiguredMcpServers();

    // Each client should be connected/discovered
    expect(mockedMcpClient.connect).toHaveBeenCalledTimes(3);
    expect(mockedMcpClient.discover).toHaveBeenCalledTimes(3);

    // Context refresh should happen once after all servers start
    expect(refreshMcpContext).toHaveBeenCalledOnce();
  });

  it('should not discover tools if folder is not trusted', async () => {
    const mockedMcpClient = makeFakeClient();
    const mockConfig = makeConfig({
      servers: { 'test-server': {} },
      isTrustedFolder: false,
    });
    const manager = new McpClientManager(
      '0.0.1',
      {} as ToolRegistry,
      mockConfig,
      undefined,
      { createClient: factoryReturning(mockedMcpClient) },
    );
    await manager.startConfiguredMcpServers();
    expect(mockedMcpClient.connect).not.toHaveBeenCalled();
    expect(mockedMcpClient.discover).not.toHaveBeenCalled();
  });

  it('should not hang when agentClient is not yet initialized during discovery', async () => {
    const mockedMcpClient = makeFakeClient();
    // Simulate the real initialization order: agentClient is created AFTER
    // Promise.all([startConfiguredMcpServers(), extensionLoader.start()]),
    // so getAgentClient() returns undefined during MCP discovery.
    const mockConfig = makeConfig({
      servers: { 'test-server': {} },
      getAgentClient: () => undefined,
    });
    const manager = new McpClientManager(
      '0.0.1',
      {} as ToolRegistry,
      mockConfig,
      undefined,
      { createClient: factoryReturning(mockedMcpClient) },
    );

    // This must resolve, not hang forever
    await manager.startConfiguredMcpServers();

    expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
    expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
  });

  describe('getMcpInstructions', () => {
    it('should aggregate instructions from all connected servers', async () => {
      const mockedMcpClient1 = makeFakeClient({
        getStatus: vi.fn().mockReturnValue('connected'),
        getInstructions: vi.fn().mockReturnValue('Server 1 instructions'),
      });
      const mockedMcpClient2 = makeFakeClient({
        getStatus: vi.fn().mockReturnValue('connected'),
        getInstructions: vi.fn().mockReturnValue('Server 2 instructions'),
      });

      const mockConfig = makeConfig({
        servers: {
          'server-1': {},
          'server-2': {},
        },
      });

      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
        undefined,
        { createClient: factoryReturning(mockedMcpClient1, mockedMcpClient2) },
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
      const mockedMcpClient = makeFakeClient({
        getStatus: vi.fn().mockReturnValue('connected'),
        getInstructions: vi.fn().mockReturnValue(''),
      });

      const mockConfig = makeConfig({
        servers: { 'test-server': {} },
      });

      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
        undefined,
        { createClient: factoryReturning(mockedMcpClient) },
      );
      await manager.startConfiguredMcpServers();

      const instructions = manager.getMcpInstructions();
      expect(instructions).toBe('');
    });

    it('should include instructions from servers with content', async () => {
      const mockedMcpClient1 = makeFakeClient({
        getStatus: vi.fn().mockReturnValue('connected'),
        getInstructions: vi
          .fn()
          .mockReturnValue('Connected server instructions'),
      });
      const mockedMcpClient2 = makeFakeClient({
        getStatus: vi.fn().mockReturnValue('connected'),
        getInstructions: vi.fn().mockReturnValue(''),
      });

      const mockConfig = makeConfig({
        servers: {
          'server-with-instructions': {},
          'server-without-instructions': {},
        },
      });

      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
        undefined,
        { createClient: factoryReturning(mockedMcpClient1, mockedMcpClient2) },
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
      const mockedMcpClient = makeFakeClient({
        getInstructions: vi.fn().mockReturnValue(''),
      });
      const mockConfig = makeConfig({ servers });
      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
        eventEmitter,
        { createClient: factoryReturning(mockedMcpClient) },
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
      const mockedMcpClient = makeFakeClient();
      const mockConfig = makeConfig({
        servers: { 'test-server': {} },
        isTrustedFolder: false,
      });
      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
        undefined,
        { createClient: factoryReturning(mockedMcpClient) },
      );

      await manager.startConfiguredMcpServers();

      // Untrusted folder means startConfiguredMcpServers returns early
      // without touching discovery state — stays NOT_STARTED
      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.NOT_STARTED);
    });
  });

  describe('startExtension background discovery (issue #2325)', () => {
    const createExtensionManager = (mockedMcpClient: FakeMcpClient) => {
      const mockConfig = makeConfig({ servers: {} });
      const manager = new McpClientManager(
        '0.0.1',
        {} as ToolRegistry,
        mockConfig,
        undefined,
        { createClient: factoryReturning(mockedMcpClient) },
      );
      return { manager, mockConfig };
    };

    // Partial mock — only fields relevant to MCP discovery are populated.
    // LlxprtExtension has many internal fields (hooks, commands, etc.) that
    // are not exercised by startExtension, so a full stub is unnecessary.
    const makeTestExtension = (): LlxprtExtension =>
      ({
        name: 'test-ext',
        version: '1.0.0',
        isActive: true,
        path: '/path/to/ext',
        contextFiles: [],
        mcpServers: { 'ext-server': {} },
      }) as unknown as LlxprtExtension;

    it('should not block startExtension on MCP server discovery (issue #2325)', async () => {
      let resolveConnect: () => void;
      const connectPromise = new Promise<void>((resolve) => {
        resolveConnect = resolve;
      });
      const mockedMcpClient = makeFakeClient({
        connect: vi.fn().mockReturnValue(connectPromise),
        discover: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      });
      const { manager } = createExtensionManager(mockedMcpClient);

      // startExtension should resolve immediately without waiting for connect
      await manager.startExtension(makeTestExtension());

      // connect was called but the deferred promise hasn't resolved yet
      expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
      // discover should NOT have been called yet — it runs after connect
      expect(mockedMcpClient.discover).not.toHaveBeenCalled();

      // Now resolve the connect promise — discovery completes in background.
      resolveConnect!();
      await manager.whenDiscoverySettled();
      // After settling, discover should have been called
      expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
    });

    it('whenDiscoverySettled should resolve after background discovery from startExtension', async () => {
      const mockedMcpClient = makeFakeClient({
        connect: vi.fn().mockResolvedValue(undefined),
        discover: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      });
      const { manager } = createExtensionManager(mockedMcpClient);

      await manager.startExtension(makeTestExtension());
      await manager.whenDiscoverySettled();
      expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
      expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
    });

    it('should not throw and whenDiscoverySettled should resolve when connect rejects', async () => {
      const mockedMcpClient = makeFakeClient({
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        discover: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
      });
      const { manager } = createExtensionManager(mockedMcpClient);

      // startExtension must resolve (not throw) even though connect rejects,
      // and whenDiscoverySettled must resolve once the background discovery
      // pass has drained. Awaiting the real methods directly proves both.
      await manager.startExtension(makeTestExtension());
      await manager.whenDiscoverySettled();
      // connect was attempted but discover was never reached
      expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
      expect(mockedMcpClient.discover).not.toHaveBeenCalled();
      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.COMPLETED);
    });
  });
});
