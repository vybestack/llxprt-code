/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTokenStorage } from './base-token-storage.js';
import { FileTokenStorage } from './file-token-storage.js';
import type { TokenStorage, OAuthCredentials } from './types.js';
import { TokenStorageType } from './types.js';

const FORCE_FILE_STORAGE_ENV_VAR = 'LLXPRT_FORCE_FILE_STORAGE';

/**
 * A {@link TokenStorage} that can additionally report keychain availability.
 * The keychain backend is only selected when {@link isAvailable} resolves true.
 */
export interface AvailabilityAwareTokenStorage extends TokenStorage {
  isAvailable(): Promise<boolean>;
}

/**
 * Factories for the two concrete backends, injectable so tests can supply
 * fakes without module-level mocking of the storage classes. Defaults build
 * the real keychain and file storages lazily (keychain via dynamic import to
 * preserve the native-module fallback semantics).
 */
export interface HybridTokenStorageDependencies {
  createKeychainStorage?: (
    serviceName: string,
  ) => Promise<AvailabilityAwareTokenStorage>;
  createFileStorage?: (serviceName: string) => TokenStorage;
}

const defaultCreateKeychainStorage = async (
  serviceName: string,
): Promise<AvailabilityAwareTokenStorage> => {
  const { KeychainTokenStorage } = await import('./keychain-token-storage.js');
  return new KeychainTokenStorage(serviceName);
};

const defaultCreateFileStorage = (serviceName: string): TokenStorage =>
  new FileTokenStorage(serviceName);

export class HybridTokenStorage extends BaseTokenStorage {
  private storage: TokenStorage | null = null;
  private storageType: TokenStorageType | null = null;
  private storageInitPromise: Promise<TokenStorage> | null = null;
  private readonly createKeychainStorage: (
    serviceName: string,
  ) => Promise<AvailabilityAwareTokenStorage>;
  private readonly createFileStorage: (serviceName: string) => TokenStorage;

  constructor(
    serviceName: string,
    dependencies: HybridTokenStorageDependencies = {},
  ) {
    super(serviceName);
    this.createKeychainStorage =
      dependencies.createKeychainStorage ?? defaultCreateKeychainStorage;
    this.createFileStorage =
      dependencies.createFileStorage ?? defaultCreateFileStorage;
  }

  private async initializeStorage(): Promise<TokenStorage> {
    const forceFileStorage = process.env[FORCE_FILE_STORAGE_ENV_VAR] === 'true';

    if (!forceFileStorage) {
      try {
        const keychainStorage = await this.createKeychainStorage(
          this.serviceName,
        );

        const isAvailable = await keychainStorage.isAvailable();
        if (isAvailable) {
          this.storage = keychainStorage;
          this.storageType = TokenStorageType.KEYCHAIN;
          return this.storage;
        }
      } catch {
        // Keychain unavailable - fallback to file storage
      }
    }

    this.storage = this.createFileStorage(this.serviceName);
    this.storageType = TokenStorageType.ENCRYPTED_FILE;
    return this.storage;
  }

  private async getStorage(): Promise<TokenStorage> {
    if (this.storage !== null) {
      return this.storage;
    }

    // Use a single initialization promise to avoid race conditions
    this.storageInitPromise ??= this.initializeStorage();

    // Wait for initialization to complete
    return this.storageInitPromise;
  }

  async getCredentials(serverName: string): Promise<OAuthCredentials | null> {
    const storage = await this.getStorage();
    return storage.getCredentials(serverName);
  }

  async setCredentials(credentials: OAuthCredentials): Promise<void> {
    const storage = await this.getStorage();
    await storage.setCredentials(credentials);
  }

  async deleteCredentials(serverName: string): Promise<void> {
    const storage = await this.getStorage();
    await storage.deleteCredentials(serverName);
  }

  async listServers(): Promise<string[]> {
    const storage = await this.getStorage();
    return storage.listServers();
  }

  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    const storage = await this.getStorage();
    return storage.getAllCredentials();
  }

  async clearAll(): Promise<void> {
    const storage = await this.getStorage();
    await storage.clearAll();
  }

  async getStorageType(): Promise<TokenStorageType> {
    await this.getStorage();
    return this.storageType!;
  }
}
