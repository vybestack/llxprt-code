/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  connectAndDiscover,
  discoverPrompts,
  invokeMcpPrompt,
  registerMcpPrompts,
} from './mcp-discovery.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from './mcp-errors.js';

const connection = vi.hoisted(() => ({
  client: undefined as Client | undefined,
}));

vi.mock('./mcp-connection.js', () => ({
  connectToMcpServer: vi.fn(() => Promise.resolve(connection.client)),
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

  it('fails closed when prompt invocation has no authorization callback', async () => {
    const client = {
      getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    } as unknown as Client;

    await expect(
      invokeMcpPrompt('server', client, 'prompt', {}, undefined),
    ).rejects.toThrow(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
    expect(client.getPrompt).not.toHaveBeenCalled();
  });

  it('forwards cancellation options to prompt discovery', async () => {
    const controller = new AbortController();
    const client = {
      getServerCapabilities: () => ({ prompts: {} }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    } as unknown as Client;

    await discoverPrompts('server', client, { signal: controller.signal });

    expect(client.listPrompts).toHaveBeenCalledWith(
      {},
      { signal: controller.signal },
    );
  });

  it('registers prompts through a shared fail-closed authorization boundary', async () => {
    const registry = new PromptRegistry();
    const client = {
      getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    } as unknown as Client;
    registerMcpPrompts(
      'server',
      client,
      registry,
      [{ name: 'prompt' }],
      () => false,
    );

    const prompt = registry.getPrompt('prompt');
    expect(prompt).toBeDefined();
    await expect(prompt?.invoke({})).rejects.toThrow(
      MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE,
    );
    expect(client.getPrompt).not.toHaveBeenCalled();
  });
});
