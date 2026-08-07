/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createMockAuthProvider,
  createMockTokenStorage,
  createMockedClient,
  silenceConsole,
} from './mcp-client.oauth.fixtures.js';
import { automock } from '../../../test-utils/src/automock.js';
import { waitFor } from '../../../test-utils/src/wait-for.js';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Mock } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';
import { MCPOAuthTokenStorage } from '../auth/oauth-token-storage.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';

import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import {
  connectToMcpServer,
  getMCPServerStatus,
  McpClient,
} from './mcp-client.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

void vi.mock('@vybestack/llxprt-code-core/utils/events.js', () => ({
  coreEvents: {
    emitFeedback: vi.fn(),
  },
}));

const createMockResourceRegistry = (): ResourceRegistry =>
  ({
    setResourcesForServer: vi.fn(),
    removeResourcesByServer: vi.fn(),
  }) as unknown as ResourceRegistry;
import type { TransportWithInternals } from './mcpClientTestHelpers.js';

async function expectPending(promise: Promise<unknown>): Promise<void> {
  expect(await Promise.race([promise, Promise.resolve('pending')])).toBe(
    'pending',
  );
}

describe('connectToMcpServer with OAuth', () => {
  let mockedClient: ClientLib.Client;
  let workspaceContext: WorkspaceContext;
  let testWorkspace: string;
  let mockAuthProvider: MCPOAuthProvider;
  let mockTokenStorage: MCPOAuthTokenStorage;

  /** Connects the suite's standard server, varying only config and signal. */
  const connectTestServer = (
    config: Parameters<typeof connectToMcpServer>[2],
    signal?: AbortSignal,
  ): ReturnType<typeof connectToMcpServer> =>
    connectToMcpServer(
      '0.0.1',
      'test-server',
      config,
      false,
      workspaceContext,
      signal,
    );

  beforeEach(() => {
    mockedClient = createMockedClient();
    (
      ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementation(() => mockedClient);

    testWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-agent-test-'),
    );
    workspaceContext = new WorkspaceContext(testWorkspace);
    silenceConsole();

    mockTokenStorage = createMockTokenStorage();
    (
      MCPOAuthTokenStorage as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(mockTokenStorage);
    mockAuthProvider = createMockAuthProvider(mockTokenStorage);
    (
      MCPOAuthProvider as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(mockAuthProvider);

    // Mock static methods used by connectToMcpServer's OAuth flow
    vi.spyOn(MCPOAuthProvider, 'authenticate').mockResolvedValue(undefined);
    vi.spyOn(MCPOAuthProvider, 'getValidToken').mockResolvedValue(
      'test-access-token',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('awaits cleanup for an already-aborted connection', async () => {
    const transport = { close: vi.fn().mockResolvedValue(undefined) };
    let releaseClientClose: (() => void) | undefined;
    (mockedClient.close as Mock<typeof mockedClient.close>).mockReturnValue(
      new Promise<void>((resolve) => {
        releaseClientClose = resolve;
      }),
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      transport as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    const controller = new AbortController();
    controller.abort();

    const connection = connectTestServer(
      { command: 'test-command' },
      controller.signal,
    );
    const outcome = connection.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await waitFor(() => expect(mockedClient.close).toHaveBeenCalledOnce());

    await expectPending(outcome);
    releaseClientClose?.();
    await expect(outcome).resolves.toMatchObject({ name: 'AbortError' });
    expect(transport.close).toHaveBeenCalledOnce();
    expect(mockedClient.close).toHaveBeenCalledOnce();
  });

  it('preserves the connection failure when transport cleanup also fails', async () => {
    const transport = {
      close: vi.fn().mockRejectedValue(new Error('transport cleanup failed')),
    };
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      transport as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    (
      mockedClient.connect as Mock<typeof mockedClient.connect>
    ).mockRejectedValue(new Error('primary connection failure'));

    await expect(
      connectTestServer({ command: 'test-command' }),
    ).rejects.toThrow('primary connection failure');
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('awaits transport cleanup and preserves one AbortError when connect is cancelled', async () => {
    let releaseTransportClose: (() => void) | undefined;
    const transport = {
      close: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          releaseTransportClose = resolve;
        }),
      ),
    };
    (mockedClient.close as Mock<typeof mockedClient.close>).mockResolvedValue(
      undefined,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      transport as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    let rejectConnect: ((error: Error) => void) | undefined;
    let notifyConnectStarted: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      notifyConnectStarted = resolve;
    });
    (
      mockedClient.connect as Mock<typeof mockedClient.connect>
    ).mockImplementation(() => {
      notifyConnectStarted?.();
      return new Promise<void>((_resolve, reject) => {
        rejectConnect = reject;
      });
    });
    const controller = new AbortController();

    const connection = connectTestServer(
      { command: 'test-command' },
      controller.signal,
    );
    const outcome = connection.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await connectStarted;
    controller.abort();
    rejectConnect?.(new Error('connect failed'));
    await waitFor(() => expect(transport.close).toHaveBeenCalledOnce());

    await expectPending(outcome);
    releaseTransportClose?.();
    const failure = await outcome;
    expect(failure).toBeInstanceOf(DOMException);
    expect(failure).toMatchObject({
      name: 'AbortError',
      cause: expect.objectContaining({ message: 'connect failed' }),
    });
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('awaits cleanup when connect resolves after cancellation', async () => {
    let releaseTransportClose: (() => void) | undefined;
    const transport = {
      close: vi.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          releaseTransportClose = resolve;
        }),
      ),
    };
    (mockedClient.close as Mock<typeof mockedClient.close>).mockResolvedValue(
      undefined,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      transport as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    let resolveConnect: (() => void) | undefined;
    let notifyConnectStarted: (() => void) | undefined;
    const connectStarted = new Promise<void>((resolve) => {
      notifyConnectStarted = resolve;
    });
    (
      mockedClient.connect as Mock<typeof mockedClient.connect>
    ).mockImplementation(() => {
      notifyConnectStarted?.();
      return new Promise<void>((resolve) => {
        resolveConnect = resolve;
      });
    });
    const controller = new AbortController();

    const outcome = connectTestServer(
      { command: 'test-command' },
      controller.signal,
    ).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await connectStarted;
    controller.abort();
    resolveConnect?.();
    await waitFor(() => expect(transport.close).toHaveBeenCalledOnce());

    await expectPending(outcome);
    releaseTransportClose?.();
    const failure = await outcome;
    expect(failure).toBeInstanceOf(DOMException);
    expect(failure).toMatchObject({ name: 'AbortError' });
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('preserves a connection failure when cleanup aborts the same handshake', async () => {
    const controller = new AbortController();
    const transport = {
      close: vi.fn().mockImplementation(async () => {
        controller.abort();
      }),
    };
    (mockedClient.close as Mock<typeof mockedClient.close>).mockResolvedValue(
      undefined,
    );
    vi.spyOn(SdkClientStdioLib, 'StdioClientTransport').mockReturnValue(
      transport as unknown as SdkClientStdioLib.StdioClientTransport,
    );
    const connectionFailure = new Error('connect failed');
    (
      mockedClient.connect as Mock<typeof mockedClient.connect>
    ).mockRejectedValueOnce(connectionFailure);

    let failure: unknown;
    try {
      await connectTestServer({ command: 'test-command' }, controller.signal);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(DOMException);
    expect(failure).toMatchObject({
      name: 'AbortError',
      cause: connectionFailure,
    });
  });

  it('should handle automatic OAuth flow on 401 with stored token', async () => {
    const serverUrl = 'http://test-server.com/';

    (
      mockedClient.connect as Mock<typeof mockedClient.connect>
    ).mockRejectedValueOnce(new Error('401 Unauthorized'));

    // We need this to be an any type because we dig into its private state.
    let capturedTransport: TransportWithInternals | undefined;
    (
      mockedClient.connect as Mock<typeof mockedClient.connect>
    ).mockImplementationOnce(async (transport) => {
      capturedTransport = transport;
      return Promise.resolve();
    });

    const client = await connectTestServer({ httpUrl: serverUrl });

    expect(client).toBe(mockedClient);
    // First connect rejects with 401, second connect succeeds with stored token
    expect(mockedClient.connect).toHaveBeenCalledTimes(2);
    // With stored token available, retryWithOAuth uses stored token directly
    expect(MCPOAuthProvider.getValidToken).toHaveBeenCalled();

    const authHeader =
      capturedTransport?._requestInit?.headers?.['Authorization'];
    expect(authHeader).toBe('Bearer test-access-token');
  });

  it('should show auth required message on 401 when no stored token exists', async () => {
    const serverUrl = 'http://test-server.com';

    // Mock no stored credentials so getStoredOAuthToken returns null
    mockTokenStorage.getCredentials = vi.fn().mockResolvedValue(null);

    (
      mockedClient.connect as Mock<typeof mockedClient.connect>
    ).mockRejectedValueOnce(new Error('401 Unauthorized'));

    await expect(connectTestServer({ httpUrl: serverUrl })).rejects.toThrow(
      /requires OAuth authentication/,
    );

    // Only initial connect is attempted
    expect(mockedClient.connect).toHaveBeenCalledTimes(1);
  });

  // Phase B: createTransportWithOAuth parity tests (RED phase)
  describe('createTransportWithOAuth transport selection', () => {
    // Note: createTransportWithOAuth is not directly exported, but we can test
    // its behavior through connectToMcpServer and retryWithOAuth

    it('should use HTTP transport for httpUrl config', async () => {
      const serverUrl = 'http://test-server.com/http';

      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('401 Unauthorized'));

      let capturedTransport: TransportWithInternals | undefined;
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockImplementationOnce(async (transport) => {
        capturedTransport = transport;
        return Promise.resolve();
      });

      await connectTestServer({ httpUrl: serverUrl });

      expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    });

    it('should use HTTP transport for url without type (default)', async () => {
      const serverUrl = 'http://test-server.com/mcp';

      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('401 Unauthorized'));

      let capturedTransport: TransportWithInternals | undefined;
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockImplementationOnce(async (transport) => {
        capturedTransport = transport;
        return Promise.resolve();
      });

      await connectTestServer({ url: serverUrl });

      expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    });

    it.each(['http', 'streamable-http'] as const)(
      'should use HTTP transport for url + type:%s',
      async (type) => {
        const serverUrl = 'http://test-server.com/mcp';

        (
          mockedClient.connect as Mock<typeof mockedClient.connect>
        ).mockRejectedValueOnce(new Error('401 Unauthorized'));

        let capturedTransport: TransportWithInternals | undefined;
        (
          mockedClient.connect as Mock<typeof mockedClient.connect>
        ).mockImplementationOnce(async (transport) => {
          capturedTransport = transport;
          return Promise.resolve();
        });

        await connectTestServer({ url: serverUrl, type });

        expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
      },
    );

    it('should use SSE transport for url + type:sse', async () => {
      const serverUrl = 'http://test-server.com/sse';

      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('401 Unauthorized'));

      let capturedTransport: TransportWithInternals | undefined;
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockImplementationOnce(async (transport) => {
        capturedTransport = transport;
        return Promise.resolve();
      });

      await connectTestServer({ url: serverUrl, type: 'sse' });

      expect(capturedTransport).toBeInstanceOf(SSEClientTransport);
    });

    it('should throw error when no transport configuration is provided', async () => {
      // Empty config causes createTransport to throw "Invalid configuration"
      // before the client.connect mock is ever reached
      await expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          {}, // No url, httpUrl, or command
          false,
          workspaceContext,
        ),
      ).rejects.toThrow(/Invalid configuration/);
    });

    it('should throw error for command-based config when connect fails with 401 (no OAuth retry for stdio)', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('401 Unauthorized'));

      await expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { command: 'test-command' }, // No URL transport
          false,
          workspaceContext,
        ),
      ).rejects.toThrow(Error);
    });
  });

  // Phase C+D: State machine and hygiene tests
  describe('connectToMcpServer state machine behavior', () => {
    // Test non-401 error + url + no type -> SSE fallback attempted
    it('should attempt SSE fallback on non-401 error with url (no type)', async () => {
      const serverUrl = 'http://test-server.com/mcp';
      const mockTransport = { close: vi.fn() };

      // First connect fails with non-401 error
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('Connection refused'));

      // Second connect (SSE fallback) succeeds
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockResolvedValueOnce(undefined);

      vi.spyOn(
        StreamableHTTPClientTransport.prototype,
        'close',
      ).mockReturnValue(mockTransport.close());

      await connectToMcpServer(
        '0.0.1',
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
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('404 Not Found'));

      await expect(connectTestServer({ url: serverUrl })).rejects.toThrow(
        /404/,
      );

      // Should only try once (no SSE fallback on 404)
      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    // Test explicit type:http prevents fallback
    it('should not attempt SSE fallback when type:http is explicit', async () => {
      const serverUrl = 'http://test-server.com/http';

      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('Connection refused'));

      await expect(
        connectTestServer({ url: serverUrl, type: 'http' }),
      ).rejects.toThrow(/Connection refused/);

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

      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('Connection failed'));

      await expect(
        connectTestServer({ httpUrl: 'http://test-server.com' }),
      ).rejects.toThrow(/Connection failed/);

      expect(mockTransport.close).toHaveBeenCalled();
    });

    // Test mcpServerRequiresOAuth NOT set on non-auth failures (negative assertion)
    it('should not set mcpServerRequiresOAuth on non-auth connection failures', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('Network timeout'));

      await expect(
        connectTestServer({ httpUrl: 'http://test-server.com' }),
      ).rejects.toThrow(/Network timeout/);

      // Check that the OAuth flag wasn't set
      // This is a negative assertion - we're testing what DOESN'T happen
      const status = getMCPServerStatus('test-server');
      expect(status).not.toBe('auth-required');
    });

    // Test fallback with different 404 string variants
    it('should detect "404" string and prevent SSE fallback', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('HTTP 404'));

      await expect(
        connectTestServer({ url: 'http://test-server.com/mcp' }),
      ).rejects.toThrow(/404/);

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should detect "Not Found" string and prevent SSE fallback', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('Not Found'));

      await expect(
        connectTestServer({ url: 'http://test-server.com/mcp' }),
      ).rejects.toThrow(/Not Found/);

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    // Audit issue #1: retryWithOAuth should NOT attempt SSE fallback on 404 when type:'http' is explicit
    it('should NOT attempt SSE fallback when type:http is explicit and OAuth retry gets 404', async () => {
      const serverUrl = 'http://test-server.com/http';

      // First connect attempt: 401 Unauthorized (triggers OAuth retry)
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('401 Unauthorized'));

      // Second connect attempt (OAuth retry with HTTP): 404 Not Found
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('404 Not Found'));

      // Should fail with 404, NOT attempt SSE fallback
      await expect(
        connectToMcpServer(
          '0.0.1',
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
      (mockedClient.connect as Mock<typeof mockedClient.connect>)
        .mockRejectedValueOnce(new Error('Connection failed at port 40404'))
        .mockResolvedValueOnce(undefined); // SSE fallback succeeds

      await connectToMcpServer(
        '0.0.1',
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

      (mockedClient.connect as Mock<typeof mockedClient.connect>)
        .mockRejectedValueOnce(new Error('Server returned error code 4040'))
        .mockResolvedValueOnce(undefined); // SSE fallback succeeds

      await connectTestServer({ url: 'http://test-server.com/mcp' });

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

      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(error404);

      await expect(
        connectTestServer({ url: 'http://test-server.com/mcp' }),
      ).rejects.toThrow(/Request failed/);

      // Should NOT attempt SSE fallback because it's a real 404
      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should detect proper HTTP 404 error message format', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('HTTP 404 Not Found'));

      await expect(
        connectTestServer({ url: 'http://test-server.com/mcp' }),
      ).rejects.toThrow(/404/);

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should detect status 404 error message format', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(new Error('Request failed with status 404'));

      await expect(
        connectTestServer({ url: 'http://test-server.com/mcp' }),
      ).rejects.toThrow(/status 404/);

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('deprecated SSE endpoint detection', () => {
    const SSE_DEPRECATED_URL = 'http://test-server.com/sse';
    const SSE_REPLACEMENT_URL = 'https://mcp.test-server.com/mcp';

    it('should surface actionable error when SSE is no longer supported', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(
        new Error(`SSE is no longer supported. use ${SSE_REPLACEMENT_URL}`),
      );

      await expect(
        connectTestServer({ url: SSE_DEPRECATED_URL, type: 'sse' }),
      ).rejects.toThrow(/no longer supported/);
    });

    it('should include the suggested replacement URL in the error', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(
        new Error(`SSE is no longer supported. use ${SSE_REPLACEMENT_URL}`),
      );

      await expect(
        connectTestServer({ url: SSE_DEPRECATED_URL, type: 'sse' }),
      ).rejects.toThrow(/https:\/\/mcp\.test-server\.com\/mcp/);
    });

    it('should recommend streamable-http type in the error', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(
        new Error('SSE is no longer supported. use http://example.com/mcp'),
      );

      await expect(
        connectTestServer({ url: 'http://example.com/sse', type: 'sse' }),
      ).rejects.toThrow(/streamable-http/);
    });

    it('does not reinterpret a stdio process error as an SSE endpoint configuration error', async () => {
      (
        mockedClient.connect as Mock<typeof mockedClient.connect>
      ).mockRejectedValueOnce(
        new Error('SSE is no longer supported in this subprocess'),
      );

      await expect(
        connectTestServer({ command: 'test-command' }),
      ).rejects.toThrow(
        /Connection failed for 'test-server': SSE is no longer supported/,
      );
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
      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        '0.0.1',
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
      (
        ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
      ).mockReturnValue(mockedClient as unknown as ClientLib.Client);
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
        '0.0.1',
      );

      await mcpClient.connect();
      const instructions = mcpClient.getInstructions();
      expect(instructions).toBe('');
    });
  });
});
