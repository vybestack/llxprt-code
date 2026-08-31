/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '../../../test-utils/src/automock.js';
import { advanceTimersByTimeAsync } from '../../../test-utils/src/async-timers.js';
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
import type { Config } from './test-support/mcpClientTestSupport.js';
import type { PromptRegistry } from './test-support/mcpClientTestSupport.js';
import type { ResourceRegistry } from './test-support/mcpClientTestSupport.js';
import { WorkspaceContext } from './test-support/mcpClientTestSupport.js';
import { McpClient } from './mcp-client.js';
import {
  addMCPStatusChangeListener,
  MCPServerStatus,
  removeMCPStatusChangeListener,
} from './mcp-status.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { registerMcpHostServices } from '../host/hostServices.js';

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

const createTrustedConfig = (): Config =>
  ({ isTrustedFolder: () => true }) as Config;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createThrowingStatusListener(
  disconnectingFailure: Error,
  disconnectedFailure: Error,
): (serverName: string, status: MCPServerStatus) => void {
  return (_serverName, status) => {
    if (status === MCPServerStatus.DISCONNECTING) {
      throw disconnectingFailure;
    }
    if (status === MCPServerStatus.DISCONNECTED) {
      throw disconnectedFailure;
    }
  };
}

function createRetryingToolRegistry(): {
  readonly registry: ToolRegistry;
  readonly artifactPresent: () => boolean;
} {
  let artifactPresent = true;
  let cleanupFailed = false;
  const registry = {
    removeMcpToolsByServer: () => {
      if (!cleanupFailed) {
        cleanupFailed = true;
        throw new Error('transient tool cleanup failure');
      }
      artifactPresent = false;
    },
  } as unknown as ToolRegistry;
  return { registry, artifactPresent: () => artifactPresent };
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
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
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

  it('finishes cleanup and reports status listener failures during disconnect', async () => {
    const sdkClient = {
      connect: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn(),
      getServerCapabilities: vi.fn().mockReturnValue({}),
    };
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
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
    const disconnectingFailure = new Error('disconnecting listener failed');
    const disconnectedFailure = new Error('disconnected listener failed');
    const throwingStatusListener = createThrowingStatusListener(
      disconnectingFailure,
      disconnectedFailure,
    );
    addMCPStatusChangeListener(throwingStatusListener);

    let failure: unknown;
    try {
      await client.disconnect();
    } catch (error) {
      failure = error;
    } finally {
      removeMCPStatusChangeListener(throwingStatusListener);
    }

    expect(sdkClient.close).toHaveBeenCalledOnce();
    expect(client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
    expect(failure).toMatchObject({
      message: "Disconnect cleanup failed for 'test-server'",
      errors: [disconnectingFailure, disconnectedFailure],
    });
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
      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
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
      await advanceTimersByTimeAsync(10_000);

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
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
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
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
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
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
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
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
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

    await waitFor(() => {
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
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(sdkClient as unknown as ClientLib.Client);
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      {} as SdkClientStdioLib.StdioClientTransport,
    );
    const toolCleanup = createRetryingToolRegistry();
    const toolRegistry = toolCleanup.registry;
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
    expect(toolCleanup.artifactPresent()).toBe(true);

    await client.disconnect();

    expect(toolCleanup.artifactPresent()).toBe(false);
  });
});
