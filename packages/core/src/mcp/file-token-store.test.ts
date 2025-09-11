/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FileTokenStore } from './file-token-store.js';
import { MCPOAuthToken, MCPOAuthCredentials } from './token-store.js';

// Mock file system operations
vi.mock('node:fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  },
}));

// Mock console methods to avoid noise in test output
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('FileTokenStore', () => {
  const mockToken: MCPOAuthToken = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_456',
    tokenType: 'Bearer',
    scope: 'read write',
    expiresAt: Date.now() + 3600000, // 1 hour from now
  };

  const mockCredentials: MCPOAuthCredentials = {
    serverName: 'test-server',
    token: mockToken,
    clientId: 'test-client-id',
    tokenUrl: 'https://auth.example.com/token',
    mcpServerUrl: 'https://mcp.example.com',
    updatedAt: Date.now(),
  };

  let tokenStore: FileTokenStore;
  const testTokenPath = '/test/path/tokens.json';

  beforeEach(() => {
    vi.clearAllMocks();
    tokenStore = new FileTokenStore(testTokenPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use provided token file path', () => {
      const customPath = '/custom/path/tokens.json';
      const store = new FileTokenStore(customPath);
      expect(store).toBeInstanceOf(FileTokenStore);
    });

    it('should use default path when none provided', () => {
      const store = new FileTokenStore();
      expect(store).toBeInstanceOf(FileTokenStore);
    });
  });

  describe('loadTokens', () => {
    it('should return empty map when token file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(0);
      expect(fs.readFile).toHaveBeenCalledWith(testTokenPath, 'utf-8');
    });

    it('should load tokens from file successfully', async () => {
      const tokensArray = [mockCredentials];
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(tokensArray));

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(1);
      expect(tokens.get('test-server')).toEqual(mockCredentials);
    });

    it('should handle corrupted token file gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('invalid json');

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(0);
    });

    it('should handle invalid data structure gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ invalid: 'structure' }),
      );

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(0);
    });

    it('should skip invalid credential entries', async () => {
      const invalidCredentials = [
        mockCredentials,
        { serverName: 'invalid', token: { invalid: 'token' } }, // Invalid token
        { invalid: 'entry' }, // Invalid structure
      ];
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(invalidCredentials),
      );

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(1);
      expect(tokens.get('test-server')).toEqual(mockCredentials);
    });

    it('should handle file read errors other than ENOENT', async () => {
      const error = new Error('Permission denied');
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(0);
    });
  });

  describe('saveToken', () => {
    it('should save token with restricted permissions', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await tokenStore.saveToken(
        'test-server',
        mockToken,
        'client-id',
        'https://token.url',
        'https://mcp.url',
      );

      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(testTokenPath), {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        testTokenPath,
        expect.stringContaining('test-server'),
        { mode: 0o600 },
      );
    });

    it('should update existing token for same server', async () => {
      const existingCredentials = {
        ...mockCredentials,
        serverName: 'existing-server',
      };
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([existingCredentials]),
      );
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const newToken = { ...mockToken, accessToken: 'new_access_token' };
      await tokenStore.saveToken('existing-server', newToken);

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const savedData = JSON.parse(writeCall[1] as string);

      expect(savedData).toHaveLength(1);
      expect(savedData[0].token.accessToken).toBe('new_access_token');
      expect(savedData[0].serverName).toBe('existing-server');
    });

    it('should validate token before saving', async () => {
      const invalidToken = { ...mockToken, accessToken: '' };

      await expect(
        tokenStore.saveToken('test-server', invalidToken),
      ).rejects.toThrow('Token must have a valid accessToken');
    });

    it('should validate server name before saving', async () => {
      await expect(tokenStore.saveToken('', mockToken)).rejects.toThrow(
        'Server name must be a non-empty string',
      );

      await expect(tokenStore.saveToken('   ', mockToken)).rejects.toThrow(
        'Server name must be a non-empty string',
      );
    });

    it('should handle mkdir errors', async () => {
      const mkdirError = new Error('Cannot create directory');
      vi.mocked(fs.mkdir).mockRejectedValue(mkdirError);

      await expect(
        tokenStore.saveToken('test-server', mockToken),
      ).rejects.toThrow('Cannot create directory');
    });

    it('should handle write errors gracefully', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      const writeError = new Error('Disk full');
      vi.mocked(fs.writeFile).mockRejectedValue(writeError);

      await expect(
        tokenStore.saveToken('test-server', mockToken),
      ).rejects.toThrow('Disk full');
    });
  });

  describe('getToken', () => {
    it('should return token for existing server', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([mockCredentials]),
      );

      const result = await tokenStore.getToken('test-server');

      expect(result).toEqual(mockCredentials);
    });

    it('should return null for non-existent server', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([mockCredentials]),
      );

      const result = await tokenStore.getToken('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when no tokens file exists', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const result = await tokenStore.getToken('test-server');

      expect(result).toBeNull();
    });

    it('should validate server name', async () => {
      await expect(tokenStore.getToken('')).rejects.toThrow(
        'Server name must be a non-empty string',
      );
    });
  });

  describe('removeToken', () => {
    it('should remove token for specific server', async () => {
      const credentials1 = { ...mockCredentials, serverName: 'server1' };
      const credentials2 = { ...mockCredentials, serverName: 'server2' };
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([credentials1, credentials2]),
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await tokenStore.removeToken('server1');

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
      const savedData = JSON.parse(writeCall[1] as string);

      expect(savedData).toHaveLength(1);
      expect(savedData[0].serverName).toBe('server2');
    });

    it('should remove token file when no tokens remain', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([mockCredentials]),
      );
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      await tokenStore.removeToken('test-server');

      expect(fs.unlink).toHaveBeenCalledWith(testTokenPath);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle removal of non-existent token gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([mockCredentials]),
      );

      await tokenStore.removeToken('non-existent');

      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should handle file operation errors gracefully', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([mockCredentials]),
      );
      vi.mocked(fs.unlink).mockRejectedValue(new Error('Permission denied'));

      // Should not throw, just log error
      await tokenStore.removeToken('test-server');

      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should validate server name', async () => {
      await expect(tokenStore.removeToken('')).rejects.toThrow(
        'Server name must be a non-empty string',
      );
    });
  });

  describe('clearAllTokens', () => {
    it('should remove token file successfully', async () => {
      vi.mocked(fs.unlink).mockResolvedValue(undefined);

      await tokenStore.clearAllTokens();

      expect(fs.unlink).toHaveBeenCalledWith(testTokenPath);
    });

    it('should handle non-existent file gracefully', async () => {
      vi.mocked(fs.unlink).mockRejectedValue({ code: 'ENOENT' });

      // Should not throw
      await tokenStore.clearAllTokens();

      expect(fs.unlink).toHaveBeenCalledWith(testTokenPath);
    });

    it('should handle other file errors gracefully', async () => {
      vi.mocked(fs.unlink).mockRejectedValue(new Error('Permission denied'));

      // Should not throw, just log error
      await tokenStore.clearAllTokens();

      expect(fs.unlink).toHaveBeenCalledWith(testTokenPath);
    });
  });
});
