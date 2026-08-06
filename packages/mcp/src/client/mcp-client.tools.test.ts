/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '../../../test-utils/src/wait-for.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import {
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpClient, populateMcpServerCommand } from './mcp-client.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('../auth/oauth-provider.js');
vi.mock('../auth/oauth-token-storage.js');
vi.mock('../auth/oauth-utils.js');
vi.mock('google-auth-library', () => ({ GoogleAuth: vi.fn() }));

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

const createTrustedConfig = (): Config =>
  ({
    isTrustedFolder: () => true,
  }) as Config;

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

  describe('Dynamic Tool Updates', () => {
    it('aborts an in-flight tool refresh when disconnected', async () => {
      let refreshSignal: AbortSignal | undefined;
      const mockedClient = {
        connect: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        setNotificationHandler: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        listTools: vi.fn(),
      };
      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue({
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as SdkClientStdioLib.StdioClientTransport);
      const toolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn(),
      } as unknown as ToolRegistry;
      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        toolRegistry,
        { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        createTrustedConfig(),
        false,
        '0.0.1',
      );
      await client.connect();
      mockedClient.listTools.mockImplementation((_request, options) => {
        refreshSignal = options?.signal;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      });
      const notificationCallback =
        mockedClient.setNotificationHandler.mock.calls[0][1];

      const refresh = notificationCallback();
      await waitFor(() => expect(refreshSignal).toBeDefined());

      await client.disconnect();

      expect(refreshSignal?.aborted).toBe(true);
      await expect(refresh).resolves.toBeUndefined();
    });

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

      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        createTrustedConfig(),
        false,
        '0.0.1',
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

      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        createTrustedConfig(),
        false,
        '0.0.1',
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

      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        createTrustedConfig(),
        false,
        '0.0.1',
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

      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        createTrustedConfig(),
        false,
        '0.0.1',
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

      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        createTrustedConfig(),
        false,
        '0.0.1',
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

      (ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>)
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
        createTrustedConfig(),
        false,
        '0.0.1',
        onToolsUpdatedSpy,
      );

      const clientB = new McpClient(
        'server-B',
        { command: 'cmd-b' },
        mockedToolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        createTrustedConfig(),
        false,
        '0.0.1',
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
          async (params, options) =>
            new Promise<void>((_resolve, reject) => {
              if (options?.signal?.aborted === true) {
                reject(new Error('Operation aborted'));
                return;
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

      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        createTrustedConfig(),
        false,
        '0.0.1',
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

      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        createTrustedConfig(),
        false,
        '0.0.1',
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

    it('clears the refresh timeout and removes new tools when the update callback fails', async () => {
      vi.useFakeTimers();
      try {
        const mockedClient = {
          connect: vi.fn(),
          getServerCapabilities: vi
            .fn()
            .mockReturnValue({ tools: { listChanged: true } }),
          setNotificationHandler: vi.fn(),
          listTools: vi.fn().mockResolvedValue({
            tools: [{ name: 'newTool', inputSchema: { type: 'object' } }],
          }),
          registerCapabilities: vi.fn(),
          setRequestHandler: vi.fn(),
        };
        (
          ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
        ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
        vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
          {} as SdkClientStdioLib.StdioClientTransport,
        );
        const toolRegistry = {
          removeMcpToolsByServer: vi.fn(),
          registerTool: vi.fn(),
          sortTools: vi.fn(),
          getMessageBus: vi.fn().mockReturnValue(undefined),
        } as unknown as ToolRegistry;
        const client = new McpClient(
          'test-server',
          { command: 'test-command', timeout: 100 },
          toolRegistry,
          {} as PromptRegistry,
          createMockResourceRegistry(),
          workspaceContext,
          createTrustedConfig(),
          false,
          '0.0.1',
          vi.fn().mockRejectedValue(new Error('context refresh failed')),
        );
        await client.connect();
        const notificationCallback =
          mockedClient.setNotificationHandler.mock.calls[0][1];

        await notificationCallback();

        expect(vi.getTimerCount()).toBe(0);
        expect(toolRegistry.removeMcpToolsByServer).toHaveBeenCalledTimes(2);
        expect(coreEvents.emitFeedback).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not remove replacement-connection tools when an old update callback fails', async () => {
      let rejectUpdate: ((error: Error) => void) | undefined;
      const updatePending = new Promise<void>((_resolve, reject) => {
        rejectUpdate = reject;
      });
      const firstSdkClient = {
        connect: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'oldTool', inputSchema: { type: 'object' } }],
        }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        request: vi.fn().mockResolvedValue({ resources: [] }),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
      };
      const replacementSdkClient = {
        ...firstSdkClient,
        connect: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
        setNotificationHandler: vi.fn(),
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'replacementTool', inputSchema: { type: 'object' } }],
        }),
      };
      (ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>)
        .mockReturnValueOnce(firstSdkClient as unknown as ClientLib.Client)
        .mockReturnValueOnce(
          replacementSdkClient as unknown as ClientLib.Client,
        );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue({
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as SdkClientStdioLib.StdioClientTransport);
      const toolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        toolRegistry,
        { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        createTrustedConfig(),
        false,
        '0.0.1',
        vi.fn().mockReturnValueOnce(updatePending),
      );
      await client.connect();
      const notificationCallback =
        firstSdkClient.setNotificationHandler.mock.calls[0][1];
      const refresh = notificationCallback();
      await waitFor(() =>
        expect(toolRegistry.registerTool).toHaveBeenCalledOnce(),
      );

      await client.disconnect();
      await client.connect();
      await client.discover(createTrustedConfig());
      const removalsBeforeOldFailure = (
        toolRegistry.removeMcpToolsByServer as Mock<
          typeof toolRegistry.removeMcpToolsByServer
        >
      ).mock.calls.length;

      rejectUpdate?.(new Error('old update failed'));
      await refresh;

      expect(toolRegistry.removeMcpToolsByServer).toHaveBeenCalledTimes(
        removalsBeforeOldFailure,
      );
    });

    it('removes stale tools when authorization is revoked during refresh', async () => {
      let trusted = true;
      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        listTools: vi.fn().mockImplementation(async () => {
          trusted = false;
          return {
            tools: [{ name: 'newTool', inputSchema: { type: 'object' } }],
          };
        }),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
      };
      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
      const toolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        toolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        { isTrustedFolder: () => trusted } as Config,
        false,
        '0.0.1',
      );
      await client.connect();
      const notificationCallback =
        mockedClient.setNotificationHandler.mock.calls[0][1];

      await notificationCallback();

      expect(toolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
        'test-server',
      );
      expect(toolRegistry.registerTool).not.toHaveBeenCalled();
      expect(coreEvents.emitFeedback).not.toHaveBeenCalled();
    });

    it('removes newly registered tools when authorization is revoked during the update callback', async () => {
      let trusted = true;
      const mockedClient = {
        connect: vi.fn(),
        getServerCapabilities: vi
          .fn()
          .mockReturnValue({ tools: { listChanged: true } }),
        setNotificationHandler: vi.fn(),
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'newTool', inputSchema: { type: 'object' } }],
        }),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
      };
      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
      const toolRegistry = {
        removeMcpToolsByServer: vi.fn(),
        registerTool: vi.fn(),
        sortTools: vi.fn(),
        getMessageBus: vi.fn().mockReturnValue(undefined),
      } as unknown as ToolRegistry;
      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        toolRegistry,
        {} as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        { isTrustedFolder: () => trusted } as Config,
        false,
        '0.0.1',
        vi.fn().mockImplementation(async () => {
          trusted = false;
        }),
      );
      await client.connect();
      const notificationCallback =
        mockedClient.setNotificationHandler.mock.calls[0][1];

      await notificationCallback();

      expect(toolRegistry.registerTool).toHaveBeenCalledOnce();
      expect(toolRegistry.removeMcpToolsByServer).toHaveBeenCalledTimes(2);
      expect(coreEvents.emitFeedback).not.toHaveBeenCalled();
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
      expect(() => populateMcpServerCommand({}, 'derp && herp')).toThrowError(
        /failed to parse mcpServerCommand/,
      );
    });
  });
});
