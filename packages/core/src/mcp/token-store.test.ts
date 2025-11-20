/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BaseTokenStore,
  MCPOAuthToken,
  MCPOAuthCredentials,
} from './token-store.js';

// Test implementation of BaseTokenStore for testing protected methods
class TestTokenStore extends BaseTokenStore {
  private tokens = new Map<string, MCPOAuthCredentials>();

  async loadTokens(): Promise<Map<string, MCPOAuthCredentials>> {
    return new Map(this.tokens);
  }

  async saveToken(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): Promise<void> {
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
    this.validateServerName(serverName);
    return this.tokens.get(serverName) || null;
  }

  async removeToken(serverName: string): Promise<void> {
    this.validateServerName(serverName);
    this.tokens.delete(serverName);
  }

  async clearAllTokens(): Promise<void> {
    this.tokens.clear();
  }

  // Expose protected methods for testing
  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  public testValidateToken(token: MCPOAuthToken): void {
    this.validateToken(token);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  public testValidateServerName(serverName: string): void {
    this.validateServerName(serverName);
  }

  // eslint-disable-next-line @typescript-eslint/explicit-member-accessibility
  public testCreateCredentials(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): MCPOAuthCredentials {
    return this.createCredentials(
      serverName,
      token,
      clientId,
      tokenUrl,
      mcpServerUrl,
    );
  }
}

describe('BaseTokenStore', () => {
  const mockToken: MCPOAuthToken = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_456',
    tokenType: 'Bearer',
    scope: 'read write',
    expiresAt: Date.now() + 3600000, // 1 hour from now
  };

  let testStore: TestTokenStore;

  beforeEach(() => {
    testStore = new TestTokenStore();
  });

  describe('isTokenExpired', () => {
    it('should return false for token without expiry', () => {
      const tokenWithoutExpiry = { ...mockToken };
      delete tokenWithoutExpiry.expiresAt;

      const result = BaseTokenStore.isTokenExpired(tokenWithoutExpiry);

      expect(result).toBe(false);
    });

    it('should return false for valid token', () => {
      const futureToken = {
        ...mockToken,
        expiresAt: Date.now() + 3600000, // 1 hour from now
      };

      const result = BaseTokenStore.isTokenExpired(futureToken);

      expect(result).toBe(false);
    });

    it('should return true for expired token', () => {
      const expiredToken = {
        ...mockToken,
        expiresAt: Date.now() - 3600000, // 1 hour ago
      };

      const result = BaseTokenStore.isTokenExpired(expiredToken);

      expect(result).toBe(true);
    });

    it('should return true for token expiring within buffer time', () => {
      const soonToExpireToken = {
        ...mockToken,
        expiresAt: Date.now() + 60000, // 1 minute from now (within 5-minute buffer)
      };

      const result = BaseTokenStore.isTokenExpired(soonToExpireToken);

      expect(result).toBe(true);
    });
  });

  describe('validateToken', () => {
    it('should pass for valid token', () => {
      expect(() => testStore.testValidateToken(mockToken)).not.toThrow();
    });

    it('should throw for missing accessToken', () => {
      const invalidToken = { ...mockToken };
      delete (invalidToken as unknown as Record<string, unknown>).accessToken;

      expect(() => testStore.testValidateToken(invalidToken)).toThrow(
        'Token must have a valid accessToken',
      );
    });

    it('should throw for empty accessToken', () => {
      const invalidToken = { ...mockToken, accessToken: '' };

      expect(() => testStore.testValidateToken(invalidToken)).toThrow(
        'Token must have a valid accessToken',
      );
    });

    it('should throw for non-string accessToken', () => {
      const invalidToken = {
        ...mockToken,
        accessToken: 123 as unknown as string,
      };

      expect(() => testStore.testValidateToken(invalidToken)).toThrow(
        'Token must have a valid accessToken',
      );
    });

    it('should throw for missing tokenType', () => {
      const invalidToken = { ...mockToken };
      delete (invalidToken as unknown as Record<string, unknown>).tokenType;

      expect(() => testStore.testValidateToken(invalidToken)).toThrow(
        'Token must have a valid tokenType',
      );
    });

    it('should throw for empty tokenType', () => {
      const invalidToken = { ...mockToken, tokenType: '' };

      expect(() => testStore.testValidateToken(invalidToken)).toThrow(
        'Token must have a valid tokenType',
      );
    });

    it('should throw for non-string tokenType', () => {
      const invalidToken = {
        ...mockToken,
        tokenType: 456 as unknown as string,
      };

      expect(() => testStore.testValidateToken(invalidToken)).toThrow(
        'Token must have a valid tokenType',
      );
    });
  });

  describe('validateServerName', () => {
    it('should pass for valid server name', () => {
      expect(() =>
        testStore.testValidateServerName('valid-server'),
      ).not.toThrow();
    });

    it('should throw for empty server name', () => {
      expect(() => testStore.testValidateServerName('')).toThrow(
        'Server name must be a non-empty string',
      );
    });

    it('should throw for whitespace-only server name', () => {
      expect(() => testStore.testValidateServerName('   ')).toThrow(
        'Server name must be a non-empty string',
      );
    });

    it('should throw for non-string server name', () => {
      expect(() =>
        testStore.testValidateServerName(123 as unknown as string),
      ).toThrow('Server name must be a non-empty string');
    });

    it('should throw for null server name', () => {
      expect(() =>
        testStore.testValidateServerName(null as unknown as string),
      ).toThrow('Server name must be a non-empty string');
    });

    it('should throw for undefined server name', () => {
      expect(() =>
        testStore.testValidateServerName(undefined as unknown as string),
      ).toThrow('Server name must be a non-empty string');
    });
  });

  describe('createCredentials', () => {
    it('should create credentials with all parameters', () => {
      const credentials = testStore.testCreateCredentials(
        'test-server',
        mockToken,
        'client-id',
        'https://token.url',
        'https://mcp.url',
      );

      expect(credentials).toEqual({
        serverName: 'test-server',
        token: mockToken,
        clientId: 'client-id',
        tokenUrl: 'https://token.url',
        mcpServerUrl: 'https://mcp.url',
        updatedAt: expect.any(Number),
      });
      expect(credentials.updatedAt).toBeGreaterThan(Date.now() - 1000);
    });

    it('should create credentials with minimal parameters', () => {
      const credentials = testStore.testCreateCredentials(
        'test-server',
        mockToken,
      );

      expect(credentials).toEqual({
        serverName: 'test-server',
        token: mockToken,
        clientId: undefined,
        tokenUrl: undefined,
        mcpServerUrl: undefined,
        updatedAt: expect.any(Number),
      });
    });

    it('should validate server name during creation', () => {
      expect(() => testStore.testCreateCredentials('', mockToken)).toThrow(
        'Server name must be a non-empty string',
      );
    });

    it('should validate token during creation', () => {
      const invalidToken = { ...mockToken, accessToken: '' };
      expect(() =>
        testStore.testCreateCredentials('test-server', invalidToken),
      ).toThrow('Token must have a valid accessToken');
    });
  });

  describe('concrete implementation test', () => {
    it('should implement all abstract methods', async () => {
      // Test that our test implementation works correctly
      await testStore.saveToken('server1', mockToken, 'client1');

      const tokens = await testStore.loadTokens();
      expect(tokens.size).toBe(1);
      expect(tokens.get('server1')).toEqual({
        serverName: 'server1',
        token: mockToken,
        clientId: 'client1',
        tokenUrl: undefined,
        mcpServerUrl: undefined,
        updatedAt: expect.any(Number),
      });

      const retrieved = await testStore.getToken('server1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.serverName).toBe('server1');

      await testStore.removeToken('server1');
      const afterRemoval = await testStore.getToken('server1');
      expect(afterRemoval).toBeNull();
    });

    it('should clear all tokens', async () => {
      await testStore.saveToken('server1', mockToken);
      await testStore.saveToken('server2', mockToken);

      let tokens = await testStore.loadTokens();
      expect(tokens.size).toBe(2);

      await testStore.clearAllTokens();
      tokens = await testStore.loadTokens();
      expect(tokens.size).toBe(0);
    });
  });
});
