/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import {
  performLogin,
  getOauthClient,
  authWithCode,
  clearOauthClientCache,
} from './oauth2.js';
import { Config } from '../config/config.js';
import { AuthType } from '../core/contentGenerator.js';
import readline from 'node:readline';
import open from 'open';
import { FatalAuthenticationError } from '../utils/errors.js';
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'http';

const httpServerState: {
  handler?: (req: IncomingMessage, res: ServerResponse) => unknown;
} = {};

vi.mock('http', () => ({
  createServer: vi.fn(
    (handler: (req: IncomingMessage, res: ServerResponse) => unknown) => {
      httpServerState.handler = handler;
      return {
        listen: vi.fn((_port: number, _host: string, callback?: () => void) => {
          callback?.();
        }),
        on: vi.fn(),
        close: vi.fn(),
      };
    },
  ),
}));

vi.mock('google-auth-library');
vi.mock('node:readline');
vi.mock('open');
vi.mock('../utils/userAccountManager.js');
vi.mock('../services/ClipboardService.js');
vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    chmod: vi.fn(),
    access: vi.fn(),
  },
}));
vi.mock('../config/storage.js', () => ({
  Storage: {
    getOAuthCredsPath: vi.fn().mockReturnValue('/test/oauth/creds.json'),
    getMcpOAuthTokensPath: vi
      .fn()
      .mockReturnValue('/test/oauth/mcp-tokens.json'),
  },
}));

describe('OAuth2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOauthClientCache();
    httpServerState.handler = undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ email: 'user@example.com' }),
      }),
    );

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock fs to prevent actual file operations
    (fs.stat as Mock).mockRejectedValue(new Error('File does not exist'));
    (fs.readFile as Mock).mockRejectedValue(new Error('File does not exist'));
    (fs.writeFile as Mock).mockResolvedValue(undefined);
    (fs.mkdir as Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function triggerOAuthCallback(query: string): Promise<void> {
    const handler = httpServerState.handler;
    if (!handler) {
      throw new Error('OAuth callback handler not registered');
    }

    const req = {
      url: `/oauth2callback${query}`,
    } as unknown as IncomingMessage;
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as ServerResponse;

    await handler(req, res);
  }

  it('should perform login with user code', async () => {
    const mockConfigWithNoBrowser = {
      getNoBrowser: () => true,
      getProxy: () => 'http://test.proxy.com:8080',
      isBrowserLaunchSuppressed: () => true,
    } as unknown as Config;

    const mockCodeVerifier = {
      codeChallenge: 'test-challenge',
      codeVerifier: 'test-verifier',
    };
    const mockAuthUrl = 'https://example.com/auth-user-code';
    const mockCode = 'test-user-code';
    const mockTokens = {
      access_token: 'test-access-token-user-code',
      refresh_token: 'test-refresh-token-user-code',
    };

    const mockGenerateAuthUrl = vi.fn().mockReturnValue(mockAuthUrl);
    const mockGetToken = vi.fn().mockResolvedValue({ tokens: mockTokens });
    const mockSetCredentials = vi.fn();
    const mockGenerateCodeVerifierAsync = vi
      .fn()
      .mockResolvedValue(mockCodeVerifier);

    const mockOAuth2Client = {
      generateAuthUrl: mockGenerateAuthUrl,
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
      generateCodeVerifierAsync: mockGenerateCodeVerifierAsync,
      on: vi.fn(),
    } as unknown as OAuth2Client;
    (OAuth2Client as unknown as Mock).mockImplementation(
      () => mockOAuth2Client,
    );

    const mockReadline = {
      question: vi.fn((_query, callback) => callback(mockCode)),
      close: vi.fn(),
    };
    (readline.createInterface as unknown as Mock).mockReturnValue(mockReadline);

    const result = await performLogin(
      AuthType.LOGIN_WITH_GOOGLE,
      mockConfigWithNoBrowser,
    );
    expect(result).toBe(true);

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/cloud-platform',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ],
        code_challenge_method: 'S256',
        code_challenge: mockCodeVerifier.codeChallenge,
        redirect_uri: 'https://codeassist.google.com/authcode',
      }),
    );

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Code Assist login required.'),
    );
    expect(mockReadline.question).toHaveBeenCalledWith(
      expect.stringContaining('authorization code'),
      expect.any(Function),
    );
    expect(mockGetToken).toHaveBeenCalledWith({
      code: mockCode,
      codeVerifier: mockCodeVerifier.codeVerifier,
      redirect_uri: 'https://codeassist.google.com/authcode',
    });
    expect(mockSetCredentials).toHaveBeenCalledWith(mockTokens);
  });

  it('should perform login with web browser', async () => {
    const mockConfig = {
      getNoBrowser: () => false,
      getProxy: () => 'http://test.proxy.com:8080',
      isBrowserLaunchSuppressed: () => false,
      isInteractive: () => false,
    } as unknown as Config;

    const mockCodeVerifier = {
      codeChallenge: 'test-challenge',
      codeVerifier: 'test-verifier',
    };
    const mockAuthUrl = 'https://example.com/auth-browser';
    const _mockCode = 'test-browser-code';
    const mockTokens = {
      access_token: 'test-access-token-browser',
      refresh_token: 'test-refresh-token-browser',
    };

    const mockGenerateAuthUrl = vi.fn().mockReturnValue(mockAuthUrl);
    const mockGetToken = vi.fn().mockResolvedValue({ tokens: mockTokens });
    const mockSetCredentials = vi.fn();
    const mockGenerateCodeVerifierAsync = vi
      .fn()
      .mockResolvedValue(mockCodeVerifier);

    const mockOAuth2Client = {
      generateAuthUrl: mockGenerateAuthUrl,
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
      generateCodeVerifierAsync: mockGenerateCodeVerifierAsync,
      on: vi.fn(),
    } as unknown as OAuth2Client;
    (OAuth2Client as unknown as Mock).mockImplementation(
      () => mockOAuth2Client,
    );

    (open as unknown as Mock).mockResolvedValue({ on: vi.fn() });

    const loginPromise = performLogin(AuthType.LOGIN_WITH_GOOGLE, mockConfig);

    await vi.waitFor(() => {
      expect(mockGenerateAuthUrl).toHaveBeenCalled();
    });

    const stateArg = (
      mockGenerateAuthUrl.mock.calls[0]?.[0] as { state: string } | undefined
    )?.state;
    expect(stateArg).toBeDefined();

    await triggerOAuthCallback(
      `?code=${encodeURIComponent(_mockCode)}&state=${stateArg}`,
    );

    const result = await loginPromise;
    expect(result).toBe(true);

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com/auth'),
    );
    expect(mockSetCredentials).toHaveBeenCalledWith(mockTokens);
  });

  it('should handle browser open error gracefully with helpful message', async () => {
    const mockConfig = {
      getNoBrowser: () => false,
      getProxy: () => 'http://test.proxy.com:8080',
      isBrowserLaunchSuppressed: () => false,
      isInteractive: () => false,
    } as unknown as Config;

    const mockOAuth2Client = {
      generateAuthUrl: vi.fn().mockReturnValue('https://example.com/auth'),
      generateCodeVerifierAsync: vi
        .fn()
        .mockResolvedValue({ codeChallenge: 'test', codeVerifier: 'test' }),
      on: vi.fn(),
    } as unknown as OAuth2Client;
    (OAuth2Client as unknown as Mock).mockImplementation(
      () => mockOAuth2Client,
    );

    // Mock open to throw an error
    const mockError = new Error('Browser failed to open');
    (open as unknown as Mock).mockRejectedValue(mockError);

    await expect(
      performLogin(AuthType.LOGIN_WITH_GOOGLE, mockConfig),
    ).rejects.toThrow(FatalAuthenticationError);
    await expect(
      performLogin(AuthType.LOGIN_WITH_GOOGLE, mockConfig),
    ).rejects.toThrow('Failed to open browser: Browser failed to open');

    expect(console.error).toHaveBeenCalledWith(
      'An unexpected error occurred while trying to open the browser:',
      'Browser failed to open',
      expect.stringContaining(
        'This might be due to browser compatibility issues',
      ),
      expect.stringContaining('NO_BROWSER=true'),
    );
  });

  it('should handle authentication timeout gracefully', async () => {
    const mockConfig = {
      getNoBrowser: () => false,
      getProxy: () => 'http://test.proxy.com:8080',
      isBrowserLaunchSuppressed: () => false,
      isInteractive: () => false,
    } as unknown as Config;

    const mockOAuth2Client = {
      generateAuthUrl: vi.fn().mockReturnValue('https://example.com/auth'),
      generateCodeVerifierAsync: vi
        .fn()
        .mockResolvedValue({ codeChallenge: 'test', codeVerifier: 'test' }),
      on: vi.fn(),
    } as unknown as OAuth2Client;
    (OAuth2Client as unknown as Mock).mockImplementation(
      () => mockOAuth2Client,
    );

    (open as unknown as Mock).mockResolvedValue({ on: vi.fn() });

    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: TimerHandler) => {
        if (typeof callback === 'function') {
          callback();
        }
        return 0 as unknown as NodeJS.Timeout;
      });

    try {
      await expect(
        performLogin(AuthType.LOGIN_WITH_GOOGLE, mockConfig),
      ).rejects.toThrow('Authentication timed out after 5 minutes');
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('should handle authentication code exchange error with descriptive message', async () => {
    const mockCode = 'test-code';
    const mockCodeVerifier = {
      codeVerifier: 'test-verifier',
    };
    const mockRedirectUri = 'http://localhost:3000/oauth2callback';

    const mockError = new Error('Invalid authorization code');
    const mockGetToken = vi.fn().mockRejectedValue(mockError);
    const mockSetCredentials = vi.fn();

    const mockOAuth2Client = {
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
    } as unknown as OAuth2Client;

    const result = await authWithCode(
      mockOAuth2Client,
      mockCode,
      mockCodeVerifier,
      mockRedirectUri,
    );

    expect(result).toBe(false);
    expect(mockGetToken).toHaveBeenCalledWith({
      code: mockCode,
      codeVerifier: mockCodeVerifier.codeVerifier,
      redirect_uri: mockRedirectUri,
    });
    expect(console.error).toHaveBeenCalledWith(
      'Failed to authenticate with authorization code:',
      'Invalid authorization code',
    );
    expect(mockSetCredentials).not.toHaveBeenCalled();
  });

  it('should handle successful authentication code exchange', async () => {
    const mockCode = 'test-code';
    const mockCodeVerifier = {
      codeVerifier: 'test-verifier',
    };
    const mockRedirectUri = 'http://localhost:3000/oauth2callback';
    const mockTokens = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
    };

    const mockGetToken = vi.fn().mockResolvedValue({ tokens: mockTokens });
    const mockSetCredentials = vi.fn();

    const mockOAuth2Client = {
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
    } as unknown as OAuth2Client;

    const result = await authWithCode(
      mockOAuth2Client,
      mockCode,
      mockCodeVerifier,
      mockRedirectUri,
    );

    expect(result).toBe(true);
    expect(mockGetToken).toHaveBeenCalledWith({
      code: mockCode,
      codeVerifier: mockCodeVerifier.codeVerifier,
      redirect_uri: mockRedirectUri,
    });
    expect(mockSetCredentials).toHaveBeenCalledWith(mockTokens);
  });

  it('should handle USE_NONE auth type', async () => {
    await expect(
      getOauthClient(AuthType.USE_NONE, {} as Config),
    ).rejects.toThrow('OAuth not required for USE_NONE auth type');
  });

  it('should handle GCA environment with access token', async () => {
    process.env.GOOGLE_GENAI_USE_GCA = 'true';
    process.env.GOOGLE_CLOUD_ACCESS_TOKEN = 'test-gca-token';

    const mockConfig = {
      getProxy: () => 'http://test.proxy.com:8080',
      isBrowserLaunchSuppressed: () => false,
      isInteractive: () => false,
    } as unknown as Config;

    const mockSetCredentials = vi.fn();
    const mockOAuth2Client = {
      setCredentials: mockSetCredentials,
      on: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue({ token: undefined }),
      generateAuthUrl: vi.fn(),
    } as unknown as OAuth2Client;
    (OAuth2Client as unknown as Mock).mockImplementation(
      () => mockOAuth2Client,
    );

    const client = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);

    expect(client).toBe(mockOAuth2Client);
    expect(mockSetCredentials).toHaveBeenCalledWith({
      access_token: 'test-gca-token',
    });

    delete process.env.GOOGLE_GENAI_USE_GCA;
    delete process.env.GOOGLE_CLOUD_ACCESS_TOKEN;
  });

  it('should load cached credentials successfully', async () => {
    const mockConfig = {
      getProxy: () => 'http://test.proxy.com:8080',
      isBrowserLaunchSuppressed: () => false,
      isInteractive: () => false,
    } as unknown as Config;

    const mockCachedCredentials = {
      refresh_token: 'cached-refresh-token',
      access_token: 'cached-access-token',
    };

    (fs.readFile as Mock).mockResolvedValueOnce(
      JSON.stringify(mockCachedCredentials),
    );

    const mockSetCredentials = vi.fn();
    const mockOAuth2Client = {
      setCredentials: mockSetCredentials,
      on: vi.fn(),
    } as unknown as OAuth2Client;
    (OAuth2Client as unknown as Mock).mockImplementation(
      () => mockOAuth2Client,
    );

    await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);

    expect(mockSetCredentials).toHaveBeenCalledWith(mockCachedCredentials);
  });

  it('should handle corrupted cached credentials with debug logging', async () => {
    const mockConfig = {
      getProxy: () => 'http://test.proxy.com:8080',
      getNoBrowser: () => false,
      isBrowserLaunchSuppressed: () => true,
    } as unknown as Config;

    // Mock corrupted JSON
    (fs.readFile as Mock).mockResolvedValueOnce('invalid json');

    const mockOAuth2Client = {
      generateAuthUrl: vi.fn().mockReturnValue('https://example.com/auth'),
      generateCodeVerifierAsync: vi
        .fn()
        .mockResolvedValue({ codeChallenge: 'test', codeVerifier: 'test' }),
      setCredentials: vi.fn(),
      on: vi.fn(),
    } as unknown as OAuth2Client;
    (OAuth2Client as unknown as Mock).mockImplementation(
      () => mockOAuth2Client,
    );

    (open as unknown as Mock).mockResolvedValue(undefined);

    // Mock console.debug to verify it's called
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    try {
      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);
    } catch {
      // The auth flow will fail because we're in test mode, but that's okay
    }

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load credentials'),
      expect.any(String),
    );

    debugSpy.mockRestore();
  });

  describe('OAuth Client Caching', () => {
    it('should cache OAuth client per auth type', async () => {
      const mockConfig = {
        getProxy: () => 'http://test.proxy.com:8080',
        isBrowserLaunchSuppressed: () => false,
        isInteractive: () => false,
      } as unknown as Config;

      const mockOAuth2Client = {
        on: vi.fn(),
        setCredentials: vi.fn(),
        getAccessToken: vi.fn().mockResolvedValue({ token: undefined }),
        generateAuthUrl: vi.fn().mockReturnValue('https://example.com/auth'),
      } as unknown as OAuth2Client;

      (OAuth2Client as unknown as Mock).mockImplementation(
        () => mockOAuth2Client,
      );

      (fs.readFile as Mock).mockResolvedValue(
        JSON.stringify({ refresh_token: 'token' }),
      );

      // First call, should create a client
      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);
      expect(OAuth2Client).toHaveBeenCalledTimes(1);

      // Second call, should use cached client
      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);
      expect(OAuth2Client).toHaveBeenCalledTimes(1);

      clearOauthClientCache();

      // Third call, after clearing cache, should create a new client
      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);
      expect(OAuth2Client).toHaveBeenCalledTimes(2);
    });
  });
});
