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
import envPaths from 'env-paths';
import type { StorageLogger } from '../types/logger.js';
import { NullStorageLoggerImpl } from '../types/logger.js';
import { getMachineSecret } from './machine-secret.js';
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

// Platform-standard paths for llxprt-code app data (no suffix to match documented paths)
const platformPaths = envPaths('llxprt-code', { suffix: '' });

let _moduleLogger: StorageLogger = new NullStorageLoggerImpl();

function setSecureStoreModuleLogger(logger: StorageLogger): void {
  _moduleLogger = logger;
}

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
  logger?: StorageLogger;
  machineSecretLoader?: () => Promise<Buffer | null>;
  machineSecretPath?: string;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function isErrorWithCode(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string'
  );
}

function isErrorWithMessage(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

const KEYRING_MODULE_ERROR_CODES = new Set([
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND',
  'ERR_DLOPEN_FAILED',
]);

function isKeyringModuleMissingError(error: unknown): boolean {
  if (isErrorWithCode(error) && KEYRING_MODULE_ERROR_CODES.has(error.code)) {
    return true;
  }
  if (!isErrorWithMessage(error)) {
    return false;
  }
  return error.message.includes('@napi-rs/keyring');
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
  if (isErrorWithCode(error) && error.code === 'ENOENT') return 'NOT_FOUND';
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

type FindCredentialsFunction = (
  service: string,
) => Promise<Array<{ account: string; password: string }>>;

function withFindCredentials(
  adapter: KeyringAdapter,
  findCredentialsFn: FindCredentialsFunction | undefined,
): KeyringAdapter {
  if (findCredentialsFn !== undefined) {
    adapter.findCredentials = async (service: string) => {
      try {
        return await findCredentialsFn(service);
      } catch {
        return [];
      }
    };
  }

  return adapter;
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
      findCredentials?: FindCredentialsFunction;
      findCredentialsAsync?: FindCredentialsFunction;
    };
    const findCredentialsFn = kr.findCredentials ?? kr.findCredentialsAsync;
    const adapter: KeyringAdapter = {
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
    };

    return withFindCredentials(adapter, findCredentialsFn);
  } catch (error) {
    if (!isKeyringModuleMissingError(error) && process.env.DEBUG) {
      const message = isErrorWithMessage(error) ? error.message : String(error);
      _moduleLogger.warn(
        `[SecureStore] Unexpected error loading @napi-rs/keyring: ${message}`,
      );
    }
    return null;
  }
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
      path.join(platformPaths.data, 'secure-store', serviceName);
    this.fallbackPolicy = options?.fallbackPolicy ?? 'allow';
    this.keyringLoaderFn =
      options?.keyringLoader ?? createDefaultKeyringAdapter;
    this.logger = options?.logger ?? new NullStorageLoggerImpl();
    this.machineSecretLoaderFn =
      options?.machineSecretLoader ?? this.defaultMachineSecretLoader;
    this.machineSecretFilePath = options?.machineSecretPath;
    setSecureStoreModuleLogger(this.logger);
  }

  private defaultMachineSecretLoader = async (): Promise<Buffer | null> =>
    getMachineSecret({
      filePath: this.machineSecretFilePath,
    });

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

  private async writeFallbackAfterKeyringSuccess(
    key: string,
    value: string,
  ): Promise<void> {
    try {
      await this.writeFallbackFile(key, value);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.debug(
        () =>
          `[set] key='${key}' fallback backup failed after keyring success (${this.fallbackDir}): ${msg}`,
      );
    }
  }

  // ─── CRUD: set() ─────────────────────────────────────────────────────────

  async set(key: string, value: string): Promise<void> {
    this.validateKey(key);

    // Try keyring first (directly, not via isKeychainAvailable)
    const adapter = await this.getKeyring();
    let keyringWriteSucceeded = false;
    let keyringWriteError: unknown = null;
    if (adapter !== null) {
      try {
        await adapter.setPassword(this.serviceName, key, value);
        this.recordKeyringSuccess();
        this.logger.debug(() => `[set] key='${key}' → keyring (OS keychain)`);

        keyringWriteSucceeded = true;
      } catch (error) {
        keyringWriteError = error;
        this.recordKeyringFailure();
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.debug(
          () => `[set] key='${key}' keyring write failed: ${msg}`,
        );
      }
    }

    // If keyring succeeded and fallbackPolicy is deny, we're done
    if (keyringWriteSucceeded && this.fallbackPolicy === 'deny') {
      return;
    }

    // If keyring unavailable or write failed, check fallback policy
    if (!keyringWriteSucceeded && this.fallbackPolicy === 'deny') {
      if (adapter !== null && keyringWriteError !== null) {
        const classified = classifyError(keyringWriteError);
        const msg =
          keyringWriteError instanceof Error
            ? keyringWriteError.message
            : String(keyringWriteError);
        this.logger.debug(
          () =>
            `[set] key='${key}' fallback denied after keyring write failure (${classified})`,
        );
        throw new SecureStoreError(msg, classified, getRemediation(classified));
      }

      this.logger.debug(
        () => `[set] key='${key}' fallback denied — throwing UNAVAILABLE`,
      );
      throw new SecureStoreError(
        'Keyring is unavailable and fallback is denied',
        'UNAVAILABLE',
        'Use --key, install a keyring backend, or change fallbackPolicy to allow',
      );
    }

    const shouldWriteFallback =
      this.fallbackPolicy === 'allow' &&
      (!keyringWriteSucceeded || process.platform === 'linux');

    if (!shouldWriteFallback) {
      return;
    }

    this.logger.debug(
      () =>
        `[set] key='${key}' → encrypted fallback file (${this.fallbackDir})`,
    );

    if (keyringWriteSucceeded) {
      await this.writeFallbackAfterKeyringSuccess(key, value);
      return;
    }

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
    let fallbackValue = await this.readFallbackFile(key);
    if (fallbackValue === null) {
      // Try legacy unencoded path
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

    // Always try unlinking the legacy path too if it's different
    const legacyPath = this.getLegacyFallbackFilePath(key);
    if (legacyPath !== filePath) {
      try {
        await fs.unlink(legacyPath);
        deletedFromFile = true;
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') {
          // Non-missing-file errors
        }
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
      if (!cred.account.startsWith('__securestore_probe__')) {
        keys.add(cred.account);
      }
    }
  }

  private addFallbackFileKeys(keys: Set<string>, files: string[]): void {
    for (const file of files) {
      if (!file.endsWith('.enc')) {
        continue;
      }
      this.addDecodedFallbackKey(keys, file.slice(0, -4));
    }
  }

  private addDecodedFallbackKey(keys: Set<string>, keyInFile: string): void {
    // First try decoding as the new sanitizer (which uses %XX for reserved chars)
    // or as encodeURIComponent (previous version). decodeURIComponent handles both.
    try {
      const decodedKey = decodeURIComponent(keyInFile);
      this.validateKey(decodedKey);
      keys.add(decodedKey);
    } catch {
      // If decoding fails, it might be a legacy raw key filename.
      try {
        this.validateKey(keyInFile);
        keys.add(keyInFile);
      } catch {
        // Truly malformed filename — skip
      }
    }
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
      // Try legacy path
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

    // Never downgrade an existing v:2 file to v:1. If the machine secret is
    // unavailable, inspect the existing target envelope; if it is v:2, refuse
    // to overwrite it with a weaker v:1 envelope rather than silently
    // destroying the stronger root of trust. v:1 fallback is still allowed for
    // new files or existing v:1 files.
    if (!useV2) {
      const finalPathForCheck = this.getFallbackFilePath(key);
      const existingVersion =
        await this.readExistingEnvelopeVersion(finalPathForCheck);
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

  /**
   * Reads only the version field of an existing fallback envelope without
   * attempting decryption. Returns the version (1 or 2) if the file exists
   * and parses as a valid envelope, or null if it does not exist or is not
   * a recognized envelope. Used by writeFallbackFile to detect v:2 files
   * that must not be downgraded to v:1.
   */
  private async readExistingEnvelopeVersion(
    filePath: string,
  ): Promise<number | null> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    if (!isValidEnvelope(parsed)) {
      return null;
    }
    return parsed.v;
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
