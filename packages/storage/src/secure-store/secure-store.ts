/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Secure credential storage with OS keychain integration.
 *
 * Provides get/set/delete/list/has operations against the OS keyring,
 * with injectable adapter for testing via keyringLoader option.
 *
 * @plan PLAN-20260211-SECURESTORE.P06
 * @requirement R1.1, R1.3, R2.1, R3.1a, R3.1b, R3.2-R3.8, R4.1-R4.8, R5.1-R5.2, R6.1
 */

import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { StorageLogger } from '../types/logger.js';
import { NullStorageLoggerImpl } from '../types/logger.js';
import { getMachineSecret } from './machine-secret.js';
import { Storage } from '../config/storage.js';
import {
  deriveV1KdfInput,
  deriveV2KdfInput,
  ENVELOPE_VERSIONS,
  isValidEnvelope,
  scryptAsync,
  SCRYPT_PARAMS,
  SALT_LEN,
  type Envelope,
} from './envelope.js';
import { verifyKeyringWrite } from './keyring-write-verification.js';
import {
  assertRuntimeNotReplaced,
  RUNTIME_REPLACED_REMEDIATION,
} from './runtime-replaced-errors.js';
import {
  createDefaultKeyringAdapter,
  setKeyringLogger,
} from './default-keyring-adapter.js';
import { CredentialWriteLock } from './credential-write-lock.js';

export { createDefaultKeyringAdapter } from './default-keyring-adapter.js';
export { resetRuntimeReplacedWarningForTesting } from './runtime-replaced-errors.js';
export { hasRuntimeReplacedWarningBeenEmitted } from './runtime-replaced-errors.js';
export {
  forceRuntimeReplacedForTesting,
  resetRuntimeIdentityForTesting,
} from './runtime-identity.js';

// ─── Error Type (re-exported from dependency-leaf module) ────────────────────
//
// SecureStoreError and SecureStoreErrorCode are defined in
// secure-store-errors.ts (a dependency leaf) so that runtime-replaced
// detection and error helpers can import them without creating a cycle back
// into this module.

export {
  SecureStoreError,
  isSecureStoreError,
  isRuntimeReplacedError,
} from './secure-store-errors.js';
export type { SecureStoreErrorCode } from './secure-store-errors.js';

import { SecureStoreError } from './secure-store-errors.js';
import type { SecureStoreErrorCode } from './secure-store-errors.js';

// ─── Adapter Interface ───────────────────────────────────────────────────────

export interface KeyringAdapter {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials?(
    service: string,
  ): Promise<Array<{ account: string; password: string }>>;
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface SecureStoreOptions {
  fallbackDir?: string;
  fallbackPolicy?: 'allow' | 'deny';
  keyringLoader?: () => Promise<KeyringAdapter | null>;
  logger?: StorageLogger;
  machineSecretLoader?: () => Promise<Buffer | null>;
  machineSecretPath?: string;
  lockDir?: string;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function isErrorWithCode(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string'
  );
}

function classifyError(error: unknown): SecureStoreErrorCode {
  const msg =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  // "Couldn't access platform storage: PermissionDenied" is what the keyring
  // crate reports when the machine has no Secret Service at all — a headless
  // Linux box, container, ssh session or WSL. Despite the wording it means "no
  // credential backend here", not "you lack permission to use one", so it has
  // to be classified UNAVAILABLE and degrade to the encrypted file. Checked
  // before the generic denied/permission test below, which would otherwise
  // match on the substring and turn a routine no-keyring machine into a hard
  // error.
  if (msg.includes('access platform storage')) return 'UNAVAILABLE';
  if (msg.includes('locked')) return 'LOCKED';
  if (msg.includes('denied') || msg.includes('permission')) return 'DENIED';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('not found')) return 'NOT_FOUND';
  if (isErrorWithCode(error) && error.code === 'ENOENT') return 'NOT_FOUND';
  return 'UNAVAILABLE';
}

function getRemediation(code: SecureStoreErrorCode): string {
  switch (code) {
    case 'UNAVAILABLE':
      return 'Use --key, install a keyring backend, use seatbelt mode, or allow encrypted fallback storage';
    case 'LOCKED':
      return 'Unlock your keyring';
    case 'DENIED':
      return 'Check permissions, run as correct user';
    case 'CORRUPT':
      return 'Re-save the key or re-authenticate';
    case 'TIMEOUT':
      return 'Retry, check system load';
    case 'NOT_FOUND':
      return 'Save the key first';
    case 'RUNTIME_REPLACED':
      return RUNTIME_REPLACED_REMEDIATION;
    case 'CONFLICT':
      return 'Retry the operation; another process wrote this credential concurrently';
    default:
      return 'An unexpected error occurred';
  }
}

function isTransientError(error: unknown): boolean {
  return classifyError(error) === 'TIMEOUT';
}

// ─── SecureStore Class ───────────────────────────────────────────────────────

/**
 * Stores and retrieves secrets via the OS keychain or encrypted file fallback.
 *
 * @plan PLAN-20260211-SECURESTORE.P06
 * @requirement R1.1, R1.3
 */
export class SecureStore {
  private readonly serviceName: string;
  private readonly fallbackPolicy: 'allow' | 'deny';
  private readonly keyringLoaderFn: () => Promise<KeyringAdapter | null>;
  private readonly fallbackDir: string;
  private readonly logger: StorageLogger;
  private readonly machineSecretLoaderFn: () => Promise<Buffer | null>;
  private readonly machineSecretFilePath: string | undefined;
  private readonly lock: CredentialWriteLock;

  private keyringInstance: KeyringAdapter | null | undefined = undefined;
  private keyringLoadAttempted = false;
  private probeCache: { available: boolean; timestamp: number } | null = null;
  private readonly PROBE_TTL_MS = 60000;
  private consecutiveKeyringFailures = 0;
  private readonly KEYRING_FAILURE_THRESHOLD = 3;

  constructor(serviceName: string, options?: SecureStoreOptions) {
    this.serviceName = serviceName;
    this.fallbackDir =
      options?.fallbackDir ??
      path.join(
        // Resolve through the central path authority so LLXPRT_DATA_HOME and
        // the compatibility LLXPRT_CONFIG_HOME fallback are honored. Resolution
        // happens at construction time; later env changes do not move an
        // existing instance's fallback dir.
        Storage.getGlobalDataDir(),
        'secure-store',
        serviceName,
      );
    this.fallbackPolicy = options?.fallbackPolicy ?? 'allow';
    this.keyringLoaderFn =
      options?.keyringLoader ?? createDefaultKeyringAdapter;
    this.logger = options?.logger ?? new NullStorageLoggerImpl();
    this.machineSecretLoaderFn =
      options?.machineSecretLoader ?? this.defaultMachineSecretLoader;
    this.machineSecretFilePath = options?.machineSecretPath;
    this.lock = new CredentialWriteLock({
      lockDir: options?.lockDir ?? Storage.getCredentialLocksDir(),
      logger: this.logger,
    });
    setKeyringLogger(this.logger);
  }

  private defaultMachineSecretLoader = async (): Promise<Buffer | null> =>
    getMachineSecret({
      filePath: this.machineSecretFilePath,
    });

  // ─── Keyring Loading ──────────────────────────────────────────────────────

  private async getKeyring(): Promise<KeyringAdapter | null> {
    if (this.keyringLoadAttempted) return this.keyringInstance ?? null;
    this.keyringLoadAttempted = true;
    try {
      this.keyringInstance = await this.keyringLoaderFn();
      this.logger.debug(
        () =>
          `[keyring] @napi-rs/keyring loaded=${this.keyringInstance !== null}`,
      );
      return this.keyringInstance;
    } catch (error) {
      this.keyringInstance = null;
      this.logger.debug(
        () =>
          `[keyring] @napi-rs/keyring load failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  // ─── Key Validation ──────────────────────────────────────────────────────

  private validateKey(key: string): void {
    if (key.length === 0) {
      throw new SecureStoreError(
        'Key must not be empty',
        'CORRUPT',
        'Provide a non-empty key name',
      );
    }
    if (key.includes('/') || key.includes('\\') || key.includes('\0')) {
      throw new SecureStoreError(
        `Key contains path separator or null byte: ${key}`,
        'CORRUPT',
        'Key names must not contain path separators or null bytes',
      );
    }
    if (
      key === '.' ||
      key === '..' ||
      key.startsWith('./') ||
      key.startsWith('../')
    ) {
      throw new SecureStoreError(
        `Key contains relative-path component: ${key}`,
        'CORRUPT',
        'Key names must not be "." or ".." or start with "./" or "../"',
      );
    }
  }

  private getFallbackFilePath(key: string): string {
    this.validateKey(key);
    // Sanitize key for filesystem (especially Windows compatibility)
    // Escapes Windows-reserved characters: * < > : " / \ | ?
    const safeKey = key.replace(
      /[*<>:"/\\|?]/g,
      (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
    );
    return path.join(this.fallbackDir, safeKey + '.enc');
  }

  private getLegacyFallbackFilePath(key: string): string {
    this.validateKey(key);
    // Support legacy unencoded paths for backward compatibility
    return path.join(this.fallbackDir, key + '.enc');
  }

  // ─── Consecutive Failure Tracking ────────────────────────────────────────

  private recordKeyringSuccess(): void {
    this.consecutiveKeyringFailures = 0;
  }

  private recordKeyringFailure(): void {
    this.consecutiveKeyringFailures += 1;
    if (this.consecutiveKeyringFailures >= this.KEYRING_FAILURE_THRESHOLD) {
      this.probeCache = null;
    }
  }

  // ─── Availability Probe ──────────────────────────────────────────────────

  async isKeychainAvailable(): Promise<boolean> {
    assertRuntimeNotReplaced();
    if (this.probeCache !== null) {
      const elapsed = Date.now() - this.probeCache.timestamp;
      if (elapsed < this.PROBE_TTL_MS) {
        this.logger.debug(
          () => `[probe] cached=${this.probeCache!.available} (within TTL)`,
        );
        return this.probeCache.available;
      }
    }
    const adapter = await this.getKeyring();
    if (adapter === null) {
      this.probeCache = { available: false, timestamp: Date.now() };
      this.logger.debug(
        () => '[probe] @napi-rs/keyring not loaded — unavailable',
      );
      return false;
    }
    const testAccount =
      '__securestore_probe__' + crypto.randomUUID().substring(0, 8);
    const testValue = 'probe-' + Date.now();
    try {
      await adapter.setPassword(this.serviceName, testAccount, testValue);
      const retrieved = await adapter.getPassword(
        this.serviceName,
        testAccount,
      );
      await adapter.deletePassword(this.serviceName, testAccount);
      const probeOk = retrieved === testValue;
      this.probeCache = { available: probeOk, timestamp: Date.now() };
      this.logger.debug(() =>
        probeOk
          ? '[probe] keyring available — OS keychain active'
          : '[probe] keyring probe value mismatch — marking unavailable',
      );
      return probeOk;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.debug(() => `[probe] keyring probe failed: ${msg}`);
      if (isTransientError(error)) {
        this.probeCache = null;
      } else {
        this.probeCache = { available: false, timestamp: Date.now() };
      }
      return false;
    }
  }

  private async deleteFallbackFiles(key: string): Promise<boolean> {
    const currentPath = this.getFallbackFilePath(key);
    const legacyPath = this.getLegacyFallbackFilePath(key);
    const paths =
      legacyPath === currentPath ? [currentPath] : [currentPath, legacyPath];
    let deleted = false;
    for (const filePath of paths) {
      try {
        await fs.unlink(filePath);
        deleted = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.debug(
            () => `[secure-store] key='${key}' fallback cleanup failed: ${msg}`,
          );
        }
      }
    }
    return deleted;
  }

  private unavailableError(message: string): SecureStoreError {
    return new SecureStoreError(
      message,
      'UNAVAILABLE',
      getRemediation('UNAVAILABLE'),
    );
  }

  // ─── CRUD: set() ─────────────────────────────────────────────────────────

  async set(key: string, value: string): Promise<void> {
    this.validateKey(key);
    assertRuntimeNotReplaced();
    await this.lock.withLock(this.serviceName, key, () =>
      this.setLocked(key, value),
    );
  }

  private async setLocked(key: string, value: string): Promise<void> {
    const adapter = await this.getKeyring();
    let keyringWriteSucceeded = false;
    let keyringWriteError: unknown = null;
    if (adapter !== null) {
      try {
        await adapter.setPassword(this.serviceName, key, value);
        keyringWriteSucceeded = true;
      } catch (error) {
        keyringWriteError = error;
        this.recordKeyringFailure();
        this.logger.debug(
          () =>
            `[set] key='${key}' keyring write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (keyringWriteSucceeded && adapter !== null) {
      const result = await verifyKeyringWrite(
        adapter,
        this.serviceName,
        key,
        value,
      );
      if (result.outcome === 'verified') {
        this.recordKeyringSuccess();
        this.logger.debug(() => `[set] key='${key}' → verified keyring`);
        await this.deleteFallbackFiles(key);
        return;
      }

      this.recordKeyringFailure();

      if (result.outcome === 'conflict') {
        throw new SecureStoreError(
          'Keyring write verification detected a conflicting value from another process',
          'CONFLICT',
          getRemediation('CONFLICT'),
        );
      }

      // outcome === 'unverified': preserve existing fallback behavior.
      if (this.fallbackPolicy === 'deny') {
        throw this.unavailableError(
          'Keyring write could not be verified and fallback is denied',
        );
      }
      this.logger.debug(
        () =>
          `[set] key='${key}' → encrypted fallback file (unverified keyring write)`,
      );
      await this.writeFallbackFile(key, value);
      return;
    }

    // Keyring unavailable or write failed.
    if (this.fallbackPolicy === 'deny') {
      if (adapter !== null && keyringWriteError !== null) {
        const classified = classifyError(keyringWriteError);
        const msg =
          keyringWriteError instanceof Error
            ? keyringWriteError.message
            : String(keyringWriteError);
        throw new SecureStoreError(msg, classified, getRemediation(classified));
      }
      throw this.unavailableError(
        'Keyring is unavailable and fallback is denied',
      );
    }

    this.logger.debug(() => `[set] key='${key}' → fallback file`);
    await this.writeFallbackFile(key, value);
  }

  // ─── CRUD: get() ─────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    this.validateKey(key);
    assertRuntimeNotReplaced();
    const adapter = await this.getKeyring();
    if (adapter !== null) {
      try {
        const value = await adapter.getPassword(this.serviceName, key);
        if (value !== null) {
          this.recordKeyringSuccess();
          this.logger.debug(
            () => `[get] key='${key}' → found in keyring (OS keychain)`,
          );
          return value;
        }
        this.logger.debug(() => `[get] key='${key}' → not found in keyring`);
      } catch (error) {
        this.recordKeyringFailure();
        const classified = classifyError(error);
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.debug(
          () =>
            `[get] key='${key}' keyring read failed (${classified}): ${msg}`,
        );
        if (
          classified !== 'UNAVAILABLE' &&
          classified !== 'NOT_FOUND' &&
          classified !== 'TIMEOUT'
        ) {
          throw new SecureStoreError(
            msg,
            classified,
            getRemediation(classified),
          );
        }
      }
    } else {
      this.logger.debug(
        () => `[get] key='${key}' keyring adapter not available`,
      );
    }

    // Try fallback file (current path, then legacy)
    let fallbackValue = await this.readFallbackFile(key);
    if (fallbackValue === null) {
      const legacyPath = this.getLegacyFallbackFilePath(key);
      if (legacyPath !== this.getFallbackFilePath(key)) {
        fallbackValue = await this.readFallbackFileAtPath(legacyPath);
      }
    }
    if (fallbackValue !== null) {
      this.logger.debug(
        () => `[get] key='${key}' → found in encrypted fallback file`,
      );
      return fallbackValue;
    }
    this.logger.debug(() => `[get] key='${key}' → not found anywhere`);
    return null;
  }

  // ─── CRUD: delete() ──────────────────────────────────────────────────────

  async delete(key: string): Promise<boolean> {
    this.validateKey(key);
    assertRuntimeNotReplaced();
    return this.lock.withLock(this.serviceName, key, () =>
      this.deleteLocked(key),
    );
  }

  private async deleteLocked(key: string): Promise<boolean> {
    let deletedFromKeyring = false;
    let deletedFromFile = false;

    const adapter = await this.getKeyring();
    if (adapter !== null) {
      try {
        deletedFromKeyring = await adapter.deletePassword(
          this.serviceName,
          key,
        );
      } catch {
        // Keyring delete failed
      }
    }

    deletedFromFile = await this.deleteFallbackFiles(key);

    this.logger.debug(
      () =>
        `[delete] key='${key}' keyring=${deletedFromKeyring} fallback=${deletedFromFile}`,
    );
    return deletedFromKeyring || deletedFromFile;
  }

  // ─── CRUD: list() ────────────────────────────────────────────────────────

  async list(): Promise<string[]> {
    assertRuntimeNotReplaced();
    const keys = new Set<string>();

    const adapter = await this.getKeyring();
    if (adapter !== null && typeof adapter.findCredentials === 'function') {
      try {
        const creds = await adapter.findCredentials(this.serviceName);
        this.addKeyringAccounts(keys, creds);
      } catch {
        // Keyring enumeration failed
      }
    }

    try {
      const files = await fs.readdir(this.fallbackDir);
      this.addFallbackFileKeys(keys, files);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        // Non-missing-dir errors
      }
    }

    const sorted = Array.from(keys).sort();
    this.logger.debug(() => `[list] found ${sorted.length} key(s)`);
    return sorted;
  }

  private addKeyringAccounts(
    keys: Set<string>,
    creds: Array<{ account: string; password: string }>,
  ): void {
    for (const cred of creds) {
      if (!cred.account.startsWith('__securestore_probe__'))
        keys.add(cred.account);
    }
  }

  private addFallbackFileKeys(keys: Set<string>, files: string[]): void {
    for (const file of files) {
      if (file.endsWith('.enc'))
        this.addDecodedFallbackKey(keys, file.slice(0, -4));
    }
  }

  private addDecodedFallbackKey(keys: Set<string>, keyInFile: string): void {
    try {
      const decodedKey = decodeURIComponent(keyInFile);
      this.validateKey(decodedKey);
      keys.add(decodedKey);
    } catch {
      try {
        this.validateKey(keyInFile);
        keys.add(keyInFile);
      } catch {
        // Malformed filename — skip
      }
    }
  }

  // ─── CRUD: has() ─────────────────────────────────────────────────────────

  async has(key: string): Promise<boolean> {
    this.validateKey(key);
    assertRuntimeNotReplaced();

    const adapter = await this.getKeyring();
    if (adapter !== null) {
      try {
        const value = await adapter.getPassword(this.serviceName, key);
        if (value !== null) {
          return true;
        }
      } catch (error) {
        const classified = classifyError(error);
        if (classified !== 'NOT_FOUND') {
          throw new SecureStoreError(
            error instanceof Error ? error.message : String(error),
            classified,
            getRemediation(classified),
          );
        }
      }
    }

    const filePath = this.getFallbackFilePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      const legacyPath = this.getLegacyFallbackFilePath(key);
      if (legacyPath !== filePath) {
        try {
          await fs.access(legacyPath);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  // ─── Encrypted File Fallback: Write ──────────────────────────────────────

  private async writeFallbackFile(key: string, value: string): Promise<void> {
    await fs.mkdir(this.fallbackDir, { recursive: true, mode: 0o700 });

    const salt = crypto.randomBytes(SALT_LEN);

    const machineSecret = await this.machineSecretLoaderFn();
    const useV2 = machineSecret !== null;

    // Never downgrade an existing v:2 file to v:1 when the machine secret is
    // unavailable — refuse rather than destroying the stronger root of trust.
    if (!useV2) {
      const existingVersion = await this.readExistingEnvelopeVersion(
        this.getFallbackFilePath(key),
      );
      if (existingVersion === 2) {
        throw new SecureStoreError(
          'Refusing to overwrite v:2 fallback file with a weaker v:1 envelope while the machine secret is unavailable',
          'UNAVAILABLE',
          'Restore the machine secret and re-save the key, or remove the existing file if intentional.',
        );
      }
    }

    const kdfInput = useV2
      ? deriveV2KdfInput(this.serviceName, machineSecret)
      : deriveV1KdfInput(this.serviceName);
    const encKey = await scryptAsync(kdfInput, salt, 32, SCRYPT_PARAMS);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([salt, iv, authTag, encrypted]);
    const envelope: Envelope = {
      v: useV2 ? 2 : 1,
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        N: SCRYPT_PARAMS.N,
        r: SCRYPT_PARAMS.r,
        p: SCRYPT_PARAMS.p,
        saltLen: SALT_LEN,
      },
      data: ciphertext.toString('base64'),
    };

    const finalPath = this.getFallbackFilePath(key);
    const tempPath = finalPath + '.tmp.' + crypto.randomUUID().substring(0, 8);
    const fd = await fs.open(tempPath, 'w', 0o600);
    try {
      await fd.writeFile(JSON.stringify(envelope));
      await fd.sync();
      await fd.close();
      await this.renameWithRetry(tempPath, finalPath);
      await fs.chmod(finalPath, 0o600);
    } catch (error) {
      await fd.close().catch(() => {});
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  private async readExistingEnvelopeVersion(
    filePath: string,
  ): Promise<number | null> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    try {
      const parsed = JSON.parse(content);
      return isValidEnvelope(parsed) ? parsed.v : null;
    } catch {
      return null;
    }
  }

  private async renameWithRetry(
    tempPath: string,
    finalPath: string,
  ): Promise<void> {
    // Retry rename for Windows concurrent write EPERM issues
    let renameAttempts = 0;
    while (renameAttempts < 3) {
      try {
        await fs.rename(tempPath, finalPath);
        break;
      } catch (error) {
        renameAttempts++;
        if (
          renameAttempts >= 3 ||
          (error as NodeJS.ErrnoException).code !== 'EPERM'
        ) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  // ─── Encrypted File Fallback: Read ───────────────────────────────────────

  private async readFallbackFile(key: string): Promise<string | null> {
    const filePath = this.getFallbackFilePath(key);
    return this.readFallbackFileAtPath(filePath);
  }

  private async readFallbackFileAtPath(
    filePath: string,
  ): Promise<string | null> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(content);
    } catch {
      throw new SecureStoreError(
        'Fallback file is corrupt or uses an unrecognized format',
        'CORRUPT',
        'Re-save the key or re-authenticate',
      );
    }
    const env = envelope as Record<string, unknown>;
    if (typeof env.v !== 'number' || !ENVELOPE_VERSIONS.has(env.v)) {
      throw new SecureStoreError(
        'Unrecognized envelope version: ' +
          String(env.v) +
          '. This file may require a newer version.',
        'CORRUPT',
        'upgrade to the latest version or re-save the key',
      );
    }
    if (!isValidEnvelope(envelope)) {
      throw new SecureStoreError(
        'Fallback file envelope is malformed',
        'CORRUPT',
        'Re-save the key or re-authenticate',
      );
    }
    const ciphertext = Buffer.from(envelope.data, 'base64');
    const salt = ciphertext.subarray(0, SALT_LEN);
    const iv = ciphertext.subarray(SALT_LEN, SALT_LEN + 12);
    const authTag = ciphertext.subarray(28, 44);
    const encryptedData = ciphertext.subarray(44);
    let kdfInput: string;
    if (envelope.v === 2) {
      const machineSecret = await this.machineSecretLoaderFn();
      if (machineSecret === null) {
        throw new SecureStoreError(
          'v:2 fallback file requires a machine secret that is unavailable',
          'CORRUPT',
          'Re-save the key or re-authenticate. The machine secret may have changed or been removed.',
        );
      }
      kdfInput = deriveV2KdfInput(this.serviceName, machineSecret);
    } else {
      kdfInput = deriveV1KdfInput(this.serviceName);
    }
    const decKey = await scryptAsync(kdfInput, salt, 32, SCRYPT_PARAMS);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', decKey, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(encryptedData),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new SecureStoreError(
        'Failed to decrypt fallback file',
        'CORRUPT',
        'Re-save the key or re-authenticate. The file may have been created on a different machine.',
      );
    }
  }
}
