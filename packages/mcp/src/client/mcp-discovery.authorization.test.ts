/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import {
  discoverPrompts,
  discoverResources,
  discoverTools,
  invokeMcpPrompt,
  registerMcpPrompts,
} from './mcp-discovery.js';
import { McpCallableTool } from './mcp-callable-tool.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from './mcp-errors.js';

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

describe('MCP capability authorization', () => {
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

  it('fails closed when prompt invocation is unauthorized', async () => {
    const client = {
      getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    } as unknown as Client;

    await expect(
      invokeMcpPrompt('server', client, 'prompt', {}, () => false),
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

  it('reports omitted prompt authorization as a security error', async () => {
    const listPrompts = vi.fn().mockResolvedValue({
      prompts: [{ name: 'prompt' }],
    });
    const client = {
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts,
    } as unknown as Client;

    await expect(
      Reflect.apply(discoverPrompts, undefined, ['server', client]),
    ).rejects.toThrow(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
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

    await expect(
      Reflect.apply(discoverTools, undefined, [
        'server',
        { command: 'server' },
        client,
        {} as Config,
      ]),
    ).rejects.toThrow(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
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

    await expect(
      Reflect.apply(discoverResources, undefined, ['server', client]),
    ).rejects.toThrow(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
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
});
