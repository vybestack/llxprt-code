/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import * as path from 'node:path';
import { Buffer } from 'node:buffer';
import * as crypto from 'node:crypto';
import {
  FileTokenStore,
  type FileTokenStoreFileSystem,
} from './file-token-store.js';
import type { MCPOAuthToken, MCPOAuthCredentials } from './token-store.js';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 1);

interface MockFileSystem extends FileTokenStoreFileSystem {
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
}

function createMockFileSystem(): MockFileSystem {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  } as unknown as MockFileSystem;
}

// The injected filesystem is (re)created per test; captured here so helpers and
// assertions can reference the active instance, replacing prior module-level
// `node:fs` mocking.
let mockFs: MockFileSystem;

const getCryptoHelpers = (_store: FileTokenStore) => {
  // Create proper encryption/decryption methods using the test key
  const encrypt = (payload: string): string => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      TEST_ENCRYPTION_KEY,
      iv,
    );

    let encrypted = cipher.update(payload, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return [iv.toString('hex'), authTag.toString('hex'), encrypted].join(':');
  };

  const decrypt = (payload: string): string => {
    const trimmed = payload.trim();
    const encryptedPattern = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

    if (!encryptedPattern.test(trimmed)) {
      return payload;
    }

    const [ivHex, authTagHex, encryptedHex] = trimmed.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      TEST_ENCRYPTION_KEY,
      iv,
    );

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  };

  return { encrypt, decrypt };
};

describe('FileTokenStore', () => {
  const mockToken: MCPOAuthToken = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_456',
    tokenType: 'Bearer',
    scope: 'read write',
    expiresAt: Date.now() + 3600000,
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
    mockFs = createMockFileSystem();
    vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    vi.spyOn(debugLogger, 'error').mockImplementation(() => {});
    tokenStore = new FileTokenStore(testTokenPath, {
      encryptionKey: TEST_ENCRYPTION_KEY,
      serviceName: 'test-service',
      fileSystem: mockFs,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use provided token file path', () => {
      const customPath = '/custom/path/tokens.json';
      const store = new FileTokenStore(customPath, {
        encryptionKey: TEST_ENCRYPTION_KEY,
        serviceName: 'test-service',
        fileSystem: mockFs,
      });
      expect(store).toBeInstanceOf(FileTokenStore);
    });

    it('should use default path when none provided', () => {
      const store = new FileTokenStore(undefined, {
        encryptionKey: TEST_ENCRYPTION_KEY,
        serviceName: 'test-service',
        fileSystem: mockFs,
      });
      expect(store).toBeInstanceOf(FileTokenStore);
    });
  });

  describe('loadTokens', () => {
    it('should return empty map when token file does not exist', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(0);
      expect(mockFs.readFile).toHaveBeenCalledWith(testTokenPath, 'utf-8');
    });

    it('should load tokens from encrypted file successfully', async () => {
      const tokensArray = [mockCredentials];
      const { encrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify(tokensArray));
      mockFs.readFile.mockResolvedValue(encrypted);

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(1);
      expect(tokens.get('test-server')).toStrictEqual(mockCredentials);
    });

    it('should support legacy plaintext token files', async () => {
      const tokensArray = [mockCredentials];
      mockFs.readFile.mockResolvedValue(JSON.stringify(tokensArray));

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(1);
      expect(tokens.get('test-server')).toStrictEqual(mockCredentials);
    });

    it('should handle corrupted token file gracefully', async () => {
      mockFs.readFile.mockResolvedValue('invalid json');

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(0);
    });

    it('should handle invalid data structure gracefully', async () => {
      const { encrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify({ invalid: 'structure' }));
      mockFs.readFile.mockResolvedValue(encrypted);

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(0);
    });

    it('should skip invalid credential entries', async () => {
      const invalidCredentials = [
        mockCredentials,
        { serverName: 'invalid', token: { invalid: 'token' } },
        { invalid: 'entry' },
      ];
      const { encrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify(invalidCredentials));
      mockFs.readFile.mockResolvedValue(encrypted);

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(1);
      expect(tokens.get('test-server')).toStrictEqual(mockCredentials);
    });

    it('should handle file read errors other than ENOENT', async () => {
      const error = new Error('Permission denied');
      mockFs.readFile.mockRejectedValue(error);

      const tokens = await tokenStore.loadTokens();

      expect(tokens.size).toBe(0);
    });
  });

  describe('saveToken', () => {
    it('should save token with restricted permissions', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await tokenStore.saveToken(
        'test-server',
        mockToken,
        'client-id',
        'https://token.url',
        'https://mcp.url',
      );

      expect(mockFs.mkdir).toHaveBeenCalledWith(path.dirname(testTokenPath), {
        recursive: true,
        mode: 0o700,
      });
      const writeCall = mockFs.writeFile.mock.calls[0];
      expect(writeCall[0]).toBe(testTokenPath);
      expect(writeCall[1]).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
      expect(writeCall[2]).toStrictEqual({ mode: 0o600 });
    });

    it('should update existing token for same server', async () => {
      const existingCredentials = {
        ...mockCredentials,
        serverName: 'existing-server',
      };
      const { encrypt, decrypt } = getCryptoHelpers(tokenStore);
      const encryptedExisting = encrypt(JSON.stringify([existingCredentials]));
      mockFs.readFile.mockResolvedValue(encryptedExisting);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      const newToken = { ...mockToken, accessToken: 'new_access_token' };
      await tokenStore.saveToken('existing-server', newToken);

      const writeCall = mockFs.writeFile.mock.calls[0];
      const savedData = JSON.parse(decrypt(writeCall[1] as string));

      expect(savedData).toHaveLength(1);
      expect(savedData[0].token.accessToken).toBe('new_access_token');
      expect(savedData[0].serverName).toBe('existing-server');
    });

    it('should validate token before saving', async () => {
      const invalidToken = { ...mockToken, accessToken: '' };

      expect(tokenStore.saveToken('test-server', invalidToken)).rejects.toThrow(
        'Token must have a valid accessToken',
      );
    });

    it('should validate server name before saving', async () => {
      expect(tokenStore.saveToken('', mockToken)).rejects.toThrow(
        'Server name must be a non-empty string',
      );

      expect(tokenStore.saveToken('   ', mockToken)).rejects.toThrow(
        'Server name must be a non-empty string',
      );
    });

    it('should handle mkdir errors', async () => {
      const mkdirError = new Error('Cannot create directory');
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
      mockFs.mkdir.mockRejectedValue(mkdirError);

      expect(tokenStore.saveToken('test-server', mockToken)).rejects.toThrow(
        'Cannot create directory',
      );
    });

    it('should handle write errors gracefully', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
      mockFs.mkdir.mockResolvedValue(undefined);
      const writeError = new Error('Disk full');
      mockFs.writeFile.mockRejectedValue(writeError);

      expect(tokenStore.saveToken('test-server', mockToken)).rejects.toThrow(
        'Disk full',
      );
    });
  });

  describe('getToken', () => {
    it('should return token for existing server', async () => {
      const { encrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify([mockCredentials]));
      mockFs.readFile.mockResolvedValue(encrypted);

      const result = await tokenStore.getToken('test-server');

      expect(result).toStrictEqual(mockCredentials);
    });

    it('should return null for non-existent server', async () => {
      const { encrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify([mockCredentials]));
      mockFs.readFile.mockResolvedValue(encrypted);

      const result = await tokenStore.getToken('non-existent');

      expect(result).toBeNull();
    });

    it('should return null when no tokens file exists', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      const result = await tokenStore.getToken('test-server');

      expect(result).toBeNull();
    });

    it('should validate server name', async () => {
      expect(tokenStore.getToken('')).rejects.toThrow(
        'Server name must be a non-empty string',
      );
    });
  });

  describe('removeToken', () => {
    it('should remove token for specific server', async () => {
      const credentials1 = { ...mockCredentials, serverName: 'server1' };
      const credentials2 = { ...mockCredentials, serverName: 'server2' };
      const { encrypt, decrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify([credentials1, credentials2]));
      mockFs.readFile.mockResolvedValue(encrypted);
      mockFs.writeFile.mockResolvedValue(undefined);

      await tokenStore.removeToken('server1');

      const writeCall = mockFs.writeFile.mock.calls[0];
      const savedData = JSON.parse(decrypt(writeCall[1] as string));

      expect(savedData).toHaveLength(1);
      expect(savedData[0].serverName).toBe('server2');
    });

    it('should remove token file when no tokens remain', async () => {
      const { encrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify([mockCredentials]));
      mockFs.readFile.mockResolvedValue(encrypted);
      mockFs.unlink.mockResolvedValue(undefined);

      await tokenStore.removeToken('test-server');

      expect(mockFs.unlink).toHaveBeenCalledWith(testTokenPath);
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle removal of non-existent token gracefully', async () => {
      const { encrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify([mockCredentials]));
      mockFs.readFile.mockResolvedValue(encrypted);

      await tokenStore.removeToken('non-existent');

      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockFs.unlink).not.toHaveBeenCalled();
    });

    it('should handle file operation errors gracefully', async () => {
      const { encrypt } = getCryptoHelpers(tokenStore);
      const encrypted = encrypt(JSON.stringify([mockCredentials]));
      mockFs.readFile.mockResolvedValue(encrypted);
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));

      await tokenStore.removeToken('test-server');

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it('should validate server name', async () => {
      expect(tokenStore.removeToken('')).rejects.toThrow(
        'Server name must be a non-empty string',
      );
    });
  });

  describe('clearAllTokens', () => {
    it('should remove token file successfully', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await tokenStore.clearAllTokens();

      expect(mockFs.unlink).toHaveBeenCalledWith(testTokenPath);
    });

    it('should handle non-existent file gracefully', async () => {
      mockFs.unlink.mockRejectedValue({ code: 'ENOENT' });

      await tokenStore.clearAllTokens();

      expect(mockFs.unlink).toHaveBeenCalledWith(testTokenPath);
    });

    it('should handle other file errors gracefully', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'));

      await tokenStore.clearAllTokens();

      expect(mockFs.unlink).toHaveBeenCalledWith(testTokenPath);
    });
  });
});
