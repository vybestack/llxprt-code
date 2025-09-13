/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';
import {
  BaseTokenStore,
  MCPOAuthToken,
  MCPOAuthCredentials,
} from './token-store.js';

// Mock token store for testing
class MockTokenStore extends BaseTokenStore {
  private tokens = new Map<string, MCPOAuthCredentials>();
  private shouldThrow = false;

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  async loadTokens(): Promise<Map<string, MCPOAuthCredentials>> {
    if (this.shouldThrow) {
      throw new Error('Mock error');
    }
    return new Map(this.tokens);
  }

  async saveToken(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Mock save error');
    }
    const credential = this.createCredentials(
      serverName,
      token,
      clientId,
      tokenUrl,
      mcpServerUrl,
    );
    this.tokens.set(serverName, credential);
  }

  async getToken(serverName: string): Promise<MCPOAuthCredentials | null> {
    if (this.shouldThrow) {
      throw new Error('Mock get error');
    }
    this.validateServerName(serverName);
    return this.tokens.get(serverName) || null;
  }

  async removeToken(serverName: string): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Mock remove error');
    }
    this.validateServerName(serverName);
    this.tokens.delete(serverName);
  }

  async clearAllTokens(): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Mock clear error');
    }
    this.tokens.clear();
  }
}

describe('MCPOAuthTokenStorage', () => {
  const mockToken: MCPOAuthToken = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_456',
    tokenType: 'Bearer',
    scope: 'read write',
    expiresAt: Date.now() + 3600000, // 1 hour from now
  };

  const _mockCredentials: MCPOAuthCredentials = {
    serverName: 'test-server',
    token: mockToken,
    clientId: 'test-client-id',
    tokenUrl: 'https://auth.example.com/token',
    mcpServerUrl: 'https://mcp.example.com',
    updatedAt: Date.now(),
  };

  let mockTokenStore: MockTokenStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTokenStore = new MockTokenStore();
    MCPOAuthTokenStorage.setTokenStore(mockTokenStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setTokenStore and getTokenStore', () => {
    it('should allow setting and getting custom token store', () => {
      const customStore = new MockTokenStore();
      MCPOAuthTokenStorage.setTokenStore(customStore);

      expect(MCPOAuthTokenStorage.getTokenStore()).toBe(customStore);
    });
  });

  describe('loadTokens', () => {
    it('should return empty map when no tokens exist', async () => {
      const tokens = await MCPOAuthTokenStorage.loadTokens();

      expect(tokens.size).toBe(0);
    });

    it('should load tokens successfully', async () => {
      // Add a token to the mock store
      await mockTokenStore.saveToken('test-server', mockToken);

      const tokens = await MCPOAuthTokenStorage.loadTokens();

      expect(tokens.size).toBe(1);
      expect(tokens.get('test-server')).toEqual(
        expect.objectContaining({
          serverName: 'test-server',
          token: mockToken,
        }),
      );
    });

    it('should handle load errors', async () => {
      mockTokenStore.setShouldThrow(true);

      await expect(MCPOAuthTokenStorage.loadTokens()).rejects.toThrow(
        'Mock error',
      );
    });
  });

  describe('saveToken', () => {
    it('should save token successfully', async () => {
      await MCPOAuthTokenStorage.saveToken(
        'test-server',
        mockToken,
        'client-id',
        'https://token.url',
        'https://mcp.url',
      );

      const saved = await MCPOAuthTokenStorage.getToken('test-server');
      expect(saved).toEqual(
        expect.objectContaining({
          serverName: 'test-server',
          token: mockToken,
          clientId: 'client-id',
          tokenUrl: 'https://token.url',
          mcpServerUrl: 'https://mcp.url',
        }),
      );
    });

    it('should update existing token for same server', async () => {
      await MCPOAuthTokenStorage.saveToken('existing-server', mockToken);

      const newToken = { ...mockToken, accessToken: 'new_access_token' };
      await MCPOAuthTokenStorage.saveToken('existing-server', newToken);

      const saved = await MCPOAuthTokenStorage.getToken('existing-server');
      expect(saved?.token.accessToken).toBe('new_access_token');
    });

    it('should handle save errors', async () => {
      mockTokenStore.setShouldThrow(true);

      await expect(
        MCPOAuthTokenStorage.saveToken('test-server', mockToken),
      ).rejects.toThrow('Mock save error');
    });
  });

  describe('getToken', () => {
    it('should return token for existing server', async () => {
      await MCPOAuthTokenStorage.saveToken('test-server', mockToken);

      const result = await MCPOAuthTokenStorage.getToken('test-server');

      expect(result).toEqual(
        expect.objectContaining({
          serverName: 'test-server',
          token: mockToken,
        }),
      );
    });

    it('should return null for non-existent server', async () => {
      await MCPOAuthTokenStorage.saveToken('test-server', mockToken);

      const result = await MCPOAuthTokenStorage.getToken('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when no tokens exist', async () => {
      const result = await MCPOAuthTokenStorage.getToken('test-server');

      expect(result).toBeNull();
    });

    it('should handle get errors', async () => {
      mockTokenStore.setShouldThrow(true);

      await expect(
        MCPOAuthTokenStorage.getToken('test-server'),
      ).rejects.toThrow('Mock get error');
    });
  });

  describe('removeToken', () => {
    it('should remove token for specific server', async () => {
      await MCPOAuthTokenStorage.saveToken('server1', mockToken);
      await MCPOAuthTokenStorage.saveToken('server2', mockToken);

      await MCPOAuthTokenStorage.removeToken('server1');

      const result1 = await MCPOAuthTokenStorage.getToken('server1');
      const result2 = await MCPOAuthTokenStorage.getToken('server2');

      expect(result1).toBeNull();
      expect(result2).not.toBeNull();
    });

    it('should handle removal of non-existent token gracefully', async () => {
      await MCPOAuthTokenStorage.saveToken('test-server', mockToken);

      // Should not throw
      await MCPOAuthTokenStorage.removeToken('non-existent');

      const result = await MCPOAuthTokenStorage.getToken('test-server');
      expect(result).not.toBeNull(); // Should still exist
    });

    it('should handle remove errors', async () => {
      mockTokenStore.setShouldThrow(true);

      await expect(
        MCPOAuthTokenStorage.removeToken('test-server'),
      ).rejects.toThrow('Mock remove error');
    });
  });

  describe('isTokenExpired', () => {
    it('should return false for token without expiry', () => {
      const tokenWithoutExpiry = { ...mockToken };
      delete tokenWithoutExpiry.expiresAt;

      const result = MCPOAuthTokenStorage.isTokenExpired(tokenWithoutExpiry);

      expect(result).toBe(false);
    });

    it('should return false for valid token', () => {
      const futureToken = {
        ...mockToken,
        expiresAt: Date.now() + 3600000, // 1 hour from now
      };

      const result = MCPOAuthTokenStorage.isTokenExpired(futureToken);

      expect(result).toBe(false);
    });

    it('should return true for expired token', () => {
      const expiredToken = {
        ...mockToken,
        expiresAt: Date.now() - 3600000, // 1 hour ago
      };

      const result = MCPOAuthTokenStorage.isTokenExpired(expiredToken);

      expect(result).toBe(true);
    });

    it('should return true for token expiring within buffer time', () => {
      const soonToExpireToken = {
        ...mockToken,
        expiresAt: Date.now() + 60000, // 1 minute from now (within 5-minute buffer)
      };

      const result = MCPOAuthTokenStorage.isTokenExpired(soonToExpireToken);

      expect(result).toBe(true);
    });
  });

  describe('clearAllTokens', () => {
    it('should clear all tokens successfully', async () => {
      await MCPOAuthTokenStorage.saveToken('server1', mockToken);
      await MCPOAuthTokenStorage.saveToken('server2', mockToken);

      await MCPOAuthTokenStorage.clearAllTokens();

      const tokens = await MCPOAuthTokenStorage.loadTokens();
      expect(tokens.size).toBe(0);
    });

    it('should handle clear errors', async () => {
      mockTokenStore.setShouldThrow(true);

      await expect(MCPOAuthTokenStorage.clearAllTokens()).rejects.toThrow(
        'Mock clear error',
      );
    });
  });
});
