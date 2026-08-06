/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '../../../test-utils/src/wait-for.js';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { McpClientManager } from './mcp-client-manager.js';
import { McpClient, MCPDiscoveryState } from './mcp-client.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
vi.mock('./mcp-client.js', () => ({
  McpClient: vi.fn(),
  MCPDiscoveryState: {
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
  },
  populateMcpServerCommand: vi.fn((servers, _command) => servers),
}));

function createMockMcpClient(): McpClient {
  return {
    connect: vi.fn(),
    discover: vi.fn(),
    disconnect: vi.fn(),
    getStatus: vi.fn(),
    invalidateCapabilities: vi.fn(),
    abortDiscovery: vi.fn(),
    getServerConfig: vi.fn().mockReturnValue({}),
    getInstructions: vi.fn().mockReturnValue(''),
  } as unknown as McpClient;
}

function createMockConfig(overrides?: Partial<Config>): Config {
  return {
    isTrustedFolder: () => true,
    getMcpServers: () => ({
      'server-a': {},
      'server-b': {},
    }),
    getMcpServerCommand: () => '',
    getPromptRegistry: () => new PromptRegistry(),
    getResourceRegistry: () => new ResourceRegistry(),
    getDebugMode: () => false,
    getWorkspaceContext: () => ({}) as WorkspaceContext,
    getAllowedMcpServers: () => undefined,
    getBlockedMcpServers: () => undefined,
    getExtensions: () => [],
    refreshMcpContext: vi.fn(),
    ...overrides,
  } as unknown as Config;
}

function createToolRegistry(config: Config): ToolRegistry {
  return new ToolRegistry(config, {
    requestConfirmation: async () => false,
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  const resolve = (value: T): void => {
    if (resolvePromise === undefined) {
      throw new Error('Deferred promise was not initialized');
    }
    resolvePromise(value);
  };
  return { promise, resolve };
}

const CLIENT_VERSION = '0.0.1';

describe('McpClientManager trust transitions', () => {
  beforeEach(() => {
    (McpClient as unknown as Mock<(...args: never[]) => unknown>).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onFolderTrustGained', () => {
    it('discovers all configured MCP servers after gaining trust', async () => {
      const client = createMockMcpClient();
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);

      const config = createMockConfig();
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      await manager.onFolderTrustGained();

      expect(client.connect).toHaveBeenCalled();
      expect(client.discover).toHaveBeenCalled();
    });

    it('does not restart discovery after the manager has stopped', async () => {
      const client = createMockMcpClient();
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);

      const refreshMcpContext = vi.fn();
      const config = createMockConfig({ refreshMcpContext });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );
      await manager.stop();

      await manager.onFolderTrustGained();

      expect(McpClient).not.toHaveBeenCalled();
      expect(client.connect).not.toHaveBeenCalled();
      expect(refreshMcpContext).not.toHaveBeenCalled();
    });

    it('does nothing if there are no configured servers', async () => {
      const client = createMockMcpClient();
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);

      const config = createMockConfig({
        getMcpServers: () => ({}),
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      await manager.onFolderTrustGained();

      expect(client.connect).not.toHaveBeenCalled();
      expect(client.discover).not.toHaveBeenCalled();
    });
  });

  describe('onFolderTrustRevoked', () => {
    it('disconnects all connected MCP servers', async () => {
      const clientA = createMockMcpClient();
      const clientB = createMockMcpClient();
      (McpClient as unknown as Mock<(...args: never[]) => unknown>)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);

      const refreshFn = vi.fn();
      const promptRegistry = new PromptRegistry();
      const resourceRegistry = new ResourceRegistry();
      const config = createMockConfig({
        refreshMcpContext: refreshFn,
        getPromptRegistry: () => promptRegistry,
        getResourceRegistry: () => resourceRegistry,
      });
      const toolRegistry = createToolRegistry(config);
      const manager = new McpClientManager(
        CLIENT_VERSION,
        toolRegistry,
        config,
      );

      await manager.startConfiguredMcpServers();
      const removeTools = vi.spyOn(toolRegistry, 'removeMcpToolsByServer');
      const removePrompts = vi.spyOn(promptRegistry, 'removePromptsByServer');
      const removeResources = vi.spyOn(
        resourceRegistry,
        'removeResourcesByServer',
      );

      await manager.onFolderTrustRevoked();

      expect(clientA.disconnect).toHaveBeenCalled();
      expect(clientB.disconnect).toHaveBeenCalled();
      expect(removeTools).toHaveBeenCalledTimes(2);
      expect(removePrompts).toHaveBeenCalledTimes(2);
      expect(removeResources).toHaveBeenCalledTimes(2);
    });

    it('invalidates every client capability generation synchronously during quarantine', async () => {
      const clientA = createMockMcpClient();
      const clientB = createMockMcpClient();
      (McpClient as unknown as Mock<(...args: never[]) => unknown>)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);
      const config = createMockConfig();
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );
      await manager.startConfiguredMcpServers();

      manager.quarantineForTrustRevocation();

      expect(clientA.invalidateCapabilities).toHaveBeenCalledOnce();
      expect(clientB.invalidateCapabilities).toHaveBeenCalledOnce();
      expect(clientA.abortDiscovery).toHaveBeenCalledOnce();
      expect(clientB.abortDiscovery).toHaveBeenCalledOnce();
      expect(clientA.disconnect).not.toHaveBeenCalled();
      expect(clientB.disconnect).not.toHaveBeenCalled();
    });

    it('quarantines every client and reports all synchronous failures', async () => {
      const events: string[] = [];
      const clientA = createMockMcpClient();
      const clientB = createMockMcpClient();
      (
        clientA.invalidateCapabilities as Mock<
          typeof clientA.invalidateCapabilities
        >
      ).mockImplementationOnce(() => {
        events.push('invalidate-a');
        throw new AggregateError([
          new Error('capability invalidation failed'),
          new Error('generation invalidation failed'),
        ]);
      });
      (
        clientA.abortDiscovery as Mock<typeof clientA.abortDiscovery>
      ).mockImplementationOnce(() => {
        events.push('abort-a');
        throw new Error('abort failed');
      });
      (
        clientB.invalidateCapabilities as Mock<
          typeof clientB.invalidateCapabilities
        >
      ).mockImplementationOnce(() => {
        events.push('invalidate-b');
      });
      (
        clientB.abortDiscovery as Mock<typeof clientB.abortDiscovery>
      ).mockImplementationOnce(() => {
        events.push('abort-b');
      });
      (McpClient as unknown as Mock<(...args: never[]) => unknown>)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);
      const promptRegistry = new PromptRegistry();
      const resourceRegistry = new ResourceRegistry();
      const config = createMockConfig({
        getPromptRegistry: () => promptRegistry,
        getResourceRegistry: () => resourceRegistry,
      });
      const toolRegistry = createToolRegistry(config);
      vi.spyOn(toolRegistry, 'removeMcpToolsByServer').mockImplementation(
        (name) => {
          events.push(`artifacts-${name}`);
          if (name === 'server-a') {
            throw new Error('artifact cleanup failed');
          }
        },
      );
      const manager = new McpClientManager(
        CLIENT_VERSION,
        toolRegistry,
        config,
      );
      await manager.startConfiguredMcpServers();

      let failure: unknown;
      try {
        manager.quarantineForTrustRevocation();
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(AggregateError);
      expect(events).toStrictEqual([
        'invalidate-a',
        'abort-a',
        'invalidate-b',
        'abort-b',
        'artifacts-server-a',
        'artifacts-server-b',
      ]);
      expect(manager.getMcpServerCount()).toBe(0);
      expect((failure as AggregateError).errors).toHaveLength(4);
    });

    it('removes all clients from the internal map after revocation', async () => {
      const clientA = createMockMcpClient();
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(clientA);

      const config = createMockConfig();
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      await manager.startConfiguredMcpServers();
      expect(manager.getMcpServerCount()).toBeGreaterThan(0);

      await manager.onFolderTrustRevoked();

      expect(manager.getMcpServerCount()).toBe(0);
    });

    it('does nothing when no servers are connected', async () => {
      const client = createMockMcpClient();
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);

      const config = createMockConfig();
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      await manager.onFolderTrustRevoked();

      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('attempts every disconnect and refresh before reporting aggregated failures', async () => {
      const events: string[] = [];
      const clientA = createMockMcpClient();
      const clientB = createMockMcpClient();
      (
        clientA.disconnect as Mock<typeof clientA.disconnect>
      ).mockImplementation(async () => {
        events.push('disconnect-a');
        throw new Error('disconnect failed');
      });
      (
        clientB.disconnect as Mock<typeof clientB.disconnect>
      ).mockImplementation(async () => {
        events.push('disconnect-b');
      });
      (McpClient as unknown as Mock<(...args: never[]) => unknown>)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);
      let failRefresh = false;
      const config = createMockConfig({
        refreshMcpContext: async () => {
          if (failRefresh) {
            events.push('refresh');
            throw new Error('refresh failed');
          }
        },
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );
      await manager.startConfiguredMcpServers();
      failRefresh = true;
      events.length = 0;

      let failure: unknown;
      try {
        await manager.onFolderTrustRevoked();
      } catch (error) {
        failure = error;
      }

      expect(events).toStrictEqual(['disconnect-a', 'disconnect-b', 'refresh']);
      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toHaveLength(2);
      expect(manager.getMcpServerCount()).toBe(0);
    });
  });

  describe('stop cleanup', () => {
    it('disconnects clients already quarantined by synchronous revocation', async () => {
      const client = createMockMcpClient();
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );
      await manager.startConfiguredMcpServers();

      manager.quarantineForTrustRevocation();
      await manager.stop();

      expect(client.disconnect).toHaveBeenCalledOnce();
    });

    it.each(['tools', 'prompts', 'resources'] as const)(
      'disconnects all clients when %s artifact cleanup fails during stop',
      async (failingRegistry) => {
        const client = createMockMcpClient();
        (
          McpClient as unknown as Mock<(...args: never[]) => unknown>
        ).mockReturnValue(client);
        const promptRegistry = new PromptRegistry();
        const resourceRegistry = new ResourceRegistry();
        const config = createMockConfig({
          getMcpServers: () => ({ 'server-a': {} }),
          getPromptRegistry: () => promptRegistry,
          getResourceRegistry: () => resourceRegistry,
        });
        const toolRegistry = createToolRegistry(config);
        const failCleanup = () => {
          throw new Error('cleanup failed');
        };
        const installCleanupFailure = {
          tools: () =>
            vi
              .spyOn(toolRegistry, 'removeMcpToolsByServer')
              .mockImplementationOnce(failCleanup),
          prompts: () =>
            vi
              .spyOn(promptRegistry, 'removePromptsByServer')
              .mockImplementationOnce(failCleanup),
          resources: () =>
            vi
              .spyOn(resourceRegistry, 'removeResourcesByServer')
              .mockImplementationOnce(failCleanup),
        };
        installCleanupFailure[failingRegistry]();
        const manager = new McpClientManager(
          CLIENT_VERSION,
          toolRegistry,
          config,
        );
        await manager.startConfiguredMcpServers();

        await expect(manager.stop()).rejects.toMatchObject({
          errors: [expect.objectContaining({ message: 'cleanup failed' })],
        });

        expect(client.disconnect).toHaveBeenCalledOnce();
      },
    );

    it('retries clients whose first stop disconnect failed', async () => {
      const client = createMockMcpClient();
      (client.disconnect as Mock<typeof client.disconnect>)
        .mockRejectedValueOnce(new Error('transient close failure'))
        .mockResolvedValueOnce(undefined);
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );
      await manager.startConfiguredMcpServers();

      await expect(manager.stop()).rejects.toMatchObject({
        errors: [
          expect.objectContaining({ message: 'transient close failure' }),
        ],
      });
      await expect(manager.stop()).resolves.toBeUndefined();

      expect(client.disconnect).toHaveBeenCalledTimes(2);
    });

    it('removes artifacts for every server name while disconnecting a shared client once', async () => {
      const client = createMockMcpClient();
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const config = createMockConfig();
      const toolRegistry = createToolRegistry(config);
      const removeTools = vi.spyOn(toolRegistry, 'removeMcpToolsByServer');
      const manager = new McpClientManager(
        CLIENT_VERSION,
        toolRegistry,
        config,
      );
      await manager.startConfiguredMcpServers();
      removeTools.mockClear();

      await manager.stop();

      expect(removeTools.mock.calls.map(([name]) => name)).toStrictEqual([
        'server-a',
        'server-b',
      ]);
      expect(client.disconnect).toHaveBeenCalledOnce();
    });

    it('disconnects an in-flight client exactly once when stop races connect completion', async () => {
      const connectReleased = createDeferred<void>();
      const client = createMockMcpClient();
      (client.connect as Mock<typeof client.connect>).mockReturnValueOnce(
        connectReleased.promise,
      );
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      void manager.startConfiguredMcpServers();
      await waitFor(() => expect(client.connect).toHaveBeenCalledOnce());

      const stop = manager.stop();
      await waitFor(() => expect(client.disconnect).toHaveBeenCalledOnce());
      connectReleased.resolve(undefined);
      await stop;

      expect(client.discover).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledOnce();
    });

    it('attempts artifact cleanup, every disconnect, and discovery settlement before reporting all stop failures', async () => {
      const discoveryReleased = createDeferred<void>();
      const events: string[] = [];
      const clientA = createMockMcpClient();
      const clientB = createMockMcpClient();
      (
        clientA.discover as Mock<typeof clientA.discover>
      ).mockImplementationOnce(async () => {
        events.push('discover-a');
        await discoveryReleased.promise;
        events.push('discovery-settled');
      });
      (
        clientA.disconnect as Mock<typeof clientA.disconnect>
      ).mockImplementationOnce(async () => {
        events.push('disconnect-a');
        throw new Error('disconnect-a failed');
      });
      (
        clientB.disconnect as Mock<typeof clientB.disconnect>
      ).mockImplementationOnce(async () => {
        events.push('disconnect-b');
        throw new Error('disconnect-b failed');
      });
      (McpClient as unknown as Mock<(...args: never[]) => unknown>)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);
      const promptRegistry = new PromptRegistry();
      const resourceRegistry = new ResourceRegistry();
      const config = createMockConfig({
        getPromptRegistry: () => promptRegistry,
        getResourceRegistry: () => resourceRegistry,
      });
      const toolRegistry = createToolRegistry(config);
      const manager = new McpClientManager(
        CLIENT_VERSION,
        toolRegistry,
        config,
      );

      void manager.startConfiguredMcpServers();
      await waitFor(() => expect(clientA.discover).toHaveBeenCalledOnce());
      vi.spyOn(toolRegistry, 'removeMcpToolsByServer').mockImplementation(
        (name) => {
          events.push(`artifacts-${name}`);
          if (name === 'server-a') {
            throw new Error('artifact cleanup failed');
          }
        },
      );

      const stop = manager.stop();
      await waitFor(() => expect(clientB.disconnect).toHaveBeenCalledOnce());
      discoveryReleased.resolve(undefined);

      await expect(stop).rejects.toMatchObject({
        errors: [
          expect.objectContaining({ message: 'artifact cleanup failed' }),
          expect.objectContaining({ message: 'disconnect-a failed' }),
          expect.objectContaining({ message: 'disconnect-b failed' }),
        ],
      });
      expect(events).toContain('discovery-settled');
    });
  });

  describe('race: CONNECTING/discovery vs revoke', () => {
    it('disconnects a failed discovery when artifact cleanup also fails', async () => {
      const client = createMockMcpClient();
      (client.discover as Mock<typeof client.discover>).mockRejectedValueOnce(
        new Error('discovery failed'),
      );
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const promptRegistry = new PromptRegistry();
      const resourceRegistry = new ResourceRegistry();
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
        getPromptRegistry: () => promptRegistry,
        getResourceRegistry: () => resourceRegistry,
      });
      const toolRegistry = createToolRegistry(config);
      vi.spyOn(toolRegistry, 'removeMcpToolsByServer').mockImplementationOnce(
        () => {
          throw new Error('registry cleanup failed');
        },
      );
      const manager = new McpClientManager(
        CLIENT_VERSION,
        toolRegistry,
        config,
      );

      await manager.startConfiguredMcpServers();

      expect(client.disconnect).toHaveBeenCalledOnce();
      expect(manager.getMcpServerCount()).toBe(0);
    });

    it('retries a failed discovery disconnect during stop even when the client was never quarantined', async () => {
      const client = createMockMcpClient();
      (client.discover as Mock<typeof client.discover>).mockRejectedValueOnce(
        new Error('discovery failed'),
      );
      (client.disconnect as Mock<typeof client.disconnect>)
        .mockRejectedValueOnce(new Error('transient close failure'))
        .mockResolvedValueOnce(undefined);
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      await manager.startConfiguredMcpServers();
      await manager.stop();

      expect(client.disconnect).toHaveBeenCalledTimes(2);
    });

    it('prevents a concurrent discovery from registering after revoke clears clients', async () => {
      let resolveConnect: (value?: void) => void = () => {};
      const client = createMockMcpClient();
      (client.connect as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveConnect = resolve;
          }),
      );

      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);

      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      // Start discovery (in-flight, stuck at connect)
      void manager.startConfiguredMcpServers();

      await waitFor(() => expect(client.connect).toHaveBeenCalled());

      const revokePromise = manager.onFolderTrustRevoked();
      expect(manager.getMcpServerCount()).toBe(0);
      await revokePromise;
      expect(client.disconnect).toHaveBeenCalledTimes(1);

      // Now resolve the stuck connect — the client must NOT be registered
      resolveConnect();
      await manager.whenDiscoverySettled();

      expect(manager.getMcpServerCount()).toBe(0);
      expect(client.discover).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledOnce();
    });

    it('rechecks trust before registering a client in connectAndDiscover', async () => {
      let resolveConnect: (value?: void) => void = () => {};
      const client = createMockMcpClient();
      (client.connect as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveConnect = resolve;
          }),
      );

      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);

      let trusted = true;
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
        isTrustedFolder: () => trusted,
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      // Start discovery (in-flight, stuck at connect)
      void manager.startConfiguredMcpServers();
      await waitFor(() => expect(client.connect).toHaveBeenCalled());

      // Flip trust to false while connect is pending
      trusted = false;

      // Resolve connect — the client must NOT be registered or discovered
      resolveConnect();
      await manager.whenDiscoverySettled();

      expect(manager.getMcpServerCount()).toBe(0);
      expect(client.discover).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledOnce();
    });

    it('removes an existing client and its artifacts when trust is revoked after reconnect', async () => {
      let trusted = true;
      let resolveReconnect: (() => void) | undefined;
      const client = createMockMcpClient();
      (client.connect as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveReconnect = resolve;
            }),
        );
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const promptRegistry = new PromptRegistry();
      const resourceRegistry = new ResourceRegistry();
      const removePrompts = vi.spyOn(promptRegistry, 'removePromptsByServer');
      const removeResources = vi.spyOn(
        resourceRegistry,
        'removeResourcesByServer',
      );
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
        getPromptRegistry: () => promptRegistry,
        getResourceRegistry: () => resourceRegistry,
        isTrustedFolder: () => trusted,
      });
      const toolRegistry = createToolRegistry(config);
      const removeTools = vi.spyOn(toolRegistry, 'removeMcpToolsByServer');
      const manager = new McpClientManager(
        CLIENT_VERSION,
        toolRegistry,
        config,
      );
      await manager.startConfiguredMcpServers();
      expect(manager.getMcpServerCount()).toBe(1);

      const restart = manager.restartServer('server-a');
      await waitFor(() => expect(client.connect).toHaveBeenCalledTimes(2));
      trusted = false;
      resolveReconnect?.();
      await restart;

      expect(manager.getMcpServerCount()).toBe(0);
      expect(removeTools).toHaveBeenCalledWith('server-a');
      expect(removePrompts).toHaveBeenCalledWith('server-a');
      expect(removeResources).toHaveBeenCalledWith('server-a');
      expect(client.discover).toHaveBeenCalledTimes(1);
      expect(client.disconnect).toHaveBeenCalledTimes(2);
    });
  });

  describe('extension MCP servers start on trust gain', () => {
    it('discovers extension servers that were skipped while untrusted', async () => {
      const client = createMockMcpClient();
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);

      let trusted = false;
      const extension = { name: 'ext', isActive: true };
      const config = createMockConfig({
        getMcpServers: () => ({}),
        isTrustedFolder: () => trusted,
        getExtensions: () => [
          {
            name: 'ext',
            isActive: true,
            mcpServers: { 'ext-server': { extension } },
          },
        ],
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      await manager.startConfiguredMcpServers();
      expect(client.connect).not.toHaveBeenCalled();

      trusted = true;
      await manager.onFolderTrustGained();

      expect(client.connect).toHaveBeenCalled();
      expect(client.discover).toHaveBeenCalled();
      expect(manager.getDiscoveryState()).toBe(MCPDiscoveryState.COMPLETED);
    });
  });

  describe('race: discovery completion vs revoke', () => {
    it('disconnects a client if trust is revoked between connect and discover', async () => {
      let resolveConnect: (value?: void) => void = () => {};
      let resolveDiscover: (value?: void) => void = () => {};
      const client = createMockMcpClient();
      (client.connect as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveConnect = resolve;
          }),
      );
      (client.discover as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveDiscover = resolve;
          }),
      );

      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);

      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      // Start discovery — stuck at connect
      void manager.startConfiguredMcpServers();
      await waitFor(() => expect(client.connect).toHaveBeenCalled());

      // Resolve connect — client gets registered
      resolveConnect();
      await waitFor(() => expect(manager.getMcpServerCount()).toBe(1));

      // Revoke trust while discover is still pending
      await manager.onFolderTrustRevoked();
      expect(manager.getMcpServerCount()).toBe(0);

      // Resolve discover — the client should already be gone; no re-registration
      resolveDiscover();
      await manager.whenDiscoverySettled();

      expect(manager.getMcpServerCount()).toBe(0);
      expect(client.disconnect).toHaveBeenCalledOnce();
    });

    it('disconnects once when invalid discovery cleanup encounters a registry failure', async () => {
      let trusted = true;
      const discoveryStarted = createDeferred<void>();
      const discoveryReleased = createDeferred<void>();
      const client = createMockMcpClient();
      (client.discover as Mock<typeof client.discover>).mockImplementationOnce(
        () => {
          discoveryStarted.resolve(undefined);
          return discoveryReleased.promise;
        },
      );
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const promptRegistry = new PromptRegistry();
      const resourceRegistry = new ResourceRegistry();
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
        getPromptRegistry: () => promptRegistry,
        getResourceRegistry: () => resourceRegistry,
        isTrustedFolder: () => trusted,
      });
      const toolRegistry = createToolRegistry(config);
      const removePrompts = vi.spyOn(promptRegistry, 'removePromptsByServer');
      const removeResources = vi.spyOn(
        resourceRegistry,
        'removeResourcesByServer',
      );
      const manager = new McpClientManager(
        CLIENT_VERSION,
        toolRegistry,
        config,
      );

      void manager.startConfiguredMcpServers();
      await waitFor(() => expect(client.discover).toHaveBeenCalledOnce());
      vi.spyOn(toolRegistry, 'removeMcpToolsByServer').mockImplementationOnce(
        () => {
          throw new Error('registry cleanup failed');
        },
      );
      trusted = false;
      discoveryReleased.resolve(undefined);
      await manager.whenDiscoverySettled();

      expect(manager.getMcpServerCount()).toBe(0);
      expect(client.disconnect).toHaveBeenCalledOnce();
      expect(removePrompts).toHaveBeenCalledWith('server-a');
      expect(removeResources).toHaveBeenCalledWith('server-a');
    });
  });

  describe('quarantine aborts active discovery synchronously', () => {
    it('aborts in-flight discovery when trust is revoked', async () => {
      const discoveryStarted = createDeferred<void>();
      const discoveryReleased = createDeferred<void>();
      const client = createMockMcpClient();
      (client.discover as Mock<typeof client.discover>).mockImplementationOnce(
        () => {
          discoveryStarted.resolve(undefined);
          return discoveryReleased.promise;
        },
      );
      (
        McpClient as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(client);
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        CLIENT_VERSION,
        createToolRegistry(config),
        config,
      );

      void manager.startConfiguredMcpServers();
      await discoveryStarted.promise;

      manager.quarantineForTrustRevocation();

      expect(client.abortDiscovery).toHaveBeenCalledOnce();
      expect(client.invalidateCapabilities).toHaveBeenCalledOnce();
      expect(manager.getMcpServerCount()).toBe(0);

      discoveryReleased.resolve(undefined);
      await manager.whenDiscoverySettled();

      expect(manager.getMcpServerCount()).toBe(0);
    });
  });
});
