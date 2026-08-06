/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { McpClient, MCPServerStatus } from './mcp-client.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('../auth/oauth-provider.js');
vi.mock('../auth/oauth-token-storage.js');
vi.mock('../auth/oauth-utils.js');
vi.mock('google-auth-library', () => ({ GoogleAuth: vi.fn() }));

interface PublicationHarness {
  readonly client: McpClient;
  readonly config: Config;
  readonly sdkClient: Client;
  readonly publishedPrompts: ReadonlySet<string>;
  readonly publishedTools: ReadonlySet<string>;
  readonly publishedResources: ReadonlySet<string>;
  getMayPublish(): boolean;
  setMayPublish(value: boolean): void;
  throwAuthorization(error: Error): void;
}

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

function createHarness(options: {
  capabilities: Record<string, object>;
  listPrompts?: () => Promise<{ prompts: Array<{ name: string }> }>;
  listTools?: () => Promise<{
    tools: Array<{
      name: string;
      inputSchema: { type: 'object' };
    }>;
  }>;
  requestResources?: () => Promise<{
    resources: Array<{ uri: string }>;
  }>;
  afterPromptRegistered?: () => void;
  afterToolRegistered?: () => void;
  afterToolsSorted?: () => void;
}): PublicationHarness {
  let mayPublish = true;
  let authorizationError: Error | undefined;
  const publishedPrompts = new Set<string>();
  const publishedTools = new Set<string>();
  const publishedResources = new Set<string>();
  const sdkClient = {
    connect: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    registerCapabilities: vi.fn(),
    setRequestHandler: vi.fn(),
    setNotificationHandler: vi.fn(),
    getServerCapabilities: () => options.capabilities,
    listPrompts:
      options.listPrompts ?? vi.fn().mockResolvedValue({ prompts: [] }),
    listTools: options.listTools ?? vi.fn().mockResolvedValue({ tools: [] }),
    request:
      options.requestResources ?? vi.fn().mockResolvedValue({ resources: [] }),
  } as unknown as Client;
  vi.mocked(ClientLib.Client).mockReturnValue(sdkClient);
  vi.mocked(SdkClientStdioLib.StdioClientTransport).mockReturnValue(
    {} as SdkClientStdioLib.StdioClientTransport,
  );
  const promptRegistry = {
    registerPrompt: (prompt: { name: string }) => {
      publishedPrompts.add(prompt.name);
      options.afterPromptRegistered?.();
    },
    removePromptsByServer: () => publishedPrompts.clear(),
  } as unknown as PromptRegistry;
  const toolRegistry = {
    registerTool: (tool: { name: string }) => {
      publishedTools.add(tool.name);
      options.afterToolRegistered?.();
    },
    sortTools: () => options.afterToolsSorted?.(),
    removeMcpToolsByServer: () => publishedTools.clear(),
    getMessageBus: vi.fn(),
  } as unknown as ToolRegistry;
  const resourceRegistry = {
    setResourcesForServer: (
      _serverName: string,
      resources: Array<{ uri: string }>,
    ) => {
      for (const resource of resources) {
        publishedResources.add(resource.uri);
      }
    },
    removeResourcesByServer: () => publishedResources.clear(),
  } as unknown as ResourceRegistry;
  const config = {
    isTrustedFolder: () => {
      if (authorizationError !== undefined) {
        throw authorizationError;
      }
      return true;
    },
  } as Config;
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

  return {
    client,
    config,
    sdkClient,
    publishedPrompts,
    publishedTools,
    publishedResources,
    getMayPublish: () => mayPublish,
    setMayPublish: (value) => {
      mayPublish = value;
    },
    throwAuthorization: (error) => {
      authorizationError = error;
    },
  };
}

function mayPublish(harness: PublicationHarness): () => boolean {
  return () => harness.getMayPublish();
}

describe('McpClient capability publication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disconnects without starting the next RPC when publication is revoked during prompt discovery', async () => {
    const promptRpcStarted = createDeferred<void>();
    const promptResponse = createDeferred<{
      prompts: Array<{ name: string }>;
    }>();
    let toolRpcStarted = false;
    const harness = createHarness({
      capabilities: { prompts: {}, tools: {} },
      listPrompts: () => {
        promptRpcStarted.resolve();
        return promptResponse.promise;
      },
      listTools: async () => {
        toolRpcStarted = true;
        return { tools: [] };
      },
    });
    await harness.client.connect();

    const discovery = harness.client.discover(
      harness.config,
      mayPublish(harness),
    );
    await promptRpcStarted.promise;
    harness.setMayPublish(false);
    promptResponse.resolve({ prompts: [{ name: 'prompt' }] });
    await discovery;

    expect(toolRpcStarted).toBe(false);
    expect(harness.publishedPrompts.size).toBe(0);
    expect(harness.client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('disconnects without starting the resource RPC when publication is revoked during tool discovery', async () => {
    const toolRpcStarted = createDeferred<void>();
    const toolResponse = createDeferred<{
      tools: Array<{
        name: string;
        inputSchema: { type: 'object' };
      }>;
    }>();
    let resourceRpcStarted = false;
    const harness = createHarness({
      capabilities: { prompts: {}, tools: {}, resources: {} },
      listPrompts: async () => ({ prompts: [{ name: 'prompt' }] }),
      listTools: () => {
        toolRpcStarted.resolve(undefined);
        return toolResponse.promise;
      },
      requestResources: async () => {
        resourceRpcStarted = true;
        return { resources: [] };
      },
    });
    await harness.client.connect();

    const discovery = harness.client.discover(
      harness.config,
      mayPublish(harness),
    );
    await toolRpcStarted.promise;
    harness.setMayPublish(false);
    toolResponse.resolve({
      tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
    });
    await discovery;

    expect(resourceRpcStarted).toBe(false);
    expect(harness.publishedPrompts.size).toBe(0);
    expect(harness.publishedTools.size).toBe(0);
    expect(harness.client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('rolls back and disconnects when prompt registration revokes publication', async () => {
    const harness = createHarness({
      capabilities: { prompts: {} },
      listPrompts: async () => ({
        prompts: [{ name: 'first' }, { name: 'second' }],
      }),
      afterPromptRegistered: () => harness.setMayPublish(false),
    });
    await harness.client.connect();

    await harness.client.discover(harness.config, mayPublish(harness));

    expect(harness.publishedPrompts.size).toBe(0);
    expect(harness.client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('rolls back and disconnects when tool registration revokes publication', async () => {
    const harness = createHarness({
      capabilities: { tools: {} },
      listTools: async () => ({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
      afterToolRegistered: () => harness.setMayPublish(false),
    });
    await harness.client.connect();

    await harness.client.discover(harness.config, mayPublish(harness));

    expect(harness.publishedTools.size).toBe(0);
    expect(harness.client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('rolls back and disconnects when sorting tools revokes publication', async () => {
    const harness = createHarness({
      capabilities: { tools: {} },
      listTools: async () => ({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
      afterToolsSorted: () => harness.setMayPublish(false),
    });
    await harness.client.connect();

    await harness.client.discover(harness.config, mayPublish(harness));

    expect(harness.publishedTools.size).toBe(0);
    expect(harness.client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('rolls back and disconnects when an authorization callback throws after publication', async () => {
    const authorizationFailure = new Error('authorization unavailable');
    const harness = createHarness({
      capabilities: { prompts: {} },
      listPrompts: async () => ({ prompts: [{ name: 'prompt' }] }),
      afterPromptRegistered: () =>
        harness.throwAuthorization(authorizationFailure),
    });
    await harness.client.connect();

    await expect(
      harness.client.discover(harness.config, mayPublish(harness)),
    ).rejects.toBe(authorizationFailure);
    expect(harness.publishedPrompts.size).toBe(0);
    expect(harness.client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('publishes capabilities while authorization remains valid', async () => {
    const harness = createHarness({
      capabilities: { prompts: {}, tools: {}, resources: {} },
      listPrompts: async () => ({ prompts: [{ name: 'prompt' }] }),
      listTools: async () => ({
        tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
      }),
      requestResources: async () => ({
        resources: [{ uri: 'file:///resource' }],
      }),
    });
    await harness.client.connect();

    await harness.client.discover(harness.config, mayPublish(harness));

    expect([...harness.publishedPrompts]).toStrictEqual(['prompt']);
    expect([...harness.publishedTools]).toStrictEqual([
      'mcp__test-server__tool',
    ]);
    expect([...harness.publishedResources]).toStrictEqual(['file:///resource']);
    expect(harness.client.getStatus()).toBe(MCPServerStatus.CONNECTED);
  });
});
