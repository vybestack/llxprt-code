/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keyring-backed OAuth token storage implementing the TokenStore interface.
 *
 * Delegates credential CRUD to SecureStore (OS keychain with encrypted
 * file fallback) and uses filesystem-based advisory locks for refresh
 * concurrency control.
 *
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
 * @requirement R1.1, R1.2, R1.3
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  OAuthTokenSchema,
  type OAuthToken,
  type BucketStats,
} from './types.js';
import { type TokenStore } from './token-store.js';
import { SecureStore, SecureStoreError } from '../storage/secure-store.js';
import { DebugLogger } from '../debug/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVICE_NAME = 'llxprt-code-oauth';
const NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_BUCKET = 'default';
const DEFAULT_LOCK_WAIT_MS = 10_000;
const DEFAULT_STALE_THRESHOLD_MS = 30_000;
const LOCK_POLL_INTERVAL_MS = 100;

/** Lazily resolved to avoid crashing when homedir() is undefined at import time. */
let _lockDir: string | undefined;
function getLockDir(): string {
  if (!_lockDir) {
    _lockDir = join(homedir(), '.llxprt', 'oauth', 'locks');
  }
  return _lockDir;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── KeyringTokenStore Class ─────────────────────────────────────────────────

/**
 * Keyring-backed token store with filesystem advisory locks.
 *
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
 */
export class KeyringTokenStore implements TokenStore {
  private readonly secureStore: SecureStore;
  private readonly logger: DebugLogger;
  private readonly lockDir: string;

  constructor(options?: { secureStore?: SecureStore; lockDir?: string }) {
    this.secureStore =
      options?.secureStore ??
      new SecureStore(SERVICE_NAME, {
        fallbackDir: join(homedir(), '.llxprt', 'secure-store', SERVICE_NAME),
        fallbackPolicy: 'allow',
      });
    this.lockDir = options?.lockDir ?? getLockDir();
    this.logger = new DebugLogger('llxprt:keyring-token-store');
  }

  private validateName(name: string, label: string): void {
    if (!NAME_REGEX.test(name)) {
      throw new Error(
        `Invalid ${label} name: "${name}". Allowed: letters, numbers, dashes, underscores.`,
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
   * Account keys are configuration labels (not secrets), but we still
   * one-way hash them for log brevity. Using FNV-1a instead of
   * crypto.createHash avoids a false-positive CodeQL alert
   * (js/insufficient-password-hash) that cannot distinguish log
   * identifiers from password storage.
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

  /**
   * Ensures the lock directory exists.
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
   */
  private async ensureLockDir(): Promise<void> {
    await fs.mkdir(this.lockDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Validates and persists an OAuth token to SecureStore.
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
   */
  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(
      () =>
        `[saveToken] [${this.hashIdentifier(key)}] type=${token.token_type}`,
    );
    const validatedToken = OAuthTokenSchema.passthrough().parse(token);
    const serialized = JSON.stringify(validatedToken);
    await this.secureStore.set(key, serialized);
  }

  /**
   * Retrieves and validates an OAuth token from SecureStore.
   * Returns null for missing or corrupt data (logged with hashed identifier).
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
   */
  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(() => `[getToken] [${this.hashIdentifier(key)}]`);

    let raw: string | null;
    try {
      raw = await this.secureStore.get(key);
    } catch (error) {
      if (error instanceof SecureStoreError && error.code === 'CORRUPT') {
        this.logger.warn(
          () =>
            `Corrupt token envelope for [${this.hashIdentifier(key)}]: ${error.message}`,
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
        () => `Corrupt token JSON for [${this.hashIdentifier(key)}]: ${msg}`,
      );
      return null;
    }

    try {
      return OAuthTokenSchema.passthrough().parse(parsed);
    } catch (zodError) {
      const msg =
        zodError instanceof Error ? zodError.message : String(zodError);
      this.logger.warn(
        () => `Invalid token schema for [${this.hashIdentifier(key)}]: ${msg}`,
      );
      return null;
    }
  }

  /**
   * Removes a token from SecureStore. Best-effort — errors are swallowed.
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
   */
  async removeToken(provider: string, bucket?: string): Promise<void> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(() => `[removeToken] [${this.hashIdentifier(key)}]`);
    try {
      await this.secureStore.delete(key);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        () =>
          `Failed to remove token for [${this.hashIdentifier(key)}]: ${msg}`,
      );
    }
  }

  /**
   * Lists all unique provider names from SecureStore keys.
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
   */
  async listProviders(): Promise<string[]> {
    this.logger.debug(
      () => `[listProviders] store=${this.secureStore.constructor.name}`,
    );
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
      this.logger.warn(() => `Failed to list providers: ${msg}`);
      return [];
    }
  }

  /**
   * Lists all bucket names for a given provider.
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
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
        () =>
          `Failed to list buckets for [${this.hashIdentifier(provider + ':')}]: ${msg}`,
      );
      return [];
    }
  }

  /**
   * Returns placeholder bucket statistics if a token exists for the given bucket.
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
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
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
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
    const startTime = Date.now();

    await this.ensureLockDir();

    this.logger.debug(
      () =>
        `[acquireRefreshLock] wait=${waitMs} stale=${staleMs} poll=${LOCK_POLL_INTERVAL_MS}`,
    );

    while (Date.now() - startTime < waitMs) {
      try {
        const lockInfo = { pid: process.pid, timestamp: Date.now() };
        await fs.writeFile(lockPath, JSON.stringify(lockInfo), {
          flag: 'wx',
          mode: 0o600,
        });
        return true;
      } catch (writeError) {
        const err = writeError as NodeJS.ErrnoException;
        if (err.code !== 'EEXIST') {
          throw writeError;
        }
      }

      // Lock file exists — read and check staleness
      try {
        const content = await fs.readFile(lockPath, 'utf8');
        const existing = JSON.parse(content) as {
          pid: number;
          timestamp: number;
        };
        const lockAge = Date.now() - existing.timestamp;

        if (lockAge > staleMs) {
          // Stale lock — break it
          try {
            await fs.unlink(lockPath);
          } catch {
            // Ignore ENOENT — another process may have broken it
          }
          continue;
        }
      } catch {
        // Lock file unreadable or corrupt — break it
        try {
          await fs.unlink(lockPath);
        } catch {
          // Ignore ENOENT
        }
        continue;
      }

      // Lock is fresh — wait and retry
      await sleep(LOCK_POLL_INTERVAL_MS);
    }

    return false;
  }

  /**
   * Releases a filesystem-based advisory lock. Idempotent.
   * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
   */
  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    this.validateName(provider, 'provider');
    if (bucket) this.validateName(bucket, 'bucket');
    const lockPath = this.lockFilePath(provider, bucket);
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
