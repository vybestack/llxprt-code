/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '../../../test-utils/src/automock.js';
import { afterEach, describe, expect, it, vi, type Mock } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Config } from './test-support/mcpClientTestSupport.js';
import type { PromptRegistry } from './test-support/mcpClientTestSupport.js';
import type { ResourceRegistry } from './test-support/mcpClientTestSupport.js';
import { WorkspaceContext } from './test-support/mcpClientTestSupport.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { McpClient } from './mcp-client.js';

const realStdioModule = {
  ...(await import('@modelcontextprotocol/sdk/client/stdio.js')),
};
const realIndexModule = {
  ...(await import('@modelcontextprotocol/sdk/client/index.js')),
};
const realOauthProviderModule = {
  ...(await import('../auth/oauth-provider.js')),
};
const realOauthTokenStorageModule = {
  ...(await import('../auth/oauth-token-storage.js')),
};
const realOauthUtilsModule = { ...(await import('../auth/oauth-utils.js')) };

void vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () =>
  automock(realStdioModule),
);
void vi.mock('@modelcontextprotocol/sdk/client/index.js', () =>
  automock(realIndexModule),
);
void vi.mock('../auth/oauth-provider.js', () =>
  automock(realOauthProviderModule),
);
void vi.mock('../auth/oauth-token-storage.js', () =>
  automock(realOauthTokenStorageModule),
);
void vi.mock('../auth/oauth-utils.js', () => automock(realOauthUtilsModule));
void vi.mock('google-auth-library', () => ({ GoogleAuth: vi.fn() }));

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
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient as unknown as Client);
    (
      SdkClientStdioLib.StdioClientTransport as unknown as Mock<
        (...args: never[]) => unknown
      >
    ).mockReturnValue({} as SdkClientStdioLib.StdioClientTransport);
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
    (ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>)
      .mockReturnValueOnce(staleSdkClient as unknown as Client)
      .mockReturnValueOnce(activeSdkClient as unknown as Client);
    (
      SdkClientStdioLib.StdioClientTransport as unknown as Mock<
        (...args: never[]) => unknown
      >
    ).mockReturnValue({} as SdkClientStdioLib.StdioClientTransport);
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
