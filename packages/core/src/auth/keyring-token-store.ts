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
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P04
 * @requirement R1.1, R1.2, R1.3
 */

import * as crypto from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { type OAuthToken, type BucketStats } from './types.js';
import { type TokenStore } from './token-store.js';
import { SecureStore } from '../storage/secure-store.js';
import { DebugLogger } from '../debug/index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const SERVICE_NAME = 'llxprt-code-oauth';
const NAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_BUCKET = 'default';
const LOCK_DIR = join(homedir(), '.llxprt', 'oauth', 'locks');
const DEFAULT_LOCK_WAIT_MS = 10_000;
const DEFAULT_STALE_THRESHOLD_MS = 30_000;
const LOCK_POLL_INTERVAL_MS = 100;

// ─── KeyringTokenStore Class ─────────────────────────────────────────────────

export class KeyringTokenStore implements TokenStore {
  private readonly secureStore: SecureStore;
  private readonly logger: DebugLogger;

  constructor(options?: { secureStore?: SecureStore }) {
    this.secureStore =
      options?.secureStore ??
      new SecureStore(SERVICE_NAME, {
        fallbackDir: join(homedir(), '.llxprt', 'secure-store', SERVICE_NAME),
        fallbackPolicy: 'allow',
      });
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

  private hashIdentifier(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  private lockFilePath(provider: string, bucket?: string): string {
    const resolved = bucket ?? DEFAULT_BUCKET;
    if (resolved === DEFAULT_BUCKET) {
      return join(LOCK_DIR, `${provider}-refresh.lock`);
    }
    return join(LOCK_DIR, `${provider}-${resolved}-refresh.lock`);
  }

  private async ensureLockDir(): Promise<void> {
    throw new Error('NotYetImplemented');
  }

  async saveToken(provider: string, token: OAuthToken, bucket?: string): Promise<void> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(() => `[saveToken] [${this.hashIdentifier(key)}] type=${token.token_type}`);
    throw new Error('NotYetImplemented');
  }

  async getToken(provider: string, bucket?: string): Promise<OAuthToken | null> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(() => `[getToken] [${this.hashIdentifier(key)}]`);
    throw new Error('NotYetImplemented');
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    const key = this.accountKey(provider, bucket);
    this.logger.debug(() => `[removeToken] [${this.hashIdentifier(key)}]`);
    throw new Error('NotYetImplemented');
  }

  async listProviders(): Promise<string[]> {
    this.logger.debug(() => `[listProviders] store=${this.secureStore.constructor.name}`);
    throw new Error('NotYetImplemented');
  }

  async listBuckets(provider: string): Promise<string[]> {
    this.validateName(provider, 'provider');
    throw new Error('NotYetImplemented');
  }

  async getBucketStats(provider: string, bucket: string): Promise<BucketStats | null> {
    this.accountKey(provider, bucket);
    throw new Error('NotYetImplemented');
  }

  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    this.validateName(provider, 'provider');
    if (options?.bucket) this.validateName(options.bucket, 'bucket');
    const waitMs = options?.waitMs ?? DEFAULT_LOCK_WAIT_MS;
    const staleMs = options?.staleMs ?? DEFAULT_STALE_THRESHOLD_MS;
    this.lockFilePath(provider, options?.bucket);
    await this.ensureLockDir();
    this.logger.debug(
      () => `[acquireRefreshLock] wait=${waitMs} stale=${staleMs} poll=${LOCK_POLL_INTERVAL_MS}`,
    );
    throw new Error('NotYetImplemented');
  }

  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    this.validateName(provider, 'provider');
    if (bucket) this.validateName(bucket, 'bucket');
    this.lockFilePath(provider, bucket);
    throw new Error('NotYetImplemented');
  }
}
