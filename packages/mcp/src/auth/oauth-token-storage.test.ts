/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';
import type { MCPOAuthToken } from './token-store.js';
import type { OAuthCredentials, TokenStorage } from './token-storage/index.js';

class MockTokenStorage implements TokenStorage {
  private readonly tokens = new Map<string, OAuthCredentials>();
  private shouldThrow = false;

  setShouldThrow(shouldThrow: boolean): void {
    this.shouldThrow = shouldThrow;
  }

  async getCredentials(serverName: string): Promise<OAuthCredentials | null> {
    if (this.shouldThrow) {
      throw new Error('Mock get error');
    }
    return this.tokens.get(serverName) ?? null;
  }

  async setCredentials(credentials: OAuthCredentials): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Mock set error');
    }
    this.tokens.set(credentials.serverName, {
      ...credentials,
      updatedAt: credentials.updatedAt,
    });
  }

  async deleteCredentials(serverName: string): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Mock delete error');
    }
    this.tokens.delete(serverName);
  }

  async listServers(): Promise<string[]> {
    return Array.from(this.tokens.keys());
  }

  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    if (this.shouldThrow) {
      throw new Error('Mock get error');
    }
    return new Map(this.tokens);
  }

  async clearAll(): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Mock clear error');
    }
    this.tokens.clear();
  }
}

describe('MCPOAuthTokenStorage', () => {
  const mockToken: MCPOAuthToken = {
    accessToken: 'access',
    refreshToken: 'refresh',
    tokenType: 'Bearer',
    scope: 'test',
    expiresAt: Date.now() + 60_000,
  };

  let mockStore: MockTokenStorage;
  let storage: MCPOAuthTokenStorage;

  beforeEach(() => {
    mockStore = new MockTokenStorage();
    storage = new MCPOAuthTokenStorage(mockStore);
  });

  it('retains independent backends for the same account', async () => {
    const other = new MCPOAuthTokenStorage(new MockTokenStorage());
    await storage.saveToken('demo', mockToken);
    await other.saveToken('demo', { ...mockToken, accessToken: 'other' });
    await other.removeToken('demo');
    expect(await other.getToken('demo')).toBeNull();
    expect((await storage.getToken('demo'))?.token.accessToken).toBe('access');
  });

  it('loads tokens via the shared interface', async () => {
    await mockStore.setCredentials({
      serverName: 'demo',
      token: mockToken,
      updatedAt: Date.now(),
    });

    const tokens = await storage.loadTokens();

    expect(tokens.size).toBe(1);
    expect(tokens.get('demo')?.token.accessToken).toBe('access');
  });

  it('saves tokens with metadata', async () => {
    await storage.saveToken('demo', mockToken, 'client');

    const saved = await storage.getToken('demo');
    expect(saved).toMatchObject({
      serverName: 'demo',
      clientId: 'client',
      token: mockToken,
    });
    expect(typeof saved?.updatedAt).toBe('number');
  });

  it('updates existing tokens', async () => {
    await storage.saveToken('demo', mockToken);
    const newToken = { ...mockToken, accessToken: 'new' };

    await storage.saveToken('demo', newToken);

    const saved = await storage.getToken('demo');
    expect(saved?.token.accessToken).toBe('new');
  });

  it('removes tokens', async () => {
    await storage.saveToken('demo', mockToken);
    await storage.removeToken('demo');

    const result = await storage.getToken('demo');
    expect(result).toBeNull();
  });

  it('clears all tokens', async () => {
    await storage.saveToken('one', mockToken);
    await storage.saveToken('two', mockToken);

    await storage.clearAll();

    const tokens = await storage.loadTokens();
    expect(tokens.size).toBe(0);
  });

  it('throws when attempting to save invalid data', async () => {
    // Invalid server name
    await expect(storage.saveToken('', mockToken)).rejects.toThrow(
      'Server name must be a non-empty string',
    );

    // Invalid token
    await expect(
      storage.saveToken('demo', { ...mockToken, accessToken: '' }),
    ).rejects.toThrow('Token must have a valid access token');
  });

  it('supports the TokenStorage instance API', async () => {
    const storage = new MCPOAuthTokenStorage(mockStore);
    await storage.saveToken('demo', mockToken);

    const credentials = await storage.getCredentials('demo');
    expect(credentials?.token.accessToken).toBe('access');

    await storage.deleteCredentials('demo');
    expect(await storage.getCredentials('demo')).toBeNull();
  });

  it('reports expiration with buffer', () => {
    const withoutExpiry = { ...mockToken };
    delete withoutExpiry.expiresAt;
    expect(MCPOAuthTokenStorage.isTokenExpired(withoutExpiry)).toBe(false);

    const expired = { ...mockToken, expiresAt: Date.now() - 1 };
    expect(MCPOAuthTokenStorage.isTokenExpired(expired)).toBe(true);

    const soonToExpire = { ...mockToken, expiresAt: Date.now() + 1_000 };
    expect(MCPOAuthTokenStorage.isTokenExpired(soonToExpire)).toBe(true);
  });

  it('handles backend errors gracefully', async () => {
    mockStore.setShouldThrow(true);

    await expect(storage.loadTokens()).rejects.toThrowError('Mock get error');

    await expect(storage.saveToken('demo', mockToken)).rejects.toThrowError(
      'Mock set error',
    );
  });
});
