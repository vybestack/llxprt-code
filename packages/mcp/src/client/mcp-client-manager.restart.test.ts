/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, afterEach } from 'vitest';
import { McpClientManager } from './mcp-client-manager.js';
import { McpClient } from './mcp-client.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
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
  ) =>
    ({
      isTrustedFolder: () => true,
      getMcpServers: () => servers,
      getMcpServerCommand: () => '',
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

  it('restartServer does not leave a stale dead client when existing.disconnect throws (reconnects with a fresh client)', async () => {
    const goodClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    const freshClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };

    let callCount = 0;
    vi.mocked(McpClient).mockImplementation(() => {
      const client = callCount === 0 ? goodClient : freshClient;
      callCount++;
      return client as unknown as McpClient;
    });

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
    const goodClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    const freshClient = {
      connect: vi.fn().mockRejectedValue(new Error('reconnect refused')),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('disconnected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };

    let callCount = 0;
    vi.mocked(McpClient).mockImplementation(() => {
      const client = callCount === 0 ? goodClient : freshClient;
      callCount++;
      return client as unknown as McpClient;
    });

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
    const serverAClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    const serverBClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    const freshA = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    const freshB = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };

    let callCount = 0;
    vi.mocked(McpClient).mockImplementation(() => {
      const pool = [serverAClient, serverBClient, freshA, freshB];
      const client = pool[callCount] ?? pool[pool.length - 1];
      callCount++;
      return client as unknown as McpClient;
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
    const goodClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    const freshClient = {
      connect: vi
        .fn()
        .mockRejectedValue(new Error('unexpected connect failure')),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('disconnected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };

    let callCount = 0;
    vi.mocked(McpClient).mockImplementation(() => {
      const client = callCount === 0 ? goodClient : freshClient;
      callCount++;
      return client as unknown as McpClient;
    });

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
    const initialClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    const freshClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };

    let callCount = 0;
    vi.mocked(McpClient).mockImplementation(() => {
      const client = callCount === 0 ? initialClient : freshClient;
      callCount++;
      return client as unknown as McpClient;
    });

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
    const initialClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };
    const freshClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('connected'),
      getServerConfig: vi.fn().mockReturnValue({}),
      getInstructions: vi.fn().mockReturnValue(''),
    };

    let callCount = 0;
    vi.mocked(McpClient).mockImplementation(() => {
      const client = callCount === 0 ? initialClient : freshClient;
      callCount++;
      return client as unknown as McpClient;
    });

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
});
