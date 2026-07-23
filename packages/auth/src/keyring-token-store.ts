/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keyring-backed OAuth token storage implementing the TokenStore interface.
 *
 * Delegates credential CRUD to ISecureStore (injected via DI) and uses
 * filesystem-based advisory locks (O_EXCL) for refresh concurrency control.
 *
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06, PLAN-20260608-ISSUE1586.P09
 * @requirement R1.1, R1.2, R1.3, REQ-AUTH-001.1
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OAuthTokenSchema,
  type OAuthToken,
  type BucketStats,
} from './types.js';
import { type TokenStore } from './token-store.js';
import { type IDebugLogger, type ISecureStore } from './interfaces/index.js';

const NAME_REGEX = /^[a-zA-Z0-9._@-]{1,64}$/;
const DEFAULT_BUCKET = 'default';
const DEFAULT_LOCK_WAIT_MS = 10_000;
const LOCK_POLL_INTERVAL_MS = 100;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
  private readonly heldTokens: Map<string, string> = new Map();

  constructor(options?: {
    secureStore: ISecureStore;
    lockDir: string;
    logger?: IDebugLogger;
  }) {
    if (options?.secureStore === undefined) {
      throw new Error(
        'KeyringTokenStore requires an ISecureStore instance. ' +
          'Use createKeyringTokenStore() from core.',
      );
    }
    if (typeof options.lockDir !== 'string' || options.lockDir.trim() === '') {
      throw new Error(
        'KeyringTokenStore requires a lockDir (OAuth advisory lock directory). ' +
          'Use createKeyringTokenStore() from core, which injects ' +
          'Storage.getOAuthLocksDir().',
      );
    }
    this.secureStore = options.secureStore;
    this.logger = options.logger ?? KeyringTokenStore.NO_OP_LOGGER;
    this.lockDir = options.lockDir;
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

  private async ensureLockDir(): Promise<void> {
    await fs.mkdir(this.lockDir, { recursive: true, mode: 0o700 });
  }

  private async acquireLock(
    lockPath: string,
    waitMs: number,
  ): Promise<boolean> {
    if (this.heldTokens.has(lockPath)) {
      return false;
    }

    const startTime = Date.now();
    await this.ensureLockDir();

    this.logger.debug(
      `[acquireLock] wait=${waitMs} poll=${LOCK_POLL_INTERVAL_MS}`,
    );

    while (Date.now() - startTime < waitMs) {
      const token = randomUUID();
      const payload = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        token,
      });
      try {
        const acquired = await this.tryCreateLock(lockPath, payload, token);
        if (acquired) {
          return true;
        }
      } catch (error) {
        if (!isErrnoCode(error, 'EEXIST')) {
          throw error;
        }
        // EEXIST: lock held by another owner or a stale orphan. No PID-based
        // reclaim — poll until timeout. This is safety-over-availability: a
        // stale orphan requires process restart or manual cleanup.
      }

      await sleep(LOCK_POLL_INTERVAL_MS);
    }

    return false;
  }

  /**
   * Attempts to create the lock file with O_EXCL. On success, records the
   * token in heldTokens and returns true. On EEXIST, returns false (no
   * throw). Other errors propagate. A close failure after a successful
   * payload write still records ownership (the file is on disk with our
   * content) but surfaces a warning.
   */
  private async tryCreateLock(
    lockPath: string,
    payload: string,
    token: string,
  ): Promise<boolean> {
    const fh = await fs.open(lockPath, 'wx', 0o600);
    let closeError: unknown;
    try {
      await fh.writeFile(payload, 'utf8');
    } catch (writeError) {
      // writeFile failure means the payload may be incomplete; close
      // and remove the orphan, then rethrow.
      try {
        await fh.close();
      } catch {
        // best-effort close
      }
      await this.removeOrphan(lockPath);
      throw writeError;
    }
    try {
      await fh.close();
    } catch (err) {
      closeError = err;
    }
    // The payload was written successfully — we own the lock. Record
    // the token so release can verify-and-unlink. A close error does
    // not change ownership (the file is on disk with our content).
    this.heldTokens.set(lockPath, token);
    if (closeError !== undefined) {
      this.logger.warn(
        `[acquireLock] unexpected close error for ${lockPath}: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
      );
    }
    return true;
  }

  private async removeOrphan(lockPath: string): Promise<void> {
    try {
      await fs.unlink(lockPath);
    } catch {
      // best-effort cleanup of an incomplete write
    }
  }

  private async releaseLock(lockPath: string): Promise<void> {
    const token = this.heldTokens.get(lockPath);
    if (token === undefined) {
      return;
    }
    // Always clear heldTokens so a release error never causes a permanent
    // self-deadlock on future acquisitions. Surface unexpected I/O errors
    // to the caller via the throw below.
    try {
      const content = await fs.readFile(lockPath, 'utf8');
      const payload = parseLockPayload(content);
      if (payload !== null && payload.token === token) {
        await fs.unlink(lockPath);
      }
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) {
        throw error;
      }
    } finally {
      this.heldTokens.delete(lockPath);
    }
  }

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
      if (isSecureStoreCorruptError(error)) {
        const msg = errorMessageOf(error);
        this.logger.warn(
          `Corrupt token envelope for [${this.hashIdentifier(key)}]: ${msg}`,
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

  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    this.validateName(provider, 'provider');
    if (options?.bucket) this.validateName(options.bucket, 'bucket');

    const lockPath = this.lockFilePath(provider, options?.bucket);
    const waitMs = options?.waitMs ?? DEFAULT_LOCK_WAIT_MS;

    return this.acquireLock(lockPath, waitMs);
  }

  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    this.validateName(provider, 'provider');
    if (bucket) this.validateName(bucket, 'bucket');
    const lockPath = this.lockFilePath(provider, bucket);
    return this.releaseLock(lockPath);
  }

  async acquireAuthLock(
    provider: string,
    options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    this.validateName(provider, 'provider');
    if (options?.bucket) this.validateName(options.bucket, 'bucket');

    const lockPath = this.authLockFilePath(provider, options?.bucket);
    const waitMs = options?.waitMs ?? 60_000;

    return this.acquireLock(lockPath, waitMs);
  }

  async releaseAuthLock(provider: string, bucket?: string): Promise<void> {
    this.validateName(provider, 'provider');
    if (bucket) this.validateName(bucket, 'bucket');
    const lockPath = this.authLockFilePath(provider, bucket);
    return this.releaseLock(lockPath);
  }
}

interface LockPayload {
  readonly pid: number;
  readonly timestamp: number;
  readonly token?: string;
}

function parseLockPayload(raw: string): LockPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isLockPayloadObject(parsed)) {
    return null;
  }
  return {
    pid: parsed.pid,
    timestamp: parsed.timestamp,
    token: typeof parsed.token === 'string' ? parsed.token : undefined,
  };
}

function isLockPayloadObject(
  value: unknown,
): value is { pid: number; timestamp: number; token?: unknown } & Record<
  string,
  unknown
> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (!('pid' in v) || !('timestamp' in v)) {
    return false;
  }
  if (typeof v.pid !== 'number' || typeof v.timestamp !== 'number') {
    return false;
  }
  return true;
}

function isSecureStoreCorruptError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Record<string, unknown>).code === 'CORRUPT'
  );
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isErrnoCode(error: unknown, expected: string): boolean {
  return errnoCodeOf(error) === expected;
}

function errnoCodeOf(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}
