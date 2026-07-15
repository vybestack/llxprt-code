/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { McpClient } from './mcp-client.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('../auth/oauth-provider.js');
vi.mock('../auth/oauth-token-storage.js');
vi.mock('../auth/oauth-utils.js');
vi.mock('google-auth-library');

function createSdkClient() {
  return {
    connect: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    registerCapabilities: vi.fn(),
    setRequestHandler: vi.fn(),
    setNotificationHandler: vi.fn(),
    getServerCapabilities: vi.fn().mockReturnValue({}),
    onerror: undefined as ((error: Error) => void) | undefined,
  };
}

describe('McpClient stale error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('closes and forgets an SDK client when handler registration fails', async () => {
    const sdkClient = createSdkClient();
    sdkClient.getServerCapabilities.mockReturnValue({
      tools: { listChanged: true },
    });
    sdkClient.setNotificationHandler.mockImplementation(() => {
      throw new Error('handler registration failed');
    });
    Object.assign(sdkClient, {
      getInstructions: vi.fn().mockReturnValue('stale instructions'),
    });
    vi.mocked(ClientLib.Client).mockReturnValue(sdkClient as unknown as Client);
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      { removeMcpToolsByServer: vi.fn() } as unknown as ToolRegistry,
      { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
      { removeResourcesByServer: vi.fn() } as unknown as ResourceRegistry,
      new WorkspaceContext('/workspace'),
      { isTrustedFolder: () => true } as Config,
      false,
      '0.0.1',
    );

    await expect(client.connect()).rejects.toThrow(
      'handler registration failed',
    );

    expect(client.getStatus()).toBe('disconnected');
    expect(client.getInstructions()).toBe('');
    expect(sdkClient.close).toHaveBeenCalledOnce();
  });

  it('ignores errors emitted by a stale SDK client after reconnect', async () => {
    const staleSdkClient = createSdkClient();
    const activeSdkClient = createSdkClient();
    vi.mocked(ClientLib.Client)
      .mockReturnValueOnce(staleSdkClient as unknown as Client)
      .mockReturnValueOnce(activeSdkClient as unknown as Client);
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      { removeMcpToolsByServer: vi.fn() } as unknown as ToolRegistry,
      { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
      {
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry,
      new WorkspaceContext('/workspace'),
      { isTrustedFolder: () => true } as Config,
      false,
      '0.0.1',
    );
    await client.connect();
    const staleErrorHandler = staleSdkClient.onerror;
    await client.disconnect();
    await client.connect();

    staleErrorHandler?.(new Error('stale connection lost'));

    expect(client.getStatus()).toBe('connected');
    expect(activeSdkClient.close).not.toHaveBeenCalled();
  });
});
