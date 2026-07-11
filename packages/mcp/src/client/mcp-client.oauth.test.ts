/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';
import { MCPOAuthTokenStorage } from '../auth/oauth-token-storage.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';

import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
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

const createMockResourceRegistry = (): ResourceRegistry =>
  ({
    setResourcesForServer: vi.fn(),
    removeResourcesByServer: vi.fn(),
  }) as unknown as ResourceRegistry;
import type { TransportWithInternals } from './mcpClientTestHelpers.js';

describe('connectToMcpServer with OAuth', () => {
  let mockedClient: ClientLib.Client;
  let workspaceContext: WorkspaceContext;
  let testWorkspace: string;
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

    testWorkspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-agent-test-'),
    );
    workspaceContext = new WorkspaceContext(testWorkspace);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(coreEvents, 'emitFeedback').mockImplementation(() => {});

    mockTokenStorage = {
      getCredentials: vi.fn().mockResolvedValue({ clientId: 'test-client' }),
    } as unknown as MCPOAuthTokenStorage;

    // Mock static methods used by connectToMcpServer's OAuth flow
    vi.spyOn(MCPOAuthProvider, 'authenticate').mockResolvedValue(undefined);
    vi.spyOn(MCPOAuthProvider, 'getValidToken').mockResolvedValue(
      'test-access-token',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle automatic OAuth flow on 401 with stored token', async () => {
    const serverUrl = 'http://test-server.com/';

    mockedClient.connect.mockRejectedValueOnce(new Error('401 Unauthorized'));

    // We need this to be an any type because we dig into its private state.
    let capturedTransport: TransportWithInternals | undefined;
    mockedClient.connect.mockImplementationOnce(async (transport) => {
      capturedTransport = transport;
      return Promise.resolve();
    });

    const client = await connectToMcpServer(
      '0.0.1',
      'test-server',
      { httpUrl: serverUrl },
      false,
      workspaceContext,
      {
        createClient: () => mockedClient,
        getStoredOAuthToken: async () => 'test-access-token',
      },
    );

    expect(client).toBe(mockedClient);
    // First connect rejects with 401, second connect succeeds with stored token
    expect(mockedClient.connect).toHaveBeenCalledTimes(2);

    const authHeader =
      capturedTransport?._requestInit?.headers?.['Authorization'];
    expect(authHeader).toBe('Bearer test-access-token');
  });

  it('should show auth required message on 401 when no stored token exists', async () => {
    const serverUrl = 'http://test-server.com';

    // Mock no stored credentials so getStoredOAuthToken returns null
    mockTokenStorage.getCredentials = vi.fn().mockResolvedValue(null);

    mockedClient.connect.mockRejectedValueOnce(new Error('401 Unauthorized'));

    expect(
      connectToMcpServer(
        '0.0.1',
        'test-server',
        { httpUrl: serverUrl },
        false,
        workspaceContext,
        {
          createClient: () => mockedClient,
          getStoredOAuthToken: async () => null,
        },
      ),
    ).rejects.toThrow(/requires OAuth authentication/);

    // Only initial connect is attempted
    expect(mockedClient.connect).toHaveBeenCalledTimes(1);
  });

  // Phase B: createTransportWithOAuth parity tests (RED phase)
  const oauthConnectionDependencies = () => ({
    createClient: () => mockedClient,
    getStoredOAuthToken: async () => 'test-access-token',
  });

  describe('createTransportWithOAuth transport selection', () => {
    // Note: createTransportWithOAuth is not directly exported, but we can test
    // its behavior through connectToMcpServer and retryWithOAuth

    // EXPECTED TO PASS: httpUrl uses HTTP transport (retryWithOAuth hardcodes HTTP)
    it('should use HTTP transport for httpUrl config', async () => {
      const serverUrl = 'http://test-server.com/http';

      mockedClient.connect.mockRejectedValueOnce(new Error('401 Unauthorized'));

      let capturedTransport: TransportWithInternals | undefined;
      mockedClient.connect.mockImplementationOnce(async (transport) => {
        capturedTransport = transport;
        return Promise.resolve();
      });

      await connectToMcpServer(
        '0.0.1',
        'test-server',
        { httpUrl: serverUrl },
        false,
        workspaceContext,
        oauthConnectionDependencies(),
      );

      // Passes because retryWithOAuth uses HTTP for httpUrl
      expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    });

    // EXPECTED TO PASS (accidentally): retryWithOAuth hardcodes HTTP for url
    // This test passes but for the WRONG reason - it should respect type field
    it('should use HTTP transport for url without type (default)', async () => {
      const serverUrl = 'http://test-server.com/mcp';

      mockedClient.connect.mockRejectedValueOnce(new Error('401 Unauthorized'));

      let capturedTransport: TransportWithInternals | undefined;
      mockedClient.connect.mockImplementationOnce(async (transport) => {
        capturedTransport = transport;
        return Promise.resolve();
      });

      await connectToMcpServer(
        '0.0.1',
        'test-server',
        { url: serverUrl },
        false,
        workspaceContext,
        oauthConnectionDependencies(),
      );

      // Passes accidentally: retryWithOAuth hardcodes HTTP (should use createTransportWithOAuth)
      expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    });

    // EXPECTED TO PASS (accidentally): retryWithOAuth ignores type field
    // This test passes but for the WRONG reason - should honor type:http explicitly
    it('should use HTTP transport for url + type:http', async () => {
      const serverUrl = 'http://test-server.com/http';

      mockedClient.connect.mockRejectedValueOnce(new Error('401 Unauthorized'));

      let capturedTransport: TransportWithInternals | undefined;
      mockedClient.connect.mockImplementationOnce(async (transport) => {
        capturedTransport = transport;
        return Promise.resolve();
      });

      await connectToMcpServer(
        '0.0.1',
        'test-server',
        { url: serverUrl, type: 'http' },
        false,
        workspaceContext,
        oauthConnectionDependencies(),
      );

      // Passes accidentally: retryWithOAuth hardcodes HTTP (ignores type field)
      expect(capturedTransport).toBeInstanceOf(StreamableHTTPClientTransport);
    });

    // EXPECTED TO FAIL: type:sse not respected in createTransportWithOAuth
    it('should use SSE transport for url + type:sse', async () => {
      const serverUrl = 'http://test-server.com/sse';

      mockedClient.connect.mockRejectedValueOnce(new Error('401 Unauthorized'));

      let capturedTransport: TransportWithInternals | undefined;
      mockedClient.connect.mockImplementationOnce(async (transport) => {
        capturedTransport = transport;
        return Promise.resolve();
      });

      await connectToMcpServer(
        '0.0.1',
        'test-server',
        { url: serverUrl, type: 'sse' },
        false,
        workspaceContext,
        oauthConnectionDependencies(),
      );

      // WILL FAIL: createTransportWithOAuth ignores type:sse, uses HTTP
      expect(capturedTransport).toBeInstanceOf(SSEClientTransport);
    });

    // EXPECTED TO FAIL: currently returns null, should throw error
    it('should throw error when neither url nor httpUrl configured', async () => {
      mockedClient.connect.mockRejectedValueOnce(new Error('401 Unauthorized'));

      // WILL FAIL: current code returns null and continues, should throw
      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { command: 'test-command' }, // No URL transport
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(Error);
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
      mockedClient.connect.mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      // Second connect (SSE fallback) succeeds
      mockedClient.connect.mockResolvedValueOnce(undefined);

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
        { createClient: () => mockedClient },
      );

      // Should have tried twice: HTTP first, then SSE fallback
      expect(mockedClient.connect).toHaveBeenCalledTimes(2);
      expect(mockTransport.close).toHaveBeenCalled();
    });

    // Test 404 detection sets httpReturned404 flag
    it('should set httpReturned404 flag on 404 error and prevent SSE fallback', async () => {
      const serverUrl = 'http://test-server.com/mcp';

      // Simulate 404 error
      mockedClient.connect.mockRejectedValueOnce(new Error('404 Not Found'));

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { url: serverUrl },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(/404/);

      // Should only try once (no SSE fallback on 404)
      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    // Test explicit type:http prevents fallback
    it('should not attempt SSE fallback when type:http is explicit', async () => {
      const serverUrl = 'http://test-server.com/http';

      mockedClient.connect.mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { url: serverUrl, type: 'http' },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
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

      mockedClient.connect.mockRejectedValueOnce(
        new Error('Connection failed'),
      );

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { httpUrl: 'http://test-server.com' },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(/Connection failed/);

      expect(mockTransport.close).toHaveBeenCalled();
    });

    // Test mcpServerRequiresOAuth NOT set on non-auth failures (negative assertion)
    it('should not set mcpServerRequiresOAuth on non-auth connection failures', async () => {
      mockedClient.connect.mockRejectedValueOnce(new Error('Network timeout'));

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { httpUrl: 'http://test-server.com' },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(/Network timeout/);

      // Check that the OAuth flag wasn't set
      // This is a negative assertion - we're testing what DOESN'T happen
      const status = getMCPServerStatus('test-server');
      expect(status).not.toBe('auth-required');
    });

    // Test fallback with different 404 string variants
    it('should detect "404" string and prevent SSE fallback', async () => {
      mockedClient.connect.mockRejectedValueOnce(new Error('HTTP 404'));

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(/404/);

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should detect "Not Found" string and prevent SSE fallback', async () => {
      mockedClient.connect.mockRejectedValueOnce(new Error('Not Found'));

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(/Not Found/);

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    // Audit issue #1: retryWithOAuth should NOT attempt SSE fallback on 404 when type:'http' is explicit
    it('should NOT attempt SSE fallback when type:http is explicit and OAuth retry gets 404', async () => {
      const serverUrl = 'http://test-server.com/http';

      // First connect attempt: 401 Unauthorized (triggers OAuth retry)
      mockedClient.connect.mockRejectedValueOnce(new Error('401 Unauthorized'));

      // Second connect attempt (OAuth retry with HTTP): 404 Not Found
      mockedClient.connect.mockRejectedValueOnce(new Error('404 Not Found'));

      // Should fail with 404, NOT attempt SSE fallback
      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { url: serverUrl, type: 'http' }, // Explicit HTTP type
          false,
          workspaceContext,
          oauthConnectionDependencies(),
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
      mockedClient.connect
        .mockRejectedValueOnce(new Error('Connection failed at port 40404'))
        .mockResolvedValueOnce(undefined); // SSE fallback succeeds

      await connectToMcpServer(
        '0.0.1',
        'test-server',
        { url: 'http://test-server.com/mcp' },
        false,
        workspaceContext,
        { createClient: () => mockedClient },
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

      mockedClient.connect
        .mockRejectedValueOnce(new Error('Server returned error code 4040'))
        .mockResolvedValueOnce(undefined); // SSE fallback succeeds

      await connectToMcpServer(
        '0.0.1',
        'test-server',
        { url: 'http://test-server.com/mcp' },
        false,
        workspaceContext,
        { createClient: () => mockedClient },
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

      mockedClient.connect.mockRejectedValueOnce(error404);

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(/Request failed/);

      // Should NOT attempt SSE fallback because it's a real 404
      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('should detect proper HTTP 404 error message format', async () => {
      mockedClient.connect.mockRejectedValueOnce(
        new Error('HTTP 404 Not Found'),
      );

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(/404/);

      expect(mockedClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should detect status 404 error message format', async () => {
      mockedClient.connect.mockRejectedValueOnce(
        new Error('Request failed with status 404'),
      );

      expect(
        connectToMcpServer(
          '0.0.1',
          'test-server',
          { url: 'http://test-server.com/mcp' },
          false,
          workspaceContext,
          { createClient: () => mockedClient },
        ),
      ).rejects.toThrow(/status 404/);

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
        undefined,
        {
          createClient: () => mockedClient,
          createTransport: async () =>
            ({}) as SdkClientStdioLib.StdioClientTransport,
        },
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
        undefined,
        {
          createClient: () => mockedClient,
          createTransport: async () =>
            ({}) as SdkClientStdioLib.StdioClientTransport,
        },
      );

      await mcpClient.connect();
      const instructions = mcpClient.getInstructions();
      expect(instructions).toBe('');
    });
  });
});
