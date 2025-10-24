/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleAuth } from 'google-auth-library';
import { GoogleCredentialProvider } from './google-auth-provider.js';
import { vi, describe, beforeEach, it, expect, Mock } from 'vitest';
import { MCPServerConfig } from '../config/config.js';

vi.mock('google-auth-library');

describe('GoogleCredentialProvider', () => {
  it('should throw an error if no scopes are provided', () => {
    expect(() => new GoogleCredentialProvider()).toThrow(
      'Scopes must be provided in the oauth config for Google Credentials provider',
    );
  });

  it('should use scopes from the config if provided', () => {
    const config = {
      oauth: {
        scopes: ['scope1', 'scope2'],
      },
    } as MCPServerConfig;
    new GoogleCredentialProvider(config);
    expect(GoogleAuth).toHaveBeenCalledWith({
      scopes: ['scope1', 'scope2'],
    });
  });

  describe('with provider instance', () => {
    let provider: GoogleCredentialProvider;
    let mockGetAccessToken: Mock;
    let mockClient: {
      getAccessToken: Mock;
      credentials?: { expiry_date: number | null };
    };

    beforeEach(() => {
      const config = {
        oauth: {
          scopes: ['scope1', 'scope2'],
        },
      } as MCPServerConfig;
      // clear and reset mock client before each test
      mockGetAccessToken = vi.fn();
      mockClient = {
        getAccessToken: mockGetAccessToken,
      };
      (GoogleAuth.prototype.getClient as Mock).mockResolvedValue(mockClient);
      provider = new GoogleCredentialProvider(config);
      vi.clearAllMocks();
    });

    it('should return credentials', async () => {
      mockGetAccessToken.mockResolvedValue({ token: 'test-token' });

      const credentials = await provider.tokens();
      expect(credentials?.access_token).toBe('test-token');
    });

    it('should return undefined if access token is not available', async () => {
      mockGetAccessToken.mockResolvedValue({ token: null });

      const credentials = await provider.tokens();
      expect(credentials).toBeUndefined();
    });

    it('should return a cached token if it is not expired', async () => {
      vi.useFakeTimers();
      mockClient.credentials = { expiry_date: Date.now() + 3600 * 1000 }; // 1 hour
      mockGetAccessToken.mockResolvedValue({ token: 'test-token' });

      // first call
      const firstTokens = await provider.tokens();
      expect(firstTokens?.access_token).toBe('test-token');
      expect(mockGetAccessToken).toHaveBeenCalledTimes(1);

      // second call
      vi.advanceTimersByTime(1800 * 1000); // Advance time by 30 minutes
      const secondTokens = await provider.tokens();
      expect(secondTokens).toBe(firstTokens);
      expect(mockGetAccessToken).toHaveBeenCalledTimes(1); // Should not be called again

      vi.useRealTimers();
    });

    it('should fetch a new token if the cached token is expired', async () => {
      vi.useFakeTimers();

      // first call
      mockClient.credentials = { expiry_date: Date.now() + 1000 }; // Expires in 1 second
      mockGetAccessToken.mockResolvedValue({ token: 'expired-token' });

      const firstTokens = await provider.tokens();
      expect(firstTokens?.access_token).toBe('expired-token');
      expect(mockGetAccessToken).toHaveBeenCalledTimes(1);

      // second call
      vi.advanceTimersByTime(1001); // Advance time past expiry
      mockClient.credentials = { expiry_date: Date.now() + 3600 * 1000 }; // New expiry
      mockGetAccessToken.mockResolvedValue({ token: 'new-token' });

      const newTokens = await provider.tokens();
      expect(newTokens?.access_token).toBe('new-token');
      expect(mockGetAccessToken).toHaveBeenCalledTimes(2); // new fetch

      vi.useRealTimers();
    });
  });
});
