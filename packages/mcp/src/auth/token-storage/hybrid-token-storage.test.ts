/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  HybridTokenStorage,
  type AvailabilityAwareTokenStorage,
} from './hybrid-token-storage.js';
import { type OAuthCredentials, TokenStorageType } from './types.js';

interface MockKeychainStorage extends AvailabilityAwareTokenStorage {
  isAvailable: ReturnType<typeof vi.fn>;
  getCredentials: ReturnType<typeof vi.fn>;
  setCredentials: ReturnType<typeof vi.fn>;
  deleteCredentials: ReturnType<typeof vi.fn>;
  listServers: ReturnType<typeof vi.fn>;
  getAllCredentials: ReturnType<typeof vi.fn>;
  clearAll: ReturnType<typeof vi.fn>;
}

interface MockFileStorage {
  getCredentials: ReturnType<typeof vi.fn>;
  setCredentials: ReturnType<typeof vi.fn>;
  deleteCredentials: ReturnType<typeof vi.fn>;
  listServers: ReturnType<typeof vi.fn>;
  getAllCredentials: ReturnType<typeof vi.fn>;
  clearAll: ReturnType<typeof vi.fn>;
}

function createMockKeychainStorage(): MockKeychainStorage {
  return {
    isAvailable: vi.fn(),
    getCredentials: vi.fn(),
    setCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
    listServers: vi.fn(),
    getAllCredentials: vi.fn(),
    clearAll: vi.fn(),
  } as unknown as MockKeychainStorage;
}

function createMockFileStorage(): MockFileStorage {
  return {
    getCredentials: vi.fn(),
    setCredentials: vi.fn(),
    deleteCredentials: vi.fn(),
    listServers: vi.fn(),
    getAllCredentials: vi.fn(),
    clearAll: vi.fn(),
  } as unknown as MockFileStorage;
}

describe('HybridTokenStorage', () => {
  let storage: HybridTokenStorage;
  let mockKeychainStorage: MockKeychainStorage;
  let mockFileStorage: MockFileStorage;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };

    // Create fake backend instances and inject them via typed factories,
    // replacing prior module-level mocking of the storage classes.
    mockKeychainStorage = createMockKeychainStorage();
    mockFileStorage = createMockFileStorage();

    storage = new HybridTokenStorage('test-service', {
      createKeychainStorage: () => Promise.resolve(mockKeychainStorage),
      createFileStorage: () => mockFileStorage,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('storage selection', () => {
    it('should use keychain when available', async () => {
      mockKeychainStorage.isAvailable.mockResolvedValue(true);
      mockKeychainStorage.getCredentials.mockResolvedValue(null);

      await storage.getCredentials('test-server');

      expect(mockKeychainStorage.isAvailable).toHaveBeenCalled();
      expect(mockKeychainStorage.getCredentials).toHaveBeenCalledWith(
        'test-server',
      );
      expect(await storage.getStorageType()).toBe(TokenStorageType.KEYCHAIN);
    });

    it('should use file storage when LLXPRT_FORCE_FILE_STORAGE is set', async () => {
      process.env['LLXPRT_FORCE_FILE_STORAGE'] = 'true';
      mockFileStorage.getCredentials.mockResolvedValue(null);

      await storage.getCredentials('test-server');

      expect(mockKeychainStorage.isAvailable).not.toHaveBeenCalled();
      expect(mockFileStorage.getCredentials).toHaveBeenCalledWith(
        'test-server',
      );
      expect(await storage.getStorageType()).toBe(
        TokenStorageType.ENCRYPTED_FILE,
      );
    });

    it('should fall back to file storage when keychain is unavailable', async () => {
      mockKeychainStorage.isAvailable.mockResolvedValue(false);
      mockFileStorage.getCredentials.mockResolvedValue(null);

      await storage.getCredentials('test-server');

      expect(mockKeychainStorage.isAvailable).toHaveBeenCalled();
      expect(mockFileStorage.getCredentials).toHaveBeenCalledWith(
        'test-server',
      );
      expect(await storage.getStorageType()).toBe(
        TokenStorageType.ENCRYPTED_FILE,
      );
    });

    it('should fall back to file storage when keychain throws error', async () => {
      mockKeychainStorage.isAvailable.mockRejectedValue(
        new Error('Keychain error'),
      );
      mockFileStorage.getCredentials.mockResolvedValue(null);

      await storage.getCredentials('test-server');

      expect(mockKeychainStorage.isAvailable).toHaveBeenCalled();
      expect(mockFileStorage.getCredentials).toHaveBeenCalledWith(
        'test-server',
      );
      expect(await storage.getStorageType()).toBe(
        TokenStorageType.ENCRYPTED_FILE,
      );
    });

    it('should cache storage selection', async () => {
      mockKeychainStorage.isAvailable.mockResolvedValue(true);
      mockKeychainStorage.getCredentials.mockResolvedValue(null);

      await storage.getCredentials('test-server');
      await storage.getCredentials('another-server');

      expect(mockKeychainStorage.isAvailable).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCredentials', () => {
    it('should delegate to selected storage', async () => {
      const credentials: OAuthCredentials = {
        serverName: 'test-server',
        token: {
          accessToken: 'access-token',
          tokenType: 'Bearer',
        },
        updatedAt: Date.now(),
      };

      mockKeychainStorage.isAvailable.mockResolvedValue(true);
      mockKeychainStorage.getCredentials.mockResolvedValue(credentials);

      const result = await storage.getCredentials('test-server');

      expect(result).toStrictEqual(credentials);
      expect(mockKeychainStorage.getCredentials).toHaveBeenCalledWith(
        'test-server',
      );
    });
  });

  describe('setCredentials', () => {
    it('should delegate to selected storage', async () => {
      const credentials: OAuthCredentials = {
        serverName: 'test-server',
        token: {
          accessToken: 'access-token',
          tokenType: 'Bearer',
        },
        updatedAt: Date.now(),
      };

      mockKeychainStorage.isAvailable.mockResolvedValue(true);
      mockKeychainStorage.setCredentials.mockResolvedValue(undefined);

      await storage.setCredentials(credentials);

      expect(mockKeychainStorage.setCredentials).toHaveBeenCalledWith(
        credentials,
      );
    });
  });

  describe('deleteCredentials', () => {
    it('should delegate to selected storage', async () => {
      mockKeychainStorage.isAvailable.mockResolvedValue(true);
      mockKeychainStorage.deleteCredentials.mockResolvedValue(undefined);

      await storage.deleteCredentials('test-server');

      expect(mockKeychainStorage.deleteCredentials).toHaveBeenCalledWith(
        'test-server',
      );
    });
  });

  describe('listServers', () => {
    it('should delegate to selected storage', async () => {
      const servers = ['server1', 'server2'];
      mockKeychainStorage.isAvailable.mockResolvedValue(true);
      mockKeychainStorage.listServers.mockResolvedValue(servers);

      const result = await storage.listServers();

      expect(result).toStrictEqual(servers);
      expect(mockKeychainStorage.listServers).toHaveBeenCalled();
    });
  });

  describe('getAllCredentials', () => {
    it('should delegate to selected storage', async () => {
      const credentialsMap = new Map([
        [
          'server1',
          {
            serverName: 'server1',
            token: { accessToken: 'token1', tokenType: 'Bearer' },
            updatedAt: Date.now(),
          },
        ],
        [
          'server2',
          {
            serverName: 'server2',
            token: { accessToken: 'token2', tokenType: 'Bearer' },
            updatedAt: Date.now(),
          },
        ],
      ]);

      mockKeychainStorage.isAvailable.mockResolvedValue(true);
      mockKeychainStorage.getAllCredentials.mockResolvedValue(credentialsMap);

      const result = await storage.getAllCredentials();

      expect(result).toStrictEqual(credentialsMap);
      expect(mockKeychainStorage.getAllCredentials).toHaveBeenCalled();
    });
  });

  describe('clearAll', () => {
    it('should delegate to selected storage', async () => {
      mockKeychainStorage.isAvailable.mockResolvedValue(true);
      mockKeychainStorage.clearAll.mockResolvedValue(undefined);

      await storage.clearAll();

      expect(mockKeychainStorage.clearAll).toHaveBeenCalled();
    });
  });
});
