/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keyring-backed OAuth token storage implementing the TokenStore interface.
 *
 * Delegates credential CRUD to ISecureStore (injected via DI) and uses
 * filesystem-based advisory locks for refresh concurrency control.
 *
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06, PLAN-20260608-ISSUE1586.P09
 * @requirement R1.1, R1.2, R1.3, REQ-AUTH-001.1
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import {
  OAuthTokenSchema,
  type OAuthToken,
  type BucketStats,
} from './types.js';
import { type TokenStore } from './token-store.js';
import {
  type ISecureStore,
  type ISecureStoreError,
} from './interfaces/secure-store.js';
import { type IDebugLogger } from './interfaces/debug-logger.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** @internal */
const _SERVICE_NAME = 'llxprt-code-oauth';
void _SERVICE_NAME;
// Allow email-style bucket names (e.g., user@example.com) while keeping filenames safe.
// @fix issue1439 - relaxed from /^[a-zA-Z0-9_-]+$/ to allow '.' and '@'
const NAME_REGEX = /^[a-zA-Z0-9._@-]{1,64}$/;
const DEFAULT_BUCKET = 'default';
const DEFAULT_LOCK_WAIT_MS = 10_000;
const DEFAULT_STALE_THRESHOLD_MS = 30_000;
const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_WRITE_GRACE_MS = 750;

// Inline platform data path matching envPaths('llxprt-code', { suffix: '' }).data
// without importing the package (auth is a leaf package with no extra deps).
function getPlatformDataDir(): string {
  const home = homedir();
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', 'llxprt-code');
  }
  if (platform() === 'win32') {
    const localAppData =
      process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local');
    return join(localAppData, 'llxprt-code', 'Data');
  }
  const xdgData = process.env['XDG_DATA_HOME'] ?? join(home, '.local', 'share');
  return join(xdgData, 'llxprt-code');
}

/** Resolved on each call so LLXPRT_CONFIG_HOME changes take effect. */
function getLockDir(): string {
  const configHome = process.env['LLXPRT_CONFIG_HOME'];
  const baseDir = configHome ?? join(getPlatformDataDir(), 'configuration');
  return join(baseDir, 'oauth', 'locks');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── KeyringTokenStore Class ─────────────────────────────────────────────────

/**
 * Keyring-backed token store with filesystem advisory locks.
 *
 * @internal **DO NOT instantiate directly in consumer code.**
 * Use `createTokenStore()` from `credential-store-factory.ts` instead.
 *
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06, PLAN-20260608-ISSUE1586.P11
 * @plan PLAN-20250214-CREDPROXY.P36
 */
export class KeyringTokenStore implements TokenStore {
  private static readonly NO_OP_LOGGER: IDebugLogger = {
    debug: () => {},
    error: () => {},
    warn: () => {},
    log: () => {},
  };

  private readonly secureStore: ISecureStore;
  private readonly logger: IDebugLogger;
  private readonly lockDir: string;

  constructor(options?: {
    secureStore?: ISecureStore;
    logger?: IDebugLogger;
    lockDir?: string;
  }) {
    if (!options?.secureStore) {
      throw new Error(
        'KeyringTokenStore requires an ISecureStore instance. ' +
          'Use createKeyringTokenStore() from core.',
      );
    }
    this.secureStore = options.secureStore;
    this.logger = options.logger ?? KeyringTokenStore.NO_OP_LOGGER;
    this.lockDir = options.lockDir ?? getLockDir();
  }

  private validateName(name: string, label: string): void {
    if (!NAME_REGEX.test(name)) {
      throw new Error(
        `Invalid ${label} name: "${name}". Allowed: letters, numbers, dashes, underscores, dots, @ (1-64 chars).`,
      );
    }
  }

  private accountKey(provider: string, bucket?: string): string {
    const resolvedBucket = bucket ?? DEFAULT_BUCKET;
    this.validateName(provider, 'provider');
    this.validateName(resolvedBucket, 'bucket');
    return `${provider}:${resolvedBucket}`;
  }

  /**
   * Non-cryptographic FNV-1a hash for debug log identifiers.
   */
  private hashIdentifier(key: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  private lockFilePath(provider: string, bucket?: string): string {
    const resolved = bucket ?? DEFAULT_BUCKET;
    if (resolved === DEFAULT_BUCKET) {
      return join(this.lockDir, `${provider}-refresh.lock`);
    }
    return join(this.lockDir, `${provider}-${resolved}-refresh.lock`);
  }

  private authLockFilePath(provider: string, bucket?: string): string {
    const resolved = bucket ?? DEFAULT_BUCKET;
    if (resolved === DEFAULT_BUCKET) {
      return join(this.lockDir, `${provider}-auth.lock`);
    }
    return join(this.lockDir, `${provider}-${resolved}-auth.lock`);
  }

  /**
   * Ensures the lock directory exists.
   */
  private async ensureLockDir(): Promise<void> {
    await fs.mkdir(this.lockDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Shared lock acquisition logic used by both refresh and auth locks.
   */
  private async acquireLock(
    lockPath: string,
    waitMs: number,
    staleMs: number,
  ): Promise<boolean> {
    const startTime = Date.now();

    await this.ensureLockDir();

    this.logger.debug(
      `[acquireLock] wait=${waitMs} stale=${staleMs} poll=${LOCK_POLL_INTERVAL_MS}`,
    );

    while (Date.now() - startTime < waitMs) {
      const createResult = await this.tryCreateLock(lockPath);
      if (createResult === 'acquired') {
        return true;
      }

      if (await this.shouldRetryAfterExistingCheck(lockPath, staleMs)) {
        await sleep(LOCK_POLL_INTERVAL_MS);
      }
    }

    return false;
  }

  private async shouldRetryAfterExistingCheck(
    lockPath: string,
    staleMs: number,
  ): Promise<boolean> {
    const checkResult = await this.checkExistingLock(lockPath, staleMs);
    return checkResult !== 'stale_broken';
  }

  private async removeStaleLock(lockPath: string): Promise<void> {
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async lockOwnershipConfirmed(
    lockPath: string,
    createdLockInfo: { pid: number; timestamp: number },
  ): Promise<boolean> {
    try {
      const content = await fs.readFile(lockPath, 'utf8');
      const existing = JSON.parse(content) as {
        pid: number;
        timestamp: number;
      };
      return (
        existing.pid === createdLockInfo.pid &&
        existing.timestamp === createdLockInfo.timestamp
      );
    } catch {
      return false;
    }
  }

  private async tryCreateLock(
    lockPath: string,
  ): Promise<'acquired' | 'exists'> {
    let createdLockInfo: { pid: number; timestamp: number } | null = null;
    try {
      const lockInfo = { pid: process.pid, timestamp: Date.now() };
      await fs.writeFile(lockPath, JSON.stringify(lockInfo), {
        flag: 'wx',
        mode: 0o600,
      });
      createdLockInfo = lockInfo;

      if (await this.lockOwnershipConfirmed(lockPath, createdLockInfo)) {
        return 'acquired';
      }
    } catch (writeError) {
      const err = writeError as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        throw writeError;
      }
    }
    return 'exists';
  }

  private async checkExistingLock(
    lockPath: string,
    staleMs: number,
  ): Promise<'retry' | 'stale_broken' | 'fresh'> {
    try {
      const content = await fs.readFile(lockPath, 'utf8');
      const existing = JSON.parse(content) as {
        pid: number;
        timestamp: number;
      };
      const lockAge = Date.now() - existing.timestamp;

      const hasValidPid =
        typeof existing.pid === 'number' &&
        Number.isInteger(existing.pid) &&
        existing.pid > 0;
      const isRecentInFlightWrite =
        !hasValidPid && lockAge <= LOCK_WRITE_GRACE_MS;

      if (isRecentInFlightWrite) {
        return 'retry';
      }

      if (lockAge > staleMs) {
        await this.removeStaleLock(lockPath);
        return 'stale_broken';
      }

      return 'fresh';
    } catch {
      try {
        const stat = await fs.stat(lockPath);
        const fileAge = Date.now() - stat.mtimeMs;
        if (fileAge <= LOCK_WRITE_GRACE_MS) {
          return 'retry';
        }
      } catch {
        // Ignore stat errors
      }

      await this.removeStaleLock(lockPath);
      return 'stale_broken';
    }
  }

  private async releaseLock(lockPath: string): Promise<void> {
    await this.removeStaleLock(lockPath);
  }

  /**
   * Validates and persists an OAuth token to ISecureStore.
   */
  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(
      `[saveToken] [${this.hashIdentifier(key)}] type=${token.token_type}`,
    );
    const validatedToken = OAuthTokenSchema.passthrough().parse(token);
    const serialized = JSON.stringify(validatedToken);
    await this.secureStore.set(key, serialized);
  }

  /**
   * Retrieves and validates an OAuth token from ISecureStore.
   */
  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(`[getToken] [${this.hashIdentifier(key)}]`);

    let raw: string | null;
    try {
      raw = await this.secureStore.get(key);
    } catch (error) {
      const ssError = error as ISecureStoreError;
      if ('code' in ssError && ssError.code === 'CORRUPT') {
        this.logger.warn(
          `Corrupt token envelope for [${this.hashIdentifier(key)}]: ${ssError.message}`,
        );
        return null;
      }
      throw error;
    }

    if (raw === null) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseError) {
      const msg =
        parseError instanceof Error ? parseError.message : String(parseError);
      this.logger.warn(
        `Corrupt token JSON for [${this.hashIdentifier(key)}]: ${msg}`,
      );
      return null;
    }

    try {
      return OAuthTokenSchema.passthrough().parse(parsed);
    } catch (zodError) {
      const msg =
        zodError instanceof Error ? zodError.message : String(zodError);
      this.logger.warn(
        `Invalid token schema for [${this.hashIdentifier(key)}]: ${msg}`,
      );
      return null;
    }
  }

  /**
   * Removes a token from ISecureStore. Best-effort — errors are swallowed.
   */
  async removeToken(provider: string, bucket?: string): Promise<void> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(`[removeToken] [${this.hashIdentifier(key)}]`);
    try {
      await this.secureStore.delete(key);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to remove token for [${this.hashIdentifier(key)}]: ${msg}`,
      );
    }
  }

  /**
   * Lists all unique provider names from ISecureStore keys.
   */
  async listProviders(): Promise<string[]> {
    this.logger.debug(`[listProviders]`);
    try {
      const allKeys = await this.secureStore.list();
      const providerSet = new Set<string>();
      for (const key of allKeys) {
        if (key.includes(':')) {
          const provider = key.split(':')[0];
          providerSet.add(provider);
        }
      }
      return Array.from(providerSet).sort();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to list providers: ${msg}`);
      return [];
    }
  }

  /**
   * Lists all bucket names for a given provider.
   */
  async listBuckets(provider: string): Promise<string[]> {
    this.validateName(provider, 'provider');
    try {
      const allKeys = await this.secureStore.list();
      const prefix = `${provider}:`;
      const buckets: string[] = [];
      for (const key of allKeys) {
        if (key.startsWith(prefix)) {
          const bucket = key.substring(prefix.length);
          buckets.push(bucket);
        }
      }
      return buckets.sort();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to list buckets for [${this.hashIdentifier(provider + ':')}]: ${msg}`,
      );
      return [];
    }
  }

  /**
   * Returns placeholder bucket statistics if a token exists for the given bucket.
   */
  async getBucketStats(
    provider: string,
    bucket: string,
  ): Promise<BucketStats | null> {
    const token = await this.getToken(provider, bucket);
    if (token === null) {
      return null;
    }
    return {
      bucket,
      requestCount: 0,
      percentage: 0,
      lastUsed: undefined,
    };
  }

  /**
   * Acquires a filesystem-based advisory lock for token refresh.
   */
  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    this.validateName(provider, 'provider');
    if (options?.bucket) this.validateName(options.bucket, 'bucket');

    const lockPath = this.lockFilePath(provider, options?.bucket);
    const waitMs = options?.waitMs ?? DEFAULT_LOCK_WAIT_MS;
    const staleMs = options?.staleMs ?? DEFAULT_STALE_THRESHOLD_MS;

    return this.acquireLock(lockPath, waitMs, staleMs);
  }

  /**
   * Releases a filesystem-based advisory lock. Idempotent.
   */
  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    this.validateName(provider, 'provider');
    if (bucket) this.validateName(bucket, 'bucket');
    const lockPath = this.lockFilePath(provider, bucket);
    return this.releaseLock(lockPath);
  }

  /**
   * Acquires a filesystem-based advisory lock for interactive authentication.
   */
  async acquireAuthLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    this.validateName(provider, 'provider');
    if (options?.bucket) this.validateName(options.bucket, 'bucket');

    const lockPath = this.authLockFilePath(provider, options?.bucket);
    const waitMs = options?.waitMs ?? 60_000;
    const staleMs = options?.staleMs ?? 360_000;

    return this.acquireLock(lockPath, waitMs, staleMs);
  }

  /**
   * Releases the auth lock for a provider. Idempotent.
   */
  async releaseAuthLock(provider: string, bucket?: string): Promise<void> {
    this.validateName(provider, 'provider');
    if (bucket) this.validateName(bucket, 'bucket');
    const lockPath = this.authLockFilePath(provider, bucket);
    return this.releaseLock(lockPath);
  }
}
