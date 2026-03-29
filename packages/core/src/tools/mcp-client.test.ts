/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderType, type Config } from '../config/config.js';
import { GoogleCredentialProvider } from '../mcp/google-auth-provider.js';
import { MCPOAuthProvider } from '../mcp/oauth-provider.js';
import { MCPOAuthTokenStorage } from '../mcp/oauth-token-storage.js';
import type { PromptRegistry } from '../prompts/prompt-registry.js';
import type { ResourceRegistry } from '../resources/resource-registry.js';
import {
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { WorkspaceContext } from '../utils/workspaceContext.js';
import {
  connectToMcpServer,
  createTransport,
  getMCPServerStatus,
  hasNetworkTransport,
  isEnabled,
  McpClient,
  populateMcpServerCommand,
} from './mcp-client.js';
import type { ToolRegistry } from './tool-registry.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { coreEvents } from '../utils/events.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('@google/genai');
vi.mock('../mcp/oauth-provider.js');
vi.mock('../mcp/oauth-token-storage.js');
vi.mock('../mcp/oauth-utils.js');
vi.mock('google-auth-library');
import { GoogleAuth } from 'google-auth-library';

vi.mock('../utils/events.js', () => ({
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
    // create a tmp dir for this test
    // Create a unique temporary directory for the workspace to avoid conflicts
    testWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-agent-test-'),
    );
    workspaceContext = new WorkspaceContext(testWorkspace);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('McpClient', () => {
    it('should discover tools', async () => {
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'testFunction',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        }),
        listPrompts: vi.fn().mockResolvedValue({
          prompts: [],
        }),
        request: vi.fn().mockResolvedValue({}),
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
      );
      await client.connect();
      await client.discover({} as Config);
      expect(mockedClient.listTools).toHaveBeenCalledWith(
        {},
        { timeout: 600000 },
      );
    });

    it('should not skip tools even if a parameter is missing a type', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),

        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'validTool',
              inputSchema: {
                type: 'object',
                properties: {
                  param1: { type: 'string' },
                },
              },
            },
            {
              name: 'invalidTool',
              inputSchema: {
                type: 'object',
                properties: {
                  param1: { description: 'a param with no type' },
                },
              },
            },
          ],
        }),
        listPrompts: vi.fn().mockResolvedValue({
          prompts: [],
        }),
        request: vi.fn().mockResolvedValue({}),
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
      );
      await client.connect();
      await client.discover({} as Config);
      expect(mockedToolRegistry.registerTool).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should handle errors when discovering prompts', async () => {
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ prompts: {} }),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listPrompts: vi.fn().mockRejectedValue(new Error('Test error')),
        request: vi.fn().mockResolvedValue({}),
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
      const mockedToolRegistry = {
        registerTool: vi.fn(),
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
      );
      await client.connect();
      await expect(client.discover({} as Config)).rejects.toThrow(
        'No prompts, tools, or resources found on the server.',
      );
      // discoverPrompts logs to console.error, not coreEvents.emitFeedback
      // The error is swallowed and doesn't propagate - just verifies the throw above
    });

    it('should not discover tools if server does not support them', async () => {
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ prompts: {} }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        request: vi.fn().mockResolvedValue({}),
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
      );
      await client.connect();
      await expect(client.discover({} as Config)).rejects.toThrow(
        'No prompts, tools, or resources found on the server.',
      );
    });

    it('should discover tools if server supports them', async () => {
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
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
        request: vi.fn().mockResolvedValue({}),
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
      );
      await client.connect();
      await client.discover({} as Config);
      expect(mockedToolRegistry.registerTool).toHaveBeenCalledOnce();
    });

    it('should discover tools with $defs and $ref in schema', async () => {
      const mockedClient = {
        connect: vi.fn(),
        discover: vi.fn(),
        disconnect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'toolWithDefs',
              description: 'A tool using $defs',
              inputSchema: {
                type: 'object',
                properties: {
                  param1: {
                    $ref: '#/$defs/MyType',
                  },
                },
                $defs: {
                  MyType: {
                    type: 'string',
                    description: 'A defined type',
                  },
                },
              },
            },
          ],
        }),
        listPrompts: vi.fn().mockResolvedValue({
          prompts: [],
        }),
        request: vi.fn().mockResolvedValue({}),
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
      );
      await client.connect();
      await client.discover({} as Config);
      expect(mockedToolRegistry.registerTool).toHaveBeenCalledOnce();
      const registeredTool = vi.mocked(mockedToolRegistry.registerTool).mock
        .calls[0][0];
      expect(registeredTool.schema.parametersJsonSchema).toStrictEqual({
        type: 'object',
        properties: {
          param1: {
            $ref: '#/$defs/MyType',
          },
        },
        $defs: {
          MyType: {
            type: 'string',
            description: 'A defined type',
          },
        },
      });
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

  describe('Dynamic Tool Updates', () => {
    it('should set up notification handler if server supports tool list changes', async () => {
      const mockedClient = {
        connect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        // Capability enables the listener
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        request: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        {} as ToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
      );

      await client.connect();

      expect(mockedClient.setNotificationHandler).toHaveBeenCalledWith(
        ToolListChangedNotificationSchema,
        expect.any(Function),
      );
    });

    it('should NOT set up notification handler if server lacks capability', async () => {
      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }), // No listChanged
        setNotificationHandler: vi.fn(),
        request: vi.fn().mockResolvedValue({}),
        registerCapabilities: vi.fn().mockResolvedValue({}),
        setRequestHandler: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        {} as ToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
      );

      await client.connect();

      expect(mockedClient.setNotificationHandler).not.toHaveBeenCalled();
    });

    it('should set up resource list change notification handler when supported', async () => {
      const mockedClient = {
        connect: vi.fn(),
        getStatus: vi.fn(),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ resources: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        request: vi.fn().mockResolvedValue({ resources: [] }),
      };

      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        {} as ToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
      );

      await client.connect();

      expect(mockedClient.setNotificationHandler).toHaveBeenCalledWith(
        ResourceListChangedNotificationSchema,
        expect.any(Function),
      );
    });

    it('should refresh tools and notify manager when notification is received', async () => {
      // Setup mocks
      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'newTool',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        request: vi.fn().mockResolvedValue({}),
        registerCapabilities: vi.fn().mockResolvedValue({}),
        setRequestHandler: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const mockedToolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;

      const onToolsUpdatedSpy = vi.fn().mockResolvedValue(undefined);

      // Initialize client with onToolsUpdated callback
      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
        onToolsUpdatedSpy,
      );

      // 1. Connect (sets up listener)
      await client.connect();

      // 2. Extract the callback passed to setNotificationHandler
      const notificationCallback =
        mockedClient.setNotificationHandler.mock.calls[0][1];

      // 3. Trigger the notification manually
      await notificationCallback();

      // 4. Assertions
      // It should clear old tools
      expect(mockedToolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
        'test-server',
      );

      // It should fetch new tools (listTools called inside discoverTools)
      expect(mockedClient.listTools).toHaveBeenCalled();

      // It should register the new tool
      expect(mockedToolRegistry.registerTool).toHaveBeenCalled();

      // It should notify the manager
      expect(onToolsUpdatedSpy).toHaveBeenCalled();

      // It should emit feedback event
      expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
        'info',
        'Tools updated for server: test-server',
      );
    });

    it('should handle errors during tool refresh gracefully', async () => {
      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        // Simulate error during discovery
        listTools: vi.fn().mockRejectedValue(new Error('Network blip')),
        request: vi.fn().mockResolvedValue({}),
        registerCapabilities: vi.fn().mockResolvedValue({}),
        setRequestHandler: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const mockedToolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;

      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
      );

      await client.connect();

      const notificationCallback =
        mockedClient.setNotificationHandler.mock.calls[0][1];

      // Trigger notification - should fail internally but catch the error
      await notificationCallback();

      // Should try to remove tools
      expect(mockedToolRegistry.removeMcpToolsByServer).toHaveBeenCalled();

      // Should NOT emit success feedback
      expect(coreEvents.emitFeedback).not.toHaveBeenCalledWith(
        'info',
        expect.stringContaining('Tools updated'),
      );
    });

    it('should handle concurrent updates from multiple servers', async () => {
      const createMockSdkClient = (toolName: string) => ({
        connect: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: toolName,
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        request: vi.fn().mockResolvedValue({}),
        registerCapabilities: vi.fn().mockResolvedValue({}),
        setRequestHandler: vi.fn().mockResolvedValue({}),
      });

      const mockClientA = createMockSdkClient('tool-from-A');
      const mockClientB = createMockSdkClient('tool-from-B');

      vi.mocked(ClientLib.Client)
        .mockReturnValueOnce(mockClientA as unknown as ClientLib.Client)
        .mockReturnValueOnce(mockClientB as unknown as ClientLib.Client);

      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const mockedToolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;

      const onToolsUpdatedSpy = vi.fn().mockResolvedValue(undefined);

      const clientA = new McpClient(
        'server-A',
        { command: 'cmd-a' },
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
        onToolsUpdatedSpy,
      );

      const clientB = new McpClient(
        'server-B',
        { command: 'cmd-b' },
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
        onToolsUpdatedSpy,
      );

      await clientA.connect();
      await clientB.connect();

      const handlerA = mockClientA.setNotificationHandler.mock.calls[0][1];
      const handlerB = mockClientB.setNotificationHandler.mock.calls[0][1];

      // Trigger burst updates simultaneously
      await Promise.all([handlerA(), handlerB()]);

      expect(mockedToolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
        'server-A',
      );
      expect(mockedToolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
        'server-B',
      );

      // Verify fetching happened on both clients
      expect(mockClientA.listTools).toHaveBeenCalled();
      expect(mockClientB.listTools).toHaveBeenCalled();

      // Verify tools from both servers were registered (2 total calls)
      expect(mockedToolRegistry.registerTool).toHaveBeenCalledTimes(2);

      // Verify the update callback was triggered for both
      expect(onToolsUpdatedSpy).toHaveBeenCalledTimes(2);
    });

    it('should abort discovery and log error if timeout is exceeded during refresh', async () => {
      vi.useFakeTimers();

      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        // Mock listTools to simulate a long running process that respects the abort signal
        listTools: vi.fn().mockImplementation(
          async (_params, options) =>
            new Promise((_resolve, reject) => {
              if (options?.signal?.aborted) {
                return reject(new Error('Operation aborted'));
              }
              options?.signal?.addEventListener('abort', () => {
                reject(new Error('Operation aborted'));
              });
              // Intentionally do not resolve immediately to simulate lag
            }),
        ),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        request: vi.fn().mockResolvedValue({}),
        registerCapabilities: vi.fn().mockResolvedValue({}),
        setRequestHandler: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const mockedToolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;

      const client = new McpClient(
        'test-server',
        // Set a short timeout
        { command: 'test-command', timeout: 100 },
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
      );

      await client.connect();

      const notificationCallback =
        mockedClient.setNotificationHandler.mock.calls[0][1];

      const refreshPromise = notificationCallback();

      vi.advanceTimersByTime(150);

      await refreshPromise;

      expect(mockedClient.listTools).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );

      expect(mockedToolRegistry.registerTool).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should pass abort signal to onToolsUpdated callback', async () => {
      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        request: vi.fn().mockResolvedValue({}),
        registerCapabilities: vi.fn().mockResolvedValue({}),
        setRequestHandler: vi.fn().mockResolvedValue({}),
      };

      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const mockedToolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;

      const onToolsUpdatedSpy = vi.fn().mockResolvedValue(undefined);

      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
        onToolsUpdatedSpy,
      );

      await client.connect();

      const notificationCallback =
        mockedClient.setNotificationHandler.mock.calls[0][1];

      await notificationCallback();

      expect(onToolsUpdatedSpy).toHaveBeenCalledWith(expect.any(AbortSignal));

      // Verify the signal passed was not aborted (happy path)
      const signal = onToolsUpdatedSpy.mock.calls[0][0];
      expect(signal.aborted).toBe(false);
    });
  });

  describe('appendMcpServerCommand', () => {
    it('should do nothing if no MCP servers or command are configured', () => {
      const out = populateMcpServerCommand({}, undefined);
      expect(out).toStrictEqual({});
    });

    it('should discover tools via mcpServerCommand', () => {
      const commandString = 'command --arg1 value1';
      const out = populateMcpServerCommand({}, commandString);
      expect(out).toStrictEqual({
        mcp: {
          command: 'command',
          args: ['--arg1', 'value1'],
        },
      });
    });

    it('should handle error if mcpServerCommand parsing fails', () => {
      expect(() => populateMcpServerCommand({}, 'derp && herp')).toThrowError();
    });
  });

  describe('createTransport', () => {
    describe('should connect via httpUrl', () => {
      it('without headers', async () => {
        const transport = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
      });

      it('with headers', async () => {
        const transport = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            headers: { Authorization: 'derp' },
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
      });
    });

    describe('should connect via url', () => {
      it('without headers defaults to HTTP transport', async () => {
        const transport = await createTransport(
          'test-server',
          {
            url: 'http://test-server',
          },
          false,
        );
        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
      });

      it('with headers defaults to HTTP transport', async () => {
        const transport = await createTransport(
          'test-server',
          {
            url: 'http://test-server',
            headers: { Authorization: 'derp' },
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
      });

      it('with type sse uses SSE transport', async () => {
        const transport = await createTransport(
          'test-server',
          {
            url: 'http://test-server',
            type: 'sse',
          },
          false,
        );
        expect(transport).toBeInstanceOf(SSEClientTransport);
      });

      it('with type http uses HTTP transport', async () => {
        const transport = await createTransport(
          'test-server',
          {
            url: 'http://test-server',
            type: 'http',
          },
          false,
        );
        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
      });
    });

    it('should connect via command', async () => {
      const mockedTransport = vi
        .spyOn(SdkClientStdioLib, 'StdioClientTransport')
        .mockReturnValue({} as SdkClientStdioLib.StdioClientTransport);

      await createTransport(
        'test-server',
        {
          command: 'test-command',
          args: ['--foo', 'bar'],
          env: { FOO: 'bar' },
          cwd: 'test/cwd',
        },
        false,
      );

      expect(mockedTransport).toHaveBeenCalledWith({
        command: 'test-command',
        args: ['--foo', 'bar'],
        cwd: 'test/cwd',
        env: { ...process.env, FOO: 'bar' },
        stderr: 'pipe',
      });
    });

    describe('useGoogleCredentialProvider', () => {
      beforeEach(() => {
        // Mock GoogleAuth client
        const mockClient = {
          getAccessToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
          quotaProjectId: 'myproject',
        };

        vi.mocked(GoogleAuth.prototype.getClient).mockResolvedValue(mockClient);
      });

      it('should use GoogleCredentialProvider when specified', async () => {
        const transport = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test.googleapis.com',
            authProviderType: AuthProviderType.GOOGLE_CREDENTIALS,
            oauth: {
              scopes: ['scope1'],
            },
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authProvider = (transport as any)._authProvider;
        expect(authProvider).toBeInstanceOf(GoogleCredentialProvider);
      });

      it('should use headers from GoogleCredentialProvider', async () => {
        const mockGetRequestHeaders = vi.fn().mockResolvedValue({
          'X-Goog-User-Project': 'provider-project',
        });
        vi.spyOn(
          GoogleCredentialProvider.prototype,
          'getRequestHeaders',
        ).mockImplementation(mockGetRequestHeaders);

        const transport = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test.googleapis.com',
            authProviderType: AuthProviderType.GOOGLE_CREDENTIALS,
            oauth: {
              scopes: ['scope1'],
            },
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        expect(mockGetRequestHeaders).toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const headers = (transport as any)._requestInit?.headers;
        expect(headers['X-Goog-User-Project']).toBe('provider-project');
      });

      it('should prioritize provider headers over config headers', async () => {
        const mockGetRequestHeaders = vi.fn().mockResolvedValue({
          'X-Goog-User-Project': 'provider-project',
        });
        vi.spyOn(
          GoogleCredentialProvider.prototype,
          'getRequestHeaders',
        ).mockImplementation(mockGetRequestHeaders);

        const transport = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test.googleapis.com',
            authProviderType: AuthProviderType.GOOGLE_CREDENTIALS,
            oauth: {
              scopes: ['scope1'],
            },
            headers: {
              'X-Goog-User-Project': 'config-project',
            },
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const headers = (transport as any)._requestInit?.headers;
        expect(headers['X-Goog-User-Project']).toBe('provider-project');
      });

      it('should use GoogleCredentialProvider with SSE transport', async () => {
        const transport = await createTransport(
          'test-server',
          {
            url: 'http://test.googleapis.com',
            type: 'sse',
            authProviderType: AuthProviderType.GOOGLE_CREDENTIALS,
            oauth: {
              scopes: ['scope1'],
            },
          },
          false,
        );

        expect(transport).toBeInstanceOf(SSEClientTransport);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const authProvider = (transport as any)._authProvider;
        expect(authProvider).toBeInstanceOf(GoogleCredentialProvider);
      });

      it('should throw an error if no URL is provided with GoogleCredentialProvider', async () => {
        await expect(
          createTransport(
            'test-server',
            {
              authProviderType: AuthProviderType.GOOGLE_CREDENTIALS,
              oauth: {
                scopes: ['scope1'],
              },
            },
            false,
          ),
        ).rejects.toThrow(
          'URL must be provided in the config for Google Credentials provider',
        );
      });
    });
  });
  describe('isEnabled', () => {
    const funcDecl = { name: 'myTool' };
    const serverName = 'myServer';

    it('should return true if no include or exclude lists are provided', () => {
      const mcpServerConfig = {};
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(true);
    });

    it('should return false if the tool is in the exclude list', () => {
      const mcpServerConfig = { excludeTools: ['myTool'] };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(false);
    });

    it('should return true if the tool is in the include list', () => {
      const mcpServerConfig = { includeTools: ['myTool'] };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(true);
    });

    it('should return true if the tool is in the include list with parentheses', () => {
      const mcpServerConfig = { includeTools: ['myTool()'] };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(true);
    });

    it('should return false if the include list exists but does not contain the tool', () => {
      const mcpServerConfig = { includeTools: ['anotherTool'] };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(false);
    });

    it('should return false if the tool is in both the include and exclude lists', () => {
      const mcpServerConfig = {
        includeTools: ['myTool'],
        excludeTools: ['myTool'],
      };
      expect(isEnabled(funcDecl, serverName, mcpServerConfig)).toBe(false);
    });

    it('should return false if the function declaration has no name', () => {
      const namelessFuncDecl = {};
      const mcpServerConfig = {};
      expect(isEnabled(namelessFuncDecl, serverName, mcpServerConfig)).toBe(
        false,
      );
    });
  });

  describe('hasNetworkTransport', () => {
    it('should return true if only url is provided', () => {
      const config = { url: 'http://example.com' };
      expect(hasNetworkTransport(config)).toBe(true);
    });

    it('should return true if only httpUrl is provided', () => {
      const config = { httpUrl: 'http://example.com' };
      expect(hasNetworkTransport(config)).toBe(true);
    });

    it('should return true if both url and httpUrl are provided', () => {
      const config = {
        url: 'http://example.com/sse',
        httpUrl: 'http://example.com/http',
      };
      expect(hasNetworkTransport(config)).toBe(true);
    });

    it('should return false if neither url nor httpUrl is provided', () => {
      const config = { command: 'do-something' };
      expect(hasNetworkTransport(config)).toBe(false);
    });

    it('should return false for an empty config object', () => {
      const config = {};
      expect(hasNetworkTransport(config)).toBe(false);
    });
  });
});

describe('connectToMcpServer with OAuth', () => {
  let mockedClient: ClientLib.Client;
  let workspaceContext: WorkspaceContext;
  let testWorkspace: string;
  let mockAuthProvider: MCPOAuthProvider;
  let mockTokenStorage: MCPOAuthTokenStorage;

  beforeEach(() => {
    mockedClient = {
      connect: vi.fn(),
      close: vi.fn(),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      onclose: vi.fn(),
      notification: vi.fn(),
    } as unknown as ClientLib.Client;
    vi.mocked(ClientLib.Client).mockImplementation(() => mockedClient);

    testWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-agent-test-'),
    );
    workspaceContext = new WorkspaceContext(testWorkspace);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockTokenStorage = {
      getCredentials: vi.fn().mockResolvedValue({ clientId: 'test-client' }),
    } as unknown as MCPOAuthTokenStorage;
    vi.mocked(MCPOAuthTokenStorage).mockReturnValue(mockTokenStorage);
    mockAuthProvider = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getValidToken: vi.fn().mockResolvedValue('test-access-token'),
      tokenStorage: mockTokenStorage,
    } as unknown as MCPOAuthProvider;
    vi.mocked(MCPOAuthProvider).mockReturnValue(mockAuthProvider);

    // Mock static methods used by connectToMcpServer's OAuth flow
    vi.spyOn(MCPOAuthProvider, 'authenticate').mockResolvedValue(undefined);
    vi.spyOn(MCPOAuthProvider, 'getValidToken').mockResolvedValue(
      'test-access-token',
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle automatic OAuth flow on 401 with stored token', async () => {
    const serverUrl = 'http://test-server.com/';

    vi.mocked(mockedClient.connect).mockRejectedValueOnce(
      new Error('401 Unauthorized'),
    );

    // We need this to be an any type because we dig into its private state.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let capturedTransport: any;
    vi.mocked(mockedClient.connect).mockImplementationOnce(
      async (transport) => {
        capturedTransport = transport;
        return Promise.resolve();
      },
    );

    const client = await connectToMcpServer(
      'test-server',
      { httpUrl: serverUrl },
      false,
      workspaceContext,
    );

    expect(client).toBe(mockedClient);
    // First connect rejects with 401, second connect succeeds with stored token
    expect(mockedClient.connect).toHaveBeenCalledTimes(2);
    // With stored token available, retryWithOAuth uses stored token directly
    expect(MCPOAuthProvider.getValidToken).toHaveBeenCalled();

    const authHeader =
      capturedTransport._requestInit?.headers?.['Authorization'];
    expect(authHeader).toBe('Bearer test-access-token');
  });

  it('should show auth required message on 401 when no stored token exists', async () => {
    const serverUrl = 'http://test-server.com';

    // Mock no stored credentials so getStoredOAuthToken returns null
    mockTokenStorage.getCredentials = vi.fn().mockResolvedValue(null);

    vi.mocked(mockedClient.connect).mockRejectedValueOnce(
      new Error('401 Unauthorized'),
    );

    await expect(
      connectToMcpServer(
        'test-server',
        { httpUrl: serverUrl },
        false,
        workspaceContext,
      ),
    ).rejects.toThrow(/requires OAuth authentication/);

    // Only initial connect is attempted
    expect(mockedClient.connect).toHaveBeenCalledTimes(1);
  });

  // Phase B: createTransportWithOAuth parity tests (RED phase)
  describe('createTransportWithOAuth transport selection', () => {
    // Note: createTransportWithOAuth is not directly exported, but we can test
    // its behavior through connectToMcpServer and retryWithOAuth

    // EXPECTED TO PASS: httpUrl uses HTTP transport (retryWithOAuth hardcodes HTTP)
    it('should use HTTP transport for httpUrl config', async () => {
      const serverUrl = 'http://test-server.com/http';

      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('401 Unauthorized'),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedTransport: any;
      vi.mocked(mockedClient.connect).mockImplementationOnce(
        async (transport) => {
          capturedTransport = transport;
          return Promise.resolve();
        },
      );

      await connectToMcpServer(
        'test-server',
        { httpUrl: serverUrl },
        false,
        workspaceContext,
      );

      // Passes because retryWithOAuth uses HTTP for httpUrl
      expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    });

    // EXPECTED TO PASS (accidentally): retryWithOAuth hardcodes HTTP for url
    // This test passes but for the WRONG reason - it should respect type field
    it('should use HTTP transport for url without type (default)', async () => {
      const serverUrl = 'http://test-server.com/mcp';

      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('401 Unauthorized'),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedTransport: any;
      vi.mocked(mockedClient.connect).mockImplementationOnce(
        async (transport) => {
          capturedTransport = transport;
          return Promise.resolve();
        },
      );

      await connectToMcpServer(
        'test-server',
        { url: serverUrl },
        false,
        workspaceContext,
      );

      // Passes accidentally: retryWithOAuth hardcodes HTTP (should use createTransportWithOAuth)
      expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    });

    // EXPECTED TO PASS (accidentally): retryWithOAuth ignores type field
    // This test passes but for the WRONG reason - should honor type:http explicitly
    it('should use HTTP transport for url + type:http', async () => {
      const serverUrl = 'http://test-server.com/http';

      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('401 Unauthorized'),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedTransport: any;
      vi.mocked(mockedClient.connect).mockImplementationOnce(
        async (transport) => {
          capturedTransport = transport;
          return Promise.resolve();
        },
      );

      await connectToMcpServer(
        'test-server',
        { url: serverUrl, type: 'http' },
        false,
        workspaceContext,
      );

      // Passes accidentally: retryWithOAuth hardcodes HTTP (ignores type field)
      expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    });

    // EXPECTED TO FAIL: type:sse not respected in createTransportWithOAuth
    it('should use SSE transport for url + type:sse', async () => {
      const serverUrl = 'http://test-server.com/sse';

      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('401 Unauthorized'),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let capturedTransport: any;
      vi.mocked(mockedClient.connect).mockImplementationOnce(
        async (transport) => {
          capturedTransport = transport;
          return Promise.resolve();
        },
      );

      await connectToMcpServer(
        'test-server',
        { url: serverUrl, type: 'sse' },
        false,
        workspaceContext,
      );

      // WILL FAIL: createTransportWithOAuth ignores type:sse, uses HTTP
      expect(capturedTransport).toBeInstanceOf(SSEClientTransport);
    });

    // EXPECTED TO FAIL: currently returns null, should throw error
    it('should throw error when neither url nor httpUrl configured', async () => {
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('401 Unauthorized'),
      );

      // WILL FAIL: current code returns null and continues, should throw
      await expect(
        connectToMcpServer(
          'test-server',
          { command: 'test-command' }, // No URL transport
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();
    });
  });

  // Phase C+D: State machine and hygiene tests (RED phase)
  describe('connectToMcpServer state machine behavior', () => {
    // EXPECTED TO PASS: 401 + stored token retry is already tested above

    // EXPECTED TO PASS: 401 + no token is already tested above

    // Test non-401 error + url + no type -> SSE fallback attempted
    // This may already be covered; checking if SSE fallback happens
    it('should attempt SSE fallback on non-401 error with url (no type)', async () => {
      const serverUrl = 'http://test-server.com/mcp';
      const mockTransport = { close: vi.fn() };

      // First connect fails with non-401 error
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      // Second connect (SSE fallback) succeeds
      vi.mocked(mockedClient.connect).mockResolvedValueOnce(undefined);

      vi.spyOn(
        StreamableHTTPClientTransport.prototype,
        'close',
      ).mockReturnValue(mockTransport.close());

      await connectToMcpServer(
        'test-server',
        { url: serverUrl },
        false,
        workspaceContext,
      );

      // Should have tried twice: HTTP first, then SSE fallback
      expect(mockedClient.connect).toHaveBeenCalledTimes(2);
      expect(mockTransport.close).toHaveBeenCalled();
    });

    // Test 404 detection sets httpReturned404 flag
    it('should set httpReturned404 flag on 404 error and prevent SSE fallback', async () => {
      const serverUrl = 'http://test-server.com/mcp';

      // Simulate 404 error
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('404 Not Found'),
      );

      await expect(
        connectToMcpServer(
          'test-server',
          { url: serverUrl },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      // Should only try once (no SSE fallback on 404)
      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    // Test explicit type:http prevents fallback
    it('should not attempt SSE fallback when type:http is explicit', async () => {
      const serverUrl = 'http://test-server.com/http';

      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      await expect(
        connectToMcpServer(
          'test-server',
          { url: serverUrl, type: 'http' },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      // Should only try once (no fallback with explicit type)
      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    // Test transport close is called on failed connect
    it('should close transport when initial connect fails', async () => {
      const mockTransport = { close: vi.fn() };

      vi.spyOn(
        StreamableHTTPClientTransport.prototype,
        'close',
      ).mockImplementation(mockTransport.close);

      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('Connection failed'),
      );

      await expect(
        connectToMcpServer(
          'test-server',
          { httpUrl: 'http://test-server.com' },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      expect(mockTransport.close).toHaveBeenCalled();
    });

    // Test mcpServerRequiresOAuth NOT set on non-auth failures (negative assertion)
    it('should not set mcpServerRequiresOAuth on non-auth connection failures', async () => {
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('Network timeout'),
      );

      await expect(
        connectToMcpServer(
          'test-server',
          { httpUrl: 'http://test-server.com' },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      // Check that the OAuth flag wasn't set
      // This is a negative assertion - we're testing what DOESN'T happen
      const status = getMCPServerStatus('test-server');
      expect(status).not.toBe('auth-required');
    });

    // Test fallback with different 404 string variants
    it('should detect "404" string and prevent SSE fallback', async () => {
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('HTTP 404'),
      );

      await expect(
        connectToMcpServer(
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should detect "Not Found" string and prevent SSE fallback', async () => {
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('Not Found'),
      );

      await expect(
        connectToMcpServer(
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    // Audit issue #1: retryWithOAuth should NOT attempt SSE fallback on 404 when type:'http' is explicit
    it('should NOT attempt SSE fallback when type:http is explicit and OAuth retry gets 404', async () => {
      const serverUrl = 'http://test-server.com/http';

      // First connect attempt: 401 Unauthorized (triggers OAuth retry)
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('401 Unauthorized'),
      );

      // Second connect attempt (OAuth retry with HTTP): 404 Not Found
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('404 Not Found'),
      );

      // Should fail with 404, NOT attempt SSE fallback
      await expect(
        connectToMcpServer(
          'test-server',
          { url: serverUrl, type: 'http' }, // Explicit HTTP type
          false,
          workspaceContext,
        ),
      ).rejects.toThrow(/404/);

      // Should only try twice: initial HTTP (401) + OAuth retry HTTP (404)
      // Should NOT try a third time with SSE fallback
      expect(mockedClient.connect).toHaveBeenCalledTimes(2);
    });

    // Audit issue #7: Test false-positive prevention for HTTP status detection
    it('should NOT treat non-404 error containing "404" in message as a 404', async () => {
      const mockTransport = { close: vi.fn() };
      vi.spyOn(
        StreamableHTTPClientTransport.prototype,
        'close',
      ).mockReturnValue(mockTransport.close());

      // Error message contains "404" but is not an actual HTTP 404 error
      vi.mocked(mockedClient.connect)
        .mockRejectedValueOnce(new Error('Connection failed at port 40404'))
        .mockResolvedValueOnce(undefined); // SSE fallback succeeds

      await connectToMcpServer(
        'test-server',
        { url: 'http://test-server.com/mcp' },
        false,
        workspaceContext,
      );

      // Should have tried twice: HTTP first, then SSE fallback
      // (because the error is NOT recognized as a real 404)
      expect(mockedClient.connect).toHaveBeenCalledTimes(2);
    });

    it('should NOT treat error with "4040" string as a 404', async () => {
      const mockTransport = { close: vi.fn() };
      vi.spyOn(
        StreamableHTTPClientTransport.prototype,
        'close',
      ).mockReturnValue(mockTransport.close());

      vi.mocked(mockedClient.connect)
        .mockRejectedValueOnce(new Error('Server returned error code 4040'))
        .mockResolvedValueOnce(undefined); // SSE fallback succeeds

      await connectToMcpServer(
        'test-server',
        { url: 'http://test-server.com/mcp' },
        false,
        workspaceContext,
      );

      expect(mockedClient.connect).toHaveBeenCalledTimes(2);
    });

    it('should correctly detect actual HTTP 404 via error code property', async () => {
      const mockTransport = { close: vi.fn() };
      vi.spyOn(
        StreamableHTTPClientTransport.prototype,
        'close',
      ).mockReturnValue(mockTransport.close());

      // Create error with code property (like MCP SDK errors)
      const error404 = new Error('Request failed');
      (error404 as unknown as { code: number }).code = 404;

      vi.mocked(mockedClient.connect).mockRejectedValueOnce(error404);

      await expect(
        connectToMcpServer(
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      // Should NOT attempt SSE fallback because it's a real 404
      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should detect proper HTTP 404 error message format', async () => {
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('HTTP 404 Not Found'),
      );

      await expect(
        connectToMcpServer(
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should detect status 404 error message format', async () => {
      vi.mocked(mockedClient.connect).mockRejectedValueOnce(
        new Error('Request failed with status 404'),
      );

      await expect(
        connectToMcpServer(
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
        ),
      ).rejects.toThrow();

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('getInstructions', () => {
    it('should return instructions from server capabilities', async () => {
      const instructionsText = 'These are server instructions for the agent.';
      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
        getInstructions: vi.fn().mockReturnValue(instructionsText),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const mcpClient = new McpClient(
        'test-server',
        { command: 'test', args: [] },
        {} as ToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
      );

      await mcpClient.connect();
      const instructions = mcpClient.getInstructions();
      expect(instructions).toBe(instructionsText);
    });

    it('should return empty string when server has no instructions', async () => {
      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
        getInstructions: vi.fn().mockReturnValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        close: vi.fn(),
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        mockedClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );

      const mcpClient = new McpClient(
        'test-server',
        { command: 'test', args: [] },
        {} as ToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        {} as Config,
        false,
      );

      await mcpClient.connect();
      const instructions = mcpClient.getInstructions();
      expect(instructions).toBe('');
    });
  });
});
