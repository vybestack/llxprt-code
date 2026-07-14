/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCPOAuthProvider token, PKCE, URL, and discovery tests.
 * Split from oauth-provider.test.ts during #2092 lint hardening.
 */

import { vi } from 'vitest';

const mockOpenBrowserSecurely = vi.hoisted(() => vi.fn());
const mockHttpServer = vi.hoisted(() => ({
  listen: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  address: vi.fn(() => ({ address: 'localhost', family: 'IPv4', port: 7777 })),
}));

vi.mock('@vybestack/llxprt-code-core/utils/secure-browser-launcher.js', () => ({
  openBrowserSecurely: mockOpenBrowserSecurely,
}));
vi.mock('node:crypto');
vi.mock('node:http', () => ({
  createServer: vi.fn(() => mockHttpServer),
}));

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { MCPOAuthProvider } from './oauth-provider.js';
import {
  OAuthUtils,
  type OAuthAuthorizationServerMetadata,
} from './oauth-utils.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import {
  mockFetch,
  createMockResponse,
  mockConfig,
  mockToken,
  mockTokenResponse,
  setupOAuthTestSpies,
} from './oauthProviderTestSetup.js';

describe('MCPOAuthProvider', () => {
  let saveTokenSpy: ReturnType<typeof vi.spyOn>;
  let getCredentialsSpy: ReturnType<typeof vi.spyOn>;
  let deleteCredentialsSpy: ReturnType<typeof vi.spyOn>;
  let isTokenExpiredSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const spies = setupOAuthTestSpies(mockOpenBrowserSecurely);
    saveTokenSpy = spies.saveTokenSpy;
    getCredentialsSpy = spies.getCredentialsSpy;
    deleteCredentialsSpy = spies.deleteCredentialsSpy;
    isTokenExpiredSpy = spies.isTokenExpiredSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('refreshAccessToken', () => {
    it('should refresh token successfully', async () => {
      const refreshResponse = {
        access_token: 'new_access_token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new_refresh_token',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(refreshResponse),
          json: refreshResponse,
        }),
      );

      const result = await MCPOAuthProvider.refreshAccessToken(
        mockConfig,
        'old_refresh_token',
        'https://auth.example.com/token',
      );

      expect(result).toStrictEqual(refreshResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json, application/x-www-form-urlencoded',
          },
          body: expect.stringContaining('grant_type=refresh_token'),
        }),
      );
    });

    it('should include client secret in refresh request when available', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      await MCPOAuthProvider.refreshAccessToken(
        mockConfig,
        'refresh_token',
        'https://auth.example.com/token',
      );

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].body).toContain('client_secret=test-client-secret');
    });

    it('should handle refresh token failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 400,
          contentType: 'application/x-www-form-urlencoded',
          text: 'error=invalid_request&error_description=Invalid refresh token',
        }),
      );

      await expect(
        MCPOAuthProvider.refreshAccessToken(
          mockConfig,
          'invalid_refresh_token',
          'https://auth.example.com/token',
        ),
      ).rejects.toThrow(
        'Token refresh failed: invalid_request - Invalid refresh token',
      );
    });
  });

  describe('getValidToken', () => {
    it('should return valid token when not expired', async () => {
      const validCredentials = {
        serverName: 'test-server',
        token: mockToken,
        clientId: 'test-client-id',
        tokenUrl: 'https://auth.example.com/token',
        updatedAt: Date.now(),
      };

      getCredentialsSpy.mockResolvedValue(validCredentials);
      isTokenExpiredSpy.mockReturnValue(false);

      const result = await MCPOAuthProvider.getValidToken(
        'test-server',
        mockConfig,
      );

      expect(result).toBe('access_token_123');
    });

    it('should refresh expired token and return new token', async () => {
      const expiredCredentials = {
        serverName: 'test-server',
        token: { ...mockToken, expiresAt: Date.now() - 3600000 },
        clientId: 'test-client-id',
        tokenUrl: 'https://auth.example.com/token',
        updatedAt: Date.now(),
      };

      getCredentialsSpy.mockResolvedValue(expiredCredentials);
      isTokenExpiredSpy.mockReturnValue(true);

      const refreshResponse = {
        access_token: 'new_access_token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'new_refresh_token',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(refreshResponse),
          json: refreshResponse,
        }),
      );

      const result = await MCPOAuthProvider.getValidToken(
        'test-server',
        mockConfig,
      );

      expect(result).toBe('new_access_token');
      expect(saveTokenSpy).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ accessToken: 'new_access_token' }),
        'test-client-id',
        'https://auth.example.com/token',
        undefined,
      );
    });

    it('should return null when no credentials exist', async () => {
      getCredentialsSpy.mockResolvedValue(null);

      const result = await MCPOAuthProvider.getValidToken(
        'test-server',
        mockConfig,
      );

      expect(result).toBeNull();
    });

    it('should handle refresh failure and remove invalid token', async () => {
      const expiredCredentials = {
        serverName: 'test-server',
        token: { ...mockToken, expiresAt: Date.now() - 3600000 },
        clientId: 'test-client-id',
        tokenUrl: 'https://auth.example.com/token',
        updatedAt: Date.now(),
      };

      getCredentialsSpy.mockResolvedValue(expiredCredentials);
      isTokenExpiredSpy.mockReturnValue(true);
      deleteCredentialsSpy.mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: false,
          status: 400,
          contentType: 'application/x-www-form-urlencoded',
          text: 'error=invalid_request&error_description=Invalid refresh token',
        }),
      );

      const result = await MCPOAuthProvider.getValidToken(
        'test-server',
        mockConfig,
      );

      expect(result).toBeNull();
      expect(deleteCredentialsSpy).toHaveBeenCalledWith('test-server');
      expect(DebugLogger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to refresh token'),
      );
    });

    it('should return null for token without refresh capability', async () => {
      const tokenWithoutRefresh = {
        serverName: 'test-server',
        token: {
          ...mockToken,
          refreshToken: undefined,
          expiresAt: Date.now() - 3600000,
        },
        clientId: 'test-client-id',
        tokenUrl: 'https://auth.example.com/token',
        updatedAt: Date.now(),
      };

      getCredentialsSpy.mockResolvedValue(tokenWithoutRefresh);
      isTokenExpiredSpy.mockReturnValue(true);

      const result = await MCPOAuthProvider.getValidToken(
        'test-server',
        mockConfig,
      );

      expect(result).toBeNull();
    });
  });

  describe('PKCE parameter generation', () => {
    it('should generate valid PKCE parameters', async () => {
      // Test is implicit in the authenticate flow tests, but we can verify
      // the crypto mocks are called correctly
      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        setTimeout(() => {
          const mockReq = {
            url: '/oauth/callback?code=auth_code_123&state=bW9ja19zdGF0ZV8xNl9ieXRlcw',
          };
          const mockRes = {
            writeHead: vi.fn(),
            end: vi.fn(),
          };
          (callbackHandler as (req: unknown, res: unknown) => void)(
            mockReq,
            mockRes,
          );
        }, 10);
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      await MCPOAuthProvider.authenticate('test-server', mockConfig);

      expect(crypto.randomBytes).toHaveBeenCalledWith(64); // code verifier
      expect(crypto.randomBytes).toHaveBeenCalledWith(16); // state
      expect(crypto.createHash).toHaveBeenCalledWith('sha256');
    });
  });

  describe('Authorization URL building', () => {
    it('should build correct authorization URL with all parameters', async () => {
      // Mock to capture the URL that would be opened
      let capturedUrl: string | undefined;
      mockOpenBrowserSecurely.mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve();
      });

      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        setTimeout(() => {
          const mockReq = {
            url: '/oauth/callback?code=auth_code_123&state=bW9ja19zdGF0ZV8xNl9ieXRlcw',
          };
          const mockRes = {
            writeHead: vi.fn(),
            end: vi.fn(),
          };
          (callbackHandler as (req: unknown, res: unknown) => void)(
            mockReq,
            mockRes,
          );
        }, 10);
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      await MCPOAuthProvider.authenticate(
        'test-server',
        mockConfig,
        'https://auth.example.com',
      );

      expect(capturedUrl).toBeDefined();
      expect(capturedUrl!).toContain('response_type=code');
      expect(capturedUrl!).toContain('client_id=test-client-id');
      expect(capturedUrl!).toContain('code_challenge=code_challenge_mock');
      expect(capturedUrl!).toContain('code_challenge_method=S256');
      expect(capturedUrl!).toContain('scope=read+write');
      expect(capturedUrl!).toContain('resource=https%3A%2F%2Fauth.example.com');
      expect(capturedUrl!).toContain('audience=https%3A%2F%2Fapi.example.com');
    });

    it('should correctly append parameters to an authorization URL that already has query params', async () => {
      // Mock to capture the URL that would be opened
      let capturedUrl: string;
      mockOpenBrowserSecurely.mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve();
      });

      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        setTimeout(() => {
          const mockReq = {
            url: '/oauth/callback?code=auth_code_123&state=bW9ja19zdGF0ZV8xNl9ieXRlcw',
          };
          const mockRes = {
            writeHead: vi.fn(),
            end: vi.fn(),
          };
          (callbackHandler as (req: unknown, res: unknown) => void)(
            mockReq,
            mockRes,
          );
        }, 10);
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      const configWithParamsInUrl = {
        ...mockConfig,
        authorizationUrl: 'https://auth.example.com/authorize?audience=1234',
      };

      await MCPOAuthProvider.authenticate('test-server', configWithParamsInUrl);

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('audience')).toBe('1234');
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.search.startsWith('?audience=1234&')).toBe(true);
    });

    it('should correctly append parameters to a URL with a fragment', async () => {
      // Mock to capture the URL that would be opened
      let capturedUrl: string;
      mockOpenBrowserSecurely.mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve();
      });

      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        setTimeout(() => {
          const mockReq = {
            url: '/oauth/callback?code=auth_code_123&state=bW9ja19zdGF0ZV8xNl9ieXRlcw',
          };
          const mockRes = {
            writeHead: vi.fn(),
            end: vi.fn(),
          };
          (callbackHandler as (req: unknown, res: unknown) => void)(
            mockReq,
            mockRes,
          );
        }, 10);
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      const configWithFragment = {
        ...mockConfig,
        authorizationUrl: 'https://auth.example.com/authorize#login',
      };

      await MCPOAuthProvider.authenticate('test-server', configWithFragment);

      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('client_id')).toBe('test-client-id');
      expect(url.hash).toBe('#login');
      expect(url.pathname).toBe('/authorize');
    });

    it('should use user-configured scopes over discovered scopes', async () => {
      let capturedUrl: string | undefined;
      mockOpenBrowserSecurely.mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve();
      });

      const configWithUserScopes: MCPOAuthConfig = {
        ...mockConfig,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scopes: ['user-scope'],
      };
      delete configWithUserScopes.authorizationUrl;
      delete configWithUserScopes.tokenUrl;

      const mockResourceMetadata = {
        resource: 'https://api.example.com/',
        authorization_servers: ['https://discovered.auth.com'],
      };

      const mockAuthServerMetadata = {
        authorization_endpoint: 'https://discovered.auth.com/authorize',
        token_endpoint: 'https://discovered.auth.com/token',
        scopes_supported: ['discovered-scope'],
      };

      mockFetch
        .mockResolvedValueOnce(createMockResponse({ ok: true, status: 200 }))
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            contentType: 'application/json',
            text: JSON.stringify(mockResourceMetadata),
            json: mockResourceMetadata,
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            contentType: 'application/json',
            text: JSON.stringify(mockAuthServerMetadata),
            json: mockAuthServerMetadata,
          }),
        );

      // Setup callback handler
      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        setTimeout(() => {
          const mockReq = {
            url: '/oauth/callback?code=auth_code&state=bW9ja19zdGF0ZV8xNl9ieXRlcw',
          };
          const mockRes = { writeHead: vi.fn(), end: vi.fn() };
          (callbackHandler as (req: unknown, res: unknown) => void)(
            mockReq,
            mockRes,
          );
        }, 10);
      });

      // Mock token exchange
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      await MCPOAuthProvider.authenticate(
        'test-server',
        configWithUserScopes,
        'https://api.example.com',
      );

      expect(capturedUrl).toBeDefined();
      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('scope')).toBe('user-scope');
    });

    it('should use discovered scopes when no user-configured scopes are provided', async () => {
      let capturedUrl: string | undefined;
      mockOpenBrowserSecurely.mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve();
      });

      const configWithoutScopes: MCPOAuthConfig = {
        ...mockConfig,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      };
      delete configWithoutScopes.scopes;
      delete configWithoutScopes.authorizationUrl;
      delete configWithoutScopes.tokenUrl;

      const mockResourceMetadata = {
        resource: 'https://api.example.com/',
        authorization_servers: ['https://discovered.auth.com'],
      };

      const mockAuthServerMetadata = {
        authorization_endpoint: 'https://discovered.auth.com/authorize',
        token_endpoint: 'https://discovered.auth.com/token',
        scopes_supported: ['discovered-scope-1', 'discovered-scope-2'],
      };

      mockFetch
        .mockResolvedValueOnce(createMockResponse({ ok: true, status: 200 }))
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            contentType: 'application/json',
            text: JSON.stringify(mockResourceMetadata),
            json: mockResourceMetadata,
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            contentType: 'application/json',
            text: JSON.stringify(mockAuthServerMetadata),
            json: mockAuthServerMetadata,
          }),
        );

      // Setup callback handler
      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        setTimeout(() => {
          const mockReq = {
            url: '/oauth/callback?code=auth_code&state=bW9ja19zdGF0ZV8xNl9ieXRlcw',
          };
          const mockRes = { writeHead: vi.fn(), end: vi.fn() };
          (callbackHandler as (req: unknown, res: unknown) => void)(
            mockReq,
            mockRes,
          );
        }, 10);
      });

      // Mock token exchange
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      await MCPOAuthProvider.authenticate(
        'test-server',
        configWithoutScopes,
        'https://api.example.com',
      );

      expect(capturedUrl).toBeDefined();
      const url = new URL(capturedUrl!);
      expect(url.searchParams.get('scope')).toBe(
        'discovered-scope-1 discovered-scope-2',
      );
    });
  });

  describe('issuer discovery conformance', () => {
    const registrationMetadata: OAuthAuthorizationServerMetadata = {
      issuer: 'http://localhost:8888/realms/my-realm',
      authorization_endpoint:
        'http://localhost:8888/realms/my-realm/protocol/openid-connect/auth',
      token_endpoint:
        'http://localhost:8888/realms/my-realm/protocol/openid-connect/token',
      registration_endpoint:
        'http://localhost:8888/realms/my-realm/clients-registrations/openid-connect',
    };

    it('falls back to path-based issuer when origin discovery fails', async () => {
      // Access the static private method on the class itself
      const providerWithAccess = MCPOAuthProvider as unknown as {
        discoverAuthServerMetadataForRegistration: (
          authorizationUrl: string,
        ) => Promise<{
          issuerUrl: string;
          metadata: OAuthAuthorizationServerMetadata;
        }>;
      };

      vi.spyOn(
        OAuthUtils,
        'discoverAuthorizationServerMetadata',
      ).mockImplementation(async (issuer) => {
        if (issuer === 'http://localhost:8888/realms/my-realm') {
          return registrationMetadata;
        }
        return null;
      });

      const result =
        await providerWithAccess.discoverAuthServerMetadataForRegistration(
          'http://localhost:8888/realms/my-realm/protocol/openid-connect/auth',
        );

      expect(
        vi.mocked(OAuthUtils.discoverAuthorizationServerMetadata).mock.calls,
      ).toStrictEqual([
        ['http://localhost:8888'],
        ['http://localhost:8888/realms/my-realm'],
      ]);
      expect(result.issuerUrl).toBe('http://localhost:8888/realms/my-realm');
      expect(result.metadata).toBe(registrationMetadata);
    });

    it('trims versioned segments from authorization endpoints', async () => {
      // Access the static private method on the class itself
      const providerWithAccess = MCPOAuthProvider as unknown as {
        discoverAuthServerMetadataForRegistration: (
          authorizationUrl: string,
        ) => Promise<{
          issuerUrl: string;
          metadata: OAuthAuthorizationServerMetadata;
        }>;
      };

      const oktaMetadata: OAuthAuthorizationServerMetadata = {
        issuer: 'https://auth.okta.local/oauth2/default',
        authorization_endpoint:
          'https://auth.okta.local/oauth2/default/v1/authorize',
        token_endpoint: 'https://auth.okta.local/oauth2/default/v1/token',
        registration_endpoint:
          'https://auth.okta.local/oauth2/default/v1/register',
      };

      const attempts: string[] = [];
      vi.spyOn(
        OAuthUtils,
        'discoverAuthorizationServerMetadata',
      ).mockImplementation(async (issuer) => {
        attempts.push(issuer);
        if (issuer === 'https://auth.okta.local/oauth2/default') {
          return oktaMetadata;
        }
        return null;
      });

      const result =
        await providerWithAccess.discoverAuthServerMetadataForRegistration(
          'https://auth.okta.local/oauth2/default/v1/authorize',
        );

      expect(attempts).toStrictEqual([
        'https://auth.okta.local',
        'https://auth.okta.local/oauth2/default/v1',
        'https://auth.okta.local/oauth2/default',
      ]);
      expect(result.issuerUrl).toBe('https://auth.okta.local/oauth2/default');
      expect(result.metadata).toBe(oktaMetadata);
    });
  });
});
