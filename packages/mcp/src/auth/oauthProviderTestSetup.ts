/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared mock infrastructure for MCPOAuthProvider tests.
 * Extracted during #2092 lint hardening so split test files can share
 * the mock setup without exceeding max-lines.
 */

import { vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { MCPOAuthConfig } from './oauth-provider.js';
import type { OAuthTokenResponse } from './oauth-provider-utils.js';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';
import type { MCPOAuthToken } from './oauth-token-storage.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import * as crypto from 'node:crypto';

export const mockFetch = vi.fn();

export const createMockResponse = (options: {
  ok: boolean;
  status?: number;
  contentType?: string;
  text?: string | (() => Promise<string>);
  json?: unknown | (() => Promise<unknown>);
}) => {
  const response: {
    ok: boolean;
    status?: number;
    headers: {
      get: (name: string) => string | null;
    };
    text?: () => Promise<string>;
    json?: () => Promise<unknown>;
  } = {
    ok: options.ok,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') {
          return options.contentType ?? null;
        }
        return null;
      },
    },
  };

  if (options.status !== undefined) {
    response.status = options.status;
  }

  if (options.text !== undefined) {
    response.text =
      typeof options.text === 'string'
        ? () => Promise.resolve(options.text as string)
        : (options.text as () => Promise<string>);
  }

  if (options.json !== undefined) {
    response.json =
      typeof options.json === 'function'
        ? (options.json as () => Promise<unknown>)
        : () => Promise.resolve(options.json);
  }

  return response;
};

export const mockHttpServer = {
  listen: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  address: vi.fn(() => ({ address: 'localhost', family: 'IPv4', port: 7777 })),
};

export const mockConfig: MCPOAuthConfig = {
  enabled: true,
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  authorizationUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  scopes: ['read', 'write'],
  redirectUri: 'http://localhost:7777/oauth/callback',
  audiences: ['https://api.example.com'],
};

export const mockToken: MCPOAuthToken = {
  accessToken: 'access_token_123',
  refreshToken: 'refresh_token_456',
  tokenType: 'Bearer',
  scope: 'read write',
  expiresAt: Date.now() + 3600000,
};

export const mockTokenResponse: OAuthTokenResponse = {
  access_token: 'access_token_123',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh_token_456',
  scope: 'read write',
};

export type OAuthSpies = {
  saveTokenSpy: MockInstance;
  getCredentialsSpy: MockInstance;
  deleteCredentialsSpy: MockInstance;
  isTokenExpiredSpy: MockInstance;
};

export function setupOAuthTestSpies(
  openBrowserFn: ReturnType<typeof vi.fn>,
): OAuthSpies {
  vi.clearAllMocks();
  openBrowserFn.mockClear();
  global.fetch = mockFetch;
  vi.spyOn(DebugLogger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(DebugLogger.prototype, 'warn').mockImplementation(() => {});
  vi.spyOn(DebugLogger.prototype, 'error').mockImplementation(() => {});
  vi.spyOn(DebugLogger.prototype, 'debug').mockImplementation(() => {});

  vi.mocked(crypto.randomBytes).mockImplementation((size: number) => {
    if (size === 32) {
      return Buffer.from('mock_code_verifier_32_bytes_long_string');
    }
    if (size === 16) {
      return Buffer.from('mock_state_16_bytes');
    }
    return Buffer.alloc(size);
  });

  vi.mocked(crypto.createHash).mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('code_challenge_mock'),
  } as unknown as crypto.Hash);

  const saveTokenSpy = vi
    .spyOn(MCPOAuthTokenStorage.prototype, 'saveToken')
    .mockResolvedValue(undefined);
  const getCredentialsSpy = vi
    .spyOn(MCPOAuthTokenStorage.prototype, 'getCredentials')
    .mockResolvedValue(null);
  const deleteCredentialsSpy = vi
    .spyOn(MCPOAuthTokenStorage.prototype, 'deleteCredentials')
    .mockResolvedValue(undefined);
  const isTokenExpiredSpy = vi
    .spyOn(MCPOAuthTokenStorage, 'isTokenExpired')
    .mockReturnValue(false);

  return {
    saveTokenSpy,
    getCredentialsSpy,
    deleteCredentialsSpy,
    isTokenExpiredSpy,
  };
}
