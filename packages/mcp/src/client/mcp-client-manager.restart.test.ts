/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, afterEach } from 'bun:test';
import { McpClientManager } from './mcp-client-manager.js';
import { McpClient, populateMcpServerCommand } from './mcp-client.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type {
  MCPServerConfig,
  LlxprtExtension,
} from '@vybestack/llxprt-code-core/config/configTypes.js';
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

describe('McpClientManager restart lifecycle with disconnect aggregation', () => {
  afterEach(() => {
    vi.mocked(McpClient).mockReset();
  });

  const createRegistries = () => ({
    promptRegistry: {
      removePromptsByServer: vi.fn(),
    } as unknown as PromptRegistry,
    resourceRegistry: {
      removeResourcesByServer: vi.fn(),
    } as unknown as ResourceRegistry,
    toolRegistry: {
      removeMcpToolsByServer: vi.fn(),
    } as unknown as ToolRegistry,
  });

  const createConfig = (
    servers: Record<string, unknown>,
    registries: ReturnType<typeof createRegistries>,
    options: {
      getServers?: () => Record<string, MCPServerConfig>;
      trusted?: boolean;
      mcpServerCommand?: string;
    } = {},
  ) =>
    ({
      isTrustedFolder: () => options.trusted ?? true,
      getMcpServers: options.getServers ?? (() => servers),
      getMcpServerCommand: () => options.mcpServerCommand ?? '',
      getPromptRegistry: () => registries.promptRegistry,
      getResourceRegistry: () => registries.resourceRegistry,
      getDebugMode: () => false,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getEnableExtensionReloading: () => false,
      getExtensionEvents: () => undefined,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getAgentClient: () => ({
        isInitialized: () => false,
      }),
      getExtensions: () => [],
      refreshMcpContext: vi.fn(),
    }) as unknown as Config;

  type MockMcpClient = {
    connect: ReturnType<typeof vi.fn>;
    discover: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    getServerConfig: ReturnType<typeof vi.fn>;
    getInstructions: ReturnType<typeof vi.fn>;
  };

  const createMockMcpClient = (
    overrides: Partial<MockMcpClient> = {},
  ): MockMcpClient => ({
    connect: vi.fn().mockResolvedValue(undefined),
    discover: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue('connected'),
    getServerConfig: vi.fn().mockReturnValue({}),
    getInstructions: vi.fn().mockReturnValue(''),
    ...overrides,
  });

  const useClientsByServer = (
    clientsByServer: Record<string, MockMcpClient[]>,
  ): void => {
    vi.mocked(McpClient).mockImplementation((serverName) => {
      const client = clientsByServer[serverName].shift();
      if (client === undefined) {
        throw new Error(`No queued MCP client for '${serverName}'`);
      }
      return client as unknown as McpClient;
    });
  };

  it('restartServer does not leave a stale dead client when existing.disconnect throws (reconnects with a fresh client)', async () => {
    const goodClient = createMockMcpClient();
    const freshClient = createMockMcpClient();

    useClientsByServer({ 'my-server': [goodClient, freshClient] });

    const registries = createRegistries();
    const config = createConfig({ 'my-server': {} }, registries);
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();
    expect(manager.getMcpServerCount()).toBe(1);

    goodClient.disconnect = vi
      .fn()
      .mockRejectedValue(
        new AggregateError([new Error('tool cleanup failed')]),
      );

    await expect(manager.restartServer('my-server')).resolves.toBeUndefined();
    await manager.whenDiscoverySettled();

    expect(goodClient.disconnect).toHaveBeenCalled();

    expect(freshClient.connect).toHaveBeenCalledOnce();
    expect(freshClient.discover).toHaveBeenCalledOnce();

    expect(manager.getMcpServerCount()).toBe(1);
    expect(manager.getClient('my-server')).toBe(
      freshClient as unknown as McpClient,
    );

    expect(registries.toolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
      'my-server',
    );
    expect(
      registries.promptRegistry.removePromptsByServer,
    ).toHaveBeenCalledWith('my-server');
    expect(
      registries.resourceRegistry.removeResourcesByServer,
    ).toHaveBeenCalledWith('my-server');

    expect(manager.getDiscoveryFailures().has('my-server')).toBe(false);
  });

  it('restartServer records a discovery failure when reconnect itself fails after a throwing disconnect', async () => {
    const goodClient = createMockMcpClient();
    const freshClient = createMockMcpClient({
      connect: vi.fn().mockRejectedValue(new Error('reconnect refused')),
      getStatus: vi.fn().mockReturnValue('disconnected'),
    });

    useClientsByServer({ 'my-server': [goodClient, freshClient] });

    const registries = createRegistries();
    const config = createConfig({ 'my-server': {} }, registries);
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();
    expect(manager.getMcpServerCount()).toBe(1);

    goodClient.disconnect = vi
      .fn()
      .mockRejectedValue(new Error('disconnect cleanup failed'));

    await manager.restartServer('my-server');
    await manager.whenDiscoverySettled();

    const failures = manager.getDiscoveryFailures();
    expect(failures.has('my-server')).toBe(true);
    expect(failures.get('my-server')).toContain('reconnect refused');

    expect(manager.getMcpServerCount()).toBe(0);
    expect(manager.getClient('my-server')).toBeUndefined();
  });

  it('restart (all servers) does not leave a stale dead client when existing.disconnect throws', async () => {
    const serverAClient = createMockMcpClient();
    const serverBClient = createMockMcpClient();
    const freshA = createMockMcpClient();
    const freshB = createMockMcpClient();

    useClientsByServer({
      'server-a': [serverAClient, freshA],
      'server-b': [serverBClient, freshB],
    });

    const registries = createRegistries();
    const config = createConfig({ 'server-a': {}, 'server-b': {} }, registries);
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();
    expect(manager.getMcpServerCount()).toBe(2);

    serverAClient.disconnect = vi
      .fn()
      .mockRejectedValue(new Error('a disconnect failed'));
    serverBClient.disconnect = vi
      .fn()
      .mockRejectedValue(new Error('b disconnect failed'));

    await expect(manager.restart()).resolves.toBeUndefined();
    await manager.whenDiscoverySettled();

    expect(manager.getMcpServerCount()).toBe(2);
    expect(manager.getDiscoveryFailures().size).toBe(0);
    expect(manager.getClient('server-a')).toBe(freshA as unknown as McpClient);
    expect(manager.getClient('server-b')).toBe(freshB as unknown as McpClient);
  });

  it('restartServer reports a discovery failure when connectAndDiscover throws an unexpected error (not masked)', async () => {
    const goodClient = createMockMcpClient();
    const freshClient = createMockMcpClient({
      connect: vi
        .fn()
        .mockRejectedValue(new Error('unexpected connect failure')),
      getStatus: vi.fn().mockReturnValue('disconnected'),
    });

    useClientsByServer({ 'my-server': [goodClient, freshClient] });

    const registries = createRegistries();
    const config = createConfig({ 'my-server': {} }, registries);
    const eventEmitter = new EventEmitter();
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
      eventEmitter,
    );

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();
    expect(manager.getMcpServerCount()).toBe(1);

    goodClient.disconnect = vi
      .fn()
      .mockRejectedValue(new Error('disconnect cleanup failed'));

    await manager.restartServer('my-server');
    await manager.whenDiscoverySettled();

    const failures = manager.getDiscoveryFailures();
    expect(failures.has('my-server')).toBe(true);
    expect(failures.get('my-server')).toContain('unexpected connect failure');

    expect(manager.getMcpServerCount()).toBe(0);
  });

  it('startConfiguredMcpServers then restartServer preserves the connected state when disconnect succeeds', async () => {
    const initialClient = createMockMcpClient();
    const freshClient = createMockMcpClient();

    useClientsByServer({ 'my-server': [initialClient, freshClient] });

    const registries = createRegistries();
    const config = createConfig({ 'my-server': {} }, registries);
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();

    await manager.restartServer('my-server');
    await manager.whenDiscoverySettled();

    expect(manager.getMcpServerCount()).toBe(1);
    expect(manager.getClient('my-server')).toBe(
      freshClient as unknown as McpClient,
    );
    expect(initialClient.disconnect).toHaveBeenCalledOnce();
    expect(freshClient.connect).toHaveBeenCalledOnce();
    expect(freshClient.discover).toHaveBeenCalledOnce();
  });

  it('restartServer emits McpClientUpdate consistently during restart (old removed, new registered)', async () => {
    const initialClient = createMockMcpClient();
    const freshClient = createMockMcpClient();

    useClientsByServer({ 'my-server': [initialClient, freshClient] });

    const registries = createRegistries();
    const config = createConfig({ 'my-server': {} }, registries);
    const eventEmitter = new EventEmitter();
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
      eventEmitter,
    );

    const emittedCounts: number[] = [];
    eventEmitter.on(CoreEvent.McpClientUpdate, (payload) => {
      const { clients } = payload as { clients: Map<string, unknown> };
      emittedCounts.push(clients.size);
    });

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();

    emittedCounts.length = 0;
    initialClient.disconnect = vi
      .fn()
      .mockRejectedValue(new Error('disconnect cleanup failed'));

    await manager.restartServer('my-server');
    await manager.whenDiscoverySettled();

    expect(emittedCounts).toContain(0);
    expect(emittedCounts[emittedCounts.length - 1]).toBe(1);
  });

  it('reconciles added and removed configured servers without restarting unchanged clients', async () => {
    const initialClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({ command: 'initial' }),
    });
    const removedClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({ command: 'removed' }),
    });
    const addedClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({ command: 'added' }),
    });
    useClientsByServer({
      initial: [initialClient],
      removed: [removedClient],
      added: [addedClient],
    });
    let configuredServers: Record<string, MCPServerConfig> = {
      initial: { command: 'initial' },
      removed: { command: 'removed' },
    };
    const registries = createRegistries();
    const config = createConfig({}, registries, {
      getServers: () => configuredServers,
    });
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();
    configuredServers = {
      initial: { command: 'initial' },
      added: { command: 'added' },
    };

    await manager.reconcileConfiguredMcpServers();
    await manager.whenDiscoverySettled();

    expect(manager.getClient('initial')).toBe(initialClient);
    expect(initialClient.disconnect).not.toHaveBeenCalled();
    expect(manager.getClient('removed')).toBeUndefined();
    expect(removedClient.disconnect).toHaveBeenCalledOnce();
    expect(manager.getClient('added')).toBe(addedClient);
    expect(registries.toolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
      'removed',
    );
    expect(
      registries.promptRegistry.removePromptsByServer,
    ).toHaveBeenCalledWith('removed');
    expect(
      registries.resourceRegistry.removeResourcesByServer,
    ).toHaveBeenCalledWith('removed');
  });

  it('reconciles successful additions when another added server fails discovery', async () => {
    const goodClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({ command: 'good' }),
    });
    const badClient = createMockMcpClient({
      connect: vi.fn().mockRejectedValue(new Error('connection refused')),
      getServerConfig: vi.fn().mockReturnValue({ command: 'bad' }),
    });
    useClientsByServer({ good: [goodClient], bad: [badClient] });
    let configuredServers: Record<string, MCPServerConfig> = {};
    const registries = createRegistries();
    const config = createConfig({}, registries, {
      getServers: () => configuredServers,
    });
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );
    configuredServers = {
      good: { command: 'good' },
      bad: { command: 'bad' },
    };

    await manager.reconcileConfiguredMcpServers();
    await manager.whenDiscoverySettled();

    expect(manager.getClient('good')).toBe(goodClient);
    expect(manager.getClient('bad')).toBeUndefined();
    expect(manager.getDiscoveryFailures().get('bad')).toBe(
      'connection refused',
    );
  });

  it('does not connect configured servers while the folder is untrusted', async () => {
    const client = createMockMcpClient();
    useClientsByServer({ added: [client] });
    const registries = createRegistries();
    const config = createConfig({ added: { command: 'added' } }, registries, {
      trusted: false,
    });
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.reconcileConfiguredMcpServers();

    expect(client.connect).not.toHaveBeenCalled();
    expect(manager.getClient('added')).toBeUndefined();
  });

  it('reconciles a changed configured server with a fresh client', async () => {
    const initialClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({ command: 'before' }),
    });
    const freshClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({ command: 'after' }),
    });
    useClientsByServer({ changed: [initialClient, freshClient] });
    let configuredServers: Record<string, MCPServerConfig> = {
      changed: { command: 'before' },
    };
    const registries = createRegistries();
    const config = createConfig({}, registries, {
      getServers: () => configuredServers,
    });
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.startConfiguredMcpServers();
    await manager.whenDiscoverySettled();
    configuredServers = { changed: { command: 'after' } };

    await manager.reconcileConfiguredMcpServers();
    await manager.whenDiscoverySettled();

    expect(initialClient.disconnect).toHaveBeenCalledOnce();
    expect(freshClient.connect).toHaveBeenCalledOnce();
    expect(manager.getClient('changed')).toBe(freshClient);
  });

  it('does not resurrect a removed server whose discovery is still in flight', async () => {
    let resolveSlowConnect!: () => void;
    const slowConnectPromise = new Promise<void>((resolve) => {
      resolveSlowConnect = resolve;
    });
    const fastClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({ command: 'fast' }),
    });
    const slowClient = createMockMcpClient({
      connect: vi.fn().mockReturnValue(slowConnectPromise),
      getServerConfig: vi.fn().mockReturnValue({ command: 'slow' }),
    });
    useClientsByServer({ fast: [fastClient], slow: [slowClient] });
    let configuredServers: Record<string, MCPServerConfig> = {
      fast: { command: 'fast' },
      slow: { command: 'slow' },
    };
    const registries = createRegistries();
    const config = createConfig({}, registries, {
      getServers: () => configuredServers,
    });
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    void manager.startConfiguredMcpServers();
    await vi.waitFor(() => {
      expect(manager.getClient('fast')).toBeDefined();
    });

    configuredServers = { fast: { command: 'fast' } };

    await manager.reconcileConfiguredMcpServers();

    resolveSlowConnect();
    await manager.whenDiscoverySettled();

    expect(manager.getClient('slow')).toBeUndefined();
    expect(manager.getClient('fast')).toBe(fastClient as unknown as McpClient);
  });

  it('does not remove extension-owned clients during reconcile', async () => {
    const extensionClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({
        command: 'ext-command',
        extension: { name: 'test-ext', isActive: true },
      }),
    });
    useClientsByServer({ extsrv: [extensionClient] });
    let configuredServers: Record<string, MCPServerConfig> = {};
    const registries = createRegistries();
    const config = createConfig({}, registries, {
      getServers: () => configuredServers,
    });
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.startExtension({
      name: 'test-ext',
      isActive: true,
      mcpServers: { extsrv: { command: 'ext-command' } },
    } as unknown as LlxprtExtension);
    await manager.whenDiscoverySettled();
    expect(manager.getClient('extsrv')).toBeDefined();

    const otherClient = createMockMcpClient({
      getServerConfig: vi.fn().mockReturnValue({ command: 'other' }),
    });
    useClientsByServer({ otherServer: [otherClient] });
    configuredServers = { otherServer: { command: 'other' } };

    await manager.reconcileConfiguredMcpServers();
    await manager.whenDiscoverySettled();

    expect(manager.getClient('extsrv')).toBe(
      extensionClient as unknown as McpClient,
    );
    expect(extensionClient.disconnect).not.toHaveBeenCalled();
  });

  it('does not evaluate server resolution in an untrusted folder during startConfiguredMcpServers', async () => {
    vi.mocked(populateMcpServerCommand).mockClear();
    const registries = createRegistries();
    const liveServers: Record<string, MCPServerConfig> = {
      added: { command: 'added' },
    };
    const config = createConfig(liveServers, registries, {
      trusted: false,
      mcpServerCommand: 'some-command',
    });
    const manager = new McpClientManager(
      '0.0.1',
      registries.toolRegistry,
      config,
    );

    await manager.startConfiguredMcpServers();

    expect(populateMcpServerCommand).not.toHaveBeenCalled();
  });
});
