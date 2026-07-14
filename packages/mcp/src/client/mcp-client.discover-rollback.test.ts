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

vi.mock('@vybestack/llxprt-code-core/utils/events.js', () => ({
  coreEvents: {
    emitFeedback: vi.fn(),
  },
}));

describe('McpClient discover rollback independence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cleans resources and tools even when prompt cleanup throws after registration', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn(),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      getServerCapabilities: vi
        .fn()
        .mockReturnValue({ prompts: {}, tools: {}, resources: {} }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [{ name: 'prompt' }],
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
      request: vi.fn().mockResolvedValue({ resources: [{ uri: 'file:///r' }] }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(sdkClient as unknown as Client);
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );

    const removePrompts = vi.fn().mockImplementation(() => {
      throw new Error('prompt cleanup exploded');
    });
    const removeResources = vi.fn();
    const removeTools = vi.fn();

    const promptRegistry = {
      registerPrompt: vi.fn(),
      removePromptsByServer: removePrompts,
    } as unknown as PromptRegistry;
    const resourceRegistry = {
      setResourcesForServer: vi.fn(),
      removeResourcesByServer: removeResources,
    } as unknown as ResourceRegistry;
    const toolRegistry = {
      registerTool: vi.fn(),
      sortTools: vi.fn(),
      removeMcpToolsByServer: removeTools,
      getMessageBus: vi.fn(),
    } as unknown as ToolRegistry;

    const config = { isTrustedFolder: () => true } as Config;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      resourceRegistry,
      new WorkspaceContext('/workspace'),
      config,
      false,
      '0.0.1',
    );
    await client.connect();

    let mayPublish = true;
    vi.mocked(resourceRegistry.setResourcesForServer).mockImplementation(() => {
      mayPublish = false;
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await client.discover(config, () => mayPublish);

    expect(removePrompts).toHaveBeenCalledWith('test-server');
    expect(removeResources).toHaveBeenCalledWith('test-server');
    expect(removeTools).toHaveBeenCalledWith('test-server');
  });

  it('cleans prompts and tools even when resource cleanup throws', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn(),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      getServerCapabilities: vi
        .fn()
        .mockReturnValue({ prompts: {}, tools: {}, resources: {} }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [{ name: 'prompt' }],
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
      request: vi.fn().mockResolvedValue({ resources: [{ uri: 'file:///r' }] }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(sdkClient as unknown as Client);
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );

    const removePrompts = vi.fn();
    const removeResources = vi.fn().mockImplementation(() => {
      throw new Error('resource cleanup exploded');
    });
    const removeTools = vi.fn();

    const promptRegistry = {
      registerPrompt: vi.fn(),
      removePromptsByServer: removePrompts,
    } as unknown as PromptRegistry;
    const resourceRegistry = {
      setResourcesForServer: vi.fn(),
      removeResourcesByServer: removeResources,
    } as unknown as ResourceRegistry;
    const toolRegistry = {
      registerTool: vi.fn(),
      sortTools: vi.fn(),
      removeMcpToolsByServer: removeTools,
      getMessageBus: vi.fn(),
    } as unknown as ToolRegistry;

    const config = { isTrustedFolder: () => true } as Config;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      resourceRegistry,
      new WorkspaceContext('/workspace'),
      config,
      false,
      '0.0.1',
    );
    await client.connect();

    let mayPublish = true;
    vi.mocked(resourceRegistry.setResourcesForServer).mockImplementation(() => {
      mayPublish = false;
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await client.discover(config, () => mayPublish);

    expect(removePrompts).toHaveBeenCalledWith('test-server');
    expect(removeResources).toHaveBeenCalledWith('test-server');
    expect(removeTools).toHaveBeenCalledWith('test-server');
  });

  it('cleans prompts and resources even when tool cleanup throws', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn(),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      getServerCapabilities: vi
        .fn()
        .mockReturnValue({ prompts: {}, tools: {}, resources: {} }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [{ name: 'prompt' }],
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
      request: vi.fn().mockResolvedValue({ resources: [{ uri: 'file:///r' }] }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(sdkClient as unknown as Client);
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );

    const removePrompts = vi.fn();
    const removeResources = vi.fn();
    const removeTools = vi.fn().mockImplementation(() => {
      throw new Error('tool cleanup exploded');
    });

    const promptRegistry = {
      registerPrompt: vi.fn(),
      removePromptsByServer: removePrompts,
    } as unknown as PromptRegistry;
    const resourceRegistry = {
      setResourcesForServer: vi.fn(),
      removeResourcesByServer: removeResources,
    } as unknown as ResourceRegistry;
    const toolRegistry = {
      registerTool: vi.fn(),
      sortTools: vi.fn(),
      removeMcpToolsByServer: removeTools,
      getMessageBus: vi.fn(),
    } as unknown as ToolRegistry;

    const config = { isTrustedFolder: () => true } as Config;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      resourceRegistry,
      new WorkspaceContext('/workspace'),
      config,
      false,
      '0.0.1',
    );
    await client.connect();

    let mayPublish = true;
    vi.mocked(resourceRegistry.setResourcesForServer).mockImplementation(() => {
      mayPublish = false;
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await client.discover(config, () => mayPublish);

    expect(removePrompts).toHaveBeenCalledWith('test-server');
    expect(removeResources).toHaveBeenCalledWith('test-server');
    expect(removeTools).toHaveBeenCalledWith('test-server');
  });

  it('cleans all three registries when the first one (prompts) throws during rollback', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn(),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      getServerCapabilities: vi
        .fn()
        .mockReturnValue({ prompts: {}, tools: {}, resources: {} }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [{ name: 'prompt' }],
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
      request: vi.fn().mockResolvedValue({ resources: [{ uri: 'file:///r' }] }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(sdkClient as unknown as Client);
    vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );

    const removePrompts = vi.fn().mockImplementation(() => {
      throw new Error('first registry failure');
    });
    const removeResources = vi.fn();
    const removeTools = vi.fn();

    const promptRegistry = {
      registerPrompt: vi.fn(),
      removePromptsByServer: removePrompts,
    } as unknown as PromptRegistry;
    const resourceRegistry = {
      setResourcesForServer: vi.fn(),
      removeResourcesByServer: removeResources,
    } as unknown as ResourceRegistry;
    const toolRegistry = {
      registerTool: vi.fn(),
      sortTools: vi.fn(),
      removeMcpToolsByServer: removeTools,
      getMessageBus: vi.fn(),
    } as unknown as ToolRegistry;

    const config = { isTrustedFolder: () => true } as Config;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      resourceRegistry,
      new WorkspaceContext('/workspace'),
      config,
      false,
      '0.0.1',
    );
    await client.connect();

    let mayPublish = true;
    vi.mocked(resourceRegistry.setResourcesForServer).mockImplementation(() => {
      mayPublish = false;
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await client.discover(config, () => mayPublish);

    expect(removePrompts).toHaveBeenCalledWith('test-server');
    expect(removeResources).toHaveBeenCalledWith('test-server');
    expect(removeTools).toHaveBeenCalledWith('test-server');
  });
});
