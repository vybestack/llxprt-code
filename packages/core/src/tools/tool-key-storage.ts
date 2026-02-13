/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool Key Registry and Storage
 *
 * Provides a registry of supported tool key names and metadata,
 * plus a storage class for securely persisting tool API keys.
 * Delegates keychain operations to SecureStore; retains encrypted-file
 * fallback for backward compatibility with existing .key file format.
 *
 * @plan PLAN-20260206-TOOLKEY.P03, PLAN-20260206-TOOLKEY.P05, PLAN-20260211-SECURESTORE.P08
 * @requirement REQ-001, REQ-003.5, REQ-003.6, REQ-003.7, REQ-005, REQ-006.3, REQ-007.1
 */

import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SecureStore,
  SecureStoreError,
  type KeyringAdapter,
} from '../storage/secure-store.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE = 'llxprt-code-tool-keys';
const KEYFILES_JSON_NAME = 'keyfiles.json';
const DEFAULT_TOOLS_DIR = (): string => {
  const homeDir = os.homedir();
  if (typeof homeDir === 'string' && homeDir.length > 0) {
    return path.join(homeDir, '.llxprt', 'tools');
  }

  try {
    const tmpDir = os.tmpdir();
    if (typeof tmpDir === 'string' && tmpDir.length > 0) {
      return path.join(tmpDir, 'llxprt-tools');
    }
  } catch {
    // ignore missing tmpdir
  }

  // Harden against mocked/undefined process.cwd() in test environments
  const cwd = process.cwd();
  if (typeof cwd === 'string' && cwd.length > 0) {
    return path.join(cwd, '.llxprt-tools');
  }

  // Final fallback: use absolute path to tmpdir
  try {
    const tmpDir = os.tmpdir();
    if (typeof tmpDir === 'string' && tmpDir.length > 0) {
      return path.join(tmpDir, 'llxprt-tools-fallback');
    }
  } catch {
    // ignore
  }

  // Last resort: hardcoded POSIX path (should never reach here in real environments)
  return '/tmp/llxprt-tools-fallback';
};

// ─── Registry Types & Data ───────────────────────────────────────────────────

export interface ToolKeyRegistryEntry {
  toolKeyName: string;
  displayName: string;
  urlParamName: string;
  description: string;
}

export const TOOL_KEY_REGISTRY = new Map<string, ToolKeyRegistryEntry>([
  [
    'exa',
    {
      toolKeyName: 'exa',
      displayName: 'Exa Search',
      urlParamName: 'exaApiKey',
      description: 'API key for Exa web and code search',
    },
  ],
]);

// ─── Registry Helpers ────────────────────────────────────────────────────────

export function isValidToolKeyName(toolName: string): boolean {
  return TOOL_KEY_REGISTRY.has(toolName);
}

export function getToolKeyEntry(
  toolName: string,
): ToolKeyRegistryEntry | undefined {
  return TOOL_KEY_REGISTRY.get(toolName);
}

export function getSupportedToolNames(): string[] {
  return Array.from(TOOL_KEY_REGISTRY.keys());
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

export function maskKeyForDisplay(key: string): string {
  if (key.length <= 8) return '*'.repeat(key.length);
  const first2 = key.substring(0, 2);
  const last2 = key.substring(key.length - 2);
  const middle = '*'.repeat(key.length - 4);
  return `${first2}${middle}${last2}`;
}

// ─── Module-level Lazy Singleton ─────────────────────────────────────────────

let _defaultInstance: ToolKeyStorage | null = null;

/**
 * Returns a lazily-created module-level ToolKeyStorage instance.
 * Avoids constructing a new instance on every tool invocation.
 */
export function getToolKeyStorage(): ToolKeyStorage {
  if (_defaultInstance === null) {
    _defaultInstance = new ToolKeyStorage();
  }
  return _defaultInstance;
}

// ─── Storage Interfaces ──────────────────────────────────────────────────────

export type { KeyringAdapter };

export interface ToolKeyStorageOptions {
  toolsDir?: string;
  keyringLoader?: () => Promise<KeyringAdapter | null>;
}

// ─── ToolKeyStorage Class ────────────────────────────────────────────────────

/**
 * Securely stores and retrieves tool API keys.
 *
 * Delegates keychain operations to SecureStore (fallbackPolicy: 'deny').
 * When the keychain is unavailable, falls back to AES-256-GCM encrypted
 * .key files for backward compatibility.
 *
 * Resolution order: keychain (via SecureStore) → encrypted file → keyfile → null
 *
 * @plan PLAN-20260211-SECURESTORE.P08
 * @requirement R7.1
 */
export class ToolKeyStorage {
  private readonly toolsDir: string;
  private readonly keyfilesJsonPath: string;
  private readonly secureStore: SecureStore;
  private readonly encryptionKey: Buffer;

  constructor(options?: ToolKeyStorageOptions) {
    this.toolsDir = options?.toolsDir ?? DEFAULT_TOOLS_DIR();
    this.keyfilesJsonPath = path.join(this.toolsDir, KEYFILES_JSON_NAME);
    this.secureStore = new SecureStore(KEYCHAIN_SERVICE, {
      fallbackPolicy: 'deny',
      keyringLoader: options?.keyringLoader,
    });
    this.encryptionKey = this.deriveEncryptionKey();
  }

  private assertValidToolName(toolName: string): void {
    if (!isValidToolKeyName(toolName)) {
      throw new Error(
        `Invalid tool key name: ${JSON.stringify(toolName)}. Supported names: ${getSupportedToolNames().join(', ')}`,
      );
    }
  }

  // ─── Encryption (backward-compatible .key file format) ──────────────────

  private deriveEncryptionKey(): Buffer {
    const salt = `${os.hostname()}-${os.userInfo().username}-llxprt-cli`;
    return crypto.scryptSync('llxprt-cli-tool-keys', salt, 32);
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(data: string): string {
    const parts = data.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedHex = parts[2];

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      iv,
    );
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // ─── Encrypted File Operations ──────────────────────────────────────────

  private async ensureToolsDir(): Promise<void> {
    await fs.mkdir(this.toolsDir, { recursive: true, mode: 0o700 });
  }

  private getEncryptedFilePath(toolName: string): string {
    this.assertValidToolName(toolName);
    return path.join(this.toolsDir, `${toolName}.key`);
  }

  private async saveToFile(toolName: string, key: string): Promise<void> {
    await this.ensureToolsDir();
    const filePath = this.getEncryptedFilePath(toolName);
    const encrypted = this.encrypt(key);
    await fs.writeFile(filePath, encrypted, { mode: 0o600 });
  }

  private async getFromFile(toolName: string): Promise<string | null> {
    const filePath = this.getEncryptedFilePath(toolName);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return this.decrypt(data);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return null;
      console.warn('Encrypted key file corrupt for', toolName);
      return null;
    }
  }

  private async deleteFile(toolName: string): Promise<void> {
    const filePath = this.getEncryptedFilePath(toolName);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') throw error;
    }
  }

  // ─── Keyfile Path Operations ────────────────────────────────────────────

  private async loadKeyfilesMap(): Promise<Record<string, string>> {
    try {
      const data = await fs.readFile(this.keyfilesJsonPath, 'utf-8');
      const parsed: unknown = JSON.parse(data);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return {};
      }
      return parsed as Record<string, string>;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return {};
      console.warn('Failed to parse keyfiles.json:', error);
      return {};
    }
  }

  private async saveKeyfilesMap(map: Record<string, string>): Promise<void> {
    await this.ensureToolsDir();
    await fs.writeFile(this.keyfilesJsonPath, JSON.stringify(map, null, 2), {
      mode: 0o600,
    });
  }

  async setKeyfilePath(toolName: string, filePath: string): Promise<void> {
    this.assertValidToolName(toolName);
    const map = await this.loadKeyfilesMap();
    map[toolName] = filePath;
    await this.saveKeyfilesMap(map);
  }

  async getKeyfilePath(toolName: string): Promise<string | null> {
    this.assertValidToolName(toolName);
    const map = await this.loadKeyfilesMap();
    return map[toolName] ?? null;
  }

  async clearKeyfilePath(toolName: string): Promise<void> {
    this.assertValidToolName(toolName);
    const map = await this.loadKeyfilesMap();
    delete map[toolName];
    await this.saveKeyfilesMap(map);
  }

  private async readKeyfile(filePath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const trimmed = content.trim();
      if (trimmed === '') {
        console.warn('Keyfile is empty:', filePath);
        return null;
      }
      const firstLine = trimmed.split('\n')[0].trim();
      return firstLine;
    } catch (error) {
      const err = error as Error;
      console.warn('Failed to read keyfile:', filePath, err.message);
      return null;
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  async saveKey(toolName: string, key: string): Promise<void> {
    this.assertValidToolName(toolName);
    try {
      await this.secureStore.set(toolName, key);
      try {
        await this.deleteFile(toolName);
      } catch {
        // ignore cleanup errors
      }
      return;
    } catch (error) {
      if (error instanceof SecureStoreError && error.code === 'UNAVAILABLE') {
        await this.saveToFile(toolName, key);
        return;
      }
      throw error;
    }
  }

  async getKey(toolName: string): Promise<string | null> {
    this.assertValidToolName(toolName);
    try {
      const key = await this.secureStore.get(toolName);
      if (key !== null) return key;
    } catch (error) {
      if (error instanceof SecureStoreError && error.code === 'UNAVAILABLE') {
        // Keyring unavailable — fall through to file
      } else {
        throw error;
      }
    }
    return await this.getFromFile(toolName);
  }

  async deleteKey(toolName: string): Promise<void> {
    this.assertValidToolName(toolName);
    try {
      await this.secureStore.delete(toolName);
    } catch (error) {
      if (error instanceof SecureStoreError && error.code === 'UNAVAILABLE') {
        // Keyring unavailable — continue to delete file
      } else {
        throw error;
      }
    }
    await this.deleteFile(toolName);
  }

  async hasKey(toolName: string): Promise<boolean> {
    this.assertValidToolName(toolName);
    const key = await this.getKey(toolName);
    return key !== null;
  }

  async resolveKey(toolName: string): Promise<string | null> {
    this.assertValidToolName(toolName);
    // Step 1: Try stored key (keychain via SecureStore or encrypted file)
    const storedKey = await this.getKey(toolName);
    if (storedKey !== null) return storedKey;

    // Step 2: Try keyfile
    const keyfilePath = await this.getKeyfilePath(toolName);
    if (keyfilePath !== null) {
      const keyfileContent = await this.readKeyfile(keyfilePath);
      if (keyfileContent !== null) return keyfileContent;
    }

    // Step 3: No key found
    return null;
  }
}
