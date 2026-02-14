/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Named API key management backed by SecureStore.
 *
 * Provides CRUD operations for named provider API keys with validation,
 * trimming, and singleton access. All storage is delegated to SecureStore.
 *
 * @plan PLAN-20260211-SECURESTORE.P12
 * @requirement R9.1, R10.1
 */

import * as path from 'node:path';
import * as os from 'node:os';
import { SecureStore } from './secure-store.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** @pseudocode line 1 */
export const KEY_NAME_REGEX = /^[a-zA-Z0-9._-]{1,64}$/;

/** @pseudocode line 13 */
const SERVICE_NAME = 'llxprt-code-provider-keys';

/** @pseudocode line 14 */
const DEFAULT_FALLBACK_DIR = (): string => {
  const homeDir = os.homedir();
  if (typeof homeDir === 'string' && homeDir.length > 0) {
    return path.join(homeDir, '.llxprt', 'provider-keys');
  }
  const tmpDir = os.tmpdir();
  return path.join(tmpDir, 'llxprt-provider-keys');
};

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validates a key name against the allowed pattern.
 * @throws {Error} if the name does not match KEY_NAME_REGEX
 *
 * @plan PLAN-20260211-SECURESTORE.P12
 * @pseudocode lines 3-9
 * @requirement R10.1, R10.2
 */
export function validateKeyName(name: string): void {
  if (!KEY_NAME_REGEX.test(name)) {
    throw new Error(
      `Key name '${name}' is invalid. Use only letters, numbers, dashes, underscores, and dots (1-64 chars).`,
    );
  }
}

// ─── ProviderKeyStorage Class ────────────────────────────────────────────────

/**
 * @plan PLAN-20260211-SECURESTORE.P12
 * @pseudocode lines 11-65
 * @requirement R9.1
 */
export class ProviderKeyStorage {
  private readonly secureStore: SecureStore;

  /** @pseudocode lines 16-24 */
  constructor(options?: { secureStore?: SecureStore }) {
    this.secureStore =
      options?.secureStore ??
      new SecureStore(SERVICE_NAME, {
        fallbackDir: DEFAULT_FALLBACK_DIR(),
        fallbackPolicy: 'allow',
      });
  }

  /** @pseudocode lines 26-39 */
  async saveKey(name: string, apiKey: string): Promise<void> {
    validateKeyName(name);

    let trimmed = apiKey.trim();
    while (trimmed.endsWith('\n') || trimmed.endsWith('\r')) {
      trimmed = trimmed.slice(0, -1);
    }

    if (trimmed.length === 0) {
      throw new Error('API key value cannot be empty.');
    }

    await this.secureStore.set(name, trimmed);
  }

  /** @pseudocode lines 41-46 */
  async getKey(name: string): Promise<string | null> {
    validateKeyName(name);
    return this.secureStore.get(name);
  }

  /** @pseudocode lines 48-53 */
  async deleteKey(name: string): Promise<boolean> {
    validateKeyName(name);
    return this.secureStore.delete(name);
  }

  /** @pseudocode lines 55-57 */
  async listKeys(): Promise<string[]> {
    return this.secureStore.list();
  }

  /** @pseudocode lines 59-64 */
  async hasKey(name: string): Promise<boolean> {
    validateKeyName(name);
    return this.secureStore.has(name);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

/** @pseudocode line 68 */
let providerKeyStorageInstance: ProviderKeyStorage | null = null;

/** @pseudocode lines 70-74 */
export function getProviderKeyStorage(): ProviderKeyStorage {
  if (providerKeyStorageInstance === null) {
    providerKeyStorageInstance = new ProviderKeyStorage();
  }
  return providerKeyStorageInstance;
}

/** @pseudocode lines 77-79 */
export function resetProviderKeyStorage(): void {
  providerKeyStorageInstance = null;
}
