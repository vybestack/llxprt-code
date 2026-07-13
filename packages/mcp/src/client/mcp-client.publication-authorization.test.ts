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

describe('McpClient capability publication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rechecks authorization immediately before registering capabilities', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn(),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({ prompts: {} }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [{ name: 'prompt' }],
      }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(sdkClient as unknown as Client);
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
    const promptRegistry = {
      registerPrompt: vi.fn(),
      removePromptsByServer: vi.fn(),
    } as unknown as PromptRegistry;
    const config = { isTrustedFolder: () => true } as Config;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        removeMcpToolsByServer: vi.fn(),
        getMessageBus: vi.fn(),
      } as unknown as ToolRegistry,
      promptRegistry,
      {
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry,
      new WorkspaceContext('/workspace'),
      config,
      false,
      '0.0.1',
    );
    await client.connect();
    const mayPublish = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await client.discover(config, mayPublish);

    expect(promptRegistry.registerPrompt).not.toHaveBeenCalled();
  });
});
