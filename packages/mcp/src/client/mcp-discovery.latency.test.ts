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
import { connectAndDiscover } from './mcp-discovery.js';

const connection = vi.hoisted(() => ({
  client: undefined as Client | undefined,
}));

const connectToMcpServerMock = vi.hoisted(() => vi.fn());

vi.mock('./mcp-connection.js', () => ({
  connectToMcpServer: connectToMcpServerMock,
}));

const statusUpdates = vi.hoisted<string[]>(() => []);

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
  updateMCPServerStatus: vi.fn((name: string, status: string) => {
    statusUpdates.push(`${name}:${status}`);
  }),
}));

describe('connectAndDiscover revocation-during-latency', () => {
  beforeEach(() => {
    connectToMcpServerMock.mockImplementation(() =>
      Promise.resolve(connection.client),
    );
    statusUpdates.length = 0;
  });

  function makeClient(
    tools: Array<{ name: string; inputSchema: unknown }>,
    prompts: Array<{ name: string }>,
  ): Client {
    return {
      close: vi.fn().mockResolvedValue(undefined),
      getServerCapabilities: () => ({ tools: {}, prompts: {} }),
      listTools: vi.fn().mockResolvedValue({ tools }),
      listPrompts: vi.fn().mockResolvedValue({ prompts }),
      callTool: vi.fn().mockResolvedValue({ content: [] }),
    } as unknown as Client;
  }

  function makeToolRegistry(): {
    registry: ToolRegistry;
    registeredTools: string[];
  } {
    const registeredTools: string[] = [];
    const registry = {
      registerTool: vi.fn((tool: { name: string }) => {
        registeredTools.push(tool.name);
      }),
      sortTools: vi.fn(),
      removeMcpToolsByServer: vi.fn(),
    } as unknown as ToolRegistry;
    return { registry, registeredTools };
  }

  it('does not set CONNECTED or register tools when trust is revoked after discovery but before publication', async () => {
    const client = makeClient(
      [{ name: 'tool1', inputSchema: { type: 'object' } }],
      [{ name: 'prompt1' }],
    );
    connection.client = client;

    const { registry, registeredTools } = makeToolRegistry();
    const promptRegistry = new PromptRegistry();
    const registerPromptSpy = vi.spyOn(promptRegistry, 'registerPrompt');

    let trustCalls = 0;
    const config = {
      isTrustedFolder: () => {
        trustCalls++;
        return trustCalls <= 9;
      },
    } as Config;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server', trust: true },
      registry,
      promptRegistry,
      false,
      {} as WorkspaceContext,
      config,
    );

    expect(statusUpdates).not.toContain('server:connected');
    expect(registeredTools).toHaveLength(0);
    expect(registerPromptSpy).not.toHaveBeenCalled();
  });

  it('sets CONNECTED and registers tools when trust holds throughout', async () => {
    const client = makeClient(
      [{ name: 'tool1', inputSchema: { type: 'object' } }],
      [{ name: 'prompt1' }],
    );
    connection.client = client;

    const { registry, registeredTools } = makeToolRegistry();
    const promptRegistry = new PromptRegistry();

    const config = {
      isTrustedFolder: () => true,
    } as Config;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server', trust: true },
      registry,
      promptRegistry,
      false,
      {} as WorkspaceContext,
      config,
    );

    expect(statusUpdates).toContain('server:connected');
    expect(registeredTools).toHaveLength(1);
  });

  it('stops registering tools mid-loop when trust is revoked between tool registrations', async () => {
    const client = makeClient(
      [
        { name: 'tool1', inputSchema: { type: 'object' } },
        { name: 'tool2', inputSchema: { type: 'object' } },
        { name: 'tool3', inputSchema: { type: 'object' } },
      ],
      [],
    );
    connection.client = client;

    const { registry, registeredTools } = makeToolRegistry();
    const promptRegistry = new PromptRegistry();

    let trustCalls = 0;
    const config = {
      isTrustedFolder: () => {
        trustCalls++;
        return trustCalls <= 12;
      },
    } as Config;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server', trust: true },
      registry,
      promptRegistry,
      false,
      {} as WorkspaceContext,
      config,
    );

    expect(registeredTools.length).toBeLessThan(3);
    expect(registry.removeMcpToolsByServer).toHaveBeenCalledWith('server');
  });

  it('does not set CONNECTED when trust is revoked after the connect handshake', async () => {
    const client = makeClient(
      [{ name: 'tool1', inputSchema: { type: 'object' } }],
      [{ name: 'prompt1' }],
    );
    connection.client = client;

    const { registry, registeredTools } = makeToolRegistry();
    const promptRegistry = new PromptRegistry();

    let trustCalls = 0;
    const config = {
      isTrustedFolder: () => {
        trustCalls++;
        return trustCalls <= 1;
      },
    } as Config;

    await connectAndDiscover(
      '0.0.1',
      'server',
      { command: 'server', trust: true },
      registry,
      promptRegistry,
      false,
      {} as WorkspaceContext,
      config,
    );

    expect(statusUpdates).not.toContain('server:connected');
    expect(registeredTools).toHaveLength(0);
    expect(client.close).toHaveBeenCalled();
  });
});
