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
import * as os from 'node:os';
import { DebugLogger } from '../debug/DebugLogger.js';

// ─── Error Type ──────────────────────────────────────────────────────────────

export type SecureStoreErrorCode =
  | 'UNAVAILABLE'
  | 'LOCKED'
  | 'DENIED'
  | 'CORRUPT'
  | 'TIMEOUT'
  | 'NOT_FOUND';

export class SecureStoreError extends Error {
  readonly code: SecureStoreErrorCode;
  readonly remediation: string;

  constructor(
    message: string,
    code: SecureStoreErrorCode,
    remediation: string,
  ) {
    super(message);
    this.name = 'SecureStoreError';
    this.code = code;
    this.remediation = remediation;
  }
}

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
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function safeUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return String(process.getuid?.() ?? 'unknown');
  }
}

function classifyError(error: unknown): SecureStoreErrorCode {
  const msg =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  if (msg.includes('locked')) return 'LOCKED';
  if (msg.includes('denied') || msg.includes('permission')) return 'DENIED';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('not found')) return 'NOT_FOUND';
  const errObj = error as NodeJS.ErrnoException;
  if (errObj?.code === 'ENOENT') return 'NOT_FOUND';
  return 'UNAVAILABLE';
}

function getRemediation(code: SecureStoreErrorCode): string {
  switch (code) {
    case 'UNAVAILABLE':
      return 'Use --key, install a keyring backend, or use seatbelt mode';
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
    default:
      return 'An unexpected error occurred';
  }
}

function isTransientError(error: unknown): boolean {
  return classifyError(error) === 'TIMEOUT';
}

interface Envelope {
  v: number;
  crypto: {
    alg: string;
    kdf: string;
    N: number;
    r: number;
    p: number;
    saltLen: number;
  };
  data: string;
}

function isValidEnvelope(envelope: unknown): envelope is Envelope {
  if (typeof envelope !== 'object' || envelope === null) return false;
  const env = envelope as Record<string, unknown>;
  if (env.v !== 1) return false;
  if (typeof env.crypto !== 'object' || env.crypto === null) return false;
  const c = env.crypto as Record<string, unknown>;
  if (c.alg !== 'aes-256-gcm') return false;
  if (c.kdf !== 'scrypt') return false;
  if (typeof env.data !== 'string') return false;
  return true;
}

/**
 * Creates a default KeyringAdapter by loading @napi-rs/keyring.
 * Exported so that other modules can reuse this without duplicating
 * the @napi-rs/keyring import.
 *
 * @plan PLAN-20260211-SECURESTORE.P08
 */
export async function createDefaultKeyringAdapter(): Promise<KeyringAdapter | null> {
  try {
    const module = await import('@napi-rs/keyring');
    const keyring = (module as Record<string, unknown>).default ?? module;
    const kr = keyring as {
      AsyncEntry: new (
        service: string,
        account: string,
      ) => {
        getPassword(): Promise<string | null>;
        setPassword(password: string): Promise<void>;
        deleteCredential(): Promise<boolean>;
      };
      findCredentials?(
        service: string,
      ): Promise<Array<{ account: string; password: string }>>;
      findCredentialsAsync?(
        service: string,
      ): Promise<Array<{ account: string; password: string }>>;
    };
    const findCredentialsFn = kr.findCredentials ?? kr.findCredentialsAsync;
    return {
      getPassword: async (service: string, account: string) => {
        const entry = new kr.AsyncEntry(service, account);
        return entry.getPassword();
      },
      setPassword: async (
        service: string,
        account: string,
        password: string,
      ) => {
        const entry = new kr.AsyncEntry(service, account);
        await entry.setPassword(password);
      },
      deletePassword: async (service: string, account: string) => {
        const entry = new kr.AsyncEntry(service, account);
        return entry.deleteCredential();
      },
      findCredentials: findCredentialsFn
        ? async (service: string) => {
            try {
              return await findCredentialsFn(service);
            } catch {
              return [];
            }
          }
        : undefined,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const isModuleMissing =
      err?.code === 'ERR_MODULE_NOT_FOUND' ||
      err?.code === 'MODULE_NOT_FOUND' ||
      err?.code === 'ERR_DLOPEN_FAILED' ||
      err?.message?.includes('@napi-rs/keyring');
    if (!isModuleMissing && process.env.DEBUG) {
      console.warn(
        `[SecureStore] Unexpected error loading @napi-rs/keyring: ${err?.message}`,
      );
    }
    return null;
  }
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLen, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
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
  private readonly logger: DebugLogger;

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
      path.join(os.homedir(), '.llxprt', 'secure-store', serviceName);
    this.fallbackPolicy = options?.fallbackPolicy ?? 'allow';
    this.keyringLoaderFn =
      options?.keyringLoader ?? createDefaultKeyringAdapter;
    this.logger = new DebugLogger(`llxprt:secure-store:${serviceName}`);
  }

  // ─── Keyring Loading ──────────────────────────────────────────────────────

  private async getKeyring(): Promise<KeyringAdapter | null> {
    if (this.keyringLoadAttempted) {
      return this.keyringInstance ?? null;
    }
    this.keyringLoadAttempted = true;
    try {
      const adapter = await this.keyringLoaderFn();
      this.keyringInstance = adapter;
      this.logger.debug(
        () => `[keyring] @napi-rs/keyring loaded=${adapter !== null}`,
      );
      return adapter;
    } catch (error) {
      this.keyringInstance = null;
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.debug(() => `[keyring] @napi-rs/keyring load failed: ${msg}`);
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
    if (key.includes('/') || key.includes('\\')) {
      throw new SecureStoreError(
        `Key contains path separator: ${key}`,
        'CORRUPT',
        'Key names must not contain path separators',
      );
    }
    if (key.includes('\0')) {
      throw new SecureStoreError(
        'Key contains null byte',
        'CORRUPT',
        'Key names must not contain null bytes',
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
    // Check cache — honor both positive and negative results within TTL
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
      if (!probeOk) {
        this.logger.debug(
          () => '[probe] keyring probe value mismatch — marking unavailable',
        );
      } else {
        this.logger.debug(
          () => '[probe] keyring available — OS keychain active',
        );
      }
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

  // ─── CRUD: set() ─────────────────────────────────────────────────────────

  async set(key: string, value: string): Promise<void> {
    this.validateKey(key);

    // Try keyring first (directly, not via isKeychainAvailable)
    const adapter = await this.getKeyring();
    if (adapter !== null) {
      try {
        await adapter.setPassword(this.serviceName, key, value);
        this.recordKeyringSuccess();
        this.logger.debug(() => `[set] key='${key}' → keyring (OS keychain)`);
        return;
      } catch (error) {
        this.recordKeyringFailure();
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.debug(
          () => `[set] key='${key}' keyring write failed: ${msg}`,
        );
      }
    }

    // Keyring unavailable or write failed — check fallback policy
    if (this.fallbackPolicy === 'deny') {
      this.logger.debug(
        () => `[set] key='${key}' fallback denied — throwing UNAVAILABLE`,
      );
      throw new SecureStoreError(
        'Keyring is unavailable and fallback is denied',
        'UNAVAILABLE',
        'Use --key, install a keyring backend, or change fallbackPolicy to allow',
      );
    }

    this.logger.debug(
      () =>
        `[set] key='${key}' → encrypted fallback file (${this.fallbackDir})`,
    );
    await this.writeFallbackFile(key, value);
  }

  // ─── CRUD: get() ─────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    this.validateKey(key);

    // Try keyring first (authoritative)
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
        // Re-throw non-transient, non-availability errors so callers know
        // the keyring is actively denying access (not just missing).
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

    // Try fallback file
    const fallbackValue = await this.readFallbackFile(key);
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

    const filePath = this.getFallbackFilePath(key);
    try {
      await fs.unlink(filePath);
      deletedFromFile = true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        // Non-missing-file errors
      }
    }

    this.logger.debug(
      () =>
        `[delete] key='${key}' keyring=${deletedFromKeyring} fallback=${deletedFromFile}`,
    );
    return deletedFromKeyring || deletedFromFile;
  }

  // ─── CRUD: list() ────────────────────────────────────────────────────────

  async list(): Promise<string[]> {
    const keys = new Set<string>();

    const adapter = await this.getKeyring();
    if (adapter !== null && typeof adapter.findCredentials === 'function') {
      try {
        const creds = await adapter.findCredentials(this.serviceName);
        for (const cred of creds) {
          if (!cred.account.startsWith('__securestore_probe__')) {
            keys.add(cred.account);
          }
        }
      } catch {
        // Keyring enumeration failed
      }
    }

    try {
      const files = await fs.readdir(this.fallbackDir);
      for (const file of files) {
        if (file.endsWith('.enc')) {
          const keyName = file.slice(0, -4);
          try {
            this.validateKey(keyName);
            keys.add(keyName);
          } catch {
            // Malformed filename — skip
          }
        }
      }
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

  // ─── CRUD: has() ─────────────────────────────────────────────────────────

  async has(key: string): Promise<boolean> {
    this.validateKey(key);

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
      return false;
    }
  }

  // ─── Encrypted File Fallback: Write ──────────────────────────────────────

  private async writeFallbackFile(key: string, value: string): Promise<void> {
    await fs.mkdir(this.fallbackDir, { recursive: true, mode: 0o700 });

    const salt = crypto.randomBytes(16);
    const machineId = crypto
      .createHash('sha256')
      .update(os.hostname() + safeUsername())
      .digest('hex');
    const kdfInput = this.serviceName + '-' + machineId;
    const encKey = await scryptAsync(kdfInput, salt, 32, {
      N: 16384,
      r: 8,
      p: 1,
    });

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    const ciphertext = Buffer.concat([salt, iv, authTag, encrypted]);
    const envelope: Envelope = {
      v: 1,
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        N: 16384,
        r: 8,
        p: 1,
        saltLen: 16,
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
      await fs.rename(tempPath, finalPath);
      await fs.chmod(finalPath, 0o600);
    } catch (error) {
      await fd.close().catch(() => {});
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  // ─── Encrypted File Fallback: Read ───────────────────────────────────────

  private async readFallbackFile(key: string): Promise<string | null> {
    const filePath = this.getFallbackFilePath(key);

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return null;
      }
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
    if (env.v !== 1) {
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
    const salt = ciphertext.subarray(0, 16);
    const iv = ciphertext.subarray(16, 28);
    const authTag = ciphertext.subarray(28, 44);
    const encryptedData = ciphertext.subarray(44);

    const machineId = crypto
      .createHash('sha256')
      .update(os.hostname() + safeUsername())
      .digest('hex');
    const kdfInput = this.serviceName + '-' + machineId;
    const decKey = await scryptAsync(kdfInput, salt, 32, {
      N: 16384,
      r: 8,
      p: 1,
    });

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', decKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([
        decipher.update(encryptedData),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch {
      throw new SecureStoreError(
        'Failed to decrypt fallback file',
        'CORRUPT',
        'Re-save the key or re-authenticate. The file may have been created on a different machine.',
      );
    }
  }
}
