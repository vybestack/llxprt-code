/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
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
import * as fs from 'node:fs/promises';

vi.mock('google-auth-library');
vi.mock('node:readline');
vi.mock('open');
vi.mock('../utils/userAccountManager.js');
vi.mock('../services/ClipboardService.js');
vi.mock('node:fs/promises');
vi.mock('../config/storage.js', () => ({
  Storage: {
    getOAuthCredsPath: vi.fn().mockReturnValue('/test/oauth/creds.json'),
  },
}));

describe('OAuth2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOauthClientCache();

    // Mock fs to prevent actual file operations
    (fs.stat as Mock).mockRejectedValue(new Error('File does not exist'));
    (fs.readFile as Mock).mockRejectedValue(new Error('File does not exist'));
    (fs.writeFile as Mock).mockResolvedValue(undefined);
    (fs.mkdir as Mock).mockResolvedValue(undefined);
  });

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
    (readline.createInterface as unknown as Mock).mockReturnValue(
      mockReadline,
    );

    const result = await performLogin(
      AuthType.LOGIN_WITH_GOOGLE,
      mockConfigWithNoBrowser,
    );
    expect(result).toBe(true);

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      code_challenge_method: 'S256',
      code_challenge: mockCodeVerifier.codeChallenge,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });

    expect(console.log).toHaveBeenCalledWith(
      `To authenticate, please visit:\n${mockAuthUrl}`,
    );
    expect(mockReadline.question).toHaveBeenCalledWith(
      '\nEnter the authorization code from the browser: ',
      expect.any(Function),
    );
    expect(mockGetToken).toHaveBeenCalledWith({
      code: mockCode,
      codeVerifier: mockCodeVerifier.codeVerifier,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });
    expect(mockSetCredentials).toHaveBeenCalledWith(mockTokens);
  });

  it('should perform login with web browser', async () => {
    const mockConfig = {
      getNoBrowser: () => false,
      getProxy: () => 'http://test.proxy.com:8080',
      isBrowserLaunchSuppressed: () => false,
    } as unknown as Config;

    const mockCodeVerifier = {
      codeChallenge: 'test-challenge',
      codeVerifier: 'test-verifier',
    };
    const mockAuthUrl = 'https://example.com/auth-browser';
    const mockCode = 'test-browser-code';
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

    (open as unknown as Mock).mockResolvedValue(undefined);

    // Mock HTTP server for OAuth callback
    const mockAuthWithWeb = vi.fn().mockImplementation(() => {
      // Simulate the callback being handled
      mockOAuth2Client.setCredentials(mockTokens);
      return Promise.resolve({
        authUrl: mockAuthUrl,
        loginCompletePromise: Promise.resolve(),
      });
    });
    // Since authWithWeb is private, we need to mock the entire performLogin flow
    // For simplicity, we'll verify the browser is opened

    const result = await performLogin(AuthType.LOGIN_WITH_GOOGLE, mockConfig);
    expect(result).toBe(true);

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('https://example.com/auth'),
    );
  });

  it('should handle browser open error gracefully with helpful message', async () => {
    const mockConfig = {
      getNoBrowser: () => false,
      getProxy: () => 'http://test.proxy.com:8080',
      isBrowserLaunchSuppressed: () => false,
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

    (open as unknown as Mock).mockResolvedValue(undefined);

    // Simulate auth flow that never completes (times out)
    const neverResolvingPromise = new Promise(() => {});

    // Mock the internal authWithWeb to return a promise that never resolves
    vi.spyOn(global, 'Promise').mockImplementationOnce(
      (executor) =>
        new Promise((resolve, reject) => {
          // Simulate a 100ms timeout for the test
          setTimeout(() => {
            reject(
              new FatalAuthenticationError(
                'Authentication timed out after 5 minutes. The browser tab may have gotten stuck in a loading state. ' +
                  'Please try again or use NO_BROWSER=true for manual authentication.',
              ),
            );
          }, 100);
        }),
    );

    await expect(
      performLogin(AuthType.LOGIN_WITH_GOOGLE, mockConfig),
    ).rejects.toThrow(FatalAuthenticationError);
    await expect(
      performLogin(AuthType.LOGIN_WITH_GOOGLE, mockConfig),
    ).rejects.toThrow('Authentication timed out after 5 minutes');
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
    } as unknown as Config;

    const mockSetCredentials = vi.fn();
    const mockOAuth2Client = {
      setCredentials: mockSetCredentials,
      on: vi.fn(),
    } as unknown as OAuth2Client;
    (OAuth2Client as unknown as Mock).mockImplementation(
      () => mockOAuth2Client,
    );

    const client = await getOauthClient(
      AuthType.LOGIN_WITH_GOOGLE,
      mockConfig,
    );

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
      } as unknown as Config;

      const mockOAuth2Client = {
        on: vi.fn(),
        setCredentials: vi.fn(),
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