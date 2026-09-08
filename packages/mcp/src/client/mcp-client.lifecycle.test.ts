/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '../../../test-utils/src/automock.js';
import { waitFor } from '../../../test-utils/src/wait-for.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it, vi, beforeEach, afterEach } from 'bun:test';
import type { Mock } from 'bun:test';
import type { Config } from './test-support/mcpClientTestSupport.js';
import type { PromptRegistry } from './test-support/mcpClientTestSupport.js';
import type { ResourceRegistry } from './test-support/mcpClientTestSupport.js';
import { WorkspaceContext } from './test-support/mcpClientTestSupport.js';
import { registerMcpHostServices } from '../host/hostServices.js';
import {
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpClient } from './mcp-client.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from './mcp-errors.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

// Exercises the real host seam instead of mocking a module (#3305).
const mockEmitFeedback = vi.fn();
registerMcpHostServices({ emitFeedback: mockEmitFeedback });

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

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

interface McpRequestInput {
  readonly method: string;
}

function resourceOnlyRequest(input: McpRequestInput): Promise<unknown> {
  if (input.method === 'resources/list') {
    return Promise.resolve({
      resources: [
        {
          uri: 'file:///tmp/resource.txt',
          name: 'resource',
          description: 'Test Resource',
          mimeType: 'text/plain',
        },
      ],
    });
  }
  return Promise.resolve({ prompts: [] });
}

function createChangingResourceRequest(): (
  input: McpRequestInput,
) => Promise<unknown> {
  let listCallCount = 0;
  return (input) => {
    if (input.method === 'resources/list') {
      listCallCount += 1;
      return Promise.resolve({
        resources: [
          {
            uri:
              listCallCount === 1
                ? 'file:///tmp/one.txt'
                : 'file:///tmp/two.txt',
          },
        ],
      });
    }
    return Promise.resolve({ prompts: [] });
  };
}

function createResourceReadRequest(
  readResult: unknown,
): (input: McpRequestInput) => Promise<unknown> {
  return (input) => {
    if (input.method === 'resources/read') {
      return Promise.resolve(readResult);
    }
    if (input.method === 'resources/list') {
      return Promise.resolve({ resources: [] });
    }
    return Promise.resolve({ prompts: [] });
  };
}

function createDeferredResourceListRequest(
  resources: Promise<unknown>,
): (input: McpRequestInput) => Promise<unknown> {
  return (input) =>
    input.method === 'resources/list' ? resources : Promise.resolve({});
}

function staleCapabilitiesRequest(input: McpRequestInput): Promise<unknown> {
  if (input.method === 'resources/list') {
    return Promise.resolve({ resources: [{ uri: 'file:///resource' }] });
  }
  if (input.method === 'resources/read') {
    return Promise.resolve({ contents: [] });
  }
  return Promise.resolve({});
}

function discoveredArtifactsRequest(input: McpRequestInput): Promise<unknown> {
  if (input.method === 'resources/list') {
    return Promise.resolve({
      resources: [{ uri: 'file:///tmp/resource.txt', name: 'resource' }],
    });
  }
  return Promise.resolve({});
}

function emptyResourceListRequest(input: McpRequestInput): Promise<unknown> {
  return input.method === 'resources/list'
    ? Promise.resolve({ resources: [] })
    : Promise.resolve({});
}

function captureResourceListHandler(
  schema: unknown,
  handler: (notification: unknown) => Promise<void> | void,
  capture: (handler: (notification: unknown) => Promise<void> | void) => void,
): void {
  if (schema === ResourceListChangedNotificationSchema) {
    capture(handler);
  }
}

function captureRefreshHandler(
  schema: unknown,
  handler: (notification: unknown) => Promise<void> | void,
  captureTool: (
    handler: (notification: unknown) => Promise<void> | void,
  ) => void,
  captureResource: (
    handler: (notification: unknown) => Promise<void> | void,
  ) => void,
): void {
  if (schema === ToolListChangedNotificationSchema) {
    captureTool(handler);
  }
  if (schema === ResourceListChangedNotificationSchema) {
    captureResource(handler);
  }
}

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

const createMockResourceRegistry = (): ResourceRegistry =>
  ({
    setResourcesForServer: vi.fn(),
    removeResourcesByServer: vi.fn(),
  }) as unknown as ResourceRegistry;

const createConfig = (isTrustedFolder: () => boolean): Config =>
  ({ isTrustedFolder }) as Config;

const createTrustedConfig = (): Config => createConfig(() => true);

describe('mcp-client', () => {
  let workspaceContext: WorkspaceContext;
  let testWorkspace: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-agent-test-'),
    );
    workspaceContext = new WorkspaceContext(testWorkspace);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Wires a fake SDK client and an empty stdio transport onto the mocks. */
  const stubSdkClient = (sdkClient: unknown): void => {
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient);
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
  };

  /** Builds an McpClient with the suite's fixed server, command, and version. */
  const buildClient = (
    toolRegistry: ToolRegistry,
    promptRegistry: PromptRegistry,
    resourceRegistry: ResourceRegistry,
    config: Config,
  ): McpClient =>
    new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      resourceRegistry,
      workspaceContext,
      config,
      false,
      '0.0.1',
    );

  describe('McpClient', () => {
    it('promptly cancels a never-settling CONNECTING handshake', async () => {
      const transport = { close: vi.fn().mockResolvedValue(undefined) };
      const sdkClient = {
        connect: vi.fn(() => new Promise<void>(() => {})),
        close: vi.fn().mockResolvedValue(undefined),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
      };
      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
      (
        SdkClientStdioLib.StdioClientTransport as unknown as Mock<
          (...args: never[]) => unknown
        >
      ).mockReturnValue(
        transport as unknown as SdkClientStdioLib.StdioClientTransport,
      );
      const client = buildClient(
        {
          removeMcpToolsByServer: vi.fn(),
        } as unknown as ToolRegistry,
        { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
        createMockResourceRegistry(),
        createTrustedConfig(),
      );

      const connectPromise = client.connect();
      await waitFor(() => expect(sdkClient.connect).toHaveBeenCalledOnce());

      await client.disconnect();
      await connectPromise;

      expect(transport.close).toHaveBeenCalled();
      expect(client.getStatus()).toBe('disconnected');
    });

    it('should discover resources when a server only exposes resources', async () => {
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ resources: {} }),
        request: vi.fn().mockImplementation(resourceOnlyRequest),
      };
      stubSdkClient(mockedClient);
      const mockedToolRegistry = {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const mockedResourceRegistry = {
        setResourcesForServer: vi.fn(),
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry;
      const client = buildClient(
        mockedToolRegistry,
        {} as PromptRegistry,
        mockedResourceRegistry,
        createTrustedConfig(),
      );
      await client.connect();
      await client.discover(createTrustedConfig());
      expect(mockedClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'resources/list' }),
        expect.anything(),
        expect.objectContaining({
          timeout: expect.any(Number),
          signal: expect.any(AbortSignal),
        }),
      );
      expect(mockedResourceRegistry.setResourcesForServer).toHaveBeenCalledWith(
        'test-server',
        [
          expect.objectContaining({
            uri: 'file:///tmp/resource.txt',
            name: 'resource',
          }),
        ],
      );
    });

    it('refreshes registry when resource list change notification is received', async () => {
      let resourceListHandler:
        | ((notification: unknown) => Promise<void> | void)
        | undefined;
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn((schema, handler) =>
          captureResourceListHandler(schema, handler, (captured) => {
            resourceListHandler = captured;
          }),
        ),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ resources: { listChanged: true } }),
        request: vi.fn().mockImplementation(createChangingResourceRequest()),
      };
      stubSdkClient(mockedClient);
      const mockedToolRegistry = {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const mockedResourceRegistry = {
        setResourcesForServer: vi.fn(),
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry;
      const client = buildClient(
        mockedToolRegistry,
        {} as PromptRegistry,
        mockedResourceRegistry,
        createTrustedConfig(),
      );
      await client.connect();
      await client.discover(createTrustedConfig());

      expect(resourceListHandler).toBeDefined();

      await resourceListHandler?.({
        method: 'notifications/resources/list_changed',
      });

      expect(
        mockedResourceRegistry.setResourcesForServer,
      ).toHaveBeenLastCalledWith('test-server', [
        expect.objectContaining({ uri: 'file:///tmp/two.txt' }),
      ]);

      expect(mockEmitFeedback).toHaveBeenCalledWith(
        'info',
        'Resources updated for server: test-server',
      );
    });

    it('should read a resource from the server when connected', async () => {
      const readResult = {
        contents: [
          {
            uri: 'file:///tmp/readme.txt',
            mimeType: 'text/plain',
            text: 'hello from resource',
          },
        ],
      };
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ resources: {} }),
        request: vi
          .fn()
          .mockImplementation(createResourceReadRequest(readResult)),
      };
      stubSdkClient(mockedClient);
      const mockedToolRegistry = {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const client = buildClient(
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        createTrustedConfig(),
      );

      await client.connect();
      const result = await client.readResource('file:///tmp/readme.txt');

      expect(result).toStrictEqual(readResult);
      expect(mockedClient.request).toHaveBeenCalledWith(
        {
          method: 'resources/read',
          params: { uri: 'file:///tmp/readme.txt' },
        },
        ReadResourceResultSchema,
      );
    });

    it('discards a delayed resource result when authorization is revoked during the RPC', async () => {
      let trusted = true;
      const readStarted = createDeferred<void>();
      const readResult = createDeferred<{ contents: never[] }>();
      const mockedClient = {
        connect: vi.fn(),
        request: vi.fn().mockImplementation(() => {
          readStarted.resolve(undefined);
          return readResult.promise;
        }),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({}),
      };
      stubSdkClient(mockedClient);
      const client = buildClient(
        {} as ToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        createConfig(() => trusted),
      );
      await client.connect();

      const read = client.readResource('file:///tmp/readme.txt');
      await readStarted.promise;
      trusted = false;
      readResult.resolve({ contents: [] });

      await expect(read).rejects.toThrow(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
    });

    it('should throw if readResource is called while disconnected', async () => {
      const mockedClient = {
        connect: vi.fn(),
        request: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
      };
      stubSdkClient(mockedClient);
      const client = buildClient(
        {} as ToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        createTrustedConfig(),
      );

      await expect(
        client.readResource('file:///tmp/readme.txt'),
      ).rejects.toThrow('Client is not connected');
    });

    it('rejects delayed tool and resource refreshes across rapid revoke→gain', async () => {
      let trusted = true;
      const tools = createDeferred<{
        tools: Array<{ name: string; inputSchema: object }>;
      }>();
      const resources = createDeferred<{
        resources: Array<{ uri: string }>;
      }>();
      let toolListHandler:
        | ((notification: unknown) => Promise<void> | void)
        | undefined;
      let resourceListHandler:
        | ((notification: unknown) => Promise<void> | void)
        | undefined;
      const mockedClient = {
        connect: vi.fn(),
        close: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn((schema, handler) =>
          captureRefreshHandler(
            schema,
            handler,
            (captured) => {
              toolListHandler = captured;
            },
            (captured) => {
              resourceListHandler = captured;
            },
          ),
        ),
        getServerCapabilities: vi.fn().mockReturnValue({
          tools: { listChanged: true },
          resources: { listChanged: true },
        }),
        listTools: vi.fn().mockReturnValue(tools.promise),
        request: vi
          .fn()
          .mockImplementation(
            createDeferredResourceListRequest(resources.promise),
          ),
      };
      stubSdkClient(mockedClient);
      const toolRegistry = {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        removeMcpToolsByServer: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const resourceRegistry = createMockResourceRegistry();
      const client = buildClient(
        toolRegistry,
        {} as PromptRegistry,
        resourceRegistry,
        createConfig(() => trusted),
      );
      await client.connect();

      const refreshTools = toolListHandler?.({
        method: 'notifications/tools/list_changed',
      });
      const refreshResources = resourceListHandler?.({
        method: 'notifications/resources/list_changed',
      });
      await waitFor(() => {
        expect(mockedClient.listTools).toHaveBeenCalledOnce();
        expect(mockedClient.request).toHaveBeenCalledWith(
          expect.objectContaining({ method: 'resources/list' }),
          expect.anything(),
          expect.anything(),
        );
      });

      trusted = false;
      client.invalidateCapabilities();
      trusted = true;
      tools.resolve({
        tools: [{ name: 'stale-tool', inputSchema: { type: 'object' } }],
      });
      resources.resolve({ resources: [{ uri: 'file:///stale' }] });
      await Promise.all([refreshTools, refreshResources]);

      expect(toolRegistry.removeMcpToolsByServer).not.toHaveBeenCalled();
      expect(toolRegistry.registerTool).not.toHaveBeenCalled();
      expect(resourceRegistry.setResourcesForServer).not.toHaveBeenCalled();
      expect(mockEmitFeedback).not.toHaveBeenCalled();
    });

    it('keeps discovered capabilities stale after synchronous invalidation even if trust returns', async () => {
      let trusted = true;
      const registeredTools: Array<{
        build(params: Record<string, unknown>): {
          execute(signal: AbortSignal): Promise<unknown>;
        };
      }> = [];
      const registeredPrompts: Array<{
        invoke(params: Record<string, unknown>): Promise<unknown>;
      }> = [];
      const mockedClient = {
        connect: vi.fn(),
        close: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({
          tools: {},
          prompts: {},
          resources: {},
        }),
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
        }),
        listPrompts: vi.fn().mockResolvedValue({
          prompts: [{ name: 'prompt' }],
        }),
        getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
        callTool: vi.fn().mockResolvedValue({ content: [] }),
        request: vi.fn().mockImplementation(staleCapabilitiesRequest),
      };
      stubSdkClient(mockedClient);
      const client = buildClient(
        {
          registerTool: (tool: (typeof registeredTools)[number]) => {
            registeredTools.push(tool);
          },
          sortTools: vi.fn(),
          getMessageBus: vi.fn().mockReturnValue(undefined),
          removeMcpToolsByServer: vi.fn(),
        } as unknown as ToolRegistry,
        {
          registerPrompt: (prompt: (typeof registeredPrompts)[number]) => {
            registeredPrompts.push(prompt);
          },
          removePromptsByServer: vi.fn(),
        } as unknown as PromptRegistry,
        createMockResourceRegistry(),
        createConfig(() => trusted),
      );
      await client.connect();
      await client.discover(createConfig(() => trusted));
      expect(registeredTools).toHaveLength(1);
      expect(registeredPrompts).toHaveLength(1);
      const [staleTool] = registeredTools;
      const [stalePrompt] = registeredPrompts;

      trusted = false;
      client.invalidateCapabilities();
      trusted = true;

      const toolResult = await staleTool
        .build({})
        .execute(new AbortController().signal);
      await expect(stalePrompt.invoke({})).rejects.toThrow(
        MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE,
      );
      await expect(client.readResource('file:///resource')).rejects.toThrow(
        MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE,
      );
      expect(toolResult).toMatchObject({
        error: {
          message: expect.stringContaining(
            MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE,
          ),
        },
      });
      expect(mockedClient.callTool).not.toHaveBeenCalled();
      expect(mockedClient.getPrompt).not.toHaveBeenCalled();
      expect(mockedClient.request).not.toHaveBeenCalledWith(
        expect.objectContaining({ method: 'resources/read' }),
        expect.anything(),
      );
    });

    it('should remove tools, prompts, and resources on disconnect', async () => {
      const mockedClient = {
        connect: vi.fn(),
        close: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: {}, prompts: {}, resources: {} }),
        listPrompts: vi.fn().mockResolvedValue({
          prompts: [{ id: 'prompt1', text: 'a prompt' }],
        }),
        request: vi.fn().mockImplementation(discoveredArtifactsRequest),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'testTool',
              description: 'A test tool',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      };
      stubSdkClient(mockedClient);
      const mockedToolRegistry = {
        registerTool: vi.fn(),
        unregisterTool: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
        removeMcpToolsByServer: vi.fn(),
        sortTools: vi.fn(),
      } as unknown as ToolRegistry;
      const mockedPromptRegistry = {
        registerPrompt: vi.fn(),
        unregisterPrompt: vi.fn(),
        removePromptsByServer: vi.fn(),
      } as unknown as PromptRegistry;
      const mockedResourceRegistry = {
        setResourcesForServer: vi.fn(),
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry;
      const client = buildClient(
        mockedToolRegistry,
        mockedPromptRegistry,
        mockedResourceRegistry,
        createTrustedConfig(),
      );
      await client.connect();
      await client.discover(createTrustedConfig());

      expect(mockedToolRegistry.registerTool).toHaveBeenCalledOnce();
      expect(mockedPromptRegistry.registerPrompt).toHaveBeenCalledOnce();
      expect(mockedResourceRegistry.setResourcesForServer).toHaveBeenCalled();

      await client.disconnect();

      expect(mockedClient.close).toHaveBeenCalledOnce();
      expect(mockedToolRegistry.removeMcpToolsByServer).toHaveBeenCalledOnce();
      expect(mockedPromptRegistry.removePromptsByServer).toHaveBeenCalledOnce();
      expect(
        mockedResourceRegistry.removeResourcesByServer,
      ).toHaveBeenCalledOnce();
    });

    it('should close client on onerror to release resources', async () => {
      const mockedClient = {
        connect: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: {}, prompts: {}, resources: {} }),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'testTool',
              description: 'A test tool',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        request: vi.fn().mockImplementation(emptyResourceListRequest),
        onerror: vi.fn(() => {
          throw new Error('original handler failed');
        }) as ((error: Error) => void) | undefined,
      };
      stubSdkClient(mockedClient);
      const mockedToolRegistry = {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        removeMcpToolsByServer: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const mockedPromptRegistry = {
        registerPrompt: vi.fn(),
        removePromptsByServer: vi.fn(),
      } as unknown as PromptRegistry;
      const mockedResourceRegistry = {
        setResourcesForServer: vi.fn(),
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry;
      const client = buildClient(
        mockedToolRegistry,
        mockedPromptRegistry,
        mockedResourceRegistry,
        createTrustedConfig(),
      );
      await client.connect();
      await client.discover(createTrustedConfig());

      expect(mockedClient.onerror).toBeTypeOf('function');

      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() =>
        mockedClient.onerror?.(new Error('connection lost')),
      ).not.toThrow();

      await waitFor(() => {
        expect(mockedClient.close).toHaveBeenCalled();
      });
      expect(mockedToolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
        'test-server',
      );
      expect(mockedPromptRegistry.removePromptsByServer).toHaveBeenCalledWith(
        'test-server',
      );
      expect(
        mockedResourceRegistry.removeResourcesByServer,
      ).toHaveBeenCalledWith('test-server');
      expect(client.getStatus()).toBe('disconnected');
    });

    it('does not resurrect a client when disconnected during connect', async () => {
      let resolveConnect: (() => void) | undefined;
      const mockedClient = {
        connect: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveConnect = resolve;
            }),
        ),
        close: vi.fn().mockResolvedValue(undefined),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
      };
      stubSdkClient(mockedClient);
      const client = buildClient(
        { removeMcpToolsByServer: vi.fn() } as unknown as ToolRegistry,
        { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
        createMockResourceRegistry(),
        createTrustedConfig(),
      );

      const connectPromise = client.connect();
      await waitFor(() => expect(mockedClient.connect).toHaveBeenCalled());
      await client.disconnect();
      resolveConnect?.();
      await connectPromise;

      expect(mockedClient.close).toHaveBeenCalledOnce();
      expect(client.getStatus()).toBe('disconnected');
    });
  });
});
