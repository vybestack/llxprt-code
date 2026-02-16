/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token store that proxies all operations through a Unix domain socket
 * to the host-side credential proxy server. Used inside sandbox containers.
 *
 * @plan PLAN-20250214-CREDPROXY.P09
 * @requirement R2.1, R8.1-R8.9, R23.3, R29.1-R29.4
 * @pseudocode analysis/pseudocode/003-proxy-token-store.md
 */

import { type OAuthToken, type BucketStats } from '../types.js';
import { type TokenStore } from '../token-store.js';
import { ProxySocketClient } from './proxy-socket-client.js';

export class ProxyTokenStore implements TokenStore {
  private readonly client: ProxySocketClient;

  constructor(socketPath: string) {
    this.client = new ProxySocketClient(socketPath);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    const response = await this.client.request('get_token', {
      provider,
      bucket,
    });
    if (!response.ok && response.code === 'NOT_FOUND') return null;
    if (!response.ok) throw new Error(response.error ?? 'proxy error');
    return response.data as unknown as OAuthToken;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    const response = await this.client.request('save_token', {
      provider,
      bucket,
      token,
    });
    if (!response.ok) throw new Error(response.error ?? 'proxy error');
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    const response = await this.client.request('remove_token', {
      provider,
      bucket,
    });
    if (!response.ok) throw new Error(response.error ?? 'proxy error');
  }

  async listProviders(): Promise<string[]> {
    const response = await this.client.request('list_providers', {});
    if (!response.ok) throw new Error(response.error ?? 'proxy error');
    return (response.data as Record<string, unknown>).providers as string[];
  }

  async listBuckets(provider: string): Promise<string[]> {
    const response = await this.client.request('list_buckets', { provider });
    if (!response.ok) throw new Error(response.error ?? 'proxy error');
    return (response.data as Record<string, unknown>).buckets as string[];
  }

  async getBucketStats(
    provider: string,
    bucket: string,
  ): Promise<BucketStats | null> {
    const response = await this.client.request('get_bucket_stats', {
      provider,
      bucket,
    });
    if (!response.ok && response.code === 'NOT_FOUND') return null;
    if (!response.ok) throw new Error(response.error ?? 'proxy error');
    return { bucket, requestCount: 0, percentage: 0, lastUsed: undefined };
  }

  async acquireRefreshLock(
    _provider: string,
    _options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(_provider: string, _bucket?: string): Promise<void> {
    // No-op: refresh coordination happens on host
  }

  getClient(): ProxySocketClient {
    return this.client;
  }
}
