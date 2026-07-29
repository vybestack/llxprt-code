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
import {
  OAuthTokenSchema,
  type OAuthToken,
  type BucketStats,
} from './types.js';
import { type TokenStore } from './token-store.js';
import { type IDebugLogger, type ISecureStore } from './interfaces/index.js';
import {
  buildCurrentProcessOwnerMetadata,
  parseOwnerMetadata,
  probeOwnerLiveness,
  serializeOwnerMetadata,
  type LockOwnerMetadata,
} from './lock-owner.js';

const NAME_REGEX = /^[a-zA-Z0-9._@-]{1,64}$/;
const DEFAULT_BUCKET = 'default';
const DEFAULT_LOCK_WAIT_MS = 10_000;
const LOCK_BACKOFF_BASE_MS = 100;
const LOCK_BACKOFF_CAP_MS = 2_000;
const LOCK_BACKOFF_JITTER_MS = 50;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function waitUntilDeadline<T>(
  promise: Promise<T>,
  deadline: number,
  fallback: T,
): Promise<T> {
  const remaining = Math.max(0, deadline - Date.now());
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(fallback), remaining);
    promise
      .then(resolve, () => resolve(fallback))
      .finally(() => {
        clearTimeout(timeout);
      });
  });
}

/**
 * Compute the next bounded randomized/exponential backoff delay.
 *
 * Replaces fixed synchronized polling so multiple contenders for the same
 * provider+bucket do not all hammer the lock file on the same cadence. The
 * delay grows exponentially from `base` up to `cap`, with a small uniform
 * jitter so independent contenders desynchronize over time.
 */
export function computeBackoffDelay(
  attempt: number,
  base: number,
  cap: number,
  jitter: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(attempt, 16);
  const jitterRange = Math.min(jitter, cap);
  const exp = Math.min(cap - jitterRange, base * 2 ** exponent);
  return exp + Math.floor(random() * jitterRange);
}

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
    onWait?: () => Promise<boolean>,
  ): Promise<boolean> {
    if (this.heldTokens.has(lockPath)) {
      return false;
    }

    const startTime = Date.now();
    const deadline = startTime + waitMs;
    await this.ensureLockDir();
    const owner = await buildCurrentProcessOwnerMetadata(
      Math.max(0, deadline - Date.now()),
    );

    this.logger.debug(`[acquireLock] wait=${waitMs}`);

    let attempt = 0;
    while (Date.now() < deadline) {
      const acquired = await this.tryCreateLock(lockPath, owner);
      if (acquired) {
        return true;
      }
      const recovered = await this.maybeRecoverDeadOwnerLock(
        lockPath,
        owner,
        Math.max(0, deadline - Date.now()),
      );
      if (recovered) {
        return true;
      }
      if (
        onWait !== undefined &&
        (await waitUntilDeadline(onWait(), deadline, false))
      ) {
        return false;
      }

      const delay = computeBackoffDelay(
        attempt,
        LOCK_BACKOFF_BASE_MS,
        LOCK_BACKOFF_CAP_MS,
        LOCK_BACKOFF_JITTER_MS,
      );
      attempt += 1;
      await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
    }

    return false;
  }

  /**
   * Publishes a complete owner record through a same-directory temporary file.
   * The hard-link claim is atomic and never replaces an existing owner.
   */
  private async publishOwnerFile(
    targetPath: string,
    owner: LockOwnerMetadata,
  ): Promise<boolean> {
    const temporaryPath = `${targetPath}.${owner.ownerToken}.tmp`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serializeOwnerMetadata(owner), 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      try {
        await fs.link(temporaryPath, targetPath);
      } catch (error) {
        if (isErrnoCode(error, 'EEXIST')) {
          return false;
        }
        throw error;
      }
      return true;
    } finally {
      await handle?.close().catch(() => undefined);
      await fs.unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async tryCreateLock(
    lockPath: string,
    owner: LockOwnerMetadata,
  ): Promise<boolean> {
    const published = await this.publishOwnerFile(lockPath, owner);
    if (published) {
      this.heldTokens.set(lockPath, owner.ownerToken);
    }
    return published;
  }

  /**
   * Coordinated/fenced takeover protocol for a lock whose owner is provably
   * dead on the current host.
   *
   * When `acquireLock` observes EEXIST, it reads the existing payload and
   * probes owner liveness. If the owner is provably dead (PID gone on this
   * host, or the PID was recycled to us with a different process-start
   * identity), this method runs a fenced takeover:
   *
   *   1. Exactly one contender wins an O_EXCL fence file
   *      (`<lockPath>.fence`). The fence carries the contender's owner
   *      metadata so a crashed fence-winner is detectable by future
   *      contenders.
   *   2. The fence winner unlinks the dead lock and atomically claims it
   *      via O_EXCL on the lock path itself. If a fresh owner appeared in
   *      the gap (another legitimate contender won the post-unlink race),
   *      the O_EXCL fails and the fence winner backs off — it never deletes
   *      a successor.
   *   3. Fence losers probe the fence owner's liveness; if the fence owner
   *      is dead (crashed mid-takeover), they remove the stale fence and
   *      retry. Otherwise they defer.
   *
   * This prevents the unsafe pattern where multiple contenders all unlink a
   * foreign lock and then all attempt auth, or where a contender deletes a
   * successor's lock. Live/unverifiable owners are never reclaimed.
   *
   * Returns true if this caller won the fence and now owns the lock.
   */
  private async maybeRecoverDeadOwnerLock(
    lockPath: string,
    owner: LockOwnerMetadata,
    probeTimeoutMs: number,
  ): Promise<boolean> {
    let existingContent: string;
    try {
      existingContent = await fs.readFile(lockPath, 'utf8');
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) {
        // Lock vanished between EEXIST and read — another contender already
        // completed. Loop back in acquireLock.
        return false;
      }
      throw error;
    }

    const existingOwner = parseOwnerMetadata(existingContent);
    const liveness = await probeOwnerLiveness(existingOwner, {
      probeTimeoutMs,
    });

    if (liveness.status !== 'dead' || existingOwner === null) {
      this.logger.debug(
        `[acquireLock] existing owner is ${liveness.status}, deferring`,
      );
      return false;
    }

    this.logger.debug(
      `[acquireLock] recovering dead-owner lock at ${lockPath}`,
    );
    return this.fencedTakeover(lockPath, existingOwner, owner, probeTimeoutMs);
  }

  private async fencedTakeover(
    lockPath: string,
    deadOwner: LockOwnerMetadata,
    owner: LockOwnerMetadata,
    probeTimeoutMs: number,
  ): Promise<boolean> {
    const fencePath = `${lockPath}.fence`;
    const fenceResult = await this.tryWinFence(fencePath, owner);
    if (fenceResult === 'lost') {
      await this.handleLostFence(fencePath, probeTimeoutMs);
      return false;
    }

    try {
      return await this.executeFencedClaim(lockPath, deadOwner, owner);
    } finally {
      await this.removeOwnedFile(fencePath, owner.ownerToken);
    }
  }

  private async tryWinFence(
    fencePath: string,
    owner: LockOwnerMetadata,
  ): Promise<'won' | 'lost'> {
    return (await this.publishOwnerFile(fencePath, owner)) ? 'won' : 'lost';
  }

  private async handleLostFence(
    fencePath: string,
    probeTimeoutMs: number,
  ): Promise<void> {
    const fenceOwner = await this.readOwner(fencePath);
    const liveness = await probeOwnerLiveness(fenceOwner, { probeTimeoutMs });
    if (fenceOwner !== null && liveness.status === 'dead') {
      await this.removeOwnedFile(fencePath, fenceOwner.ownerToken);
    }
  }

  private async executeFencedClaim(
    lockPath: string,
    deadOwner: LockOwnerMetadata,
    owner: LockOwnerMetadata,
  ): Promise<boolean> {
    const observedOwner = await this.readOwner(lockPath);
    if (observedOwner?.ownerToken !== deadOwner.ownerToken) {
      return false;
    }

    await this.removeOwnedFile(lockPath, deadOwner.ownerToken);
    try {
      return await this.tryCreateLock(lockPath, owner);
    } catch (error) {
      if (isErrnoCode(error, 'EEXIST')) {
        return false;
      }
      throw error;
    }
  }

  private async readOwner(lockPath: string): Promise<LockOwnerMetadata | null> {
    try {
      return parseOwnerMetadata(await fs.readFile(lockPath, 'utf8'));
    } catch (error) {
      if (isErrnoCode(error, 'ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  private async removeOwnedFile(
    lockPath: string,
    ownerToken: string,
  ): Promise<void> {
    const observedOwner = await this.readOwner(lockPath);
    if (observedOwner?.ownerToken !== ownerToken) {
      return;
    }
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      if (!isErrnoCode(error, 'ENOENT')) {
        throw error;
      }
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
      const owner = parseOwnerMetadata(content);
      if (owner !== null && owner.ownerToken === token) {
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
    options?: {
      waitMs?: number;
      bucket?: string;
      onWait?: () => Promise<boolean>;
    },
  ): Promise<boolean> {
    this.validateName(provider, 'provider');
    if (options?.bucket) this.validateName(options.bucket, 'bucket');

    const lockPath = this.authLockFilePath(provider, options?.bucket);
    const waitMs = options?.waitMs ?? 60_000;

    return this.acquireLock(lockPath, waitMs, options?.onWait);
  }

  async releaseAuthLock(provider: string, bucket?: string): Promise<void> {
    this.validateName(provider, 'provider');
    if (bucket) this.validateName(bucket, 'bucket');
    const lockPath = this.authLockFilePath(provider, bucket);
    return this.releaseLock(lockPath);
  }
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
