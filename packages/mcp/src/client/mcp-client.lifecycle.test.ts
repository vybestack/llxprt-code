/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import {
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpClient } from './mcp-client.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('@google/genai');
vi.mock('../auth/oauth-provider.js');
vi.mock('../auth/oauth-token-storage.js');
vi.mock('../auth/oauth-utils.js');
vi.mock('google-auth-library');

vi.mock('@vybestack/llxprt-code-core/utils/events.js', () => ({
  coreEvents: {
    emitFeedback: vi.fn(),
  },
}));

const createMockResourceRegistry = (): ResourceRegistry =>
  ({
    setResourcesForServer: vi.fn(),
    removeResourcesByServer: vi.fn(),
  }) as unknown as ResourceRegistry;

describe('mcp-client', () => {
  let workspaceContext: WorkspaceContext;
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-agent-test-'),
    );
    workspaceContext = new WorkspaceContext(testWorkspace);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('McpClient', () => {
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
        request: vi.fn().mockImplementation(({ method }) => {
          if (method === 'resources/list') {
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
        }),
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
      const mockedToolRegistry = {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const mockedResourceRegistry = {
        setResourcesForServer: vi.fn(),
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry;
      const client = new McpClient(
        'test-server',
        {
          command: 'test-command',
        },
        mockedToolRegistry,
        {} as PromptRegistry,
        mockedResourceRegistry,
        workspaceContext,
        {} as Config,
        false,
        '0.0.1',
      );
      await client.connect();
      await client.discover({} as Config);
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
      let listCallCount = 0;
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
        setNotificationHandler: vi.fn((schema, handler) => {
          if (schema === ResourceListChangedNotificationSchema) {
            resourceListHandler = handler;
          }
        }),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ resources: { listChanged: true } }),
        request: vi.fn().mockImplementation(({ method }) => {
          if (method === 'resources/list') {
            listCallCount += 1;
            if (listCallCount === 1) {
              return Promise.resolve({
                resources: [
                  {
                    uri: 'file:///tmp/one.txt',
                  },
                ],
              });
            }
            return Promise.resolve({
              resources: [
                {
                  uri: 'file:///tmp/two.txt',
                },
              ],
            });
          }
          return Promise.resolve({ prompts: [] });
        }),
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
      const mockedToolRegistry = {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const mockedResourceRegistry = {
        setResourcesForServer: vi.fn(),
        removeResourcesByServer: vi.fn(),
      } as unknown as ResourceRegistry;
      const client = new McpClient(
        'test-server',
        {
          command: 'test-command',
        },
        mockedToolRegistry,
        {} as PromptRegistry,
        mockedResourceRegistry,
        workspaceContext,
        {} as Config,
        false,
        '0.0.1',
      );
      await client.connect();
      await client.discover({} as Config);

      expect(resourceListHandler).toBeDefined();

      await resourceListHandler?.({
        method: 'notifications/resources/list_changed',
      });

      expect(
        mockedResourceRegistry.setResourcesForServer,
      ).toHaveBeenLastCalledWith('test-server', [
        expect.objectContaining({ uri: 'file:///tmp/two.txt' }),
      ]);

      expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
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
        request: vi.fn().mockImplementation(({ method }) => {
          if (method === 'resources/read') {
            return Promise.resolve(readResult);
          }
          if (method === 'resources/list') {
            return Promise.resolve({ resources: [] });
          }
          return Promise.resolve({ prompts: [] });
        }),
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
      const mockedToolRegistry = {
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const client = new McpClient(
        'test-server',
        {
          command: 'test-command',
        },
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
        '0.0.1',
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

    it('should throw if readResource is called while disconnected', async () => {
      const mockedClient = {
        connect: vi.fn(),
        request: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
      const client = new McpClient(
        'test-server',
        {
          command: 'test-command',
        },
        {} as ToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
        '0.0.1',
      );

      await expect(
        client.readResource('file:///tmp/readme.txt'),
      ).rejects.toThrow('Client is not connected');
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
        request: vi.fn().mockImplementation(({ method }) => {
          if (method === 'resources/list') {
            return Promise.resolve({
              resources: [
                { uri: 'file:///tmp/resource.txt', name: 'resource' },
              ],
            });
          }
          return Promise.resolve({});
        }),
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
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
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
      const client = new McpClient(
        'test-server',
        {
          command: 'test-command',
        },
        mockedToolRegistry,
        mockedPromptRegistry,
        mockedResourceRegistry,
        workspaceContext,
        {} as Config,
        false,
        '0.0.1',
      );
      await client.connect();
      await client.discover({} as Config);

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
        request: vi.fn().mockImplementation(({ method }) => {
          if (method === 'resources/list') {
            return Promise.resolve({ resources: [] });
          }
          return Promise.resolve({});
        }),
        onerror: undefined as ((error: Error) => void) | undefined,
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
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
      const client = new McpClient(
        'test-server',
        {
          command: 'test-command',
        },
        mockedToolRegistry,
        mockedPromptRegistry,
        mockedResourceRegistry,
        workspaceContext,
        {} as Config,
        false,
        '0.0.1',
      );
      await client.connect();
      await client.discover({} as Config);

      const errorHandler = mockedClient.onerror!;
      expect(errorHandler).toBeDefined();

      vi.spyOn(console, 'error').mockImplementation(() => {});
      errorHandler(new Error('connection lost'));

      await vi.waitFor(() => {
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
  });
});
