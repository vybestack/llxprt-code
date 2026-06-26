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
  getSupportedToolNames,
  isValidToolKeyName,
} from '@vybestack/llxprt-code-tools';
import {
  SecureStore,
  SecureStoreError,
  type KeyringAdapter,
} from '../storage/secure-store.js';
import {
  decryptEnvelopeString,
  encryptEnvelopeString,
  readEnvelopeVersion,
  type EnvelopeCodecOptions,
} from '@vybestack/llxprt-code-storage/storage/envelope-codec.js';
import { debugLogger } from '../utils/debugLogger.js';

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

// ─── Module-level Lazy Singleton ─────────────────────────────────────────────

let _defaultInstance: ToolKeyStorage | null = null;

/**
 * Returns a lazily-created module-level ToolKeyStorage instance.
 * Avoids constructing a new instance on every tool invocation.
 */
export function getToolKeyStorage(): ToolKeyStorage {
  _defaultInstance ??= new ToolKeyStorage();
  return _defaultInstance;
}

// ─── Storage Interfaces ──────────────────────────────────────────────────────

export type { KeyringAdapter };

export interface ToolKeyStorageOptions {
  toolsDir?: string;
  keyringLoader?: () => Promise<KeyringAdapter | null>;
  /**
   * Injectable machine-secret loader backing the v:2 envelope codec used for
   * the encrypted .key file fallback. Defaults to the production
   * machine-secret resolution (keyring → file → generate). Returning `null`
   * means "no machine secret available" (v:1 only).
   */
  machineSecretLoader?: () => Promise<Buffer | null>;
  /**
   * Optional path for the default machine-secret loader. Ignored when
   * `machineSecretLoader` is provided.
   */
  machineSecretPath?: string;
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
  private readonly codecOptions: EnvelopeCodecOptions;

  constructor(options?: ToolKeyStorageOptions) {
    this.toolsDir = options?.toolsDir ?? DEFAULT_TOOLS_DIR();
    this.keyfilesJsonPath = path.join(this.toolsDir, KEYFILES_JSON_NAME);
    this.secureStore = new SecureStore(KEYCHAIN_SERVICE, {
      fallbackPolicy: 'deny',
      keyringLoader: options?.keyringLoader,
    });
    this.encryptionKey = this.deriveEncryptionKey();
    // When no explicit machineSecretLoader is injected, leave it undefined so
    // the codec falls back to its own production resolver
    // (getMachineSecret). When a path is supplied, pass it through so the
    // default resolver uses that file location.
    this.codecOptions = {
      machineSecretLoader: options?.machineSecretLoader,
      machineSecretPath: options?.machineSecretPath,
    };
  }

  private assertValidToolName(toolName: string): void {
    if (!isValidToolKeyName(toolName)) {
      throw new Error(
        `Invalid tool key name: ${JSON.stringify(toolName)}. Supported names: ${getSupportedToolNames().join(', ')}`,
      );
    }
  }

  // ─── Encryption (legacy .key file format — read-only compatibility) ────

  private deriveEncryptionKey(): Buffer {
    const salt = `${os.hostname()}-${os.userInfo().username}-llxprt-cli`;
    return crypto.scryptSync('llxprt-cli-tool-keys', salt, 32);
  }

  /**
   * Legacy AES-256-GCM decrypt for the `iv:authTag:ciphertext` (hex) format.
   * Used only to read pre-existing .key files that predate the versioned
   * envelope codec.
   */
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

  /**
   * Writes the key to a versioned envelope (v:2 when a machine secret is
   * available, v:1 otherwise). Enforces anti-downgrade: an existing v:2 file
   * is never silently overwritten with a weaker v:1 envelope when the machine
   * secret is unavailable.
   */
  private async saveToFile(toolName: string, key: string): Promise<void> {
    await this.ensureToolsDir();
    const filePath = this.getEncryptedFilePath(toolName);

    // Detect an existing envelope version for anti-downgrade protection.
    // Non-envelope (legacy) files and missing files yield null. Non-ENOENT
    // read errors are rethrown so we fail closed rather than silently
    // clobbering an unreadable file.
    let existingVersion: number | null = null;
    try {
      const existing = await fs.readFile(filePath, 'utf-8');
      existingVersion = readEnvelopeVersion(existing);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw error;
      }
    }

    const envelopeJson = await encryptEnvelopeString(key, KEYCHAIN_SERVICE, {
      ...this.codecOptions,
      existingEnvelopeVersion: existingVersion,
    });
    await fs.writeFile(filePath, envelopeJson, { mode: 0o600 });
  }

  /**
   * Reads and decrypts the .key file.
   *
   * - Versioned envelope (v:1 or v:2): decrypt via the codec. v:2 read errors
   *   (missing/different machine secret, tampering) propagate — fail closed.
   * - Legacy `iv:authTag:ciphertext` (hex): decrypt with the legacy key for
   *   backward compatibility. A recognized legacy file that fails to decrypt
   *   (authentication failure/tampering) throws — fail closed.
   * - Unrecognized content (neither a valid envelope nor legacy hex-colon):
   *   throws — fail closed (a corrupted/forged .key is never silently treated
   *   as "no key").
   * - Missing file (ENOENT): returns null.
   */
  private async getFromFile(toolName: string): Promise<string | null> {
    const filePath = this.getEncryptedFilePath(toolName);
    let data: string;
    try {
      data = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') return null;
      throw error;
    }

    // Route versioned envelopes through the codec. readEnvelopeVersion returns
    // a version number for valid envelopes and null otherwise (including for
    // legacy hex-colon content).
    if (readEnvelopeVersion(data) !== null) {
      // Versioned envelope: v:2 missing/different secret errors must
      // propagate (fail closed), not turn into null.
      return decryptEnvelopeString(data, KEYCHAIN_SERVICE, this.codecOptions);
    }

    // Legacy hex-colon format: positively recognize it before attempting
    // decryption. Recognized legacy content that fails to authenticate must
    // fail closed (throw), not return null; unrecognized content (neither
    // envelope nor legacy hex-colon) also fails closed.
    if (this.isLegacyHexColonFormat(data)) {
      return this.decrypt(data);
    }
    throw new Error(
      `Encrypted key file for ${toolName} is corrupted or in an unrecognized format`,
    );
  }

  /**
   * Recognizes the legacy `iv:authTag:ciphertext` (hex) shape WITHOUT
   * attempting decryption. Requires exactly three colon-separated parts that
   * are all non-empty hex strings.
   */
  private isLegacyHexColonFormat(data: string): boolean {
    const parts = data.split(':');
    if (parts.length !== 3) {
      return false;
    }
    const hex = /^[0-9a-fA-F]+$/;
    return parts.every((p) => p.length > 0 && hex.test(p));
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
      debugLogger.warn('Failed to parse keyfiles.json:', error);
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
        debugLogger.warn('Keyfile is empty:', filePath);
        return null;
      }
      const firstLine = trimmed.split('\n')[0].trim();
      return firstLine;
    } catch (error) {
      const err = error as Error;
      debugLogger.warn('Failed to read keyfile:', filePath, err.message);
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
    return this.getFromFile(toolName);
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
