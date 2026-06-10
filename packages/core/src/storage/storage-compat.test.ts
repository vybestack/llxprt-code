import { describe, it, expect } from 'vitest';

// Root core imports
import * as core from '@vybestack/llxprt-code-core';

// Root storage imports
import * as storage from '@vybestack/llxprt-code-storage';

// Deep shim imports (core deep paths)
import * as configStorageShim from '@vybestack/llxprt-code-core/config/storage.js';
import * as fileSystemServiceShim from '@vybestack/llxprt-code-core/services/fileSystemService.js';
import * as fileDiscoveryServiceShim from '@vybestack/llxprt-code-core/services/fileDiscoveryService.js';
import * as secureStoreShim from '@vybestack/llxprt-code-core/storage/secure-store.js';
import * as providerKeyStorageShim from '@vybestack/llxprt-code-core/storage/provider-key-storage.js';
import * as sessionTypesShim from '@vybestack/llxprt-code-core/storage/sessionTypes.js';
import * as conversationFileWriterShim from '@vybestack/llxprt-code-core/storage/ConversationFileWriter.js';

// Deep storage imports
import * as configStoragePkg from '@vybestack/llxprt-code-storage/config/storage.js';
import * as fileSystemServicePkg from '@vybestack/llxprt-code-storage/services/fileSystemService.js';
import * as fileDiscoveryServicePkg from '@vybestack/llxprt-code-storage/services/fileDiscoveryService.js';
import * as secureStorePkg from '@vybestack/llxprt-code-storage/storage/secure-store.js';
import * as providerKeyStoragePkg from '@vybestack/llxprt-code-storage/storage/provider-key-storage.js';
import * as sessionTypesPkg from '@vybestack/llxprt-code-storage/storage/sessionTypes.js';
import * as conversationFileWriterPkg from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';

// Test-only helper from storage testing module
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';

describe('Core compatibility shims', () => {
  describe('root core exports expose moved symbols', () => {
    it('exposes Storage from core root', () => {
      expect(core.Storage).toBeDefined();
      expect(typeof core.Storage).toBe('function');
    });

    it('exposes SecureStore from core root', () => {
      expect(core.SecureStore).toBeDefined();
      expect(typeof core.SecureStore).toBe('function');
    });

    it('exposes SecureStoreError from core root', () => {
      expect(core.SecureStoreError).toBeDefined();
      expect(typeof core.SecureStoreError).toBe('function');
    });

    it('exposes ProviderKeyStorage from core root', () => {
      expect(core.ProviderKeyStorage).toBeDefined();
      expect(typeof core.ProviderKeyStorage).toBe('function');
    });

    it('exposes FileDiscoveryService from core root', () => {
      expect(core.FileDiscoveryService).toBeDefined();
    });

    it('exposes StandardFileSystemService from core root', () => {
      expect(core.StandardFileSystemService).toBeDefined();
    });

    it('exposes session constants from core root', () => {
      expect(core.SESSION_FILE_PREFIX).toBeDefined();
    });

    it('exposes PROVIDER_ACCOUNTS_FILENAME from core root', () => {
      expect(core.PROVIDER_ACCOUNTS_FILENAME).toBeDefined();
      expect(typeof core.PROVIDER_ACCOUNTS_FILENAME).toBe('string');
    });

    it('exposes OAUTH_FILE from core root', () => {
      expect(core.OAUTH_FILE).toBeDefined();
      expect(typeof core.OAUTH_FILE).toBe('string');
    });

    it('exposes FileSystemService from core root as runtime value', () => {
      expect(core.FileSystemService).toBeDefined();
      expect(typeof core.FileSystemService).toBe('function');
    });
  });

  describe('deep shim imports resolve for all seven paths', () => {
    it('config/storage.js shim re-exports from storage', () => {
      expect(configStorageShim.Storage).toBe(configStoragePkg.Storage);
      expect(configStorageShim.LLXPRT_DIR).toBe(configStoragePkg.LLXPRT_DIR);
    });

    it('services/fileSystemService.js shim re-exports from storage', () => {
      expect(fileSystemServiceShim.FileSystemService).toBe(
        fileSystemServicePkg.FileSystemService,
      );
      expect(fileSystemServiceShim.StandardFileSystemService).toBe(
        fileSystemServicePkg.StandardFileSystemService,
      );
    });

    it('services/fileDiscoveryService.js shim re-exports from storage', () => {
      expect(fileDiscoveryServiceShim.FileDiscoveryService).toBe(
        fileDiscoveryServicePkg.FileDiscoveryService,
      );
    });

    it('storage/secure-store.js shim re-exports from storage', () => {
      expect(secureStoreShim.SecureStore).toBe(secureStorePkg.SecureStore);
      expect(secureStoreShim.SecureStoreError).toBe(
        secureStorePkg.SecureStoreError,
      );
      expect(secureStoreShim.createDefaultKeyringAdapter).toBe(
        secureStorePkg.createDefaultKeyringAdapter,
      );
    });

    it('storage/provider-key-storage.js shim re-exports from storage', () => {
      expect(providerKeyStorageShim.ProviderKeyStorage).toBe(
        providerKeyStoragePkg.ProviderKeyStorage,
      );
      expect(providerKeyStorageShim.getProviderKeyStorage).toBe(
        providerKeyStoragePkg.getProviderKeyStorage,
      );
      expect(providerKeyStorageShim.resetProviderKeyStorage).toBe(
        providerKeyStoragePkg.resetProviderKeyStorage,
      );
      expect(providerKeyStorageShim.KEY_NAME_REGEX).toBe(
        providerKeyStoragePkg.KEY_NAME_REGEX,
      );
      expect(providerKeyStorageShim.validateKeyName).toBe(
        providerKeyStoragePkg.validateKeyName,
      );
    });

    it('storage/sessionTypes.js shim re-exports from storage', () => {
      expect(sessionTypesShim.SESSION_FILE_PREFIX).toBe(
        sessionTypesPkg.SESSION_FILE_PREFIX,
      );
    });

    it('storage/ConversationFileWriter.js shim re-exports from storage', () => {
      expect(conversationFileWriterShim.ConversationFileWriter).toBe(
        conversationFileWriterPkg.ConversationFileWriter,
      );
      expect(conversationFileWriterShim.getConversationFileWriter).toBe(
        conversationFileWriterPkg.getConversationFileWriter,
      );
    });
  });

  describe('root export identity (core root === storage root)', () => {
    it('Storage identity', () => {
      expect(core.Storage).toBe(storage.Storage);
    });

    it('PROVIDER_ACCOUNTS_FILENAME identity', () => {
      expect(core.PROVIDER_ACCOUNTS_FILENAME).toBe(
        storage.PROVIDER_ACCOUNTS_FILENAME,
      );
    });

    it('OAUTH_FILE identity', () => {
      expect(core.OAUTH_FILE).toBe(storage.OAUTH_FILE);
    });

    it('FileSystemService identity', () => {
      expect(core.FileSystemService).toBe(storage.FileSystemService);
    });

    it('StandardFileSystemService identity', () => {
      expect(core.StandardFileSystemService).toBe(
        storage.StandardFileSystemService,
      );
    });

    it('FileDiscoveryService identity', () => {
      expect(core.FileDiscoveryService).toBe(storage.FileDiscoveryService);
    });

    it('SecureStore identity', () => {
      expect(core.SecureStore).toBe(storage.SecureStore);
    });

    it('ProviderKeyStorage identity', () => {
      expect(core.ProviderKeyStorage).toBe(storage.ProviderKeyStorage);
    });

    it('SESSION_FILE_PREFIX identity', () => {
      expect(core.SESSION_FILE_PREFIX).toBe(storage.SESSION_FILE_PREFIX);
    });

    it('LLXPRT_DIR identity', () => {
      expect(core.LLXPRT_DIR).toBe(storage.LLXPRT_DIR);
    });
  });

  describe('singleton identity', () => {
    it('getProviderKeyStorage and resetProviderKeyStorage affect the same singleton', () => {
      // Reset both sides to ensure clean state
      providerKeyStoragePkg.resetProviderKeyStorage();

      // Get singleton from storage package
      const fromStorage = providerKeyStoragePkg.getProviderKeyStorage();
      // Get singleton from core shim
      const fromCoreShim = providerKeyStorageShim.getProviderKeyStorage();

      // They must be the exact same object (singleton identity)
      expect(fromCoreShim).toBe(fromStorage);

      // Clean up
      providerKeyStoragePkg.resetProviderKeyStorage();
    });

    it('getConversationFileWriter deep-path shim identity', () => {
      // Reset to ensure clean state using storage testing module
      resetConversationFileWriterForTesting();

      // Get from core deep path shim
      const fromCoreDeep = conversationFileWriterShim.getConversationFileWriter(
        '/tmp/compat-test-core',
      );
      // Get from storage deep path
      const fromStorageDeep =
        conversationFileWriterPkg.getConversationFileWriter(
          '/tmp/compat-test-storage',
        );

      // Same singleton regardless of path used to access
      expect(fromCoreDeep).toBe(fromStorageDeep);

      // Clean up
      resetConversationFileWriterForTesting();
    });
  });
});
