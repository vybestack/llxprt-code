/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClientManager } from './mcp-client-manager.js';
import { McpClient } from './mcp-client.js';
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

describe('McpClientManager trust transitions', () => {
  beforeEach(() => {
    vi.mocked(McpClient).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onFolderTrustGained', () => {
    it('discovers all configured MCP servers after gaining trust', async () => {
      const client = createMockMcpClient();
      vi.mocked(McpClient).mockReturnValue(client);

      const config = createMockConfig();
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );

      await manager.onFolderTrustGained();

      expect(client.connect).toHaveBeenCalled();
      expect(client.discover).toHaveBeenCalled();
    });

    it('does nothing if there are no configured servers', async () => {
      const client = createMockMcpClient();
      vi.mocked(McpClient).mockReturnValue(client);

      const config = createMockConfig({
        getMcpServers: () => ({}),
      });
      const manager = new McpClientManager(
        '0.0.1',
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
      vi.mocked(McpClient)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);

      const refreshFn = vi.fn();
      const config = createMockConfig({
        refreshMcpContext: refreshFn,
      });
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );

      await manager.startConfiguredMcpServers();

      await manager.onFolderTrustRevoked();

      expect(clientA.disconnect).toHaveBeenCalled();
      expect(clientB.disconnect).toHaveBeenCalled();
    });

    it('invalidates every client capability generation synchronously during quarantine', async () => {
      const clientA = createMockMcpClient();
      const clientB = createMockMcpClient();
      vi.mocked(McpClient)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);
      const config = createMockConfig();
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );
      await manager.startConfiguredMcpServers();

      manager.quarantineForTrustRevocation();

      expect(clientA.invalidateCapabilities).toHaveBeenCalledOnce();
      expect(clientB.invalidateCapabilities).toHaveBeenCalledOnce();
      expect(clientA.disconnect).not.toHaveBeenCalled();
      expect(clientB.disconnect).not.toHaveBeenCalled();
    });

    it('removes all clients from the internal map after revocation', async () => {
      const clientA = createMockMcpClient();
      vi.mocked(McpClient).mockReturnValue(clientA);

      const config = createMockConfig();
      const manager = new McpClientManager(
        '0.0.1',
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
      vi.mocked(McpClient).mockReturnValue(client);

      const config = createMockConfig();
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );

      await manager.onFolderTrustRevoked();

      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('continues disconnecting clients when one disconnect fails', async () => {
      const clientA = createMockMcpClient();
      const clientB = createMockMcpClient();
      (clientA.disconnect as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('disconnect failed'),
      );
      vi.mocked(McpClient)
        .mockReturnValueOnce(clientA)
        .mockReturnValueOnce(clientB);
      const config = createMockConfig();
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );

      await manager.startConfiguredMcpServers();
      await manager.onFolderTrustRevoked();

      expect(clientA.disconnect).toHaveBeenCalled();
      expect(clientB.disconnect).toHaveBeenCalled();
      expect(manager.getMcpServerCount()).toBe(0);
    });
  });

  describe('stop cleanup', () => {
    it('disconnects clients already quarantined by synchronous revocation', async () => {
      const client = createMockMcpClient();
      vi.mocked(McpClient).mockReturnValue(client);
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );
      await manager.startConfiguredMcpServers();

      manager.quarantineForTrustRevocation();
      await manager.stop();

      expect(client.disconnect).toHaveBeenCalledOnce();
    });
  });

  describe('race: CONNECTING/discovery vs revoke', () => {
    it('prevents a concurrent discovery from registering after revoke clears clients', async () => {
      let resolveConnect: (value?: void) => void = () => {};
      const client = createMockMcpClient();
      (client.connect as ReturnType<typeof vi.fn>).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveConnect = resolve;
          }),
      );

      vi.mocked(McpClient).mockReturnValue(client);

      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );

      // Start discovery (in-flight, stuck at connect)
      void manager.startConfiguredMcpServers();

      await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());

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

      vi.mocked(McpClient).mockReturnValue(client);

      let trusted = true;
      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
        isTrustedFolder: () => trusted,
      });
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );

      // Start discovery (in-flight, stuck at connect)
      void manager.startConfiguredMcpServers();
      await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());

      // Flip trust to false while connect is pending
      trusted = false;

      // Resolve connect — the client must NOT be registered or discovered
      resolveConnect();
      await manager.whenDiscoverySettled();

      expect(manager.getMcpServerCount()).toBe(0);
      expect(client.discover).not.toHaveBeenCalled();
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
      vi.mocked(McpClient).mockReturnValue(client);
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
      const manager = new McpClientManager('0.0.1', toolRegistry, config);
      await manager.startConfiguredMcpServers();
      expect(manager.getMcpServerCount()).toBe(1);

      const restart = manager.restartServer('server-a');
      await vi.waitFor(() => expect(client.connect).toHaveBeenCalledTimes(2));
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
      vi.mocked(McpClient).mockReturnValue(client);

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
        '0.0.1',
        createToolRegistry(config),
        config,
      );

      await manager.startConfiguredMcpServers();
      expect(client.connect).not.toHaveBeenCalled();

      trusted = true;
      await manager.onFolderTrustGained();

      expect(client.connect).toHaveBeenCalled();
      expect(client.discover).toHaveBeenCalled();
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

      vi.mocked(McpClient).mockReturnValue(client);

      const config = createMockConfig({
        getMcpServers: () => ({ 'server-a': {} }),
      });
      const manager = new McpClientManager(
        '0.0.1',
        createToolRegistry(config),
        config,
      );

      // Start discovery — stuck at connect
      void manager.startConfiguredMcpServers();
      await vi.waitFor(() => expect(client.connect).toHaveBeenCalled());

      // Resolve connect — client gets registered
      resolveConnect();
      await vi.waitFor(() => expect(manager.getMcpServerCount()).toBe(1));

      // Revoke trust while discover is still pending
      await manager.onFolderTrustRevoked();
      expect(manager.getMcpServerCount()).toBe(0);

      // Resolve discover — the client should already be gone; no re-registration
      resolveDiscover();
      await manager.whenDiscoverySettled();

      expect(manager.getMcpServerCount()).toBe(0);
      expect(client.disconnect).toHaveBeenCalledOnce();
    });
  });
});
