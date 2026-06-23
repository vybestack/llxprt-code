/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCPOAuthProvider authenticate tests.
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
import { MCPOAuthProvider } from './oauth-provider.js';
import {
  mockFetch,
  createMockResponse,
  mockConfig,
  mockTokenResponse,
  setupOAuthTestSpies,
} from './oauthProviderTestSetup.js';

describe('MCPOAuthProvider', () => {
  let saveTokenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const spies = setupOAuthTestSpies(mockOpenBrowserSecurely);
    saveTokenSpy = spies.saveTokenSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('authenticate', () => {
    it('should perform complete OAuth flow with PKCE', async () => {
      // Mock HTTP server callback
      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        // Simulate OAuth callback
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

      // Mock token exchange
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      const result = await MCPOAuthProvider.authenticate(
        'test-server',
        mockConfig,
      );

      expect(result).toStrictEqual({
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_456',
        tokenType: 'Bearer',
        scope: 'read write',
        expiresAt: expect.any(Number),
      });

      expect(mockOpenBrowserSecurely).toHaveBeenCalledWith(
        expect.stringContaining('authorize'),
      );
      expect(saveTokenSpy).toHaveBeenCalledWith(
        'test-server',
        expect.objectContaining({ accessToken: 'access_token_123' }),
        'test-client-id',
        'https://auth.example.com/token',
        undefined,
      );
    });

    it('should handle OAuth discovery when no authorization URL provided', async () => {
      // Use a mutable config object
      const configWithoutAuth: MCPOAuthConfig = {
        ...mockConfig,
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      };
      delete configWithoutAuth.authorizationUrl;
      delete configWithoutAuth.tokenUrl;

      const mockResourceMetadata = {
        resource: 'https://api.example.com/',
        authorization_servers: ['https://discovered.auth.com'],
      };

      const mockAuthServerMetadata = {
        authorization_endpoint: 'https://discovered.auth.com/authorize',
        token_endpoint: 'https://discovered.auth.com/token',
        scopes_supported: ['read', 'write'],
      };

      // Mock HEAD request for WWW-Authenticate check
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 200,
          }),
        )
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

      // Mock token exchange with discovered endpoint
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      const result = await MCPOAuthProvider.authenticate(
        'test-server',
        configWithoutAuth,
        'https://api.example.com',
      );

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discovered.auth.com/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        }),
      );
    });

    it('should perform dynamic client registration when no client ID is provided but registration URL is provided', async () => {
      const configWithoutClient: MCPOAuthConfig = {
        ...mockConfig,
        registrationUrl: 'https://auth.example.com/register',
      };
      delete configWithoutClient.clientId;

      const mockRegistrationResponse: OAuthClientRegistrationResponse = {
        client_id: 'dynamic_client_id',
        client_secret: 'dynamic_client_secret',
        redirect_uris: ['http://localhost:7777/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockRegistrationResponse),
          json: mockRegistrationResponse,
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

      // Mock token exchange
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      const result = await MCPOAuthProvider.authenticate(
        'test-server',
        configWithoutClient,
      );

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/register',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should perform OAuth discovery and dynamic client registration when no client ID or registration URL provided', async () => {
      const configWithoutClient: MCPOAuthConfig = { ...mockConfig };
      delete configWithoutClient.clientId;

      const mockRegistrationResponse: OAuthClientRegistrationResponse = {
        client_id: 'dynamic_client_id',
        client_secret: 'dynamic_client_secret',
        redirect_uris: ['http://localhost:7777/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };

      const mockAuthServerMetadata: OAuthAuthorizationServerMetadata = {
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        registration_endpoint: 'https://auth.example.com/register',
      };

      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            contentType: 'application/json',
            text: JSON.stringify(mockAuthServerMetadata),
            json: mockAuthServerMetadata,
          }),
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            contentType: 'application/json',
            text: JSON.stringify(mockRegistrationResponse),
            json: mockRegistrationResponse,
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

      // Mock token exchange
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      const result = await MCPOAuthProvider.authenticate(
        'test-server',
        configWithoutClient,
      );

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/register',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should perform OAuth discovery once and dynamic client registration when no client ID, authorization URL or registration URL provided', async () => {
      const configWithoutClientAndAuthorizationUrl: MCPOAuthConfig = {
        ...mockConfig,
      };
      delete configWithoutClientAndAuthorizationUrl.clientId;
      delete configWithoutClientAndAuthorizationUrl.authorizationUrl;

      const mockResourceMetadata: OAuthProtectedResourceMetadata = {
        resource: 'https://api.example.com/',
        authorization_servers: ['https://auth.example.com'],
      };

      const mockAuthServerMetadata: OAuthAuthorizationServerMetadata = {
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        registration_endpoint: 'https://auth.example.com/register',
      };

      const mockRegistrationResponse: OAuthClientRegistrationResponse = {
        client_id: 'dynamic_client_id',
        client_secret: 'dynamic_client_secret',
        redirect_uris: ['http://localhost:7777/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };

      mockFetch
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            status: 200,
          }),
        )
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
        )
        .mockResolvedValueOnce(
          createMockResponse({
            ok: true,
            contentType: 'application/json',
            text: JSON.stringify(mockRegistrationResponse),
            json: mockRegistrationResponse,
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

      // Mock token exchange
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      const result = await MCPOAuthProvider.authenticate(
        'test-server',
        configWithoutClientAndAuthorizationUrl,
        'https://api.example.com',
      );

      expect(result).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/register',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('should handle OAuth callback errors', async () => {
      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        setTimeout(() => {
          const mockReq = {
            url: '/oauth/callback?error=access_denied&error_description=User%20denied%20access',
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

      await expect(
        MCPOAuthProvider.authenticate('test-server', mockConfig),
      ).rejects.toThrow('OAuth error: access_denied');
    });

    it('should handle state mismatch in callback', async () => {
      let callbackHandler: unknown;
      vi.mocked(http.createServer).mockImplementation((handler) => {
        callbackHandler = handler;
        return mockHttpServer as unknown as http.Server;
      });

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        setTimeout(() => {
          const mockReq = {
            url: '/oauth/callback?code=auth_code_123&state=wrong_state',
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

      await expect(
        MCPOAuthProvider.authenticate('test-server', mockConfig),
      ).rejects.toThrow('State mismatch - possible CSRF attack');
    });

    it('should handle token exchange failure', async () => {
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
          ok: false,
          status: 400,
          contentType: 'application/x-www-form-urlencoded',
          text: 'error=invalid_grant&error_description=Invalid grant',
        }),
      );

      await expect(
        MCPOAuthProvider.authenticate('test-server', mockConfig),
      ).rejects.toThrow('Token exchange failed: invalid_grant - Invalid grant');
    });

    it('should handle callback timeout', async () => {
      vi.mocked(http.createServer).mockImplementation(
        () => mockHttpServer as unknown as http.Server,
      );

      mockHttpServer.listen.mockImplementation((port, callback) => {
        callback?.();
        // Don't trigger callback - simulate timeout
      });

      // Mock setTimeout to trigger timeout immediately
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = vi.fn((callback, delay) => {
        if (delay === 5 * 60 * 1000) {
          // 5 minute timeout
          callback();
        }
        return originalSetTimeout(callback, 0);
      }) as unknown as typeof setTimeout;

      await expect(
        MCPOAuthProvider.authenticate('test-server', mockConfig),
      ).rejects.toThrow('OAuth callback timeout');

      global.setTimeout = originalSetTimeout;
    });

    it('should use port from redirectUri if provided', async () => {
      const configWithPort: MCPOAuthConfig = {
        ...mockConfig,
        redirectUri: 'http://localhost:12345/oauth/callback',
      };

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
      mockHttpServer.address.mockReturnValue({
        port: 12345,
        address: '127.0.0.1',
        family: 'IPv4',
      });

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          contentType: 'application/json',
          text: JSON.stringify(mockTokenResponse),
          json: mockTokenResponse,
        }),
      );

      await MCPOAuthProvider.authenticate('test-server', configWithPort);

      expect(mockHttpServer.listen).toHaveBeenCalledWith(
        12345,
        expect.any(Function),
      );
    });

    it('should ignore invalid ports in redirectUri', async () => {
      const configWithInvalidPort: MCPOAuthConfig = {
        ...mockConfig,
        redirectUri: 'http://localhost:invalid/oauth/callback',
      };

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

      await MCPOAuthProvider.authenticate('test-server', configWithInvalidPort);

      // Should be called with 0 (OS assigned) because the port was invalid
      expect(mockHttpServer.listen).toHaveBeenCalledWith(
        0,
        expect.any(Function),
      );
    });

    it('should not default to privileged ports when redirectUri has no port', async () => {
      const configNoPort: MCPOAuthConfig = {
        ...mockConfig,
        redirectUri: 'http://localhost/oauth/callback',
      };

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

      await MCPOAuthProvider.authenticate('test-server', configNoPort);

      // Should be called with 0 (OS assigned), not 80
      expect(mockHttpServer.listen).toHaveBeenCalledWith(
        0,
        expect.any(Function),
      );
    });
  });
});
