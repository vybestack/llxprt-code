/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  MockInstance,
} from 'vitest';
import { getOauthClient } from './oauth2.js';
import { getCachedGoogleAccount } from '../utils/user_account.js';
import { OAuth2Client, Compute } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import http from 'http';
import open from 'open';
import crypto from 'crypto';
import * as os from 'os';
import { AuthType } from '../core/contentGenerator.js';
import { Config } from '../config/config.js';
import readline from 'node:readline';

vi.mock('os', async (importOriginal) => {
  const os = await importOriginal<typeof import('os')>();
  return {
    ...os,
    homedir: vi.fn(),
  };
});

vi.mock('google-auth-library');
vi.mock('http');
vi.mock('open');
vi.mock('crypto');
vi.mock('node:readline');

const mockConfig = {
  getNoBrowser: () => false,
  getProxy: () => undefined,
} as unknown as Config;

// Mock fetch globally
global.fetch = vi.fn();

describe('oauth2', () => {
  let tempHomeDir: string;
  let processExitSpy: MockInstance;

  beforeEach(() => {
    // Mock process.exit to prevent tests from actually exiting
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error(`process.exit unexpectedly called`);
    }) as never);
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-home-'),
    );
    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
  });
  afterEach(() => {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    vi.clearAllMocks();
    delete process.env.CLOUD_SHELL;
    processExitSpy.mockRestore();
  });

  it.skip('should perform a web login', { timeout: 20000 }, async () => {
    const mockAuthUrl = 'https://example.com/auth';
    const mockCode = 'test-code';
    const mockState = 'test-state';
    const mockTokens = {
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
    };

    const mockGenerateAuthUrl = vi.fn().mockReturnValue(mockAuthUrl);
    const mockGetToken = vi.fn().mockResolvedValue({ tokens: mockTokens });
    const mockSetCredentials = vi.fn();
    const mockGetAccessToken = vi
      .fn()
      .mockResolvedValue({ token: 'mock-access-token' });
    const mockGenerateCodeVerifierAsync = vi
      .fn()
      .mockResolvedValue('mock-code-verifier');
    const mockOAuth2Client = {
      generateAuthUrl: mockGenerateAuthUrl,
      getToken: mockGetToken,
      setCredentials: mockSetCredentials,
      getAccessToken: mockGetAccessToken,
      generateCodeVerifierAsync: mockGenerateCodeVerifierAsync,
      credentials: mockTokens,
      on: vi.fn(),
    } as unknown as OAuth2Client;
    vi.mocked(OAuth2Client).mockImplementation(() => mockOAuth2Client);

    vi.spyOn(crypto, 'randomBytes').mockReturnValue(mockState as never);
    // Mock open to return a proper child process mock
    const mockChildProcess = {
      on: vi.fn(),
      pid: 12345,
    };
    vi.mocked(open).mockImplementation(async () => mockChildProcess as never);

    // Mock readline in case it falls back to user code
    const mockReadline = {
      question: vi.fn((_query, callback) => callback(mockCode)),
      close: vi.fn(),
    };
    vi.mocked(readline.createInterface).mockReturnValue(
      mockReadline as unknown as readline.Interface,
    );

    // Mock the UserInfo API response
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ email: 'test-google-account@gmail.com' }),
    } as unknown as Response);

    let requestCallback!: http.RequestListener<
      typeof http.IncomingMessage,
      typeof http.ServerResponse
    >;

    let serverListeningCallback: (value: unknown) => void;
    const serverListeningPromise = new Promise(
      (resolve) => (serverListeningCallback = resolve),
    );

    let capturedPort = 0;
    const mockHttpServer = {
      listen: vi.fn((port: number, host: string, callback?: () => void) => {
        capturedPort = port;
        // The callback might be passed as second parameter when host is omitted
        if (typeof host === 'function') {
          callback = host;
        }
        if (callback) {
          callback();
        }
        serverListeningCallback(undefined);
      }),
      close: vi.fn((callback?: () => void) => {
        if (callback) {
          callback();
        }
      }),
      on: vi.fn(),
      address: () => ({ port: capturedPort }),
    };
    vi.mocked(http.createServer).mockImplementation((cb) => {
      requestCallback = cb as http.RequestListener<
        typeof http.IncomingMessage,
        typeof http.ServerResponse
      >;
      return mockHttpServer as unknown as http.Server;
    });

    const clientPromise = getOauthClient(
      AuthType.LOGIN_WITH_GOOGLE,
      mockConfig,
    );

    // wait for server to start listening.
    await serverListeningPromise;

    const mockReq = {
      url: `/oauth2callback?code=${mockCode}&state=${mockState}`,
    } as http.IncomingMessage;
    const mockRes = {
      writeHead: vi.fn(),
      end: vi.fn(),
    } as unknown as http.ServerResponse;

    await requestCallback(mockReq, mockRes);

    const client = await clientPromise;
    expect(client).toBe(mockOAuth2Client);

    expect(open).toHaveBeenCalledWith(mockAuthUrl);
    expect(mockGetToken).toHaveBeenCalledWith({
      code: mockCode,
      redirect_uri: `http://localhost:${capturedPort}/oauth2callback`,
    });
    expect(mockSetCredentials).toHaveBeenCalledWith(mockTokens);

    // Verify Google Account was cached
    const googleAccountPath = path.join(
      tempHomeDir,
      '.llxprt',
      'google_accounts.json',
    );
    expect(fs.existsSync(googleAccountPath)).toBe(true);
    const cachedGoogleAccount = fs.readFileSync(googleAccountPath, 'utf-8');
    expect(JSON.parse(cachedGoogleAccount)).toEqual({
      active: 'test-google-account@gmail.com',
      old: [],
    });

    // Verify the getCachedGoogleAccount function works
    expect(getCachedGoogleAccount()).toBe('test-google-account@gmail.com');
  });

  it.skip(
    'should perform login with user code',
    { timeout: 30000 },
    async () => {
      const mockConfigWithNoBrowser = {
        getNoBrowser: () => true,
        getProxy: () => undefined,
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
      const mockGetAccessToken = vi
        .fn()
        .mockResolvedValue({ token: 'mock-access-token-user-code' });

      const mockOAuth2Client = {
        generateAuthUrl: mockGenerateAuthUrl,
        getToken: mockGetToken,
        setCredentials: mockSetCredentials,
        generateCodeVerifierAsync: mockGenerateCodeVerifierAsync,
        getAccessToken: mockGetAccessToken,
        credentials: mockTokens,
        on: vi.fn(),
      } as unknown as OAuth2Client;
      vi.mocked(OAuth2Client).mockImplementation(() => mockOAuth2Client);

      // Mock open to immediately reject to simulate browser not available
      vi.mocked(open).mockRejectedValue(new Error('Browser not available'));

      const mockReadline = {
        question: vi.fn((_query, callback) => callback(mockCode)),
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(
        mockReadline as unknown as readline.Interface,
      );

      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      // Mock the UserInfo API response
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ email: 'test-user-code@gmail.com' }),
      } as unknown as Response);

      const client = await getOauthClient(
        AuthType.LOGIN_WITH_GOOGLE,
        mockConfigWithNoBrowser,
      );

      expect(client).toBe(mockOAuth2Client);

      // Verify the auth flow
      expect(mockGenerateCodeVerifierAsync).toHaveBeenCalled();
      expect(mockGenerateAuthUrl).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(mockAuthUrl),
      );
      expect(mockReadline.question).toHaveBeenCalledWith(
        'Enter the authorization code: ',
        expect.any(Function),
      );
      expect(mockGetToken).toHaveBeenCalledWith({
        code: mockCode,
        codeVerifier: mockCodeVerifier.codeVerifier,
        redirect_uri: 'https://codeassist.google.com/authcode',
      });
      expect(mockSetCredentials).toHaveBeenCalledWith(mockTokens);

      consoleLogSpy.mockRestore();
    },
  );

  describe('in Cloud Shell', () => {
    const mockGetAccessToken = vi.fn();
    let mockComputeClient: Compute;

    beforeEach(() => {
      vi.spyOn(os, 'homedir').mockReturnValue('/user/home');
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(fs.promises, 'readFile').mockRejectedValue(
        new Error('File not found'),
      ); // Default to no cached creds

      mockGetAccessToken.mockResolvedValue({ token: 'test-access-token' });
      mockComputeClient = {
        credentials: { refresh_token: 'test-refresh-token' },
        getAccessToken: mockGetAccessToken,
      } as unknown as Compute;

      vi.mocked(Compute).mockImplementation(() => mockComputeClient);
    });

    it('should attempt to load cached credentials first', async () => {
      const cachedCreds = { refresh_token: 'cached-token' };
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(
        JSON.stringify(cachedCreds),
      );

      const mockClient = {
        setCredentials: vi.fn(),
        getAccessToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
        getTokenInfo: vi.fn().mockResolvedValue({}),
        on: vi.fn(),
      };

      // To mock the new OAuth2Client() inside the function
      vi.mocked(OAuth2Client).mockImplementation(
        () => mockClient as unknown as OAuth2Client,
      );

      await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, mockConfig);

      expect(fs.promises.readFile).toHaveBeenCalledWith(
        '/user/home/.llxprt/oauth_creds.json',
        'utf-8',
      );
      expect(mockClient.setCredentials).toHaveBeenCalledWith(cachedCreds);
      expect(mockClient.getAccessToken).toHaveBeenCalled();
      expect(mockClient.getTokenInfo).toHaveBeenCalled();
      expect(Compute).not.toHaveBeenCalled(); // Should not fetch new client if cache is valid
    });

    it('should use Compute to get a client if no cached credentials exist', async () => {
      await getOauthClient(AuthType.CLOUD_SHELL, mockConfig);

      expect(Compute).toHaveBeenCalledWith({});
      expect(mockGetAccessToken).toHaveBeenCalled();
    });

    it('should not cache the credentials after fetching them via ADC', async () => {
      const newCredentials = { refresh_token: 'new-adc-token' };
      mockComputeClient.credentials = newCredentials;
      mockGetAccessToken.mockResolvedValue({ token: 'new-adc-token' });

      await getOauthClient(AuthType.CLOUD_SHELL, mockConfig);

      expect(fs.promises.writeFile).not.toHaveBeenCalled();
    });

    it('should return the Compute client on successful ADC authentication', async () => {
      const client = await getOauthClient(AuthType.CLOUD_SHELL, mockConfig);
      expect(client).toBe(mockComputeClient);
    });

    it('should throw an error if ADC fails', async () => {
      const testError = new Error('ADC Failed');
      mockGetAccessToken.mockRejectedValue(testError);

      await expect(
        getOauthClient(AuthType.CLOUD_SHELL, mockConfig),
      ).rejects.toThrow(
        'Could not authenticate using Cloud Shell credentials. Please select a different authentication method or ensure you are in a properly configured environment. Error: ADC Failed',
      );
    });
  });
});
