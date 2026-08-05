/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResourceListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { McpClient } from './mcp-client.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('@google/genai');
vi.mock('../auth/oauth-provider.js');
vi.mock('../auth/oauth-token-storage.js');
vi.mock('../auth/oauth-utils.js');
vi.mock('google-auth-library', () => ({ GoogleAuth: vi.fn() }));

vi.mock('@vybestack/llxprt-code-core/utils/events.js', () => ({
  coreEvents: {
    emitFeedback: vi.fn(),
  },
}));

const RESOURCE_LIST_CHANGED_METHOD = 'notifications/resources/list_changed';

type ResourceListHandler = (notification: unknown) => Promise<void> | void;

function createMockSdkClient(
  request: ReturnType<typeof vi.fn> = vi
    .fn()
    .mockResolvedValue({ resources: [] }),
): {
  readonly mockedClient: {
    readonly connect: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
    readonly registerCapabilities: ReturnType<typeof vi.fn>;
    readonly setRequestHandler: ReturnType<typeof vi.fn>;
    readonly setNotificationHandler: ReturnType<typeof vi.fn>;
    readonly getServerCapabilities: ReturnType<typeof vi.fn>;
    readonly request: ReturnType<typeof vi.fn>;
  };
  readonly getResourceListHandler: () => ResourceListHandler | undefined;
} {
  let resourceListHandler: ResourceListHandler | undefined;
  return {
    mockedClient: {
      connect: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn((schema, handler) => {
        if (schema === ResourceListChangedNotificationSchema) {
          resourceListHandler = handler;
        }
      }),
      getServerCapabilities: vi
        .fn()
        .mockReturnValue({ resources: { listChanged: true } }),
      request,
    },

    getResourceListHandler: () => resourceListHandler,
  };
}

describe('McpClient resource refresh', () => {
  function createTestMcpClient(
    config: Config,
    resourceRegistry = new ResourceRegistry(),
    toolRegistry: ToolRegistry = {
      registerTool: vi.fn(),
      sortTools: vi.fn(),
      removeMcpToolsByServer: vi.fn(),
      getMessageBus: vi.fn(),
    } as unknown as ToolRegistry,
  ): McpClient {
    return new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
      resourceRegistry,
      new WorkspaceContext('/workspace'),
      config,
      false,
      '0.0.1',
    );
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts an in-flight resource refresh when disconnected', async () => {
    let refreshSignal: AbortSignal | undefined;
    const requestStarted = Promise.withResolvers<void>();
    const { mockedClient, getResourceListHandler } = createMockSdkClient();
    vi.mocked(ClientLib.Client).mockReturnValue(
      mockedClient as unknown as Client,
    );
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as SdkClientStdioLib.StdioClientTransport);
    const trustedConfig = { isTrustedFolder: () => true } as Config;
    const client = createTestMcpClient(trustedConfig);
    await client.connect();
    mockedClient.request.mockImplementation((_request, _schema, options) => {
      refreshSignal = options?.signal;
      requestStarted.resolve();
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });

    const refresh = Promise.resolve(
      getResourceListHandler()?.({
        method: RESOURCE_LIST_CHANGED_METHOD,
      }),
    );
    await requestStarted.promise;

    await client.disconnect();

    expect(refreshSignal?.aborted).toBe(true);
    await refresh;
  });

  it('rolls back resources when authorization is revoked during publication', async () => {
    let trusted = true;
    const { mockedClient, getResourceListHandler } = createMockSdkClient(
      vi.fn().mockResolvedValue({ resources: [{ uri: 'file:///new' }] }),
    );
    vi.mocked(ClientLib.Client).mockReturnValue(
      mockedClient as unknown as Client,
    );
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    const resourceRegistry = new ResourceRegistry();
    const removeResources = vi.spyOn(
      resourceRegistry,
      'removeResourcesByServer',
    );
    const realSetResources =
      resourceRegistry.setResourcesForServer.bind(resourceRegistry);
    vi.spyOn(resourceRegistry, 'setResourcesForServer').mockImplementation(
      (server, resources) => {
        trusted = false;
        return realSetResources(server, resources);
      },
    );
    const config = { isTrustedFolder: () => trusted } as Config;
    const client = createTestMcpClient(config, resourceRegistry);
    await client.connect();

    await getResourceListHandler()?.({
      method: RESOURCE_LIST_CHANGED_METHOD,
    });

    expect(removeResources).toHaveBeenCalledWith('test-server');
    expect(resourceRegistry.setResourcesForServer).toHaveBeenCalledWith(
      'test-server',
      [{ uri: 'file:///new' }],
    );
    expect(resourceRegistry.getAllResources()).toHaveLength(0);
  });

  it('clears the refresh timeout when registry publication fails', async () => {
    const { mockedClient, getResourceListHandler } = createMockSdkClient(
      vi.fn().mockResolvedValue({
        resources: [{ uri: 'file:///resource' }],
      }),
    );
    vi.mocked(ClientLib.Client).mockReturnValue(
      mockedClient as unknown as Client,
    );
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    const resourceRegistry = new ResourceRegistry();
    const trustedConfig = { isTrustedFolder: () => true } as Config;
    const client = createTestMcpClient(trustedConfig, resourceRegistry);
    await client.connect();
    await client.discover(trustedConfig);
    expect(resourceRegistry.getAllResources()).toHaveLength(1);
    vi.spyOn(resourceRegistry, 'setResourcesForServer').mockImplementationOnce(
      () => {
        throw new Error('registry publication failed');
      },
    );
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await getResourceListHandler()?.({
      method: RESOURCE_LIST_CHANGED_METHOD,
    });

    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(resourceRegistry.getAllResources()).toHaveLength(1);
    clearTimeoutSpy.mockRestore();
  });

  it('removes resources from the real registry after rollback when authorization is revoked', async () => {
    const { mockedClient, getResourceListHandler } = createMockSdkClient(
      vi.fn().mockResolvedValue({ resources: [{ uri: 'file:///new' }] }),
    );
    vi.mocked(ClientLib.Client).mockReturnValue(
      mockedClient as unknown as Client,
    );
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    const resourceRegistry = new ResourceRegistry();
    const config = { isTrustedFolder: () => false } as Config;
    const client = createTestMcpClient(config, resourceRegistry);
    await client.connect();

    await getResourceListHandler()?.({
      method: RESOURCE_LIST_CHANGED_METHOD,
    });

    expect(resourceRegistry.getAllResources()).toHaveLength(0);
  });
});
