/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResourceListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { McpClient } from './mcp-client.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('@google/genai');
vi.mock('../auth/oauth-provider.js');
vi.mock('../auth/oauth-token-storage.js');
vi.mock('../auth/oauth-utils.js');
vi.mock('google-auth-library');

vi.mock('@vybestack/llxprt-code-core/utils/events.js', () => ({
  coreEvents: {
    emitFeedback: vi.fn(),
  },
}));

describe('McpClient resource refresh', () => {
  it('aborts an in-flight resource refresh when disconnected', async () => {
    let resourceListHandler:
      | ((notification: unknown) => Promise<void> | void)
      | undefined;
    let refreshSignal: AbortSignal | undefined;
    const mockedClient = {
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
      request: vi.fn().mockResolvedValue({ resources: [] }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      mockedClient as unknown as Client,
    );
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as SdkClientStdioLib.StdioClientTransport);
    const trustedConfig = { isTrustedFolder: () => true } as Config;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        removeMcpToolsByServer: vi.fn(),
        getMessageBus: vi.fn(),
      } as unknown as ToolRegistry,
      { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
      {
        setResourcesForServer: vi.fn(),
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry,
      new WorkspaceContext('/workspace'),
      trustedConfig,
      false,
      '0.0.1',
    );
    await client.connect();
    mockedClient.request.mockImplementation((_request, _schema, options) => {
      refreshSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });

    const refresh = Promise.resolve(
      resourceListHandler?.({
        method: 'notifications/resources/list_changed',
      }),
    );
    await vi.waitFor(() => expect(refreshSignal).toBeDefined());

    await client.disconnect();

    expect(refreshSignal?.aborted).toBe(true);
    await refresh;
  });

  it('removes stale resources when authorization is revoked during discovery', async () => {
    let trusted = true;
    let resourceListHandler:
      | ((notification: unknown) => Promise<void> | void)
      | undefined;
    const mockedClient = {
      connect: vi.fn(),
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
      request: vi.fn().mockImplementation(async () => {
        trusted = false;
        return { resources: [{ uri: 'file:///new' }] };
      }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      mockedClient as unknown as Client,
    );
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
    const resourceRegistry = {
      setResourcesForServer: vi.fn(),
      removeResourcesByServer: vi.fn(),
    } as unknown as ResourceRegistry;
    const config = { isTrustedFolder: () => trusted } as Config;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn(),
      } as unknown as ToolRegistry,
      {} as PromptRegistry,
      resourceRegistry,
      new WorkspaceContext('/workspace'),
      config,
      false,
      '0.0.1',
    );
    await client.connect();

    await resourceListHandler?.({
      method: 'notifications/resources/list_changed',
    });

    expect(resourceRegistry.removeResourcesByServer).toHaveBeenCalledWith(
      'test-server',
    );
    expect(resourceRegistry.setResourcesForServer).not.toHaveBeenCalled();
  });

  it('clears the refresh timeout when registry publication fails', async () => {
    let resourceListHandler:
      | ((notification: unknown) => Promise<void> | void)
      | undefined;
    const mockedClient = {
      connect: vi.fn(),
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
      request: vi.fn().mockResolvedValue({
        resources: [{ uri: 'file:///resource' }],
      }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      mockedClient as unknown as Client,
    );
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
    const resourceRegistry = {
      setResourcesForServer: vi.fn(),
      removeResourcesByServer: vi.fn(),
    } as unknown as ResourceRegistry;
    const trustedConfig = { isTrustedFolder: () => true } as Config;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn(),
      } as unknown as ToolRegistry,
      {} as PromptRegistry,
      resourceRegistry,
      new WorkspaceContext('/workspace'),
      trustedConfig,
      false,
      '0.0.1',
    );
    await client.connect();
    await client.discover(trustedConfig);
    vi.mocked(resourceRegistry.setResourcesForServer).mockImplementationOnce(
      () => {
        throw new Error('registry publication failed');
      },
    );
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await resourceListHandler?.({
      method: 'notifications/resources/list_changed',
    });

    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    clearTimeoutSpy.mockRestore();
  });
});
