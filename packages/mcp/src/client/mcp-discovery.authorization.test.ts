/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  connectAndDiscover,
  discoverPrompts,
  discoverResources,
  discoverTools,
  invokeMcpPrompt,
  registerMcpPrompts,
} from './mcp-discovery.js';
import { McpCallableTool } from './mcp-callable-tool.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from './mcp-errors.js';
import { MCPServerStatus, updateMCPServerStatus } from './mcp-status.js';

const connection = vi.hoisted(() => ({
  client: undefined as Client | undefined,
}));

const connectToMcpServerMock = vi.hoisted(() => vi.fn());

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

vi.mock('./mcp-connection.js', () => ({
  connectToMcpServer: connectToMcpServerMock,
}));

vi.mock('./mcp-status.js', () => ({
  MCPServerStatus: {
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
  },
  MCPDiscoveryState: {
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
  },
  setMCPDiscoveryState: vi.fn(),
  updateMCPServerStatus: vi.fn(),
}));

describe('MCP capability authorization', () => {
  beforeEach(() => {
    connectToMcpServerMock.mockImplementation(() =>
      Promise.resolve(connection.client),
    );
    vi.mocked(updateMCPServerStatus).mockReset();
  });

  it('blocks a discovered tool after live folder trust is revoked', async () => {
    let trusted = true;
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    connection.client = {
      close: vi.fn(),
      getServerCapabilities: () => ({ tools: {} }),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
      callTool,
    } as unknown as Client;
    const registeredTools: Array<{
      build(params: Record<string, unknown>): {
        execute(signal: AbortSignal): Promise<unknown>;
      };
    }> = [];
    const toolRegistry = {
      registerTool: (tool: (typeof registeredTools)[number]) => {
        registeredTools.push(tool);
      },
      sortTools: vi.fn(),
      getMessageBus: vi.fn(),
      removeMcpToolsByServer: vi.fn(),
    } as unknown as ToolRegistry;
    const config = {
      isTrustedFolder: () => trusted,
    } as Config;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server', trust: true },
      toolRegistry,
      new PromptRegistry(),
      false,
      {} as WorkspaceContext,
      config,
    );
    expect(registeredTools).toHaveLength(1);

    trusted = false;
    const result = await registeredTools[0]
      .build({})
      .execute(new AbortController().signal);

    expect(result).toMatchObject({
      error: {
        message: expect.stringContaining(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE),
      },
    });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('discards a delayed tool result when authorization is revoked during the RPC', async () => {
    let trusted = true;
    const callStarted = createDeferred<void>();
    const callResult = createDeferred<{ content: never[] }>();
    const client = {
      callTool: vi.fn().mockImplementation(() => {
        callStarted.resolve(undefined);
        return callResult.promise;
      }),
    } as unknown as Client;
    const callable = new McpCallableTool(
      client,
      { name: 'tool', inputSchema: { type: 'object' } },
      1_000,
      () => trusted,
    );

    const resultPromise = callable.callTool([{ name: 'tool', args: {} }]);
    await callStarted.promise;
    trusted = false;
    callResult.resolve({ content: [] });

    await expect(resultPromise).resolves.toMatchObject([
      {
        functionResponse: {
          response: {
            error: {
              message: MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE,
            },
          },
        },
      },
    ]);
  });

  it('fails closed when prompt invocation has no authorization callback', async () => {
    const client = {
      getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    } as unknown as Client;

    await expect(
      invokeMcpPrompt('server', client, 'prompt', {}, undefined),
    ).rejects.toThrow(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
    expect(client.getPrompt).not.toHaveBeenCalled();
  });

  it('discards a delayed prompt result when authorization is revoked during the RPC', async () => {
    let trusted = true;
    const promptStarted = createDeferred<void>();
    const promptResult = createDeferred<{ messages: never[] }>();
    const client = {
      getPrompt: vi.fn().mockImplementation(() => {
        promptStarted.resolve(undefined);
        return promptResult.promise;
      }),
    } as unknown as Client;

    const invocation = invokeMcpPrompt(
      'server',
      client,
      'prompt',
      {},
      () => trusted,
    );
    await promptStarted.promise;
    trusted = false;
    promptResult.resolve({ messages: [] });

    await expect(invocation).rejects.toThrow(
      MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE,
    );
  });

  it('forwards cancellation options to prompt discovery', async () => {
    const controller = new AbortController();
    const client = {
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    } as unknown as Client;

    await discoverPrompts('server', client, {
      signal: controller.signal,
      isAuthorized: () => true,
    });

    expect(client.listPrompts).toHaveBeenCalledWith(
      {},
      { signal: controller.signal },
    );
  });

  it('fails closed and skips listPrompts when no authorization callback is provided', async () => {
    const listPrompts = vi.fn().mockResolvedValue({
      prompts: [{ name: 'prompt' }],
    });
    const client = {
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts,
    } as unknown as Client;

    const prompts = await discoverPrompts('server', client);

    expect(prompts).toStrictEqual([]);
    expect(listPrompts).not.toHaveBeenCalled();
  });

  it('fails closed and skips listPrompts when authorization returns false', async () => {
    const listPrompts = vi.fn().mockResolvedValue({
      prompts: [{ name: 'prompt' }],
    });
    const client = {
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts,
    } as unknown as Client;

    const prompts = await discoverPrompts('server', client, {
      isAuthorized: () => false,
    });

    expect(prompts).toStrictEqual([]);
    expect(listPrompts).not.toHaveBeenCalled();
  });

  it('discovers prompts when authorization is granted', async () => {
    const listPrompts = vi.fn().mockResolvedValue({
      prompts: [{ name: 'prompt' }],
    });
    const client = {
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts,
    } as unknown as Client;

    const prompts = await discoverPrompts('server', client, {
      isAuthorized: () => true,
    });

    expect(prompts).toStrictEqual([{ name: 'prompt' }]);
    expect(listPrompts).toHaveBeenCalledOnce();
  });

  it('returns no prompts when authorization is revoked after listPrompts (race)', async () => {
    let authorized = true;
    const listPrompts = vi.fn().mockImplementation(async () => {
      authorized = false;
      return {
        prompts: [{ name: 'prompt' }],
      };
    });
    const client = {
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts,
    } as unknown as Client;

    const prompts = await discoverPrompts('server', client, {
      isAuthorized: () => authorized,
    });

    expect(listPrompts).toHaveBeenCalledOnce();
    expect(prompts).toStrictEqual([]);
  });

  it('does not pass the isAuthorized callback into the SDK request options', async () => {
    const listPrompts = vi.fn().mockResolvedValue({ prompts: [] });
    const client = {
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts,
    } as unknown as Client;

    await discoverPrompts('server', client, {
      timeout: 1000,
      isAuthorized: () => true,
    });

    const optionsArg = listPrompts.mock.calls[0]?.[1];
    expect(optionsArg).toStrictEqual({ timeout: 1000 });
    expect(optionsArg).not.toHaveProperty('isAuthorized');
  });

  it('passes the server timeout to direct prompt discovery', async () => {
    connection.client = {
      close: vi.fn().mockResolvedValue(undefined),
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
    } as unknown as Client;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server', timeout: 321 },
      {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        removeMcpToolsByServer: vi.fn(),
      } as unknown as ToolRegistry,
      new PromptRegistry(),
      false,
      {} as WorkspaceContext,
      { isTrustedFolder: () => true } as Config,
    );

    expect(connection.client.listPrompts).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ timeout: 321 }),
    );
    const promptOptionsArg = connection.client.listPrompts.mock.calls[0]?.[1];
    expect(promptOptionsArg).not.toHaveProperty('isAuthorized');
  });

  it('fails closed and skips listTools when no authorization callback is provided', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    const listTools = vi.fn().mockResolvedValue({
      tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
    });
    const client = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools,
      callTool,
    } as unknown as Client;

    const tools = await discoverTools(
      'server',
      { command: 'server' },
      client,
      {} as Config,
    );

    expect(tools).toStrictEqual([]);
    expect(listTools).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it('fails closed and skips listTools when authorization returns false', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    const listTools = vi.fn().mockResolvedValue({
      tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
    });
    const client = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools,
      callTool,
    } as unknown as Client;

    const tools = await discoverTools(
      'server',
      { command: 'server' },
      client,
      {} as Config,
      undefined,
      { isAuthorized: () => false },
    );

    expect(tools).toStrictEqual([]);
    expect(listTools).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it('discovers tools when authorization is granted', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    const listTools = vi.fn().mockResolvedValue({
      tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
    });
    const client = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools,
      callTool,
    } as unknown as Client;

    const tools = await discoverTools(
      'server',
      { command: 'server', trust: true },
      client,
      { isTrustedFolder: () => true } as Config,
      undefined,
      { isAuthorized: () => true },
    );

    expect(tools).toHaveLength(1);
    expect(listTools).toHaveBeenCalledOnce();

    const result = await tools[0]
      .build({})
      .execute(new AbortController().signal);
    expect(callTool).toHaveBeenCalledOnce();
    expect(result).not.toMatchObject({
      error: expect.objectContaining({ isError: true }),
    });
  });

  it('does not pass the isAuthorized callback into the SDK listTools options', async () => {
    const listTools = vi.fn().mockResolvedValue({ tools: [] });
    const client = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools,
    } as unknown as Client;

    await discoverTools(
      'server',
      { command: 'server' },
      client,
      {} as Config,
      undefined,
      { timeout: 1000, isAuthorized: () => true },
    );

    const optionsArg = listTools.mock.calls[0]?.[1];
    expect(optionsArg).toStrictEqual({ timeout: 1000 });
    expect(optionsArg).not.toHaveProperty('isAuthorized');
  });

  it('returns no tools when authorization is revoked after listTools (race)', async () => {
    const callTool = vi.fn().mockResolvedValue({ content: [] });
    let authorized = true;
    const listTools = vi.fn().mockImplementation(async () => {
      authorized = false;
      return {
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      };
    });
    const client = {
      getServerCapabilities: () => ({ tools: {} }),
      listTools,
      callTool,
    } as unknown as Client;

    const tools = await discoverTools(
      'server',
      { command: 'server' },
      client,
      {} as Config,
      undefined,
      { isAuthorized: () => authorized },
    );

    expect(listTools).toHaveBeenCalledOnce();
    expect(tools).toStrictEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('does not request resources without explicit authorization', async () => {
    const request = vi.fn().mockResolvedValue({
      resources: [{ uri: 'file:///secret' }],
    });
    const client = {
      getServerCapabilities: () => ({ resources: {} }),
      request,
    } as unknown as Client;

    const resources = await discoverResources('server', client);

    expect(resources).toStrictEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not publish prompts without authorization', () => {
    const registry = new PromptRegistry();
    const client = {
      getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    } as unknown as Client;

    const published = registerMcpPrompts(
      'server',
      client,
      registry,
      [{ name: 'prompt' }],
      () => false,
    );

    expect(published).toBe(false);
    expect(registry.getPrompt('prompt')).toBeUndefined();
  });
  it('does not connect when folder trust is not authorized', async () => {
    connectToMcpServerMock.mockClear();

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server' },
      {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        removeMcpToolsByServer: vi.fn(),
      } as unknown as ToolRegistry,
      new PromptRegistry(),
      false,
      {} as WorkspaceContext,
      { isTrustedFolder: () => false } as Config,
    );

    expect(connectToMcpServerMock).not.toHaveBeenCalled();
  });

  it('rolls back and disconnects when trust is revoked during prompt discovery', async () => {
    let trusted = true;
    const promptRpcStarted = createDeferred<void>();
    const promptResponse = createDeferred<{ prompts: never[] }>();
    const closeFn = vi.fn().mockResolvedValue(undefined);
    connection.client = {
      close: closeFn,
      getServerCapabilities: () => ({ prompts: {}, tools: {} }),
      listPrompts: () => {
        promptRpcStarted.resolve(undefined);
        return promptResponse.promise;
      },
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
    } as unknown as Client;
    const publishedTools = new Set<string>();
    const toolRegistry = {
      registerTool: (tool: { name: string }) => publishedTools.add(tool.name),
      sortTools: vi.fn(),
      removeMcpToolsByServer: () => publishedTools.clear(),
    } as unknown as ToolRegistry;
    const promptRegistry = new PromptRegistry();
    const config = { isTrustedFolder: () => trusted } as Config;

    const discovery = connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server' },
      toolRegistry,
      promptRegistry,
      false,
      {} as WorkspaceContext,
      config,
    );
    await promptRpcStarted.promise;
    trusted = false;
    promptResponse.resolve({ prompts: [] });
    await discovery;

    expect(publishedTools.size).toBe(0);
    expect(promptRegistry.getAllPrompts()).toStrictEqual([]);
    expect(closeFn).toHaveBeenCalledOnce();
    expect(updateMCPServerStatus).toHaveBeenLastCalledWith(
      'server',
      MCPServerStatus.DISCONNECTED,
    );
  });

  it('stops prompt publication when a registry event revokes trust', async () => {
    let trusted = true;
    const publicationEvents: string[] = [];
    const closeFn = vi.fn().mockResolvedValue(undefined);
    connection.client = {
      close: closeFn,
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [{ name: 'first' }, { name: 'second' }],
      }),
    } as unknown as Client;
    const publishedPrompts = new Set<string>();
    const promptRegistry = {
      registerPrompt: (prompt: { name: string }) => {
        publicationEvents.push(prompt.name);
        publishedPrompts.add(prompt.name);
        trusted = false;
      },
      removePromptsByServer: () => publishedPrompts.clear(),
    } as unknown as PromptRegistry;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server' },
      {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        removeMcpToolsByServer: vi.fn(),
      } as unknown as ToolRegistry,
      promptRegistry,
      false,
      {} as WorkspaceContext,
      { isTrustedFolder: () => trusted } as Config,
    );

    expect(publicationEvents).toStrictEqual(['first']);
    expect(publishedPrompts.size).toBe(0);
    expect(closeFn).toHaveBeenCalledOnce();
  });

  it('rolls back and disconnects when sorting tools revokes trust', async () => {
    let trusted = true;
    const publishedTools = new Set<string>();
    const closeFn = vi.fn().mockResolvedValue(undefined);
    connection.client = {
      close: closeFn,
      getServerCapabilities: () => ({ tools: {} }),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
    } as unknown as Client;
    const toolRegistry = {
      registerTool: (tool: { name: string }) => publishedTools.add(tool.name),
      sortTools: () => {
        trusted = false;
      },
      removeMcpToolsByServer: () => publishedTools.clear(),
      getMessageBus: vi.fn(),
    } as unknown as ToolRegistry;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server' },
      toolRegistry,
      new PromptRegistry(),
      false,
      {} as WorkspaceContext,
      { isTrustedFolder: () => trusted } as Config,
    );

    expect(publishedTools.size).toBe(0);
    expect(closeFn).toHaveBeenCalledOnce();
    expect(updateMCPServerStatus).toHaveBeenLastCalledWith(
      'server',
      MCPServerStatus.DISCONNECTED,
    );
  });

  it('server error handler closes client and disconnects even when registry cleanup throws', async () => {
    const closeFn = vi.fn().mockResolvedValue(undefined);
    const removeTools = vi.fn().mockImplementation(() => {
      throw new Error('persistent tool registry failure');
    });
    const removePrompts = vi.fn().mockImplementation(() => {
      throw new Error('persistent prompt registry failure');
    });
    connection.client = {
      close: closeFn,
      getServerCapabilities: () => ({ prompts: {}, tools: {} }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [{ name: 'prompt' }],
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
    } as unknown as Client;

    const toolRegistry = {
      registerTool: vi.fn(),
      sortTools: vi.fn(),
      removeMcpToolsByServer: removeTools,
    } as unknown as ToolRegistry;
    const promptRegistry = {
      removePromptsByServer: removePrompts,
    } as unknown as PromptRegistry;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server' },
      toolRegistry,
      promptRegistry,
      false,
      {} as WorkspaceContext,
      { isTrustedFolder: () => true } as Config,
    );

    const errorHandler = (
      connection.client as unknown as {
        onerror: (error: Error) => void;
      }
    ).onerror;
    expect(errorHandler).toBeTypeOf('function');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => errorHandler(new Error('connection lost'))).not.toThrow();

    expect(closeFn).toHaveBeenCalled();
    expect(removeTools).toHaveBeenCalledWith('server');
    expect(removePrompts).toHaveBeenCalledWith('server');
    const { updateMCPServerStatus } = await import('./mcp-status.js');
    expect(updateMCPServerStatus).toHaveBeenCalledWith(
      'server',
      'disconnected',
    );
  });
});
