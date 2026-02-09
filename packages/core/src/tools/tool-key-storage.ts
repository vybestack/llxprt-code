/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool Key Registry and Storage
 *
 * Provides a registry of supported tool key names and metadata,
 * plus a storage class for securely persisting tool API keys
 * (OS keychain primary, AES-256-GCM encrypted file fallback).
 *
 * @plan PLAN-20260206-TOOLKEY.P03, PLAN-20260206-TOOLKEY.P05
 * @requirement REQ-001, REQ-003.5, REQ-003.6, REQ-003.7, REQ-005, REQ-006.3, REQ-007.1
 * @pseudocode lines 021-258
 */

// @pseudocode line 021
import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Constants ───────────────────────────────────────────────────────────────
// @pseudocode lines 024-026

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
// @pseudocode lines 027a-027j

export interface KeytarAdapter {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export interface ToolKeyStorageOptions {
  toolsDir?: string;
  keytarLoader?: () => Promise<KeytarAdapter | null>;
}

// ─── ToolKeyStorage Class ────────────────────────────────────────────────────

/**
 * Securely stores and retrieves tool API keys.
 *
 * Uses the OS keychain when available, falling back to AES-256-GCM
 * encrypted files. Also supports external keyfile references.
 *
 * Resolution order: keychain → encrypted file → keyfile → null
 *
 * @plan PLAN-20260206-TOOLKEY.P03, PLAN-20260206-TOOLKEY.P05
 * @requirement REQ-001, REQ-003.5, REQ-003.6, REQ-003.7, REQ-005, REQ-006.3, REQ-007.1
 * @pseudocode lines 028-258
 */
export class ToolKeyStorage {
  // @pseudocode lines 028a-028b
  private readonly toolsDir: string;
  private readonly keyfilesJsonPath: string;
  private readonly keytarLoaderFn: () => Promise<KeytarAdapter | null>;
  private readonly encryptionKey: Buffer;

  // @pseudocode lines 030-032
  private keychainAvailable: boolean | null = null;
  private keytarModule: KeytarAdapter | null = null;
  private keytarLoadAttempted = false;

  constructor(options?: ToolKeyStorageOptions) {
    this.toolsDir = options?.toolsDir ?? DEFAULT_TOOLS_DIR();
    this.keyfilesJsonPath = path.join(this.toolsDir, KEYFILES_JSON_NAME);
    this.keytarLoaderFn = options?.keytarLoader ?? defaultKeytarLoader;
    this.encryptionKey = this.deriveEncryptionKey();
  }

  private assertValidToolName(toolName: string): void {
    if (!isValidToolKeyName(toolName)) {
      throw new Error(
        `Invalid tool key name: ${JSON.stringify(toolName)}. Supported names: ${getSupportedToolNames().join(', ')}`,
      );
    }
  }

  // ─── Keychain Adapter ───────────────────────────────────────────────────
  // @pseudocode lines 036-050

  private async getKeytar(): Promise<KeytarAdapter | null> {
    if (this.keytarLoadAttempted) return this.keytarModule;
    this.keytarLoadAttempted = true;

    try {
      const adapter = await this.keytarLoaderFn();
      this.keytarModule = adapter;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      const isModuleMissing =
        err?.code === 'ERR_MODULE_NOT_FOUND' ||
        err?.code === 'MODULE_NOT_FOUND' ||
        err?.code === 'ERR_DLOPEN_FAILED' ||
        err?.message?.includes(`'@napi-rs/keyring'`);

      if (isModuleMissing) {
        console.warn(
          '@napi-rs/keyring not available; falling back to encrypted file',
        );
      } else {
        console.warn('Failed to load @napi-rs/keyring:', error);
      }

      this.keytarModule = null;
    }
    return this.keytarModule;
  }

  // @pseudocode lines 052-068
  private async checkKeychainAvailability(): Promise<boolean> {
    if (this.keychainAvailable !== null) return this.keychainAvailable;

    try {
      const keytar = await this.getKeytar();
      if (keytar === null) {
        this.keychainAvailable = false;
        return false;
      }

      const testAccount = `__keychain_test__${crypto.randomBytes(8).toString('hex')}`;
      await keytar.setPassword(KEYCHAIN_SERVICE, testAccount, 'test');
      const retrieved = await keytar.getPassword(KEYCHAIN_SERVICE, testAccount);
      const deleted = await keytar.deletePassword(
        KEYCHAIN_SERVICE,
        testAccount,
      );
      this.keychainAvailable = deleted && retrieved === 'test';
      return this.keychainAvailable;
    } catch {
      this.keychainAvailable = false;
      return false;
    }
  }

  // ─── Encryption ─────────────────────────────────────────────────────────
  // @pseudocode lines 072-098

  // @pseudocode lines 072-075
  private deriveEncryptionKey(): Buffer {
    const salt = `${os.hostname()}-${os.userInfo().username}-llxprt-cli`;
    return crypto.scryptSync('llxprt-cli-tool-keys', salt, 32);
  }

  // @pseudocode lines 077-083
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  // @pseudocode lines 085-094
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

  // @pseudocode lines 096-098
  private async ensureToolsDir(): Promise<void> {
    await fs.mkdir(this.toolsDir, { recursive: true, mode: 0o700 });
  }

  // ─── Keychain Operations ────────────────────────────────────────────────
  // @pseudocode lines 102-131

  // @pseudocode lines 102-111
  private async saveToKeychain(
    toolName: string,
    key: string,
  ): Promise<boolean> {
    if (!(await this.checkKeychainAvailability())) return false;
    const keytar = await this.getKeytar();
    if (keytar === null) return false;
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, toolName, key);
      return true;
    } catch {
      return false;
    }
  }

  // @pseudocode lines 113-121
  private async getFromKeychain(toolName: string): Promise<string | null> {
    if (!(await this.checkKeychainAvailability())) return null;
    const keytar = await this.getKeytar();
    if (keytar === null) return null;
    try {
      return await keytar.getPassword(KEYCHAIN_SERVICE, toolName);
    } catch {
      return null;
    }
  }

  // @pseudocode lines 123-131
  private async deleteFromKeychain(toolName: string): Promise<boolean> {
    if (!(await this.checkKeychainAvailability())) return false;
    const keytar = await this.getKeytar();
    if (keytar === null) return false;
    try {
      return await keytar.deletePassword(KEYCHAIN_SERVICE, toolName);
    } catch {
      return false;
    }
  }

  // ─── Encrypted File Operations ──────────────────────────────────────────
  // @pseudocode lines 135-163

  // @pseudocode lines 135-137
  private getEncryptedFilePath(toolName: string): string {
    this.assertValidToolName(toolName);
    return path.join(this.toolsDir, `${toolName}.key`);
  }

  // @pseudocode lines 139-144
  private async saveToFile(toolName: string, key: string): Promise<void> {
    await this.ensureToolsDir();
    const filePath = this.getEncryptedFilePath(toolName);
    const encrypted = this.encrypt(key);
    await fs.writeFile(filePath, encrypted, { mode: 0o600 });
  }

  // @pseudocode lines 146-155
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

  // @pseudocode lines 157-163
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
  // @pseudocode lines 167-213

  // @pseudocode lines 167-177
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

  // @pseudocode lines 179-182
  private async saveKeyfilesMap(map: Record<string, string>): Promise<void> {
    await this.ensureToolsDir();
    await fs.writeFile(this.keyfilesJsonPath, JSON.stringify(map, null, 2), {
      mode: 0o600,
    });
  }

  // @pseudocode lines 184-188
  async setKeyfilePath(toolName: string, filePath: string): Promise<void> {
    this.assertValidToolName(toolName);
    const map = await this.loadKeyfilesMap();
    map[toolName] = filePath;
    await this.saveKeyfilesMap(map);
  }

  // @pseudocode lines 190-193
  async getKeyfilePath(toolName: string): Promise<string | null> {
    this.assertValidToolName(toolName);
    const map = await this.loadKeyfilesMap();
    return map[toolName] ?? null;
  }

  // @pseudocode lines 195-199
  async clearKeyfilePath(toolName: string): Promise<void> {
    this.assertValidToolName(toolName);
    const map = await this.loadKeyfilesMap();
    delete map[toolName];
    await this.saveKeyfilesMap(map);
  }

  // @pseudocode lines 201-213
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
  // @pseudocode lines 217-256

  // @pseudocode lines 217-225
  async saveKey(toolName: string, key: string): Promise<void> {
    this.assertValidToolName(toolName);
    const savedToKeychain = await this.saveToKeychain(toolName, key);
    if (savedToKeychain) {
      try {
        await this.deleteFile(toolName);
      } catch {
        // ignore cleanup errors
      }
      return;
    }
    await this.saveToFile(toolName, key);
  }

  // @pseudocode lines 227-231
  async getKey(toolName: string): Promise<string | null> {
    this.assertValidToolName(toolName);
    const key = await this.getFromKeychain(toolName);
    if (key !== null) return key;
    return await this.getFromFile(toolName);
  }

  // @pseudocode lines 233-236
  async deleteKey(toolName: string): Promise<void> {
    this.assertValidToolName(toolName);
    await this.deleteFromKeychain(toolName);
    await this.deleteFile(toolName);
  }

  // @pseudocode lines 238-241
  async hasKey(toolName: string): Promise<boolean> {
    this.assertValidToolName(toolName);
    const key = await this.getKey(toolName);
    return key !== null;
  }

  // @pseudocode lines 243-256
  async resolveKey(toolName: string): Promise<string | null> {
    this.assertValidToolName(toolName);
    // Step 1: Try stored key (keychain or encrypted file)
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

// ─── Default Keytar Loader ───────────────────────────────────────────────────
// @pseudocode line 040 — dynamic import of @napi-rs/keyring

async function defaultKeytarLoader(): Promise<KeytarAdapter | null> {
  try {
    const keyring = (await import('@napi-rs/keyring')) as {
      AsyncEntry: new (
        service: string,
        account: string,
      ) => {
        getPassword(): Promise<string | null>;
        setPassword(password: string): Promise<void>;
        deletePassword(): Promise<boolean>;
      };
    };
    return {
      getPassword: (service: string, account: string) => {
        const entry = new keyring.AsyncEntry(service, account);
        return entry.getPassword();
      },
      setPassword: (service: string, account: string, password: string) => {
        const entry = new keyring.AsyncEntry(service, account);
        return entry.setPassword(password);
      },
      deletePassword: (service: string, account: string) => {
        const entry = new keyring.AsyncEntry(service, account);
        return entry.deletePassword();
      },
    };
  } catch {
    return null;
  }
}
