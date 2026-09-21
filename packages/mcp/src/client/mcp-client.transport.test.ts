/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '../../../test-utils/src/automock.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { AuthProviderType } from '@vybestack/llxprt-code-auth/mcp-auth-provider-type.js';

import {
  createTransport,
  hasNetworkTransport,
  isEnabled,
} from './mcp-client.js';
import {
  getTransportAuthProvider,
  getTransportHeaders,
} from './mcpClientTestHelpers.js';
import { registerMcpHostServices } from '../host/hostServices.js';
import type { McpAuthProvider } from '../auth/auth-provider.js';
import type { MCPServerConfig } from '../config/mcpServerConfig.js';
import {
  registerMcpAuthFactories,
  resetRegisteredMcpAuthFactories,
} from '../auth/mcp-auth-factory.js';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';

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

const CUSTOM_AUTH_TYPE = 'custom_auth';

const FAKE_CLIENT_METADATA: OAuthClientMetadata = {
  client_name: 'test (fake)',
  redirect_uris: [],
  grant_types: [],
  response_types: [],
  token_endpoint_auth_method: 'none',
};

/** Local auth provider double dispatched through the factory registry seam. */
class FakeAuthProvider implements McpAuthProvider {
  readonly redirectUrl = '';
  readonly clientMetadata = FAKE_CLIENT_METADATA;
  constructor(readonly config?: MCPServerConfig) {}
  clientInformation() {
    return undefined;
  }
  saveClientInformation() {}
  async tokens() {
    return undefined;
  }
  saveTokens() {}
  redirectToAuthorization() {}
  saveCodeVerifier() {}
  codeVerifier() {
    return '';
  }
  async getRequestHeaders() {
    return { 'X-Fake-Project': 'provider-project' };
  }
}

describe('mcp-client', () => {
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

      it('with type streamable-http uses HTTP transport (alias for http)', async () => {
        const transport = await createTransport(
          'test-server',
          {
            url: 'http://test-server',
            type: 'streamable-http',
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

    describe('custom authProviderType dispatch', () => {
      beforeEach(() => {
        resetRegisteredMcpAuthFactories();
      });
      afterEach(() => {
        resetRegisteredMcpAuthFactories();
      });

      it('uses the registered factory auth provider when one matches', async () => {
        registerMcpAuthFactories([
          {
            authProviderType: CUSTOM_AUTH_TYPE,
            createAuthProvider: (config) => new FakeAuthProvider(config),
          },
        ]);

        const transport = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            authProviderType: CUSTOM_AUTH_TYPE,
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        const authProvider = getTransportAuthProvider(transport);
        expect(authProvider).toBeInstanceOf(FakeAuthProvider);
      });

      it('uses headers from the factory auth provider', async () => {
        registerMcpAuthFactories([
          {
            authProviderType: CUSTOM_AUTH_TYPE,
            createAuthProvider: (config) => new FakeAuthProvider(config),
          },
        ]);

        const transport = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            authProviderType: CUSTOM_AUTH_TYPE,
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        const headers = getTransportHeaders(transport);
        expect(headers['X-Fake-Project']).toBe('provider-project');
      });

      it('prioritizes factory provider headers over config headers', async () => {
        registerMcpAuthFactories([
          {
            authProviderType: CUSTOM_AUTH_TYPE,
            createAuthProvider: (config) => new FakeAuthProvider(config),
          },
        ]);

        const transport = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            authProviderType: CUSTOM_AUTH_TYPE,
            headers: {
              'X-Fake-Project': 'config-project',
            },
          },
          false,
        );

        expect(transport).toBeInstanceOf(StreamableHTTPClientTransport);
        const headers = getTransportHeaders(transport);
        expect(headers['X-Fake-Project']).toBe('provider-project');
      });

      it('uses the factory auth provider with SSE transport', async () => {
        registerMcpAuthFactories([
          {
            authProviderType: CUSTOM_AUTH_TYPE,
            createAuthProvider: (config) => new FakeAuthProvider(config),
          },
        ]);

        const transport = await createTransport(
          'test-server',
          {
            url: 'http://test-server',
            type: 'sse',
            authProviderType: CUSTOM_AUTH_TYPE,
          },
          false,
        );

        expect(transport).toBeInstanceOf(SSEClientTransport);
        const authProvider = getTransportAuthProvider(transport);
        expect(authProvider).toBeInstanceOf(FakeAuthProvider);
      });

      it('throws a terminal error naming the server and type for an unknown custom type', async () => {
        await expect(
          createTransport(
            'test-server',
            {
              httpUrl: 'http://test-server',
              authProviderType: CUSTOM_AUTH_TYPE,
            },
            false,
          ),
        ).rejects.toThrow(/test-server.*custom_auth.*no auth provider/i);
      });

      it('does not fall back to standard OAuth for an unknown custom type', async () => {
        // oauth.enabled would previously route to the standard OAuth path;
        // the unknown custom type must remain terminal either way.
        const error = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            authProviderType: CUSTOM_AUTH_TYPE,
            oauth: { enabled: true } as MCPServerConfig['oauth'],
          },
          false,
        ).then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(
          /test-server.*custom_auth.*no auth provider/i,
        );
      });

      it('throws a terminal error naming the google plugin for google_credentials without a factory', async () => {
        await expect(
          createTransport(
            'test-server',
            {
              httpUrl: 'http://test.googleapis.com',
              authProviderType: AuthProviderType.GOOGLE_CREDENTIALS,
              oauth: {
                scopes: ['scope1'],
              },
            },
            false,
          ),
        ).rejects.toThrow(/google-mcp-auth/i);
      });

      it('throws a terminal error naming the google plugin for service_account_impersonation without a factory', async () => {
        await expect(
          createTransport(
            'test-server',
            {
              url: 'http://test.googleapis.com',
              authProviderType: AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION,
              targetAudience: 'audience',
              targetServiceAccount: 'sa@project.iam.gserviceaccount.com',
            },
            false,
          ),
        ).rejects.toThrow(/google-mcp-auth/i);
      });

      it('propagates a factory failure as a terminal error carrying the cause', async () => {
        const factoryError = new Error('factory exploded');
        registerMcpAuthFactories([
          {
            authProviderType: CUSTOM_AUTH_TYPE,
            createAuthProvider: () => {
              throw factoryError;
            },
          },
        ]);

        const error = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            authProviderType: CUSTOM_AUTH_TYPE,
          },
          false,
        ).then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/test-server.*custom_auth/i);
        expect((error as Error).cause).toBe(factoryError);
      });

      it('throws a terminal error when the factory returns undefined and never resolves OAuth', async () => {
        // A malformed JS plugin can pass manifest validation (the factory is
        // a function) yet return nothing; that must not be read as "no custom
        // authentication selected" and fall through to stored OAuth tokens.
        const getValidToken = vi
          .spyOn(MCPOAuthProvider, 'getValidToken')
          .mockResolvedValue('oauth-token-must-not-resolve');
        registerMcpAuthFactories([
          {
            authProviderType: CUSTOM_AUTH_TYPE,
            createAuthProvider: () => undefined as unknown as McpAuthProvider,
          },
        ]);

        const error = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            authProviderType: CUSTOM_AUTH_TYPE,
            oauth: { enabled: true } as MCPServerConfig['oauth'],
          },
          false,
        ).then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(
          /test-server.*custom_auth.*runtime plugin.*undefined/i,
        );
        expect(getValidToken).not.toHaveBeenCalled();
        getValidToken.mockRestore();
      });

      it('throws a terminal error when the factory returns a non-object', async () => {
        const getValidToken = vi
          .spyOn(MCPOAuthProvider, 'getValidToken')
          .mockResolvedValue('oauth-token-must-not-resolve');
        registerMcpAuthFactories([
          {
            authProviderType: CUSTOM_AUTH_TYPE,
            createAuthProvider: () =>
              'not-a-provider' as unknown as McpAuthProvider,
          },
        ]);

        const error = await createTransport(
          'test-server',
          {
            httpUrl: 'http://test-server',
            authProviderType: CUSTOM_AUTH_TYPE,
            oauth: { enabled: true } as MCPServerConfig['oauth'],
          },
          false,
        ).then(
          () => undefined,
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(
          /test-server.*custom_auth.*runtime plugin.*string/i,
        );
        expect(getValidToken).not.toHaveBeenCalled();
        getValidToken.mockRestore();
      });

      it('throws the Google Credentials missing-URL error without a factory', async () => {
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

      it('throws the ServiceAccountImpersonation missing-URL error without a factory', async () => {
        await expect(
          createTransport(
            'test-server',
            {
              authProviderType: AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION,
            },
            false,
          ),
        ).rejects.toThrow(
          'No URL configured for ServiceAccountImpersonation MCP Server',
        );
      });

      it('throws a generic missing-URL error for other custom types', async () => {
        await expect(
          createTransport(
            'test-server',
            {
              authProviderType: CUSTOM_AUTH_TYPE,
            },
            false,
          ),
        ).rejects.toThrow(/URL must be provided.*custom_auth/);
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
