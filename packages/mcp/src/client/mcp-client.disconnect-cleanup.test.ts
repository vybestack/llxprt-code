/**
 * @license
 * Copyright 2025 Vybestack LLC
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
import { McpClient } from './mcp-client.js';
import {
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
} from './mcp-status.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

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

const createMockResourceRegistry = (): ResourceRegistry =>
  ({
    setResourcesForServer: vi.fn(),
    removeResourcesByServer: vi.fn(),
  }) as unknown as ResourceRegistry;

const createTrustedConfig = (): Config =>
  ({ isTrustedFolder: () => true }) as Config;

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

describe('McpClient disconnect cleanup', () => {
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
    fs.rmSync(testWorkspace, { recursive: true, force: true });
  });

  it('reaches disconnected when the SDK client close fails', async () => {
    const transport = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn().mockRejectedValue(new Error('client close failed')),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({}),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      sdkClient as unknown as ClientLib.Client,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      transport as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      { removeMcpToolsByServer: vi.fn() } as unknown as ToolRegistry,
      { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
      createMockResourceRegistry(),
      workspaceContext,
      createTrustedConfig(),
      false,
      '0.0.1',
    );
    await client.connect();

    await expect(client.disconnect()).rejects.toThrow('client close failed');

    expect(sdkClient.close).toHaveBeenCalledOnce();

    expect(client.getStatus()).toBe('disconnected');
  });

  it('times out a hanging SDK client close and keeps it retryable', async () => {
    vi.useFakeTimers();
    try {
      const sdkClient = {
        connect: vi.fn(),
        close: vi
          .fn()
          .mockImplementationOnce(() => new Promise<void>(() => {}))
          .mockResolvedValueOnce(undefined),
        registerCapabilities: vi.fn(),
        setRequestHandler: vi.fn(),
        getServerCapabilities: vi.fn().mockReturnValue({}),
      };
      vi.mocked(ClientLib.Client).mockReturnValue(
        sdkClient as unknown as ClientLib.Client,
      );
      vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
        {} as SdkClientStdioLib.StdioClientTransport,
      );
      const client = new McpClient(
        'test-server',
        { command: 'test-command' },
        { removeMcpToolsByServer: vi.fn() } as unknown as ToolRegistry,
        { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
        createMockResourceRegistry(),
        workspaceContext,
        createTrustedConfig(),
        false,
        '0.0.1',
      );
      await client.connect();

      const disconnect = client.disconnect().then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(disconnect).resolves.toMatchObject({
        message: "Timed out closing MCP client 'test-server' after 10000ms",
      });
      await expect(client.disconnect()).resolves.toBeUndefined();
      expect(sdkClient.close).toHaveBeenCalledTimes(2);
      expect(client.getStatus()).toBe('disconnected');
    } finally {
      vi.useRealTimers();
    }
  });
  it('retains a failed SDK client close so disconnect can retry it', async () => {
    const closeFailure = new Error('client close failed');
    const sdkClient = {
      connect: vi.fn(),
      close: vi
        .fn()
        .mockRejectedValueOnce(closeFailure)
        .mockResolvedValueOnce(undefined),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({}),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      sdkClient as unknown as ClientLib.Client,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      { removeMcpToolsByServer: vi.fn() } as unknown as ToolRegistry,
      { removePromptsByServer: vi.fn() } as unknown as PromptRegistry,
      createMockResourceRegistry(),
      workspaceContext,
      createTrustedConfig(),
      false,
      '0.0.1',
    );
    await client.connect();

    await expect(client.disconnect()).rejects.toBe(closeFailure);
    await expect(client.disconnect()).resolves.toBeUndefined();

    expect(sdkClient.close).toHaveBeenCalledTimes(2);
  });

  it('closes the SDK client and reaches disconnected when registry cleanup fails', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({}),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      sdkClient as unknown as ClientLib.Client,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as SdkClientStdioLib.StdioClientTransport);
    const cleanupFailure = new Error('tool cleanup failed');
    const toolRegistry = {
      removeMcpToolsByServer: vi.fn().mockImplementation(() => {
        throw cleanupFailure;
      }),
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

    await expect(client.disconnect()).rejects.toBe(cleanupFailure);

    expect(sdkClient.close).toHaveBeenCalledOnce();
    expect(client.getStatus()).toBe('disconnected');
  });

  it('aggregates multiple registry cleanup failures during disconnect', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({}),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      sdkClient as unknown as ClientLib.Client,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as SdkClientStdioLib.StdioClientTransport);
    const toolCleanupFailure = new Error('tool cleanup failed');
    const promptCleanupFailure = new Error('prompt cleanup failed');
    const toolRegistry = {
      removeMcpToolsByServer: vi.fn().mockImplementation(() => {
        throw toolCleanupFailure;
      }),
    } as unknown as ToolRegistry;
    const promptRegistry = {
      removePromptsByServer: vi.fn().mockImplementation(() => {
        throw promptCleanupFailure;
      }),
    } as unknown as PromptRegistry;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      createMockResourceRegistry(),
      workspaceContext,
      createTrustedConfig(),
      false,
      '0.0.1',
    );
    await client.connect();

    let failure: unknown;
    try {
      await client.disconnect();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      message: "Disconnect cleanup failed for 'test-server'",
      errors: expect.arrayContaining([
        toolCleanupFailure,
        promptCleanupFailure,
      ]),
    });

    expect(sdkClient.close).toHaveBeenCalledOnce();
    expect(client.getStatus()).toBe('disconnected');
  });

  it('onerror closes client and disconnects even when registry cleanup throws', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      getServerCapabilities: vi
        .fn()
        .mockReturnValue({ tools: {}, prompts: {}, resources: {} }),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      sdkClient as unknown as ClientLib.Client,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as SdkClientStdioLib.StdioClientTransport);
    const toolRegistry = {
      registerTool: vi.fn(),
      sortTools: vi.fn(),
      removeMcpToolsByServer: vi.fn().mockImplementation(() => {
        throw new Error('persistent tool registry failure');
      }),
      getMessageBus: vi.fn(),
    } as unknown as ToolRegistry;
    const promptRegistry = {
      removePromptsByServer: vi.fn().mockImplementation(() => {
        throw new Error('persistent prompt registry failure');
      }),
    } as unknown as PromptRegistry;
    const resourceRegistry = {
      removeResourcesByServer: vi.fn().mockImplementation(() => {
        throw new Error('persistent resource registry failure');
      }),
    } as unknown as ResourceRegistry;
    const client = new McpClient(
      'test-server',
      { command: 'test-command' },
      toolRegistry,
      promptRegistry,
      resourceRegistry,
      workspaceContext,
      createTrustedConfig(),
      false,
      '0.0.1',
    );
    await client.connect();

    const errorHandler = (
      sdkClient as unknown as { onerror: (error: Error) => void }
    ).onerror;
    expect(errorHandler).toBeTypeOf('function');

    const throwingStatusListener = () => {
      throw new Error('status listener failed');
    };
    addMCPStatusChangeListener(throwingStatusListener);
    try {
      expect(() => errorHandler(new Error('connection lost'))).not.toThrow();
    } finally {
      removeMCPStatusChangeListener(throwingStatusListener);
    }

    await vi.waitFor(() => {
      expect(sdkClient.close).toHaveBeenCalled();
    });

    expect(toolRegistry.removeMcpToolsByServer).toHaveBeenCalledWith(
      'test-server',
    );
    expect(promptRegistry.removePromptsByServer).toHaveBeenCalledWith(
      'test-server',
    );
    expect(resourceRegistry.removeResourcesByServer).toHaveBeenCalledWith(
      'test-server',
    );
    expect(client.getStatus()).toBe('disconnected');
  });

  it('retries artifact cleanup after onerror left the client disconnected', async () => {
    const clientClosed = createDeferred<void>();
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn().mockImplementation(() => {
        clientClosed.resolve(undefined);
        return Promise.resolve();
      }),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      setNotificationHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({}),
    };
    vi.mocked(ClientLib.Client).mockReturnValue(
      sdkClient as unknown as ClientLib.Client,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
    let toolArtifactPresent = true;
    let cleanupFailed = false;
    const toolRegistry = {
      removeMcpToolsByServer: () => {
        if (!cleanupFailed) {
          cleanupFailed = true;
          throw new Error('transient tool cleanup failure');
        }
        toolArtifactPresent = false;
      },
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
    const errorHandler = (
      sdkClient as unknown as { onerror: (error: Error) => void }
    ).onerror;

    errorHandler(new Error('connection lost'));
    await clientClosed.promise;
    expect(client.getStatus()).toBe('disconnected');
    expect(toolArtifactPresent).toBe(true);

    await client.disconnect();

    expect(toolArtifactPresent).toBe(false);
  });
});
